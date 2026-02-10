const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const User = require('../models/User');
const { signToken } = require('../services/tokenService');
const { hashPassword } = require('../services/hashService');
const config = require('../config/config');

// Dev-only: promote the authenticated user to admin and return a new token
router.post('/promote', authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.role = 'admin';
    await user.save();
    const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });
    const payload = { id: user._id, email: user.email, name: user.name, createdAt: user.createdAt, isMember: user.isMember, role: user.role };
    return res.json({ success: true, token, data: payload });
  } catch (err) {
    console.error('Dev promote error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Dev-only: create an admin user with provided email/password (only when not in production)
router.post('/create-admin', async (req, res) => {
  try {
    if ((process.env.NODE_ENV || config.NODE_ENV || 'development') === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, message: 'email and password required' });
    // If user exists, return token
    let user = await User.findOne({ email });
    if (user) {
      user.role = 'admin';
      await user.save();
      const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });
      const payload = { id: user._id, email: user.email, name: user.name, createdAt: user.createdAt, isMember: user.isMember, role: user.role };
      return res.json({ success: true, token, data: payload });
    }

    const passwordHash = await hashPassword(password);
    user = await User.create({ name: name || 'Admin', email, passwordHash, role: 'admin' });
    const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });
    const payload = { id: user._id, email: user.email, name: user.name, createdAt: user.createdAt, isMember: user.isMember, role: user.role };
    return res.json({ success: true, token, data: payload });
  } catch (err) {
    console.error('Create-admin error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Debug endpoint: echo request headers and body (redacts Authorization)
router.post('/echo-req', async (req, res) => {
  try {
    const headers = {};
    for (const h in req.headers) {
      try {
        if (h.toLowerCase() === 'authorization') {
          headers[h] = req.headers[h] ? '[REDACTED]' : '';
        } else {
          headers[h] = req.headers[h];
        }
      } catch (e) { headers[h] = String(req.headers[h]); }
    }
    // include connection info for debugging
    const info = { ip: req.ip, method: req.method, url: req.originalUrl };
    return res.json({ ok: true, headers, body: req.body || null, info });
  } catch (err) {
    console.error('echo-req error', err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

// Dev-only: return a signed token for the given email (creates user if not exists)
router.post('/token-check', async (req, res) => {
  try {
    if ((process.env.NODE_ENV || config.NODE_ENV || 'development') === 'production') {
      return res.status(403).json({ success: false, message: 'Not allowed in production' });
    }
    const { email, name } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: 'email required' });
    let user = await User.findOne({ email });
    if (!user) {
      const pwd = Math.random().toString(36).slice(2,10);
      const passwordHash = await hashPassword(pwd);
      user = await User.create({ name: name || 'DevUser', email, passwordHash });
      console.log('Dev token-check created user', email);
    }
    const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });
    return res.json({ success: true, token, data: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('token-check error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

