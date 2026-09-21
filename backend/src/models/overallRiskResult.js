import mongoose from 'mongoose';

const overallRiskResultSchema = new mongoose.Schema({
  patientId: { type: String, default: null, index: true },
  deviceId: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  overallRisk: { type: String, enum: ['LOW_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA', 'SENSOR_ERROR', 'STALE_DATA'], required: true },
  ecgMlResult: { type: String, default: null },
  ecgMlProbability: { type: Number, default: null },
  vitalMlResult: { type: String, default: null },
  vitalMlProbability: { type: Number, default: null },
  heartRateStatus: { type: String, required: true },
  spo2Status: { type: String, required: true },
  temperatureStatus: { type: String, required: true },
  signalQuality: { type: String, required: true },
  reasons: { type: [String], required: true },
  engineVersion: { type: String, required: true }
}, { timestamps: true, versionKey: false });

overallRiskResultSchema.index({ deviceId: 1, timestamp: -1 });
export const OverallRiskResult = mongoose.model('OverallRiskResult', overallRiskResultSchema);