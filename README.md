# 🫀 Smart Health Monitoring & AI Diagnostic Suite

An enterprise-grade, end-to-end **IoT Healthcare Monitoring & Machine Learning Platform**. The system captures multi-channel sensor telemetry from an **ESP32 microcontroller node** (ECG, PPG, SpO2, and Body Temperature), executes **dual real-time Machine Learning models** (MIT-BIH Deep Learning Arrhythmia CNN + Scikit-Learn Vital Signs Classifier), evaluates composite clinical risks, triggers proactive incident alerts, and provides automated **Clinical PDF Medical Reports** with WhatsApp and Email sharing.

---

## 📑 Table of Contents

- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Dual Machine Learning Pipeline](#-dual-machine-learning-pipeline)
- [Frontend SaaS Application Views](#-frontend-saas-application-views)
- [Hardware Wiring & Sensor Pinout Guide](#-hardware-wiring--sensor-pinout-guide)
- [Hardware Connectivity Modes (USB Cable & Wi-Fi)](#-hardware-connectivity-modes)
- [Quick Start Guide](#-quick-start-guide)
- [Backend REST API Reference](#-backend-rest-api-reference)
- [Verification & Automated Tests](#-verification--automated-tests)

---

## 🏗️ System Architecture

```
                                  ┌───────────────────────────────┐
                                  │   ESP32 Hardware Node         │
                                  │ ───────────────────────────── │
                                  │ • MAX30102 (SpO2 & HR PPG)    │
                                  │ • AD8232 (ECG Lead Sensor)    │
                                  │ • DS18B20 (Precision Temp)    │
                                  │ • 0.96" I2C OLED Display      │
                                  └───────────────┬───────────────┘
                                                  │
                       ┌──────────────────────────┴──────────────────────────┐
                       │                                                     │
         [Wi-Fi Direct HTTP POST]                              [USB Cable COM Port Serial]
                       │                                                     │
                       │                                                     ▼
                       │                                       ┌───────────────────────────┐
                       │                                       │ serial_hardware_bridge.py │
                       │                                       └─────────────┬─────────────┘
                       ▼                                                     │
        ┌────────────────────────────────────────────────────────────────────┴┐
        │                     Node.js Express Backend API                     │
        │                           (Port 4000)                               │
        │ ─────────────────────────────────────────────────────────────────── │
        │  • Sensor Data Ingestion (/api/readings)                            │
        │  • Real-Time Overall Clinical Risk Engine                           │
        │  • Automated Incident & Alert Dispatching                           │
        │  • PDF Medical Report Generation (PDFKit)                           │
        │  • Role-Based JWT Authentication & Security                         │
        └───────────────────┬───────────────────────────────┬─────────────────┘
                            │                               │
                            ▼                               ▼
       ┌───────────────────────────────┐   ┌─────────────────────────────────┐
       │   FastAPI ML Microservice     │   │      MongoDB Atlas Cloud / DB   │
       │         (Port 8000)           │   │ ─────────────────────────────── │
       │ ───────────────────────────── │   │ • Users & Clinical Staff        │
       │ • MIT-BIH Arrhythmia CNN      │   │ • Telemetry Readings Stream     │
       │ • Vital Signs Risk Classifier │   │ • Dual ML Predictions History   │
       │ • 187-pt ECG Waveform Scoring │   │ • Overall Risk Evaluations      │
       └───────────────────────────────┘   │ • Alerts & Triage Incidents     │
                                           │ • Stored Clinical PDF Reports   │
                                           └────────────────┬────────────────┘
                                                            │
                                                            ▼
                                           ┌─────────────────────────────────┐
                                           │   React SaaS Clinical Dashboard │
                                           │            (Port 5173)          │
                                           │ ─────────────────────────────── │
                                           │ • Real-Time Vitals Dashboard    │
                                           │ • Deep-Dive Biometric Analytics │
                                           │ • Incident Surveillance & Triage│
                                           │ • Clinical Report Generator     │
                                           └─────────────────────────────────┘
```

---

## ⚡ Key Features

### 1. 🫀 Multi-Sensor Biometric Telemetry
- **MAX30102 Optical Pulse Oximeter**: Captures Red (660nm) and Infrared (880nm) photoplethysmography (PPG) waveforms to calculate Blood Oxygen Saturation (% SpO2) and Pulse Rate (BPM) with dynamic finger detection.
- **AD8232 Electrocardiogram (ECG)**: Samples cardiac electrical activity at **250 Hz**, buffers 187-point windows for machine learning arrhythmia classification, and detects physical lead-off states.
- **DS18B20 1-Wire Digital Temperature Sensor**: Provides ±0.5°C accurate clinical body temperature monitoring with sensor fault detection.
- **0.96" I2C OLED Display**: Real-time on-device ECG oscilloscope wave, SpO2, and heart rate output.

### 2. 🧠 Dual Machine Learning Diagnostic Models
- **Model 1 (ECG Arrhythmia Classifier)**: Evaluates 187 normalized ECG voltage points against the MIT-BIH Arrhythmia dataset, outputting `HIGH` or `LOW` risk with an exact confidence percentage.
- **Model 2 (Vital Signs Risk Classifier)**: Multi-parameter Scikit-Learn gradient-boosted pipeline that correlates Heart Rate, SpO2, and Temperature to detect vital signs deterioration.
- **Non-Blocking Execution**: Asynchronous inference upon hardware ingestion without blocking sensor streaming.

### 3. 🚨 Real-Time Risk Assessment & Incident Alerts
- **Composite Risk Engine**: Evaluates incoming telemetry against dual ML outputs, sensor signal qualities, and persistent abnormal readings across time.
- **Automated Incident Dispatch**: Generates critical alert records in MongoDB whenever abnormal states (e.g. Arrhythmia, severe Hypoxia `<92%`, high fever `>38.5°C`, or lead disconnections) occur.

### 4. 📄 Structured Clinical PDF Reporting & Social Sharing
- **Instant PDF Generation**: Generates high-resolution, vector-styled clinical medical reports complete with patient demographic info, telemetry summaries, min/max metrics, risk classification callouts, and physician remarks.
- **One-Click Sharing**: Direct sharing to WhatsApp, Email, or device-native app share menus with secure download links.

### 5. 🔌 Dual-Mode Hardware Connection (USB Cable & Wi-Fi)
- **Wi-Fi Wireless HTTP**: Directly connects to the local network and streams JSON telemetry payloads over HTTP POST.
- **USB Cable Serial Bridge**: Automatically discovers connected ESP32 COM ports (115200 baud), parses real-time sensor streams, and forwards data to the backend with auto-reconnect on replug.

---

## 🧠 Dual Machine Learning Pipeline

| Attribute | Model 1: ECG Arrhythmia Classifier | Model 2: Vital Signs Risk Model |
| :--- | :--- | :--- |
| **Framework** | Deep Learning / Scikit-Learn Artifact | Scikit-Learn Imputer & Classifier Pipeline |
| **Dataset** | MIT-BIH Arrhythmia Dataset (`mitbih_train.csv`, `mitbih_test.csv`) | Synthetic & Clinical Multi-Parameter Vitals |
| **Input Shape** | 187 normalized ECG signal samples | 3 Features: `[Heart Rate, SpO2, Temperature]` |
| **Classes** | `LOW` (Normal Sinus Rhythm), `HIGH` (Arrhythmia / Ectopic Beat) | `LOW` (Normal Vitals), `HIGH` (Physiological Risk) |
| **Inference Endpoint** | `POST /predict` on Port 8000 | `POST /predict/vital` on Port 8000 |
| **Latency** | `< 12 ms` per 187-sample buffer | `< 3 ms` per reading |

---

## 🖥️ Frontend SaaS Application Views

The frontend application provides 4 dedicated, specialized viewports:

### 1. 📊 Real-Time Biometric Dashboard (`currentNav === 'dashboard'`)
- **Automated Risk Hero Banner**: Visual risk indicator (Low Risk / High Risk / Evaluating) with computed clinical explanations.
- **4 Biometric Cards**: Real-time Heart Rate (BPM), Blood Oxygen (% SpO2), Body Temperature (°C), and ECG Sample Counter with status badges.
- **Medical Oscilloscope Waveform**: Glowing green SVG vector sweep trace with 250 Hz live indicator and baseline reference.
- **Dual ML Diagnostic Gauges**: Confidence dials and classification outputs for both AI models.
- **Historical Trends & Hardware Status**: 3-axis vitals trends and sensor connectivity indicators.

### 2. 📈 Deep-Dive Biometric Analytics Hub (`currentNav === 'analytics'`)
- **Channel Focus Viewports**:
  - `📊 Multi-Channel Matrix`: Synchronized continuous time-series graphs for all channels.
  - `🫀 Heart Rate Focus`: Expanded high-resolution chart, Resting HR baseline, and Healthy Zone (60–100 BPM) compliance score.
  - `◌ Blood Oxygen Focus`: SpO2 saturation curve, Hypoxia desaturation counter (`<92%`), and Target Score (`>95%`).
  - `🌡 Body Temperature Focus`: Precision thermal drift curve and Fever threshold (`>38.0°C`) tracking.
  - `⌁ ECG Oscilloscope`: 187-point buffer oscilloscope, lead impedance status, and MIT-BIH Arrhythmia CNN confidence.
  - `📑 Telemetry Records`: Searchable raw MongoDB ingestion log with one-click **"Download Telemetry CSV"** export.
- **Stability Index**: Multi-sensor stability score aggregated across all channels.

### 3. 🔔 Surveillance & Incident Triage Center (`currentNav === 'alerts'`)
- **Active Critical Hero Callout**: Displays active emergency conditions with immediate triage recommendations.
- **Triage Matrix Filters**: Filter by status (`Pending` / `Acknowledged`), severity (`CRITICAL` / `WARNING`), and diagnostic category (`OVERALL_RISK`, `ECG_ML`, `VITAL_ML`).
- **Interactive Incident Timeline**: Cards with glowing severity borders, clinical trigger explanations, and a **"✓ Acknowledge"** button that updates triage state in real time.
- **Sensor Mesh Health Panel**: Live operational diagnostics for ESP32, MAX30102, AD8232, DS18B20, and WiFi RSSI.

### 4. 📑 Clinical Reports & PDF Intelligence (`currentNav === 'reports'`)
- **Report Parameter Builder**: Configure report type (Comprehensive Health, ECG Diagnostic, Vital Signs Summary, Alert Audit), Target Patient ID, Time Window, and Physician Notes.
- **Live Paper Preview**: Real-time rendering of the document before generation.
- **MongoDB Archive**: Search, view, and re-download generated medical reports.
- **Sharing Modal**: Direct WhatsApp message generation, email dispatch, or system file sharing.

---

## 🔌 Hardware Wiring & Sensor Pinout Guide

### ESP32 Pin Mapping Table

| Sensor / Component | Sensor Pin | ESP32 GPIO Pin | Function / Notes |
| :--- | :--- | :--- | :--- |
| **MAX30102 (PPG)** | `VCC` | `3.3V` | Operating voltage |
| | `GND` | `GND` | Common Ground |
| | `SDA` | `GPIO 21` | I2C Data line |
| | `SCL` | `GPIO 22` | I2C Clock line |
| **AD8232 (ECG)** | `3.3V` | `3.3V` | Power supply |
| | `GND` | `GND` | Common Ground |
| | `OUTPUT` | `GPIO 34` | ADC1 Channel 6 (Analog ECG input) |
| | `LO+` | `GPIO 35` | Lead-Off Positive digital input |
| | `LO-` | `GPIO 32` | Lead-Off Negative digital input |
| **DS18B20 (Temp)** | `VCC` | `3.3V` | Power supply |
| | `GND` | `GND` | Common Ground |
| | `DATA` | `GPIO 4` | 1-Wire Data line (requires 4.7kΩ pull-up resistor to 3.3V) |
| **0.96" OLED Display**| `VCC` | `3.3V` | Power supply |
| | `GND` | `GND` | Common Ground |
| | `SDA` | `GPIO 21` | Shared I2C Data line |
| | `SCL` | `GPIO 22` | Shared I2C Clock line |

---

## 📡 Hardware Connectivity Modes

### Mode 1: Direct USB Cable Connection (Serial Gateway Bridge)
When the ESP32 is plugged into your PC via USB:
1. Connect the ESP32 via USB cable.
2. The firmware automatically streams `[TELEMETRY_JSON]` over Serial at **115200 baud**.
3. Run the Serial Gateway Bridge:
   ```powershell
   .\ml-service\.venv\Scripts\python.exe serial_hardware_bridge.py
   ```
   *The bridge auto-detects the COM port, parses incoming telemetry, and forwards it to the backend.*

### Mode 2: Wireless Wi-Fi Connection (HTTP Direct Ingestion)
1. Open `firmware/HealthMonitor_ECG_MAX30102_SPO2.ino`.
2. Configure your Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID = "YOUR_WIFI_SSID";
   const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
   const char* SERVER_URL = "http://<YOUR_PC_IP>:4000/api/readings";
   ```
3. Flash the firmware using PlatformIO or the Arduino IDE. The ESP32 will automatically connect to Wi-Fi and stream readings via HTTP POST.

### Mode 3: Built-in Live Hardware Simulator
To test the complete stack without physical hardware:
```powershell
.\ml-service\.venv\Scripts\python.exe simulate_live_hardware.py
```
*Streams alternating normal and abnormal telemetry cycles with real MIT-BIH ECG samples.*

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Python**: v3.10 or higher
- **MongoDB**: MongoDB Atlas URI or local MongoDB instance

---

### Step 1: All-in-One Launch (Recommended)
Run the launcher from the project root:
```powershell
python start.py
```
This automatically launches:
- **Express Backend API** on [http://localhost:4000](http://localhost:4000)
- **FastAPI ML Microservice** on [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **React Dashboard Frontend** on [http://localhost:5173](http://localhost:5173)

---

### Step 2: Manual Service Startup (Optional)

#### 1. Start Express Backend
```powershell
cd backend
npm install
npm run dev
```

#### 2. Start FastAPI ML Service
```powershell
cd ml-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

#### 3. Start React Frontend
```powershell
cd frontend
npm install
npm run dev
```

---

## 🌐 Backend REST API Reference

### Sensor Telemetry & Ingestion
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/readings` | Ingests real-time telemetry from ESP32 (`x-device-api-key` required) |
| `GET` | `/api/readings/latest` | Retrieves the most recent sensor reading |
| `GET` | `/api/readings/history` | Retrieves historical readings (supports `?deviceId=...&limit=...`) |

### Machine Learning & Risk Intelligence
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/ml/predict` | Runs 187-sample ECG Arrhythmia classification |
| `POST` | `/api/ml/predict/vital` | Runs vital signs risk classification |
| `GET` | `/api/ml/results/latest` | Retrieves latest ECG ML prediction result |
| `GET` | `/api/ml/results/vital/latest` | Retrieves latest Vital Signs ML prediction result |
| `GET` | `/api/risk/latest` | Retrieves latest overall clinical risk evaluation |
| `GET` | `/api/alerts` | Retrieves active and historical incident alerts |

### Clinical PDF Reports
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/reports/preview` | Generates real-time report metrics preview |
| `POST` | `/api/reports/generate` | Generates and persists medical report in MongoDB |
| `GET` | `/api/reports/history` | Retrieves stored report history for a patient |
| `GET` | `/api/reports/:id/download`| Downloads the formatted clinical PDF document |

### Authentication & Provider Portal
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Registers a new clinical provider account |
| `POST` | `/api/auth/login` | Authenticates user and returns JWT token |
| `GET` | `/api/auth/me` | Retrieves authenticated staff profile |

---

## 🧪 Verification & Automated Tests

To execute the automated end-to-end integration test suite:

```powershell
cd backend
node e2e_full_system_check.js
```

### Verified Test Matrix:
- ✅ **MongoDB Connection & Schema Storage**
- ✅ **Express Backend API Health (`/api/health`)**
- ✅ **FastAPI ECG Arrhythmia CNN Model (`POST /predict`)**
- ✅ **FastAPI Vital Signs Risk Model (`POST /predict/vital`)**
- ✅ **User Authentication (Register, Login, JWT verification)**
- ✅ **Hardware Telemetry Ingestion & Real-Time Storage**
- ✅ **Clinical PDF Report Generation & Download Pipeline**
- ✅ **Frontend Production Build (`npm run build` with 0 errors)**

---

## 🔒 Security & Disclaimers
> [!IMPORTANT]
> **Engineering Prototype Notice**: This system is designed as an IoT telemetry engineering and machine learning prototype. The artificial intelligence classifications and composite risk scores are intended for clinical research and decision-support demonstration, not for independent medical diagnosis.

---

### © 2026 Smart Health Monitoring System · Clinical SaaS Platform