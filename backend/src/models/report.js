import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reportId: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  reportType: { 
    type: String, 
    enum: ['COMPREHENSIVE_HEALTH', 'ECG_DIAGNOSTIC', 'VITAL_SIGNS_SUMMARY', 'ALERT_RISK_AUDIT'], 
    default: 'COMPREHENSIVE_HEALTH',
    required: true,
    index: true 
  },
  status: { 
    type: String, 
    enum: ['GENERATED', 'COMPLETED', 'ARCHIVED'], 
    default: 'GENERATED',
    required: true 
  },
  patientId: { type: String, required: true, index: true },
  deviceId: { type: String, default: 'ESP32_HEALTH_01' },
  timeRange: { type: String, default: '24H' },
  createdById: { type: String, default: 'system' },
  createdByUsername: { type: String, required: true, default: 'System Doctor' },
  createdByUserRole: { type: String, required: true, default: 'Doctor' },
  notes: { type: String, default: '' },
  metricsSummary: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true, versionKey: false });

reportSchema.index({ patientId: 1, createdAt: -1 });

export const Report = mongoose.model('Report', reportSchema);
