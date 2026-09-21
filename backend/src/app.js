import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Reading } from './models/reading.js';
import { MlResult } from './models/mlResult.js';
import { OverallRiskResult } from './models/overallRiskResult.js';
import { Alert } from './models/alert.js';
import { validateReading } from './validators/reading.js';
import { evaluateOverallRisk } from './services/overallRiskEngine.js';
import authRoutes from './routes/authRoutes.js';
import reportRoutes from './routes/reportRoutes.js';



async function evaluateAndStoreRisk({ deviceId, patientId, mlResult, vitalMlResult }) {
  const reading = await Reading.findOne({ deviceId }).sort({ timestamp: -1 }).lean();
  const recentReadings = await Reading.find({ deviceId }).sort({ timestamp: -1 }).limit(2).lean();
  if (!reading) return null;
  
  const latestEcgMl = mlResult ?? await MlResult.findOne({ deviceId, modelType: 'ECG' }).sort({ predictionTimestamp: -1 }).lean();
  const latestVitalMl = vitalMlResult ?? await MlResult.findOne({ deviceId, modelType: 'VITAL' }).sort({ predictionTimestamp: -1 }).lean();

  const evaluation = evaluateOverallRisk({ reading, mlResult: latestEcgMl, vitalMlResult: latestVitalMl, recentReadings });
  const saved = await OverallRiskResult.create({
    patientId: patientId ?? reading.patientId,
    deviceId,
    timestamp: new Date(),
    overallRisk: evaluation.overallRisk,
    ecgMlResult: latestEcgMl?.riskLabel ?? null,
    ecgMlProbability: latestEcgMl?.riskProbability ?? null,
    vitalMlResult: latestVitalMl?.riskLabel ?? null,
    vitalMlProbability: latestVitalMl?.riskProbability ?? null,
    heartRateStatus: reading.heartRateValid ? 'VALID' : 'UNAVAILABLE',
    spo2Status: reading.spo2Valid ? 'VALID' : 'UNAVAILABLE',
    temperatureStatus: reading.temperatureValid ? 'VALID' : 'UNAVAILABLE',
    signalQuality: reading.ecgSignalQuality,
    reasons: evaluation.reasons,
    engineVersion: evaluation.engineVersion
  });
  if (evaluation.overallRisk === 'HIGH_RISK') {
    await Alert.create({ patientId: saved.patientId, deviceId, category: 'OVERALL_RISK', severity: 'CRITICAL', message: `Overall health risk assessment: HIGH`, timestamp: saved.timestamp });
  }
  if (latestEcgMl?.riskLabel === 'HIGH') {
    await Alert.create({ patientId: saved.patientId, deviceId, category: 'ECG_ML', severity: 'WARNING', message: 'ECG abnormality classification: HIGH', timestamp: saved.timestamp });
  }
  if (latestVitalMl?.riskLabel === 'HIGH') {
    await Alert.create({ patientId: saved.patientId, deviceId, category: 'VITAL_ML', severity: 'WARNING', message: 'Vital signs risk ML classification: HIGH', timestamp: saved.timestamp });
  }
  return saved;
}

