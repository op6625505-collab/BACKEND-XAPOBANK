const express = require('express');
const router = express.Router();
const adminMiddleware = require('../middleware/adminMiddleware');

// Protect all admin user management routes
router.use(adminMiddleware);

// POST /api/admin/user/:id/membership  { action: 'grant'|'revoke', amount?: number }
router.post('/user/:id/membership', async (req, res) => {
  try {
    const User = require('../models/User');
    const { id } = req.params;
    const { action, amount } = req.body || {};
    if (!id || !action) return res.status(400).json({ ok: false, error: 'Missing id or action' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    if (String(action).toLowerCase() === 'grant') {
      user.isMember = true;
      if (typeof amount !== 'undefined') user.membershipPaidAmount = Number(amount) || user.membershipPaidAmount || 0;
      user.membershipPaidAt = new Date();
      const exp = new Date(user.membershipPaidAt);
      exp.setFullYear(exp.getFullYear() + 1);
      user.membershipExpiresAt = exp;
      if (!user.membershipId) user.membershipId = `MBR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      await user.save();
      return res.json({ ok: true, data: { isMember: user.isMember, membershipPaidAmount: user.membershipPaidAmount, membershipExpiresAt: user.membershipExpiresAt, membershipId: user.membershipId } });
    } else if (String(action).toLowerCase() === 'revoke') {
      user.isMember = false;
      user.membershipExpiresAt = undefined;
      user.membershipPaidAt = undefined;
      user.membershipPaidAmount = undefined;
      await user.save();
      return res.json({ ok: true, data: { isMember: user.isMember } });
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('admin user membership error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /api/admin/user/:id/balance  { type: 'savings'|'collateral', operation: 'add'|'set', amount }
router.post('/user/:id/balance', async (req, res) => {
  try {
    const User = require('../models/User');
    const { id } = req.params;
    const { type, operation, amount } = req.body || {};
    if (!id || !type || !operation || typeof amount === 'undefined') return res.status(400).json({ ok: false, error: 'Missing parameters' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    const a = Number(amount || 0);
    if (type === 'savings') {
      if (operation === 'add') user.savingsBalanceUSD = (user.savingsBalanceUSD || 0) + a;
      else if (operation === 'set') user.savingsBalanceUSD = a;
      else return res.status(400).json({ ok: false, error: 'Unknown operation' });
    } else if (type === 'collateral') {
      if (operation === 'add') user.collateralBalanceUSD = (user.collateralBalanceUSD || 0) + a;
      else if (operation === 'set') user.collateralBalanceUSD = a;
      else return res.status(400).json({ ok: false, error: 'Unknown operation' });
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown type' });
    }
    await user.save();
    return res.json({ ok: true, data: { savingsBalanceUSD: user.savingsBalanceUSD, collateralBalanceUSD: user.collateralBalanceUSD } });
  } catch (err) {
    console.error('admin user balance error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// POST /api/admin/user/:id/loan  { action: 'approve'|'reject' }
router.post('/user/:id/loan', async (req, res) => {
  try {
    const User = require('../models/User');
    const { id } = req.params;
    const { action } = req.body || {};
    if (!id || !action) return res.status(400).json({ ok: false, error: 'Missing id or action' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    if (String(action).toLowerCase() === 'approve') {
      user.idVerified = true; // Assuming loan verification uses the same field, or add a new field like loanVerified
      await user.save();
      return res.json({ ok: true, data: { idVerified: user.idVerified } });
    } else if (String(action).toLowerCase() === 'reject') {
      user.idVerified = false;
      // Optionally remove uploaded files or mark as rejected
      await user.save();
      return res.json({ ok: true, data: { idVerified: user.idVerified } });
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('admin user loan error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// GET /api/admin/users/loan-pending
router.get('/users/loan-pending', async (req, res) => {
  try {
    const User = require('../models/User');
    // Find users who have uploaded any identity document (passport, national ID, or driver's license)
    const users = await User.find({
      idVerified: false,
      $or: [
        { passportPath: { $exists: true, $ne: null } },
        { nationalIdPath: { $exists: true, $ne: null } },
        { driversLicensePath: { $exists: true, $ne: null } }
      ]
    }).select('name email phone country passportPath nationalIdPath driversLicensePath livePhotoPath idUploadedAt createdAt');
    return res.json({ ok: true, data: users });
  } catch (err) {
    console.error('admin users loan-pending error', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
