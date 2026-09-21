import express from 'express';
import mongoose from 'mongoose';
import { Reading } from '../models/reading.js';
import { OverallRiskResult } from '../models/overallRiskResult.js';
import { MlResult } from '../models/mlResult.js';
import { Alert } from '../models/alert.js';
import { Report } from '../models/report.js';
import { optionalAuth } from '../middleware/auth.js';
import { generatePdfReport } from '../services/pdfReportGenerator.js';

const router = express.Router();

/**
 * Helper to gather real aggregated data from MongoDB for report generation
 */
async function aggregateReportData({ patientId, deviceId, timeRange = '24H' }) {
  const filter = {};
  if (deviceId) filter.deviceId = deviceId;
  if (patientId) filter.patientId = patientId;

  // Time range calculation
  let since = new Date(0);
  const now = new Date();
  if (timeRange === '1H') since = new Date(now.getTime() - 60 * 60 * 1000);
  else if (timeRange === '6H') since = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  else if (timeRange === '24H') since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  else if (timeRange === '7D') since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (timeRange !== 'CUSTOM') {
    filter.timestamp = { $gte: since };
  }

  // Fetch real data from MongoDB
  let readings = await Reading.find(filter).sort({ timestamp: -1 }).limit(500).lean();
  if (readings.length === 0) {
    // fallback filter without timestamp constraint if collection has data older than time range
    const baseFilter = deviceId ? { deviceId } : {};
    readings = await Reading.find(baseFilter).sort({ timestamp: -1 }).limit(100).lean();
  }

  const latestReading = readings[0] || null;

  // Vitals calculation
  const validHrs = readings.map(r => r.heartRate).filter(v => typeof v === 'number' && v > 0);
  const validSpo2s = readings.map(r => r.spo2).filter(v => typeof v === 'number' && v > 0);
  const validTemps = readings.map(r => r.temperature).filter(v => typeof v === 'number' && v > 0);

  const avgHeartRate = validHrs.length ? Math.round(validHrs.reduce((a, b) => a + b, 0) / validHrs.length) : null;
  const minHeartRate = validHrs.length ? Math.min(...validHrs) : null;
  const maxHeartRate = validHrs.length ? Math.max(...validHrs) : null;

  const avgSpo2 = validSpo2s.length ? Number((validSpo2s.reduce((a, b) => a + b, 0) / validSpo2s.length).toFixed(1)) : null;
  const minSpo2 = validSpo2s.length ? Math.min(...validSpo2s) : null;
  const maxSpo2 = validSpo2s.length ? Math.max(...validSpo2s) : null;

  const avgTemp = validTemps.length ? Number((validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1)) : null;
  const minTemp = validTemps.length ? Math.min(...validTemps) : null;
  const maxTemp = validTemps.length ? Math.max(...validTemps) : null;

  // ML Results & Overall Risk from MongoDB
  const targetDevice = deviceId || latestReading?.deviceId;
  const riskFilter = targetDevice ? { deviceId: targetDevice } : {};

  const [latestRisk, ecgMl, vitalMl, recentAlerts] = await Promise.all([
    OverallRiskResult.findOne(riskFilter).sort({ timestamp: -1 }).lean(),
    MlResult.findOne({ ...riskFilter, modelType: 'ECG' }).sort({ predictionTimestamp: -1 }).lean(),
    MlResult.findOne({ ...riskFilter, modelType: 'VITAL' }).sort({ predictionTimestamp: -1 }).lean(),
    Alert.find(riskFilter).sort({ timestamp: -1 }).limit(10).lean()
  ]);

  return {
    totalReadingsCount: readings.length,
    latestTimestamp: latestReading?.timestamp || new Date(),
    vitals: {
      avgHeartRate,
      minHeartRate,
      maxHeartRate,
      avgSpo2,
      minSpo2,
      maxSpo2,
      avgTemp,
      minTemp,
      maxTemp
    },
    risk: latestRisk || { overallRisk: 'NO_DATA', reasons: ['No risk evaluation records stored in database yet.'] },
    ecgMl: ecgMl || { riskLabel: 'NO DATA', riskProbability: null },
    vitalMl: vitalMl || { riskLabel: 'NO DATA', riskProbability: null },
    alerts: recentAlerts || []
  };
}

