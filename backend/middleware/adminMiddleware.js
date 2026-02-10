const { verifyToken } = require('../services/tokenService');
const config = require('../config/config');

// Admin middleware: only allow the configured creator (by ADMIN_EMAIL or ADMIN_ID).
module.exports = (req, res, next) => {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const token = auth.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Invalid token' });

  // If ADMIN_EMAIL or ADMIN_ID is configured, only allow that user.
  if (config.ADMIN_EMAIL) {
    if (!payload.email || String(payload.email).toLowerCase() !== String(config.ADMIN_EMAIL).toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Admin access restricted' });
    }
  } else if (config.ADMIN_ID) {
    if (!payload.id || String(payload.id) !== String(config.ADMIN_ID)) {
      return res.status(403).json({ success: false, message: 'Admin access restricted' });
    }
  } else {
    // Fallback: require role === 'admin'
    if (payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin role required' });
  }

  req.user = payload;
  next();
};
