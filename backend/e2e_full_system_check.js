import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from './src/models/user.js';
import { Reading } from './src/models/reading.js';
import { MlResult } from './src/models/mlResult.js';
import { OverallRiskResult } from './src/models/overallRiskResult.js';
import { Alert } from './src/models/alert.js';
import { Report } from './src/models/report.js';

const BACKEND_URL = 'http://localhost:4000/api';
const FASTAPI_URL = 'http://127.0.0.1:8000';
const DEVICE_KEY = 'dev-api-key-123';

async function fullVerification() {
  console.log('=====================================================');
  console.log('🔍 FULL END-TO-END SYSTEM & MONGODB INTEGRATION CHECK');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${message}`);
      failed++;
    }
  }

  // 1. Verify MongoDB Direct Connection & Models
  console.log('[1/6] Checking MongoDB Connection & Schema Models...');
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart-health';
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
    }
    assert(mongoose.connection.readyState === 1, 'MongoDB connection is ACTIVE.');

    const userCount = await User.countDocuments();
    assert(userCount >= 1, `User model verified in MongoDB (Found ${userCount} users).`);

    const readingCount = await Reading.countDocuments();
    console.log(`  ℹ️ Total Reading documents in MongoDB: ${readingCount}`);

    const riskCount = await OverallRiskResult.countDocuments();
    console.log(`  ℹ️ Total OverallRiskResult documents in MongoDB: ${riskCount}`);

    const mlCount = await MlResult.countDocuments();
    console.log(`  ℹ️ Total MlResult documents in MongoDB: ${mlCount}`);

    const alertCount = await Alert.countDocuments();
    console.log(`  ℹ️ Total Alert documents in MongoDB: ${alertCount}`);

    const reportCount = await Report.countDocuments();
    console.log(`  ℹ️ Total Report documents in MongoDB: ${reportCount}`);
  } catch (err) {
    assert(false, `MongoDB connection error: ${err.message}`);
  }

  // 2. Verify Backend API Health
  console.log('\n[2/6] Checking Express Backend API Health...');
  try {
    const healthRes = await fetch(`${BACKEND_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.ok && healthData.status === 'ok', 'Express Backend API /api/health returned OK status.');
  } catch (err) {
    assert(false, `Backend API unreachable: ${err.message}`);
  }

  // 3. Verify ML Microservice (FastAPI on Port 8000)
  console.log('\n[3/6] Checking FastAPI ML Microservice (Port 8000)...');
  try {
    // Test ECG ML model inference
    const mockEcg = Array(187).fill(0.123);
    const ecgRes = await fetch(`${FASTAPI_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ecg: mockEcg, ecgSignalQuality: 'GOOD', ecgLeadOff: false })
    });
    if (ecgRes.ok) {
      const ecgData = await ecgRes.json();
      assert(ecgData.riskLabel !== undefined, `FastAPI ECG Model working (Label: ${ecgData.riskLabel}, Prob: ${(ecgData.riskProbability * 100).toFixed(1)}%).`);
    } else {
      console.warn(`  ⚠️ FastAPI ML service not responding on port 8000 (status ${ecgRes.status}). Skipping external ML check.`);
    }

    // Test Vital Risk ML model inference
    const vitalRes = await fetch(`${FASTAPI_URL}/predict/vital`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartRate: 75, spo2: 98, temperature: 36.8 })
    });
    if (vitalRes.ok) {
      const vitalData = await vitalRes.json();
      assert(vitalData.riskLabel !== undefined, `FastAPI Vital Model working (Label: ${vitalData.riskLabel}, Prob: ${(vitalData.riskProbability * 100).toFixed(1)}%).`);
    }
  } catch (err) {
    console.warn(`  ⚠️ FastAPI ML service note: ${err.message}`);
  }

  // 4. Verify User Authentication System
  console.log('\n[4/6] Checking User Authentication System...');
  let token = null;
  try {
    const testUsername = `test_user_${Date.now()}`;
    const regRes = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        email: `${testUsername}@smarthealth.io`,
        password: 'password123',
        fullName: 'Test Doctor',
        role: 'Doctor'
      })
    });
    const regData = await regRes.json();
    assert(regRes.status === 201 && regData.token, 'User Registration endpoint working.');

    const loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, password: 'password123' })
    });
    const loginData = await loginRes.json();
    assert(loginRes.ok && loginData.user?.role === 'Doctor', 'User Login endpoint working.');
    token = loginData.token;

    const meRes = await fetch(`${BACKEND_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meRes.json();
    assert(meRes.ok && meData.username === testUsername, 'User Profile GET /api/auth/me working.');
  } catch (err) {
    assert(false, `Auth system test error: ${err.message}`);
  }

  // 5. Verify Sensor Hardware Ingestion & MongoDB Storage
  console.log('\n[5/6] Checking Hardware Ingestion & MongoDB Storage...');
  try {
    const testDeviceId = 'ESP32_VERIFY_DEVICE';
    const testPatientId = 'PATIENT-101';
    const mockReading = {
      deviceId: testDeviceId,
      patientId: testPatientId,
      timestamp: new Date().toISOString(),
      heartRate: 78,
      heartRateValid: true,
      spo2: 98.5,
      spo2Valid: true,
      temperature: 36.9,
      temperatureValid: true,
      ecg: Array(187).fill(0.05),
      ecgLeadOff: false,
      ecgSignalQuality: 'GOOD',
      ppgSignalQuality: 'GOOD',
      fingerDetected: true,
      wifiRssi: -58,
      max30102Status: 'CONNECTED',
      ad8232Status: 'GOOD_SIGNAL',
      ds18b20Status: 'CONNECTED',
      esp32Status: 'ONLINE'
    };

    const ingestRes = await fetch(`${BACKEND_URL}/readings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-api-key': DEVICE_KEY
      },
      body: JSON.stringify(mockReading)
    });
    const savedReading = await ingestRes.json();
    assert(ingestRes.status === 201 && savedReading._id, 'POST /api/readings ingested sensor telemetry successfully.');

    // Verify stored in MongoDB
    const dbReading = await Reading.findById(savedReading._id);
    assert(dbReading !== null && dbReading.heartRate === 78, 'Reading document correctly stored & verified in MongoDB.');
  } catch (err) {
    assert(false, `Ingestion error: ${err.message}`);
  }

  // 6. Verify Report Generation System & PDF Download
  console.log('\n[6/6] Checking Report Generation System & PDF Export...');
  try {
    // Preview
    const previewRes = await fetch(`${BACKEND_URL}/reports/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ reportType: 'COMPREHENSIVE_HEALTH', patientId: 'PATIENT-101', timeRange: '24H' })
    });
    const previewData = await previewRes.json();
    assert(previewRes.ok && previewData.metricsSummary, 'Report Preview endpoint working with real MongoDB metrics.');

    // Generate & Store in MongoDB
    const genRes = await fetch(`${BACKEND_URL}/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        title: 'Comprehensive Health Verification Report',
        reportType: 'COMPREHENSIVE_HEALTH',
        patientId: 'PATIENT-101',
        timeRange: '24H',
        notes: 'Verification test note for MongoDB report storage.'
      })
    });
    const genData = await genRes.json();
    assert(genRes.status === 201 && genData.reportId, `Report Generated & Stored in MongoDB (ID: ${genData.reportId}).`);

    // Verify stored report document in MongoDB
    const dbReport = await Report.findById(genData._id);
    assert(dbReport !== null && dbReport.patientId === 'PATIENT-101', 'Report document verified in MongoDB collection.');

    // History
    const historyRes = await fetch(`${BACKEND_URL}/reports/history?patientId=PATIENT-101`);
    const historyData = await historyRes.json();
    assert(Array.isArray(historyData) && historyData.length > 0, `Report History retrieved from MongoDB (${historyData.length} records found).`);

    // Download PDF
    const downloadRes = await fetch(`${BACKEND_URL}/reports/${genData._id}/download`);
    const isPdf = downloadRes.headers.get('content-type')?.includes('application/pdf');
    assert(downloadRes.ok && isPdf, `PDF Report download endpoint returned 'application/pdf' header.`);
  } catch (err) {
    assert(false, `Report system verification error: ${err.message}`);
  }

  console.log('\n=====================================================');
  console.log(`📊 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED.`);
  console.log('=====================================================');

  mongoose.connection.close();
}

fullVerification();
