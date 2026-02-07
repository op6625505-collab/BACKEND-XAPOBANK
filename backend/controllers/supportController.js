const { sendEmail } = require('../services/emailService');
const config = require('../config/config');

// POST /api/support
exports.sendSupport = async (req, res) => {
  try {
    const { message, subject } = req.body;
    const from = (req.user && req.user.email) || req.body.from || 'anonymous@local';
    const name = (req.user && req.user.name) || req.body.name || 'Anonymous';
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    const supportTo = process.env.SUPPORT_EMAIL || process.env.NOTIFY_FROM || 'support@example.com';
    const emailSubject = subject || `Support message from ${name}`;
    const html = `<p><strong>From:</strong> ${name} &lt;${from}&gt;</p><p><strong>Message:</strong></p><div>${message.replace(/\n/g, '<br>')}</div>`;

    const r = await sendEmail(supportTo, emailSubject, html, message);
    if (!r.ok) {
      return res.status(502).json({ success: false, message: 'Failed to send support message', error: r.error });
    }

    return res.json({ success: true, message: 'Support message sent' });
  } catch (err) {
    console.error('support.sendSupport error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
