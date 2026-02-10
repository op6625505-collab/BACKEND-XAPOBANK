const express = require('express');
const router = express.Router();

// POST /api/test/email
// Body: { to, subject, html, text }
router.post('/email', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: 'Missing `to` in body' });
    const { sendEmail } = require('../services/emailService');
    const result = await sendEmail(to, subject || 'Test email from XapoBank', html || `<p>This is a test email</p>`, text || 'Test email');
    if (!result.ok) {
      const errStr = result.error && (typeof result.error === 'string') ? result.error : JSON.stringify(result.error || 'unknown');
      return res.status(500).json({ ok: false, error: errStr });
    }
    return res.json({ ok: true, info: result.info || null });
  } catch (err) {
    console.error('test email error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /api/test/sendgrid
// Body: { to, subject, html, text }
router.post('/sendgrid', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: 'Missing `to` in body' });
    const emailService = require('../services/emailService');
    const apiKey = process.env.SENDGRID_API_KEY || '';
    if (!apiKey) return res.status(500).json({ ok: false, error: 'SENDGRID_API_KEY not configured' });
    if (typeof emailService.sendViaSendGrid !== 'function') return res.status(500).json({ ok: false, error: 'sendViaSendGrid not available' });
    const result = await emailService.sendViaSendGrid({ to, subject, html, text }, apiKey);
    if (!result.ok) {
      const errStr = result.error && (typeof result.error === 'string') ? result.error : JSON.stringify(result.error || 'unknown');
      return res.status(500).json({ ok: false, error: errStr, response: result.response || null });
    }
    return res.json({ ok: true, info: result.response || null });
  } catch (err) {
    console.error('sendgrid test error', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;

// GET /api/test/smtp-verify
router.get('/smtp-verify', async (req, res) => {
  try {
    const emailService = require('../services/emailService');
    if (typeof emailService.verifyTransporter !== 'function') return res.status(500).json({ ok: false, error: 'verifyTransporter not available' });
    const result = await emailService.verifyTransporter();
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error || 'verify failed' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('smtp-verify error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});
