#pragma once

// MAX30102 wiring is confirmed by the project brief.
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;

// Verified standard ESP32 pin configuration
constexpr int AD8232_OUTPUT_PIN = 34;   // ADC1 CH6 (Analog ECG input)
constexpr int AD8232_LO_PLUS_PIN = 35;  // Lead-Off + detection
constexpr int AD8232_LO_MINUS_PIN = 32; // Lead-Off - detection
constexpr int DS18B20_DATA_PIN = 4;     // 1-Wire Data pin for temperature sensor