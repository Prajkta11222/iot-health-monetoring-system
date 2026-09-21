import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  patientId: { type: String, default: null, index: true },
  deviceId: { type: String, required: true, index: true },
  category: { type: String, enum: ['SENSOR', 'ECG_ML', 'VITAL_ML', 'OVERALL_RISK'], required: true },
  severity: { type: String, enum: ['INFO', 'WARNING', 'CRITICAL'], required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, required: true, index: true },
  active: { type: Boolean, default: true },
  acknowledged: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

export const Alert = mongoose.model('Alert', alertSchema);