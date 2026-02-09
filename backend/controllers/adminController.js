const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { membershipNotification, depositNotification, loanNotification, withdrawalNotification } = require('../templates/emailTemplates');
const path = require('path');
const { emitToUser, emitToAdmins } = require('../services/socketService');

exports.listPending = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    else filter.status = 'Pending';
    const items = await Transaction.find(filter).sort({ timestamp: -1 }).limit(200);
    return res.json({ isOk: true, data: items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ isOk: false, error: 'Server error' });
  }
};

// Approve transaction and trigger membership logic if applicable
exports.approveTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id) || await Transaction.findOne({ transactionId: id });
    if (!tx) return res.status(404).json({ isOk: false, error: 'Transaction not found' });

    tx.status = 'Completed';
    await tx.save();

    // If this was a loan, create a disbursement deposit and apply balances server-side
    try {
      if (tx.type && String(tx.type).toLowerCase() === 'loan' && (tx.loanAmount || 0) > 0 && tx.userId) {
        const deposit = {
          type: 'deposit',
          amount: Number(tx.loanAmount || 0),
          currency: tx.currency || 'USD',
          status: 'Completed',
          timestamp: new Date().toISOString(),
          userId: tx.userId,
          userName: tx.userName || '',
          userEmail: tx.userEmail || '',
          description: 'Loan disbursement',
          collateralBTC: 0,
          loanAmount: 0,
          transactionId: (tx.transactionId ? String(tx.transactionId) : String(tx._id || Date.now())) + '_DISB'
        };
        const createdDep = await Transaction.create(deposit);
        // apply to user balances immediately
        try {
          const user = await User.findById(tx.userId);
          if (user) {
            user.savingsBalanceUSD = (user.savingsBalanceUSD || 0) + Number(createdDep.amount || 0);
            await user.save();
            // mark deposit applied
            createdDep.appliedToBalances = true;
            await createdDep.save();
            try { emitToUser(tx.userId, 'user:updated', { id: user._id, savingsBalanceUSD: user.savingsBalanceUSD, collateralBalanceUSD: user.collateralBalanceUSD }); } catch (e) {}
          }
        } catch (e) { console.warn('apply loan disbursement to user failed', e && e.message); }
        // notify user about the new deposit transaction
        try { if (tx.userId) emitToUser(tx.userId, 'transaction:created', createdDep); } catch (e) {}
      }
    } catch (e) { console.warn('creating disbursement on approve failed', e && e.message); }

    // notify user about transaction update
    try {
      if (tx.userId) emitToUser(tx.userId, 'transaction:updated', tx);
    } catch (e) { console.warn('emitToUser failed on admin approve', e && e.message); }
    // notify other admins about the change
    try { emitToAdmins('transaction:updated', tx); } catch (e) { /* ignore */ }

    // If this was a withdrawal referencing a loan, reduce the loan outstanding amount
    try {
      if (tx.type && String(tx.type).toLowerCase() === 'withdrawal' && tx.relatedLoanId && tx.userId) {
        // try to find the related loan by _id or transactionId
        let loanTx = null;
        try { loanTx = await Transaction.findById(tx.relatedLoanId); } catch (e) { /* ignore */ }
        if (!loanTx) loanTx = await Transaction.findOne({ transactionId: String(tx.relatedLoanId) });
        if (loanTx) {
          const loanAmt = Number(loanTx.loanAmount || loanTx.amount || 0);
          const withdrawAmt = Number(tx.amount || 0);
          const newOutstanding = Math.max(0, loanAmt - withdrawAmt);
          // update both loanAmount and amount fields for UI consistency
          loanTx.loanAmount = newOutstanding;
          loanTx.amount = newOutstanding;
          // If loan is fully withdrawn/paid out, mark as completed
          if (newOutstanding <= 0) loanTx.status = 'Completed';
          await loanTx.save();
          // emit updates for loan transaction so frontend refreshes activity/repayments
          try { emitToUser(loanTx.userId, 'transaction:updated', loanTx); } catch (e) {}
          try { emitToAdmins('transaction:updated', loanTx); } catch (e) {}
          
          // If loan is fully repaid, clear the user's active loan
          if (newOutstanding <= 0) {
            try {
              const User = require('../models/User');
              const user = await User.findById(tx.userId);
              if (user && user.activeLoanId === String(loanTx._id)) {
                user.activeLoanId = null;
                user.activeLoanAmount = 0;
                user.activeLoanDueDate = null;
                await user.save();
                try { emitToUser(tx.userId, 'user:updated', { id: user._id, activeLoanId: null, activeLoanAmount: 0, activeLoanDueDate: null }); } catch(e) {}
              }
            } catch (e) { console.warn('Failed to clear active loan status:', e && e.message); }
          }
        }
      }
    } catch (e) { console.warn('Failed to adjust related loan after withdrawal approve', e && e.message); }

    // membership update logic
    try {
      const s = String(tx.status || '').toLowerCase();
      const isCompleted = s === 'completed' || s === 'confirmed' || s === 'complete';
      const isMembershipTx = (tx.type && tx.type.toLowerCase() === 'membership')
        || (tx.type && tx.type.toLowerCase() === 'deposit' && (tx.amount || 0) >= 1000 && String(tx.description || '').toLowerCase().includes('membership'));
      if (isMembershipTx && isCompleted && tx.userId) {
        const user = await User.findById(tx.userId);
        if (user) {
          // Check if user already has active membership (not expired)
          if (user.isMember && user.membershipExpiresAt && new Date(user.membershipExpiresAt) > new Date()) {
            console.warn(`Membership renewal blocked for user ${tx.userId}: existing membership still active until ${user.membershipExpiresAt}`);
            return res.status(400).json({ isOk: false, error: 'User already has an active membership. Cannot renew until expiry.' });
          }
          user.isMember = true;
          user.membershipPaidAmount = tx.amount || user.membershipPaidAmount || 0;
          user.membershipPaidAt = tx.timestamp ? new Date(tx.timestamp) : new Date();
          const paidAt = user.membershipPaidAt || new Date();
          const expires = new Date(paidAt);
          expires.setFullYear(expires.getFullYear() + 1);
          user.membershipExpiresAt = expires;
          try {
            if (!user.membershipId) user.membershipId = `MBR-${Date.now().toString(36)}-${require('crypto').randomBytes(3).toString('hex')}`;
          } catch (e) { user.membershipId = user.membershipId || `MBR-${Date.now()}`; }
          await user.save();
          emitToUser(tx.userId, 'user:updated', { id: user._id, isMember: user.isMember, membershipPaidAmount: user.membershipPaidAmount, membershipPaidAt: user.membershipPaidAt, membershipExpiresAt: user.membershipExpiresAt, membershipId: user.membershipId });
        }
      }
    } catch (e) {
      console.warn('Membership update failed on admin approve:', e && e.message);
    }

    // send payment confirmation email (best-effort)
    try {
      if (tx.userId) {
        const user = await User.findById(tx.userId);
        if (user && user.email) {
          const ttype = String(tx.type || 'payment').toLowerCase();
          let tpl = null;
          if (ttype === 'membership') tpl = membershipNotification(user, tx);
          else if (ttype === 'deposit') tpl = depositNotification(user, tx);
          else if (ttype === 'loan') tpl = loanNotification(user, tx);
          else if (ttype === 'withdrawal' || ttype === 'withdraw') tpl = withdrawalNotification(user, tx);
          if (tpl) {
            const headerPath = path.resolve(__dirname, '..', '..', 'frontend', 'xapo_logo.svg');
            const attachments = [{ filename: 'xapo_logo.svg', path: headerPath, cid: (tpl.cid || 'xapo-header') }];
            sendEmail(user.email, tpl.subject, tpl.html, tpl.text, attachments).then(r => {
              if (!r.ok) console.warn('Payment confirmation email not sent', r.error);
            }).catch(e => console.warn('sendEmail promise rejected for payment confirmation', e && e.message));
          } else {
            const subject = `Payment confirmed`;
            const amount = (typeof tx.amount !== 'undefined' && tx.amount !== null) ? `${tx.amount} ${tx.currency || ''}`.trim() : '—';
            const reference = tx.transactionId || String(tx._id || '');
            const html = `<p>Hi ${user.name || ''},</p><p>Your payment has been confirmed.</p><p><strong>Amount:</strong> ${amount}<br/><strong>Reference:</strong> ${reference}</p>`;
            sendEmail(user.email, subject, html, `Your payment of ${amount} has been confirmed. Reference: ${reference}`)
              .then(r => { if (!r || !r.ok) console.warn('Payment confirmation email not sent (adminController)', r); })
              .catch(e => console.warn('sendEmail promise rejected (adminController)', e && e.message));
          }
        }
      }
    } catch (e) {
      console.warn('Payment confirmation email failed:', e && e.message);
    }

    return res.json({ isOk: true, data: tx });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ isOk: false, error: 'Server error' });
  }
};

// Fetch transactions for a specific user. Query with ?email=... or ?userId=...
exports.getUserTransactions = async (req, res) => {
  try {
    const { email, userId } = req.query;
    let user = null;
    if (email) user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user && userId) user = await User.findById(userId).catch(() => null);

    if (!user) {
      // If no user found, return empty list rather than 404 to make the admin UX simpler.
      return res.json({ isOk: true, data: [] });
    }

    const items = await Transaction.find({ userId: user._id }).sort({ timestamp: -1 }).limit(500);
    return res.json({ isOk: true, data: items });
  } catch (err) {
    console.error('getUserTransactions error', err);
    return res.status(500).json({ isOk: false, error: 'Server error' });
  }
};
