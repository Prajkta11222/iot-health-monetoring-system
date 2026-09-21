"""
Smart Health Monitoring System - Serial Hardware Gateway Bridge

Connects the physical ESP32 via USB Serial to the existing system:
ESP32 USB Serial → serial_hardware_bridge.py → existing /api/readings → MongoDB → ML → React

Key Capabilities:
- Auto-detects connected ESP32 USB COM port (Silicon Labs CP210x, CH340, FTDI, WCH, etc.)
- Supports hot-unplug and automatic reconnection
- Parses real-time sensor streams at 115200 baud:
  * JSON telemetry format (e.g. [TELEMETRY_JSON] or raw JSON)
  * Standard firmware serial text logs (e.g. SpO2 = 98 %, MAX HR = 75 BPM, etc.)
- Ingests real hardware readings into http://127.0.0.1:4000/api/readings
- Zero mock data; sends only real readings from the connected hardware

Usage:
    .\\ml-service\\.venv\\Scripts\\python.exe serial_hardware_bridge.py
    .\\ml-service\\.venv\\Scripts\\python.exe serial_hardware_bridge.py COM3
"""

import sys
import os
import time
import json
import re
import urllib.request
import functools
import serial
import serial.tools.list_ports
from datetime import datetime, timezone

# Unbuffer print output for real-time terminal output
print = functools.partial(print, flush=True)

# Ensure robust UTF-8 console output across Windows cmd/powershell
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:4000/api/readings")
DEVICE_KEY = os.environ.get("DEVICE_API_KEY", "dev-api-key-123")
DEVICE_ID = os.environ.get("DEVICE_ID", "ESP32_HARDWARE_NODE_01")
PATIENT_ID = os.environ.get("PATIENT_ID", "PATIENT_DEMO_2026")
BAUD_RATE = 115200


def list_available_ports():
    return list(serial.tools.list_ports.comports())


def find_esp32_port():
    ports = list_available_ports()
    esp_keywords = [
        "cp210", "ch340", "ch341", "ch910", "wch", "ftdi",
        "usb serial", "usb-serial", "esp", "silicon labs",
        "uart", "espressif", "usb to uart", "pl2303"
    ]

    # 1. Match known USB-UART chip descriptions or HWIDs
    for p in ports:
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        if any(k in desc or k in hwid for k in esp_keywords):
            return p.device

    # 2. Match any USB-connected COM port (exclude ACPI / motherboard ports)
    for p in ports:
        hwid = (p.hwid or "").upper()
        desc = (p.description or "").lower()
        if "USB" in hwid and "ACPI" not in hwid and "bluetooth" not in desc:
            return p.device

    return None


def send_to_backend(payload):
    """Post reading to the existing Express backend /api/readings endpoint."""
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            BACKEND_URL,
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-device-api-key": DEVICE_KEY
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.getcode() == 201
    except Exception as e:
        print(f"  ❌ Backend ingestion error: {e}")
        return False


def build_reading_payload(state):
    """Construct a payload conforming to backend reading validation schema."""
    finger = bool(state.get("fingerDetected"))
    hr_valid = bool(state.get("heartRateValid") and state.get("heartRate") is not None)
    spo2_valid = bool(state.get("spo2Valid") and state.get("spo2") is not None)
    temp_valid = bool(state.get("temperatureValid") and state.get("temperature") is not None)
    lead_off = bool(state.get("ecgLeadOff", False))

    ppg_quality = "GOOD" if (finger and spo2_valid) else ("POOR" if finger else "NO_FINGER")
    ecg_quality = "LEAD_OFF" if lead_off else "GOOD"

    payload = {
        "deviceId": DEVICE_ID,
        "patientId": PATIENT_ID,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "heartRate": int(state["heartRate"]) if hr_valid else None,
        "heartRateValid": hr_valid,
        "spo2": float(state["spo2"]) if spo2_valid else None,
        "spo2Valid": spo2_valid,
        "temperature": float(state["temperature"]) if temp_valid else None,
        "temperatureValid": temp_valid,
        "ecg": state.get("ecg") if (isinstance(state.get("ecg"), list) and not lead_off) else [],
        "ecgLeadOff": lead_off,
        "ecgSignalQuality": ecg_quality,
        "ppgSignalQuality": ppg_quality,
        "fingerDetected": finger,
        "wifiRssi": state.get("wifiRssi", None),
        "max30102Status": "CONNECTED" if finger else "NO_FINGER",
        "ad8232Status": "LEAD_OFF" if lead_off else "GOOD_SIGNAL",
        "ds18b20Status": "CONNECTED" if temp_valid else "INVALID",
        "esp32Status": "ONLINE"
    }
    return payload