export function createApp({ mlClient = fetch } = {}) {
  const app = express();
  const clientOrigin = process.env.CLIENT_ORIGIN;
  const corsOrigin = (!clientOrigin || clientOrigin === '*') 
    ? '*' 
    : (clientOrigin.includes(',') ? clientOrigin.split(',').map(s => s.trim()) : clientOrigin);
  app.use(cors({
    origin: corsOrigin,
    credentials: corsOrigin !== '*',
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 2000 }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'managed-by-server' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/reports', reportRoutes);

  app.post('/api/readings', async (req, res, next) => {
    try {
      if (req.get('x-device-api-key') !== process.env.DEVICE_API_KEY) return res.status(401).json({ error: 'Invalid device credentials' });
      const error = validateReading(req.body);
      if (error) return res.status(400).json({ error });
      const reading = await Reading.create({ ...req.body, timestamp: new Date(req.body.timestamp) });
      
      // Fast non-blocking Vital Risk ML inference upon hardware ingestion
      if (reading.heartRateValid && reading.spo2Valid && reading.temperatureValid) {
        mlClient(`${process.env.FASTAPI_URL}/predict/vital`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ heartRate: reading.heartRate, spo2: reading.spo2, temperature: reading.temperature })
        }).then(async (response) => {
          if (response.ok) {
            const body = await response.json();
            const savedVitalMl = await MlResult.create({
              ...body,
              modelType: 'VITAL',
              deviceId: reading.deviceId,
              patientId: reading.patientId ?? null,
              heartRate: reading.heartRate,
              spo2: reading.spo2,
              temperature: reading.temperature,
              predictionTimestamp: new Date(body.predictionTimestamp)
            });
            await evaluateAndStoreRisk({ deviceId: reading.deviceId, patientId: reading.patientId, vitalMlResult: savedVitalMl.toObject() });
          }
        }).catch((e) => console.warn('Instant Vital ML evaluation error:', e.message));
      }

      // Fast non-blocking ECG ML inference upon hardware ingestion
      if (reading.ecg?.length === 187 && reading.ecgSignalQuality === 'GOOD' && !reading.ecgLeadOff) {
        mlClient(`${process.env.FASTAPI_URL}/predict`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ecg: reading.ecg, ecgSignalQuality: reading.ecgSignalQuality, ecgLeadOff: reading.ecgLeadOff })
        }).then(async (response) => {
          if (response.ok) {
            const body = await response.json();
            const savedMl = await MlResult.create({
              ...body,
              modelType: 'ECG',
              deviceId: reading.deviceId,
              patientId: reading.patientId ?? null,
              predictionTimestamp: new Date(body.predictionTimestamp)
            });
            await evaluateAndStoreRisk({ deviceId: reading.deviceId, patientId: reading.patientId, mlResult: savedMl.toObject() });
          }
        }).catch((e) => console.warn('Instant ECG ML evaluation error:', e.message));
      } else {
        evaluateAndStoreRisk({ deviceId: reading.deviceId, patientId: reading.patientId }).catch(() => {});
      }

      res.status(201).json(reading);
    } catch (err) { next(err); }
  });
  app.get('/api/readings/latest', async (_req, res, next) => {
    try { res.json(await Reading.findOne().sort({ timestamp: -1 }).lean()); } catch (err) { next(err); }
  });
  app.get('/api/readings/history', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId } : {};
      res.json(await Reading.find(filter).sort({ timestamp: -1 }).limit(Math.min(Number(req.query.limit) || 100, 1000)).lean());
    } catch (err) { next(err); }
  });
  app.post('/api/ml/predict', async (req, res, next) => {
    try {
      const response = await mlClient(`${process.env.FASTAPI_URL}/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ecg: req.body.ecg, ecgSignalQuality: req.body.ecgSignalQuality, ecgLeadOff: req.body.ecgLeadOff }) });
      const body = await response.json();
      if (response.ok && req.body.deviceId) {
        const savedMl = await MlResult.create({ ...body, modelType: 'ECG', deviceId: req.body.deviceId, patientId: req.body.patientId ?? null, predictionTimestamp: new Date(body.predictionTimestamp) });
        await evaluateAndStoreRisk({ deviceId: req.body.deviceId, patientId: req.body.patientId, mlResult: savedMl.toObject() });
      }
      res.status(response.status).json(body);
    } catch (err) { next(err); }
  });
  app.post('/api/ml/predict/vital', async (req, res, next) => {
    try {
      const response = await mlClient(`${process.env.FASTAPI_URL}/predict/vital`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ heartRate: req.body.heartRate, spo2: req.body.spo2, temperature: req.body.temperature })
      });
      const body = await response.json();
      if (response.ok && req.body.deviceId) {
        const savedVitalMl = await MlResult.create({
          ...body,
          modelType: 'VITAL',
          deviceId: req.body.deviceId,
          patientId: req.body.patientId ?? null,
          heartRate: req.body.heartRate,
          spo2: req.body.spo2,
          temperature: req.body.temperature,
          predictionTimestamp: new Date(body.predictionTimestamp)
        });
        await evaluateAndStoreRisk({ deviceId: req.body.deviceId, patientId: req.body.patientId, vitalMlResult: savedVitalMl.toObject() });
      }
      res.status(response.status).json(body);
    } catch (err) { next(err); }
  });
  app.get('/api/ml/results/latest', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId, modelType: 'ECG' } : { modelType: 'ECG' };
      const resEcg = await MlResult.findOne(filter).sort({ predictionTimestamp: -1 }).lean();
      res.json(resEcg || await MlResult.findOne(req.query.deviceId ? { deviceId: req.query.deviceId } : {}).sort({ predictionTimestamp: -1 }).lean());
    } catch (err) { next(err); }
  });
  app.get('/api/ml/results/vital/latest', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId, modelType: 'VITAL' } : { modelType: 'VITAL' };
      res.json(await MlResult.findOne(filter).sort({ predictionTimestamp: -1 }).lean());
    } catch (err) { next(err); }
  });
  app.get('/api/risk/latest', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId } : {};
      res.json(await OverallRiskResult.findOne(filter).sort({ timestamp: -1 }).lean());
    } catch (err) { next(err); }
  });
  app.get('/api/risk/history', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId } : {};
      res.json(await OverallRiskResult.find(filter).sort({ timestamp: -1 }).limit(Math.min(Number(req.query.limit) || 100, 1000)).lean());
    } catch (err) { next(err); }
  });
  app.post('/api/risk/evaluate', async (req, res, next) => {
    try {
      const mlResult = await MlResult.findOne({ deviceId: req.body.deviceId, modelType: 'ECG' }).sort({ predictionTimestamp: -1 }).lean();
      const vitalMlResult = await MlResult.findOne({ deviceId: req.body.deviceId, modelType: 'VITAL' }).sort({ predictionTimestamp: -1 }).lean();
      const saved = await evaluateAndStoreRisk({ deviceId: req.body.deviceId, patientId: req.body.patientId, mlResult, vitalMlResult });
      res.status(saved ? 201 : 404).json(saved ?? { error: 'No reading available' });
    } catch (err) { next(err); }
  });
  app.get('/api/alerts', async (req, res, next) => {
    try {
      const filter = req.query.deviceId ? { deviceId: req.query.deviceId } : {};
      res.json(await Alert.find(filter).sort({ timestamp: -1 }).limit(Math.min(Number(req.query.limit) || 100, 1000)).lean());
    } catch (err) { next(err); }
  });
  app.use((err, _req, res, _next) => res.status(503).json({ error: 'Service unavailable', detail: process.env.NODE_ENV === 'production' ? undefined : err.message }));
  return app;
}