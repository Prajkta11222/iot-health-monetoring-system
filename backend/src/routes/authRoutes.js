import express from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/user.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Register new user
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password, fullName, role = 'Doctor', patientId = null } = req.body;

    if (!username || !email || !password || !fullName) {
      return res.status(400).json({ error: 'Username, email, password, and full name are required.' });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      fullName,
      role,
      patientId: patientId || (role === 'Patient' ? `PATIENT-${Math.floor(100 + Math.random() * 900)}` : null)
    });

    const token = generateToken(user);
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        patientId: user.patientId
      }
    });
  } catch (err) {
    next(err);
  }
});

// Login user
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username/Email and password are required.' });
    }

    const user = await User.findOne({
      $or: [{ username: username.trim() }, { email: username.trim().toLowerCase() }]
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials. Incorrect password.' });
    }

    const token = generateToken(user);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        patientId: user.patientId
      }
    });
  } catch (err) {
    next(err);
  }
});

// Logout user
router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// List all registered users (for user management / patient selection)
router.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

export default router;
