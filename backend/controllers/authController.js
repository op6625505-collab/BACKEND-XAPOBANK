const User = require('../models/User');
const { hashPassword, comparePassword } = require('../services/hashService');
const { signToken } = require('../services/tokenService');
const config = require('../config/config');
const crypto = require('crypto');
const path = require('path');

exports.register = async (req, res) => {
  console.log('REGISTER REQUEST:', req.body);
  try {
    // Accept either `name` or `fullName` from clients (some frontends send `name`).
    const { name, fullName, email, password, phone, country, promoCode } = req.body;
    const userName = (name || fullName || '').trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(400).json({ success: false, message: 'Email already exists' });
    const passwordHash = await hashPassword(password);
    const createPayload = { name: userName, email: normalizedEmail, passwordHash, phone: phone || '', country: country || '' };
    if (promoCode && String(promoCode).trim()) {
      try {
        const promoService = require('../services/promoService');
        const allowed = promoService.getAllowedCodes() || [];
        const code = String(promoCode).trim();
        if (allowed.includes(code.toLowerCase())) {
          createPayload.promoCode = code;
          createPayload.promoAppliedAt = new Date();
        } else {
          console.info('Promo code rejected (not in allowed list)', code);
        }
      } catch (e) {
        console.warn('Promo validation failed:', e && e.message);
      }
    }
    const user = await User.create(createPayload);
    const payload = { id: user._id, email: user.email, name: user.name, phone: user.phone, country: user.country, createdAt: user.createdAt, isMember: user.isMember, role: user.role };
    const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });

    // Diagnostic: log token generation (redacted) to help debug missing-token cases
    try { console.info('REGISTER TOKEN', { email: user.email, tokenPresent: !!token, tokenPreview: token ? (String(token).slice(0,8) + '...') : null }); } catch (e) {}

    // send welcome email (best-effort, non-blocking) with header image attachment
    try {
      const { sendEmail } = require('../services/emailService');
      const { welcomeNotification } = require('../templates/emailTemplates');
      const tpl = welcomeNotification(user);
      // Resolve the header SVG logo path in the frontend folder
      const headerPath = path.resolve(__dirname, '..', '..', 'frontend', 'xapo_logo.svg');
      const attachments = [{ filename: 'xapo_logo.svg', path: headerPath, cid: tpl.cid || 'xapo-header' }];
      sendEmail(user.email, tpl.subject, tpl.html, tpl.text, attachments)
        .then(r => { if (!r || !r.ok) console.warn('Welcome email not sent', r); })
        .catch(e => console.warn('sendEmail promise rejected (welcome)', e));
    } catch (e) {
      console.warn('Failed to send welcome email', e && e.message);
    }

    try { if (token) res.set('X-Token-Present', '1'); else res.set('X-Token-Present', '0'); if (token) res.set('X-Token-Length', String(String(token).length)); } catch (e) {}
    console.info('REGISTER RESPONSE', { email: user.email, tokenPresent: !!token, tokenLength: token ? String(token).length : 0 });
    return res.status(201).json({ success: true, message: 'Account created', token, data: payload });
  } catch (err) {
    console.error('Register error:', err && err.message ? err.message : err);
    // Handle duplicate key (race conditions) more gracefully
    if (err && err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    return res.status(500).json({ success: false, message: err && err.message ? err.message : 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    email = String(email).trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      try { console.info('LOGIN FAIL - no user or missing passwordHash', { email }); } catch (e) {}
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    let ok = false;
    try { ok = await comparePassword(password, user.passwordHash); } catch (e) { ok = false; }
    if (!ok) {
      try { console.info('LOGIN FAIL - password mismatch', { email }); } catch (e) {}
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = signToken({ id: user._id, email: user.email, name: user.name, role: user.role });
    // Diagnostic: log token generation (redacted) to help debug missing-token cases
    try { console.info('LOGIN TOKEN', { email: user.email, id: user._id ? String(user._id) : '', tokenPresent: !!token, tokenPreview: token ? (String(token).slice(0,8) + '...') : null }); } catch (e) {}
    // Ensure headers are set explicitly and expose them for debugging even if CORS middleware is absent upstream
    try {
      if (token) {
        res.setHeader('X-Token-Present', '1');
        res.setHeader('X-Token-Length', String(String(token).length));
      } else {
        res.setHeader('X-Token-Present', '0');
        res.setHeader('X-Token-Length', '0');
        console.error('LOGIN: token is falsy after signToken()');
      }
      // Also ensure these headers are exposed to browsers when CORS is in play
      try { res.setHeader('Access-Control-Expose-Headers', 'X-Token-Present,X-Token-Length,Content-Type'); } catch (e) {}
    } catch (e) {
      console.warn('Failed to set diagnostic headers for login', e && e.message ? e.message : e);
    }
    console.info('LOGIN RESPONSE', { email: user.email, id: user._id ? String(user._id) : '', tokenPresent: !!token, tokenLength: token ? String(token).length : 0 });
    // include createdAt, membership flag, id verification fields and role for client UI
    const payload = {
      id: user._id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      isMember: user.isMember,
      role: user.role,
      idVerified: !!user.idVerified,
      idUploadedAt: user.idUploadedAt || null,
      passportPath: user.passportPath || null,
      nationalIdPath: user.nationalIdPath || null
    };
    return res.json({ success: true, token, data: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.me = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { name, email, phone, country } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (email && email !== user.email) {
      const exists = await User.findOne({ email });
      if (exists) return res.status(400).json({ success: false, message: 'Email already in use' });
      user.email = email;
    }

    if (name) user.name = name;
    if (typeof phone !== 'undefined') user.phone = phone;
    if (typeof country !== 'undefined') user.country = country;

    await user.save();
    const cleaned = { id: user._id, name: user.name, email: user.email, phone: user.phone, country: user.country };
    return res.json({ success: true, message: 'Profile updated', data: cleaned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Request a password reset: generate token, save to user, email link
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ success: true, message: "If that email exists, we've sent instructions" });

    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 1000 * 60 * 60; // 1 hour
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(expires);
    await user.save();

    try {
      const { sendEmail } = require('../services/emailService');
      // Prefer explicit CLIENT_URL, but fall back to the request origin so local dev works
      const origin = (req && (req.get && (req.get('origin') || req.protocol + '://' + req.get('host')))) || config.CLIENT_URL || 'http://localhost:5000';
      const resetBase = (config.CLIENT_URL && config.CLIENT_URL !== 'http://localhost:8000') ? config.CLIENT_URL.replace(/\/$/, '') : origin.replace(/\/$/, '');
      const resetUrl = `${resetBase}/reset-password.html?token=${token}&email=${encodeURIComponent(user.email)}`;
      const subject = 'Reset your password';
      const html = `<p>Hi ${user.name || ''},</p><p>We received a request to reset your password. Click the link below to set a new password (link expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, ignore this email.</p>`;
      // Log the reset URL for local testing when SMTP isn't configured
      console.log('Password reset URL (for testing):', resetUrl);
      sendEmail(user.email, subject, html)
        .then(r => { if (!r || !r.ok) console.warn('Reset email not sent', r); })
        .catch(e => console.warn('sendEmail promise rejected (reset)', e));
    } catch (e) {
      console.warn('Failed to send reset email', e && e.message);
    }

    return res.json({ success: true, message: 'If that email exists we sent instructions' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Perform password reset using token
exports.resetPassword = async (req, res) => {
  try {
    const { email, token, password } = req.body;
    if (!email || !token || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    const user = await User.findOne({ email, resetPasswordToken: token });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid token or email' });
    if (!user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'Token expired' });
    }

    user.passwordHash = await hashPassword(password);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ success: true, message: 'Password has been updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id; // From authMiddleware
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify current password
    const isPasswordValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Hash and update new password
    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    console.log(`Password changed for user: ${user.email}`);
    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id; // From authMiddleware

    // Delete the user from database
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`User account deleted: ${deletedUser.email}`);
    return res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getTwoFactorStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    return res.json({ success: true, twoFactorEnabled: user.twoFactorEnabled || false });
  } catch (err) {
    console.error('Get 2FA status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.enableTwoFactor = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.twoFactorEnabled = true;
    await user.save();
    
    console.log(`2FA enabled for user: ${user.email}`);
    return res.json({ success: true, message: 'Two-Factor Authentication enabled' });
  } catch (err) {
    console.error('Enable 2FA error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.disableTwoFactor = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.twoFactorEnabled = false;
    await user.save();
    
    console.log(`2FA disabled for user: ${user.email}`);
    return res.json({ success: true, message: 'Two-Factor Authentication disabled' });
  } catch (err) {
    console.error('Disable 2FA error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
