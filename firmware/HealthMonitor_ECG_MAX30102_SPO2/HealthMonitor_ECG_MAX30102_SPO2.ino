#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#include "MAX30105.h"
#include "spo2_algorithm.h"
#include "pins.h"

// =====================================================
// OLED CONFIGURATION
// =====================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// =====================================================
// SENSORS & NETWORK CONFIGURATION
// =====================================================
MAX30105 particleSensor;

OneWire oneWire(DS18B20_DATA_PIN);
DallasTemperature tempSensor(&oneWire);

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://YOUR_SERVER_IP:4000/api/readings";
const char* DEVICE_API_KEY = "dev-api-key-123";
const char* DEVICE_ID = "ESP32_HARDWARE_NODE_01";
const char* PATIENT_ID = "PATIENT_DEMO_2026";

// =====================================================
// MAX30102 SPO2 BUFFER (SparkFun algorithm uses 100 samples)
// =====================================================
#define BUFFER_SIZE 100

uint32_t irBuffer[BUFFER_SIZE];
uint32_t redBuffer[BUFFER_SIZE];
int bufferIndex = 0;

int32_t spo2 = 0;
int8_t validSpO2 = 0;
int32_t maxHR = 0;
int8_t validHR = 0;

byte maxSampleCounter = 0;
#define FINGER_THRESHOLD 50000
long latestIR = 0;
long latestRED = 0;

// =====================================================
// ECG & TELEMETRY BUFFERS
// =====================================================
#define ECG_SAMPLE_RATE 250
#define ECG_SAMPLE_INTERVAL_US (1000000 / ECG_SAMPLE_RATE)
#define ECG_TELEMETRY_SIZE 187

int waveform[SCREEN_WIDTH];
float ecgTelemetryBuffer[ECG_TELEMETRY_SIZE];
int ecgTelemetryIndex = 0;

float baseline = 2048.0;
float ECG_GAIN = 0.035;

unsigned long lastECGSample = 0;
unsigned long lastDisplay = 0;
unsigned long lastTelemetrySend = 0;
unsigned long lastTempRead = 0;

float currentTemperature = NAN;
bool temperatureValid = false;

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);

  // I2C
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // AD8232
  pinMode(AD8232_LO_PLUS_PIN, INPUT);
  pinMode(AD8232_LO_MINUS_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(AD8232_OUTPUT_PIN, ADC_11db);

  // OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED NOT FOUND");
    while (1);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(25, 5);
  display.println("HEALTH");
  display.setTextSize(1);
  display.setCursor(35, 32);
  display.println("Starting...");
  display.display();
  delay(1500);

  // MAX30102
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 NOT FOUND");
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(5, 20);
    display.println("MAX30102 NOT FOUND");
    display.setCursor(5, 35);
    display.println("Check SDA/SCL");
    display.display();
    while (1);
  }

  byte ledBrightness = 60;
  byte sampleAverage = 4;
  byte ledMode = 2;       // RED + IR
  int sampleRate = 100;   // 100 Hz
  int pulseWidth = 411;
  int adcRange = 4096;

  particleSensor.setup(ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange);

  // DS18B20
  tempSensor.begin();

  // Initialize waveform & telemetry buffer
  for (int i = 0; i < SCREEN_WIDTH; i++) {
    waveform[i] = 38;
  }
  for (int i = 0; i < ECG_TELEMETRY_SIZE; i++) {
    ecgTelemetryBuffer[i] = 0.0;
  }

  display.clearDisplay();
  display.display();

  // Wi-Fi Connection
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to Wi-Fi");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Offline/Pending connection mode.");
  }

  lastECGSample = micros();

  Serial.println();
  Serial.println("====================================");
  Serial.println(" HEALTH MONITOR & TELEMETRY NODE");
  Serial.println(" ECG + MAX30102 + DS18B20 + Wi-Fi");
  Serial.println("====================================");
  Serial.println();
}

// =====================================================
// TELEMETRY TRANSMISSION
// =====================================================
// Base epoch: 2026-01-01T00:00:00Z as Unix seconds
#define EPOCH_BASE_SEC 1767225600UL

