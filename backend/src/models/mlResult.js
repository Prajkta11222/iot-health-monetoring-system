import mongoose from 'mongoose';

const mlResultSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  patientId: { type: String, default: null, index: true },
  modelType: { type: String, enum: ['ECG', 'VITAL'], default: 'ECG', index: true },
  riskLabel: { type: String, enum: ['LOW', 'HIGH'], required: true },
  riskProbability: { type: Number, min: 0, max: 1, default: null },
  modelVersion: { type: String, required: true },
  signalQuality: { type: String, default: 'GOOD' },
  heartRate: { type: Number, default: null },
  spo2: { type: Number, default: null },
  temperature: { type: Number, default: null },
  predictionTimestamp: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

mlResultSchema.index({ deviceId: 1, modelType: 1, predictionTimestamp: -1 });

export const MlResult = mongoose.model('MlResult', mlResultSchema);