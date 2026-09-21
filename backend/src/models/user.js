import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, index: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  role: { 
    type: String, 
    enum: ['Admin', 'Doctor', 'Nurse', 'Patient'], 
    default: 'Doctor',
    required: true 
  },
  patientId: { type: String, default: null, trim: true }
}, { timestamps: true, versionKey: false });

export const User = mongoose.model('User', userSchema);