// 1. Preview Report Data (queries live MongoDB)
router.post('/preview', optionalAuth, async (req, res, next) => {
  try {
    const { patientId = 'PATIENT-101', deviceId = 'ESP32_HEALTH_01', timeRange = '24H', reportType = 'COMPREHENSIVE_HEALTH' } = req.body;
    const metrics = await aggregateReportData({ patientId, deviceId, timeRange });

    res.json({
      reportType,
      patientId,
      deviceId,
      timeRange,
      previewGeneratedAt: new Date(),
      createdByUser: req.user ? `${req.user.fullName} (${req.user.role})` : 'Doctor (System)',
      metricsSummary: metrics
    });
  } catch (err) {
    next(err);
  }
});

// 2. Generate and Store Report in MongoDB
router.post('/generate', optionalAuth, async (req, res, next) => {
  try {
    const {
      title,
      reportType = 'COMPREHENSIVE_HEALTH',
      patientId = 'PATIENT-101',
      deviceId = 'ESP32_HEALTH_01',
      timeRange = '24H',
      notes = ''
    } = req.body;

    const metricsSummary = await aggregateReportData({ patientId, deviceId, timeRange });
    const reportId = `RPT-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const reportTitle = title || `${reportType.replaceAll('_', ' ')} Report for ${patientId}`;

    const newReport = await Report.create({
      reportId,
      title: reportTitle,
      reportType,
      status: 'GENERATED',
      patientId,
      deviceId,
      timeRange,
      createdById: req.user?.id || 'system',
      createdByUsername: req.user?.fullName || req.user?.username || 'Doctor / Care Team',
      createdByUserRole: req.user?.role || 'Doctor',
      notes,
      metricsSummary,
      createdAt: new Date()
    });

    res.status(201).json(newReport);
  } catch (err) {
    next(err);
  }
});

// 3. Fetch Report History List
router.get('/history', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.patientId) filter.patientId = req.query.patientId;
    if (req.query.reportType) filter.reportType = req.query.reportType;

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    res.json(reports);
  } catch (err) {
    next(err);
  }
});

// 4. Fetch Single Report by ID
router.get('/:id', async (req, res, next) => {
  try {
    let report = null;
    if (mongoose.isValidObjectId(req.params.id)) {
      report = await Report.findOne({ $or: [{ _id: req.params.id }, { reportId: req.params.id }] }).lean();
    } else {
      report = await Report.findOne({ reportId: req.params.id }).lean();
    }
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// 5. Download Professional PDF Report from Real MongoDB Data
router.get('/:id/download', async (req, res, next) => {
  try {
    let report = null;
    if (req.params.id !== 'preview') {
      if (mongoose.isValidObjectId(req.params.id)) {
        report = await Report.findOne({ $or: [{ _id: req.params.id }, { reportId: req.params.id }] }).lean();
      } else {
        report = await Report.findOne({ reportId: req.params.id }).lean();
      }
    }

    if (!report) {
      // If not found in DB by exact ID, dynamically construct a report for preview/download
      const patientId = req.query.patientId || 'PATIENT-101';
      const deviceId = req.query.deviceId || 'ESP32_HEALTH_01';
      const reportType = req.query.reportType || 'COMPREHENSIVE_HEALTH';
      const timeRange = req.query.timeRange || '24H';
      const metricsSummary = await aggregateReportData({ patientId, deviceId, timeRange });

      report = {
        reportId: `RPT-LIVE-${Date.now().toString(36).toUpperCase()}`,
        title: `${reportType.replaceAll('_', ' ')} Report for ${patientId}`,
        reportType,
        status: 'GENERATED',
        patientId,
        deviceId,
        createdByUsername: 'Care Team Lead',
        createdByUserRole: 'Doctor',
        notes: 'Generated directly from active sensor telemetry stored in MongoDB.',
        metricsSummary,
        createdAt: new Date()
      };
    }

    generatePdfReport(report, res);
  } catch (err) {
    next(err);
  }
});

export default router;
