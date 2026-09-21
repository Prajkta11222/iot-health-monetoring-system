import 'dotenv/config';
import mongoose from 'mongoose';
import dns from 'dns';
import { createApp } from './src/app.js';
import { seedDefaultUsers } from './src/config/seedUsers.js';

// Set public DNS servers to resolve MongoDB Atlas SRV records on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // ignore if custom DNS configuration is unavailable
}

const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart-health';

try {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`✅ Connected to MongoDB at: ${mongoUri.replace(/:([^@]+)@/, ':****@')}`);
  await seedDefaultUsers();
} catch (err) {
  console.warn(`⚠️ Could not connect to primary MONGO_URI (${err.message}). Trying local fallback...`);
  try {
    const localUri = 'mongodb://127.0.0.1:27017/smart-health';
    await mongoose.connect(localUri);
    console.log(`✅ Connected to fallback local MongoDB at: ${localUri}`);
    await seedDefaultUsers();
  } catch (localErr) {
    console.error(`❌ Database connection error: ${localErr.message}`);
  }
}


createApp().listen(port, '0.0.0.0', () => console.log(`Smart Health API listening on 0.0.0.0:${port}`));