// Build a UTC ISO-8601 timestamp from millis() offset against EPOCH_BASE_SEC
String buildTimestamp() {
  unsigned long totalSec = EPOCH_BASE_SEC + (millis() / 1000UL);
  unsigned int ms       = millis() % 1000;
  unsigned long sec  = totalSec % 60;
  unsigned long min  = (totalSec / 60) % 60;
  unsigned long hr   = (totalSec / 3600) % 24;
  unsigned long days = totalSec / 86400;
  // approximate Gregorian date from day count (good for ~2026-2099)
  unsigned long y = 2000;
  while (true) {
    bool leap = (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0));
    unsigned long dy = leap ? 366 : 365;
    if (days < dy) break;
    days -= dy;
    y++;
  }
  static const uint8_t dpm[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
  bool leap = (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0));
  unsigned long m = 1;
  for (; m <= 12; m++) {
    unsigned long dim = dpm[m - 1] + (m == 2 && leap ? 1 : 0);
    if (days < dim) break;
    days -= dim;
  }
  unsigned long d = days + 1;
  char buf[28];
  snprintf(buf, sizeof(buf), "%04lu-%02lu-%02luT%02lu:%02lu:%02lu.%03uZ",
           y, m, d, hr, min, sec, ms);
  return String(buf);
}

