const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const adminMiddleware = require('../middleware/adminMiddleware');

// GET /api/admin/emails?limit=20&content=true
router.get('/emails', adminMiddleware, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const withContent = String(req.query.content || '').toLowerCase() === 'true';
    const dir = path.join(__dirname, '..', 'tmp_emails');
    if (!fs.existsSync(dir)) return res.json({ ok: true, emails: [] });
    const files = fs.readdirSync(dir).filter(f => f && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a,b) => b.mtime - a.mtime)
      .slice(0, limit);
    const emails = files.map(f => {
      const filePath = path.join(dir, f.name);
      const out = { file: f.name, path: filePath, mtime: f.mtime };
      if (withContent) {
        try { out.content = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { out.content = null; }
      }
      return out;
    });
    return res.json({ ok: true, emails });
  } catch (err) {
    console.error('admin/emails error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

module.exports = router;
