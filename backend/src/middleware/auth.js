import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'smart_health_jwt_secret_key_2026_super_secure';

export function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      patientId: user.patientId
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired authentication token.' });
  }
}

export function optionalAuth(req, _res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.query?.token;

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // ignore token verification error for optional auth
    }
  }
  next();
}

export function requireRoles(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Role '${req.user.role}' is not authorized for this action.` });
    }
    next();
  };
}
