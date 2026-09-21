import bcrypt from 'bcryptjs';
import { User } from '../models/user.js';

export async function seedDefaultUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      console.log('🌱 Seeding initial user accounts in MongoDB...');

      const defaultPassword = await bcrypt.hash('password123', 10);

      const defaultUsers = [
        {
          username: 'doctor_smith',
          email: 'doctor@smarthealth.io',
          password: defaultPassword,
          fullName: 'Dr. Sarah Smith',
          role: 'Doctor',
          patientId: null
        },
        {
          username: 'admin_sys',
          email: 'admin@smarthealth.io',
          password: defaultPassword,
          fullName: 'System Administrator',
          role: 'Admin',
          patientId: null
        },
        {
          username: 'nurse_joy',
          email: 'nurse@smarthealth.io',
          password: defaultPassword,
          fullName: 'Nurse Joy',
          role: 'Nurse',
          patientId: null
        },
        {
          username: 'patient_john',
          email: 'john@smarthealth.io',
          password: defaultPassword,
          fullName: 'John Doe',
          role: 'Patient',
          patientId: 'PATIENT-101'
        }
      ];

      await User.insertMany(defaultUsers);
      console.log('✅ Default users seeded successfully! (Passwords: password123)');
    }
  } catch (err) {
    console.warn('⚠️ User seeding notice:', err.message);
  }
}