void sendTelemetry(bool leadOff) {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["patientId"] = PATIENT_ID;
  doc["timestamp"] = buildTimestamp();

  bool fingerDetected = (latestIR >= FINGER_THRESHOLD);

  if (fingerDetected && validHR) {
    doc["heartRate"] = maxHR;
    doc["heartRateValid"] = true;
  } else {
    doc["heartRate"] = nullptr;
    doc["heartRateValid"] = false;
  }

  if (fingerDetected && validSpO2) {
    doc["spo2"] = spo2;
    doc["spo2Valid"] = true;
  } else {
    doc["spo2"] = nullptr;
    doc["spo2Valid"] = false;
  }

  if (temperatureValid) {
    doc["temperature"] = currentTemperature;
    doc["temperatureValid"] = true;
  } else {
    doc["temperature"] = nullptr;
    doc["temperatureValid"] = false;
  }

  JsonArray ecgArray = doc["ecg"].to<JsonArray>();
  if (!leadOff) {
    for (int i = 0; i < ECG_TELEMETRY_SIZE; i++) {
      ecgArray.add(ecgTelemetryBuffer[(ecgTelemetryIndex + i) % ECG_TELEMETRY_SIZE]);
    }
  }

  doc["ecgLeadOff"] = leadOff;
  doc["ecgSignalQuality"] = leadOff ? "LEAD_OFF" : "GOOD";
  doc["ppgSignalQuality"] = fingerDetected ? (validSpO2 ? "GOOD" : "POOR") : "NO_FINGER";
  doc["fingerDetected"] = fingerDetected;
  doc["wifiRssi"] = WiFi.RSSI();
  doc["max30102Status"] = fingerDetected ? "CONNECTED" : "NO_FINGER";
  doc["ad8232Status"] = leadOff ? "LEAD_OFF" : "GOOD_SIGNAL";
  doc["ds18b20Status"] = temperatureValid ? "CONNECTED" : "INVALID";
  doc["esp32Status"] = "ONLINE";

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  Serial.print("[TELEMETRY_JSON]");
  Serial.println(jsonPayload);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-api-key", DEVICE_API_KEY);

    int httpCode = http.POST(jsonPayload);
    if (httpCode > 0) {
      Serial.printf("[HTTP] POST Code: %d\n", httpCode);
    } else {
      Serial.printf("[HTTP] POST Failed: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  unsigned long currentMicros = micros();
  unsigned long currentMillis = millis();

  // -------------------------------------------------
  // 1. DS18B20 TEMPERATURE SAMPLING (Every 2s)
  // -------------------------------------------------
  if (currentMillis - lastTempRead >= 2000) {
    lastTempRead = currentMillis;
    tempSensor.requestTemperatures();
    float t = tempSensor.getTempCByIndex(0);
    if (t > -55.0 && t < 85.0) {
      currentTemperature = t;
      temperatureValid = true;
    } else {
      temperatureValid = false;
    }
  }

  // -------------------------------------------------
  // 2. AD8232 ECG SAMPLING @ 250 Hz
  // -------------------------------------------------
  if (currentMicros - lastECGSample >= ECG_SAMPLE_INTERVAL_US) {
    lastECGSample += ECG_SAMPLE_INTERVAL_US;

    int rawECG = analogRead(AD8232_OUTPUT_PIN);
    bool leadOff = digitalRead(AD8232_LO_PLUS_PIN) || digitalRead(AD8232_LO_MINUS_PIN);

    baseline = baseline * 0.995 + rawECG * 0.005;
    float ecgAC = rawECG - baseline;

    int y = 38 - (int)(ecgAC * ECG_GAIN);
    y = constrain(y, 14, 50);

    for (int i = 0; i < SCREEN_WIDTH - 1; i++) {
      waveform[i] = waveform[i + 1];
    }
    waveform[SCREEN_WIDTH - 1] = leadOff ? 38 : y;

    ecgTelemetryBuffer[ecgTelemetryIndex] = ecgAC;
    ecgTelemetryIndex = (ecgTelemetryIndex + 1) % ECG_TELEMETRY_SIZE;
  }

  // -------------------------------------------------
  // 3. MAX30102 SAMPLING & SPO2 ALGORITHM
  // -------------------------------------------------
  particleSensor.check();

  while (particleSensor.available()) {
    uint32_t irValue = particleSensor.getFIFOIR();
    uint32_t redValue = particleSensor.getFIFORed();

    latestIR = irValue;
    latestRED = redValue;

    if (irValue > FINGER_THRESHOLD) {
      maxSampleCounter++;
      if (maxSampleCounter >= 4) {
        maxSampleCounter = 0;

        if (bufferIndex < BUFFER_SIZE) {
          irBuffer[bufferIndex] = irValue;
          redBuffer[bufferIndex] = redValue;
          bufferIndex++;
        }

        if (bufferIndex >= BUFFER_SIZE) {
          Serial.println();
          Serial.println("Calculating SpO2 & HR...");

          maxim_heart_rate_and_oxygen_saturation(
            irBuffer,
            BUFFER_SIZE,
            redBuffer,
            &spo2,
            &validSpO2,
            &maxHR,
            &validHR
          );

          if (validSpO2) {
            Serial.print("SpO2 = "); Serial.print(spo2); Serial.println(" %");
          } else {
            Serial.println("SpO2 = INVALID");
          }

          if (validHR) {
            Serial.print("MAX HR = "); Serial.print(maxHR); Serial.println(" BPM");
          } else {
            Serial.println("MAX HR = INVALID");
          }

          for (int i = 25; i < BUFFER_SIZE; i++) {
            irBuffer[i - 25] = irBuffer[i];
            redBuffer[i - 25] = redBuffer[i];
          }
          bufferIndex = 75;
        }
      }
    } else {
      bufferIndex = 0;
      maxSampleCounter = 0;
      spo2 = 0;
      validSpO2 = 0;
      maxHR = 0;
      validHR = 0;
    }

    particleSensor.nextSample();
  }

  // -------------------------------------------------
  // 4. OLED DISPLAY UPDATE (50ms interval)
  // -------------------------------------------------
  if (currentMillis - lastDisplay >= 50) {
    lastDisplay = currentMillis;

    bool leadOff = digitalRead(AD8232_LO_PLUS_PIN) || digitalRead(AD8232_LO_MINUS_PIN);

    display.clearDisplay();

    // HEADER
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("ECG:");
    display.print(leadOff ? "OFF" : "OK ");

    // SPO2
    display.setCursor(62, 0);
    display.print("SpO2:");
    if (latestIR < FINGER_THRESHOLD) {
      display.print("--");
    } else if (validSpO2) {
      display.print(spo2);
      display.print("%");
    } else {
      display.print("...");
    }

    // DIVIDER
    display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

    // ECG WAVEFORM
    for (int x = 1; x < SCREEN_WIDTH; x++) {
      display.drawLine(x - 1, waveform[x - 1], x, waveform[x], SSD1306_WHITE);
    }

    // BOTTOM STATUS
    display.fillRect(0, 52, 128, 12, BLACK);
    display.setCursor(0, 54);

    if (latestIR < FINGER_THRESHOLD) {
      display.print("Place finger on MAX30102");
    } else if (!validSpO2) {
      display.print("Measuring SpO2...");
    } else {
      display.print("SpO2:");
      display.print(spo2);
      display.print("% ");
      if (validHR) {
        display.print("HR:");
        display.print(maxHR);
      }
    }

    display.display();
  }

  // -------------------------------------------------
  // 5. HTTP TELEMETRY DISPATCH TO BACKEND (3s interval)
  // -------------------------------------------------
  if (currentMillis - lastTelemetrySend >= 3000) {
    lastTelemetrySend = currentMillis;
    bool leadOff = digitalRead(AD8232_LO_PLUS_PIN) || digitalRead(AD8232_LO_MINUS_PIN);
    sendTelemetry(leadOff);
  }
}