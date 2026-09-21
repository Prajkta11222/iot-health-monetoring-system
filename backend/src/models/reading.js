import mongoose from 'mongoose';

const readingSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  patientId: { type: String, default: null, index: true },
  timestamp: { type: Date, required: true, index: true },
  heartRate: { type: Number, default: null },
  heartRateValid: { type: Boolean, required: true },
  spo2: { type: Number, default: null },
  spo2Valid: { type: Boolean, required: true },
  temperature: { type: Number, default: null },
  temperatureValid: { type: Boolean, required: true },
  ecg: { type: [Number], default: [] },
  ecgLeadOff: { type: Boolean, required: true },
  ecgSignalQuality: { type: String, enum: ['GOOD', 'POOR_SIGNAL', 'LEAD_OFF', 'NO_DATA', 'DISCONNECTED'], required: true },
  ppgSignalQuality: { type: String, enum: ['GOOD', 'POOR', 'NO_FINGER', 'INVALID', 'DISCONNECTED'], required: true },
  fingerDetected: { type: Boolean, required: true },
  wifiRssi: { type: Number, default: null }
  ,max30102Status: { type: String, default: null }
  ,ad8232Status: { type: String, default: null }
  ,ds18b20Status: { type: String, default: null }
  ,esp32Status: { type: String, default: null }
}, { timestamps: true, versionKey: false });

readingSchema.index({ deviceId: 1, timestamp: -1 });
export const Reading = mongoose.model('Reading', readingSchema);