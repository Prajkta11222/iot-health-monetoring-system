import 'dotenv/config';
import mongoose from 'mongoose';
import dns from 'dns';
import { createApp } from './src/app.js';
import { Reading } from './src/models/reading.js';
import { MlResult } from './src/models/mlResult.js';
import { OverallRiskResult } from './src/models/overallRiskResult.js';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {}

async function runSimulation() {
  console.log('===================================================');
  console.log('   IoT Smart Health System - E2E Integration Test  ');
  console.log('===================================================\n');

  // 1. Connect to MongoDB
  console.log('[1/4] Connecting to MongoDB...');
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart-health';
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`  ✓ Connected to MongoDB (${mongoUri.replace(/:([^@]+)@/, ':****@')})`);
  } catch (err) {
    console.warn(`  ⚠️ Could not connect to primary URI (${err.message}). Falling back to local MongoDB...`);
    await mongoose.connect('mongodb://127.0.0.1:27017/smart-health');
    console.log('  ✓ Connected to local MongoDB');
  }

  // 2. Create Express app instance
  const app = createApp();
  const server = app.listen(4001);
  const BASE_URL = 'http://127.0.0.1:4001';

  try {
    // 3. Simulate hardware sending a reading
    console.log('\n[2/4] Simulating hardware (ESP32) sending sensor reading...');
    const dummyEcg = Array(187).fill(0).map((_, i) => Math.sin(i / 10) * 0.5 + 0.5);
    
    const readingPayload = {
      deviceId: 'ESP32_DEMO_01',
      patientId: 'PATIENT_1001',
      timestamp: new Date().toISOString(),
      heartRate: 75,
      heartRateValid: true,
      spo2: 98,
      spo2Valid: true,
      temperature: 36.6,
      temperatureValid: true,
      ecg: dummyEcg,
      ecgLeadOff: false,
      ecgSignalQuality: 'GOOD',
      ppgSignalQuality: 'GOOD',
      fingerDetected: true,
      wifiRssi: -55,
      max30102Status: 'CONNECTED',
      ad8232Status: 'CONNECTED',
      ds18b20Status: 'CONNECTED',
      esp32Status: 'ONLINE'
    };

    const readingRes = await fetch(`${BASE_URL}/api/readings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-device-api-key': process.env.DEVICE_API_KEY || 'dev-api-key-123'
      },
      body: JSON.stringify(readingPayload)
    });

    if (!readingRes.ok) {
      throw new Error(`Failed to post reading: ${readingRes.status} ${await readingRes.text()}`);
    }
    const savedReading = await readingRes.json();
    console.log('  ✓ Hardware reading stored in MongoDB:', savedReading._id);

    const readingsCount = await Reading.countDocuments({ deviceId: 'ESP32_DEMO_01' });

    console.log(`\n  Database Totals for ESP32_DEMO_01:`);
    console.log(`    - Sensor Readings: ${readingsCount}`);

    console.log('\n===================================================');
    console.log('   🎉 MONGODB CONNECTION & PIPELINE VERIFIED!');
    console.log('===================================================');
    process.exit(0);
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runSimulation().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
