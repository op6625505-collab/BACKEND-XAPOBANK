const express = require('express');
const router = express.Router();
const adminMiddleware = require('../middleware/adminMiddleware');
const Transaction = require('../models/Transaction');

// POST /api/admin/transactions/confirm
// Body: { transactionId: string, status?: string }
router.post('/transactions/confirm', adminMiddleware, async (req, res) => {
  try {
    const { transactionId, status } = req.body || {};
    if (!transactionId) return res.status(400).json({ isOk: false, error: 'transactionId required' });
    // find by transactionId or by _id
    let tx = await Transaction.findOne({ transactionId }) || await Transaction.findById(transactionId);
    if (!tx) return res.status(404).json({ isOk: false, error: 'Transaction not found' });

    const newStatus = status || 'Completed';
    const prevStatus = tx.status || '';
    tx.status = newStatus;
    await tx.save();

    // emit socket events
    try {
      const { emitToUser, emitToAdmins } = require('../services/socketService');
      if (tx.userId) emitToUser(tx.userId, 'transaction:updated', tx);
      if (typeof emitToAdmins === 'function') emitToAdmins('transaction:updated', tx);
    } catch (e) { console.warn('emit updates failed:', e && e.message); }

    // If completed, apply balances and membership logic (mirror server behavior)
    try {
      const User = require('../models/User');
      const crypto = require('crypto');
      const s = String(newStatus || '').toLowerCase();
      const wasCompleted = String(prevStatus || '').toLowerCase() === 'completed' || String(prevStatus || '').toLowerCase() === 'confirmed' || String(prevStatus || '').toLowerCase() === 'complete';
      const isCompleted = s === 'completed' || s === 'confirmed' || s === 'complete';

      // Only apply balance if not already applied (prevStatus was not completed)
      if (isCompleted && !wasCompleted) {
        // apply balances
        if (tx.userId) {
          const user = await User.findById(tx.userId);
          if (user) {
            const type = String(tx.type || '').toLowerCase();
            if (type === 'deposit') {
              if (tx.collateralBTC && Number(tx.collateralBTC) > 0) {
                user.collateralBalanceUSD = (user.collateralBalanceUSD || 0) + (tx.amount || 0);
                user.collateralBalanceBTC = (user.collateralBalanceBTC || 0) + (tx.collateralBTC || 0);
              } else {
                user.savingsBalanceUSD = (user.savingsBalanceUSD || 0) + (tx.amount || 0);
              }
            }
            // membership promotion
            const isMembershipTx = (tx.type && tx.type.toLowerCase() === 'membership')
              || (tx.type && tx.type.toLowerCase() === 'deposit' && (tx.amount || 0) >= 1000 && String(tx.description || '').toLowerCase().includes('membership'));
            if (isMembershipTx) {
              // Check if user already has active membership (not expired)
              if (user.isMember && user.membershipExpiresAt && new Date(user.membershipExpiresAt) > new Date()) {
                console.warn(`Membership renewal blocked for user ${tx.userId}: existing membership still active until ${user.membershipExpiresAt}`);
                // Don't prevent the entire transaction confirmation, just skip the membership update
              } else {
                user.isMember = true;
                user.membershipPaidAmount = tx.amount || user.membershipPaidAmount || 0;
                user.membershipPaidAt = tx.timestamp ? new Date(tx.timestamp) : new Date();
                const paidAt = user.membershipPaidAt || new Date();
                const expires = new Date(paidAt); expires.setFullYear(expires.getFullYear() + 1);
                user.membershipExpiresAt = expires;
                try { if (!user.membershipId) user.membershipId = `MBR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; } catch(e){ user.membershipId = user.membershipId || `MBR-${Date.now()}`; }
              }
              await user.save();
              try { const { emitToUser } = require('../services/socketService'); if (tx.userId) emitToUser(tx.userId, 'user:updated', { id: user._id, savingsBalanceUSD: user.savingsBalanceUSD, collateralBalanceUSD: user.collateralBalanceUSD, collateralBalanceBTC: user.collateralBalanceBTC, isMember: user.isMember }); } catch(e){}
            }
          }
        }
      }
    } catch (e) { console.warn('apply balances/membership failed:', e && e.message); }

    // send confirmation email (best-effort)
    try {
      const { sendEmail } = require('../services/emailService');
      const { membershipNotification, depositNotification, loanNotification, withdrawalNotification } = require('../templates/emailTemplates');
      if (String(newStatus || '').toLowerCase() === 'completed' && tx.userId) {
        const User = require('../models/User');
        const user = await User.findById(tx.userId);
        if (user && user.email) {
          const ttype = String(tx.type || 'payment').toLowerCase();
          let tpl = null;
          if (ttype === 'membership') tpl = membershipNotification(user, tx);
          else if (ttype === 'deposit') tpl = depositNotification(user, tx);
          else if (ttype === 'loan') tpl = loanNotification(user, tx);
          else if (ttype === 'withdrawal' || ttype === 'withdraw') tpl = withdrawalNotification(user, tx);
          if (tpl) {
            const headerPath = require('path').resolve(__dirname, '..', '..', 'frontend', 'xapo_logo.svg');
            const attachments = [{ filename: 'xapo_logo.svg', path: headerPath, cid: (tpl.cid || 'xapo-header') }];
            sendEmail(user.email, tpl.subject, tpl.html, tpl.text, attachments)
              .then(r => { if (!r || !r.ok) console.warn('Email send failed (adminTransactions)', r); })
              .catch(err => console.warn('Email send exception (adminTransactions)', err));
          } else {
            const subject = `Payment confirmed`;
            const amount = (typeof tx.amount !== 'undefined' && tx.amount !== null) ? `${tx.amount} ${tx.currency || ''}`.trim() : '—';
            const reference = tx.transactionId || String(tx._id || '');
            const html = `<p>Hi ${user.name || ''},</p><p>Your payment has been confirmed.</p><p><strong>Amount:</strong> ${amount}<br/><strong>Reference:</strong> ${reference}</p>`;
            sendEmail(user.email, subject, html, `Your payment of ${amount} has been confirmed. Reference: ${reference}`)
              .then(r => { if (!r || !r.ok) console.warn('Email send failed (adminTransactions)', r); })
              .catch(err => console.warn('Email send exception (adminTransactions)', err));
          }
        }
      }
    } catch (e) { console.warn('Payment confirmation email failed:', e && e.message); }

    return res.json({ isOk: true, data: tx });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ isOk: false, error: 'Server error' });
  }
});

module.exports = router;