def run_bridge(target_port=None):
    print("=" * 65)
    print("   🔌 SMART HEALTH SERIAL HARDWARE GATEWAY BRIDGE")
    print("   ESP32 USB Serial → /api/readings → MongoDB → ML → React")
    print("=" * 65)

    last_scan_print = 0

    while True:
        port = target_port or find_esp32_port()
        if not port:
            now = time.time()
            if now - last_scan_print >= 4:
                available = list_available_ports()
                if available:
                    port_list = ", ".join(f"{p.device} ({p.description})" for p in available)
                    print(f"⏳ Scanning... Detected ports: [{port_list}]. Plug in ESP32 via USB.")
                else:
                    print("⏳ Scanning for USB hardware... No COM ports detected. (Plug in ESP32 via USB)")
                last_scan_print = now
            time.sleep(1.5)
            continue

        print(f"\n🔍 Connecting to hardware on port [{port}] at {BAUD_RATE} baud...")
        ser = None
        try:
            # Configure serial port with DTR/RTS disabled before opening to avoid reset pulses
            ser = serial.Serial()
            ser.port = port
            ser.baudrate = BAUD_RATE
            ser.timeout = 2
            ser.dtr = False
            ser.rts = False
            ser.open()

            time.sleep(0.5)
            ser.reset_input_buffer()
            print(f"✅ CONNECTED to {port}! Streaming live telemetry to {BACKEND_URL}\n")
            print("-" * 65)

            # Hardware state tracking for live telemetry aggregation
            state = {
                "fingerDetected": False,
                "heartRate": None,
                "heartRateValid": False,
                "spo2": None,
                "spo2Valid": False,
                "temperature": None,
                "temperatureValid": False,
                "ecg": [],
                "ecgLeadOff": False,
                "wifiRssi": None
            }

            count = 0
            last_periodic_send = 0
            state_changed = False

            while True:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                now = time.time()

                if line:
                    # 1. Parse JSON Telemetry (e.g. [TELEMETRY_JSON]{...} or raw {...})
                    if "{" in line and "}" in line:
                        start_idx = line.find("{")
                        end_idx = line.rfind("}") + 1
                        json_str = line[start_idx:end_idx]
                        try:
                            doc = json.loads(json_str)
                            # Update with fresh UTC timestamp for real-time frontend syncing
                            doc["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                            if "deviceId" not in doc:
                                doc["deviceId"] = DEVICE_ID
                            if "patientId" not in doc:
                                doc["patientId"] = PATIENT_ID
                            count += 1
                            ok = send_to_backend(doc)
                            hr = doc.get("heartRate")
                            spo2 = doc.get("spo2")
                            temp = doc.get("temperature")
                            leads = "OFF" if doc.get("ecgLeadOff") else "CONNECTED"
                            finger = "YES" if doc.get("fingerDetected") else "NO"
                            status_sym = "✅" if ok else "⚠️"
                            print(f"[{count:04d}] {status_sym} USB Telemetry | HR: {hr or '--'} BPM | SpO2: {spo2 or '--'}% | Temp: {temp or '--'}°C | Leads: {leads} | Finger: {finger}")
                            last_periodic_send = now
                            continue
                        except json.JSONDecodeError:
                            pass

                    # 2. Parse Text Telemetry from untouched firmware
                    # MAX30102 SpO2
                    spo2_match = re.search(r"SpO2\s*=\s*(\d+)", line, re.IGNORECASE)
                    if spo2_match:
                        state["spo2"] = float(spo2_match.group(1))
                        state["spo2Valid"] = True
                        state["fingerDetected"] = True
                        state_changed = True
                    elif "SpO2 = INVALID" in line or "SpO2: INVALID" in line:
                        state["spo2"] = None
                        state["spo2Valid"] = False
                        state_changed = True

                    # MAX30102 Heart Rate
                    hr_match = re.search(r"(?:MAX\s*HR|HR)\s*=\s*(\d+)", line, re.IGNORECASE)
                    if hr_match:
                        state["heartRate"] = int(hr_match.group(1))
                        state["heartRateValid"] = True
                        state["fingerDetected"] = True
                        state_changed = True
                    elif "HR = INVALID" in line or "MAX HR = INVALID" in line:
                        state["heartRate"] = None
                        state["heartRateValid"] = False
                        state_changed = True

                    # Finger Detection hints
                    if "Place finger on MAX30102" in line or "NO_FINGER" in line:
                        state["fingerDetected"] = False
                        state["spo2"] = None
                        state["spo2Valid"] = False
                        state["heartRate"] = None
                        state["heartRateValid"] = False
                        state_changed = True
                    elif "Calculating SpO2 & HR..." in line:
                        state["fingerDetected"] = True

                    # AD8232 ECG Leads
                    if "ECG: OFF" in line or "LEAD_OFF" in line:
                        state["ecgLeadOff"] = True
                        state_changed = True
                    elif "ECG: OK" in line or "GOOD_SIGNAL" in line:
                        state["ecgLeadOff"] = False
                        state_changed = True

                    # DS18B20 Temperature
                    temp_match = re.search(r"(?:Temp|Temperature)\s*=\s*([\d\.]+)", line, re.IGNORECASE)
                    if temp_match:
                        state["temperature"] = float(temp_match.group(1))
                        state["temperatureValid"] = True
                        state_changed = True

                    # Display node log if it contains recognizable status
                    if any(key in line for key in ["Calculating", "SpO2", "HR", "OLED", "MAX30102", "Connected", "Wi-Fi"]):
                        print(f"  [NODE LOG] {line}")

                # Send telemetry reading when sensor data updates or periodically every 3 seconds
                if (state_changed and (now - last_periodic_send >= 2.0)) or (now - last_periodic_send >= 3.0):
                    payload = build_reading_payload(state)
                    count += 1
                    ok = send_to_backend(payload)
                    hr = payload.get("heartRate")
                    spo2 = payload.get("spo2")
                    temp = payload.get("temperature")
                    leads = "OFF" if payload.get("ecgLeadOff") else "CONNECTED"
                    finger = "YES" if payload.get("fingerDetected") else "NO"
                    status_sym = "✅" if ok else "⚠️"
                    print(f"[{count:04d}] {status_sym} USB Telemetry | HR: {hr or '--'} BPM | SpO2: {spo2 or '--'}% | Temp: {temp or '--'}°C | Leads: {leads} | Finger: {finger}")
                    last_periodic_send = now
                    state_changed = False

        except serial.SerialException as e:
            err_msg = str(e)
            if "PermissionError" in err_msg or "Access is denied" in err_msg:
                print(f"⚠️ Port {port} is busy or access denied. Ensure Arduino IDE Serial Monitor or other serial terminals are CLOSED.")
            else:
                print(f"⚠️ Serial connection event on {port}: {e}")
            print("Retrying in 2 seconds...")
            time.sleep(2)
        except KeyboardInterrupt:
            print("\nBridge stopped by user.")
            break
        finally:
            if ser is not None:
                try:
                    ser.close()
                except Exception:
                    pass


if __name__ == "__main__":
    cli_port = sys.argv[1] if len(sys.argv) > 1 else None
    run_bridge(cli_port)
