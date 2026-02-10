const { addCode, removeCode, getAllowedCodes } = require('../services/promoService');

exports.list = async (req, res) => {
  try {
    const codes = getAllowedCodes();
    return res.json({ success: true, data: codes });
  } catch (e) {
    console.error('adminPromos.list failed', e && e.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.add = async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, message: 'Missing code' });
    const updated = addCode(code);
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error('adminPromos.add failed', e && e.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const code = req.params.code || req.body && req.body.code;
    if (!code) return res.status(400).json({ success: false, message: 'Missing code' });
    const updated = removeCode(code);
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error('adminPromos.remove failed', e && e.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
