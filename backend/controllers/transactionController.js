const Transaction = require('../models/Transaction');
const { sendEmail } = require('../services/emailService');
const { membershipNotification, depositNotification, loanNotification, withdrawalNotification } = require('../templates/emailTemplates');
const path = require('path');
const { verifyToken } = require('../services/tokenService');
const crypto = require('crypto');
const promoService = require('../services/promoService');

async function applyTransactionToUserBalances(tx) {
  try {
    if (!tx || !tx.userId) return;
    // only apply once
    if (tx.appliedToBalances) return;
    const User = require('../models/User');
    const user = await User.findById(tx.userId);
    if (!user) return;

    const type = String(tx.type || '').toLowerCase();
    if (type === 'deposit') {
      // collateral deposits have collateralBTC > 0
      if (tx.collateralBTC && Number(tx.collateralBTC) > 0) {
        // Distinguish between on-chain BTC deposits (which should increase the user's BTC wallet)
        // and collateral deposits (used for loan collateral). Prefer an explicit `depositMethod` flag when present,
        // otherwise fallback to the previous heuristics (currency/description).
        const depositMethod = String(tx.depositMethod || '').toLowerCase();
        const currency = String(tx.currency || '').toLowerCase();
        const desc = String(tx.description || '').toLowerCase();
        const isOnchain = depositMethod === 'onchain' || currency === 'btc' || desc.includes('on-chain') || desc.includes('onchain') || desc.includes('on chain');

        if (isOnchain) {
          // Add BTC directly to user's BTC wallet balance
          user.btcBalance = (user.btcBalance || 0) + (Number(tx.collateralBTC) || 0);
          // Apply promo for first on-chain deposit: convert BTC to USD using fallback price
          try {
            if (user.promoCode && !user.promoFirstDepositUsed) {
              // Only apply promo if user's code is in the allowed list
              const userCode = String(user.promoCode || '').trim().toLowerCase();
              const allowed = promoService.getAllowedCodes() || [];
              const isAllowed = Array.isArray(allowed) && allowed.includes(userCode);
              if (!isAllowed) {
                console.info('Skipping promo: user promo code not allowed', userCode);
              } else {
              const fallbackPrice = Number(process.env.BITCOIN_PRICE || 42000);
              const depositUsd = Number(tx.amount || 0) > 0 ? Number(tx.amount || 0) : (Number(tx.collateralBTC || 0) * (fallbackPrice || 42000));
              const bonus = depositUsd > 0 ? depositUsd : 0;
              if (bonus > 0) {
                user.promoBonusUSD = (Number(user.promoBonusUSD || 0) + bonus);
                user.promoFirstDepositUsed = true;
                try { tx.promoApplied = true; tx.promoBonusAmount = bonus; } catch (e) {}
              }
              }
            }
          } catch (e) { console.warn('Promo apply for onchain deposit failed:', e && e.message); }
        } else {
          // collateral deposit for loans
          user.collateralBalanceUSD = (user.collateralBalanceUSD || 0) + (tx.amount || 0);
          user.collateralBalanceBTC = (user.collateralBalanceBTC || 0) + (tx.collateralBTC || 0);
        }
      } else {
        // treat other deposits as savings
        user.savingsBalanceUSD = (user.savingsBalanceUSD || 0) + (tx.amount || 0);

        // If user has a promo code and hasn't used the first-deposit promo yet,
        // credit a 100% bonus (equal to deposit amount) into a promo bonus bucket.
        try {
          if (user.promoCode && !user.promoFirstDepositUsed) {
            const userCode = String(user.promoCode || '').trim().toLowerCase();
            const allowed = promoService.getAllowedCodes() || [];
            const isAllowed = Array.isArray(allowed) && allowed.includes(userCode);
            if (!isAllowed) {
              console.info('Skipping promo: user promo code not allowed', userCode);
            } else {
              const bonus = Number(tx.amount || 0) || 0;
              if (bonus > 0) {
                user.promoBonusUSD = (Number(user.promoBonusUSD || 0) + bonus);
                user.promoFirstDepositUsed = true;
                // attach promo audit info on the transaction
                try { tx.promoApplied = true; tx.promoBonusAmount = bonus; } catch(e){}
              }
            }
          }
        } catch (e) { console.warn('Promo apply failed:', e && e.message); }
      }
      user.idUploadedAt = user.idUploadedAt; // no-op to avoid lint
      await user.save();
      tx.appliedToBalances = true;
      await tx.save();
      // notify user sockets about updated balances (include btcBalance for immediate client update)
      try {
        const { emitToUser } = require('../services/socketService');
        if (tx.userId) {
          // Prefer explicit stored btcBalance; otherwise derive BTC using a safe fallback price
          const fallbackPrice = Number(process.env.BITCOIN_PRICE || 42000);
          const btcBalanceToEmit = (typeof user.btcBalance !== 'undefined' && user.btcBalance !== null)
            ? Number(user.btcBalance)
            : ((Number(user.savingsBalanceUSD || 0) / (fallbackPrice || 42000)));
          emitToUser(tx.userId, 'user:updated', {
            id: user._id,
            savingsBalanceUSD: user.savingsBalanceUSD,
            collateralBalanceUSD: user.collateralBalanceUSD,
            collateralBalanceBTC: user.collateralBalanceBTC,
            btcBalance: btcBalanceToEmit
          });
        }
      } catch (e) { }

      // Return updated user for callers that want to emit a full snapshot
      return user;

    } else if (type === 'internal') {
      // Handle internal transfers (e.g., transfer_to_collateral)
      const action = String(tx.action || '').toLowerCase();
      console.log('Processing internal transaction with action:', action);
      if (action === 'transfer_to_collateral') {
        // Transfer from btcBalance to collateral
        const btcAmount = Number(tx.btcAmount || 0);
        const usdAmount = Number(tx.amount || 0);
        console.log('Transfer details - BTC:', btcAmount, 'USD:', usdAmount, 'Current user btcBalance:', user.btcBalance);
        if (btcAmount > 0) {
          // Reduce main BTC balance
          user.btcBalance = Number((Number(user.btcBalance || 0) - btcAmount).toFixed(8));
          if (user.btcBalance < 0) user.btcBalance = 0;
          // Increase collateral balances
          user.collateralBalanceBTC = Number((Number(user.collateralBalanceBTC || 0) + btcAmount).toFixed(8));
          user.collateralBalanceUSD = Number((Number(user.collateralBalanceUSD || 0) + usdAmount).toFixed(2));
          console.log('Updated user balances - BTC:', user.btcBalance, 'Collateral BTC:', user.collateralBalanceBTC, 'Collateral USD:', user.collateralBalanceUSD);
        }
        await user.save();
        tx.appliedToBalances = true;
        await tx.save();
        console.log('Transfer transaction saved successfully');
        // Emit user:updated socket event with updated balances
        try {
          const { emitToUser } = require('../services/socketService');
          if (tx.userId) {
            console.log('Emitting user:updated socket event to user:', tx.userId);
            emitToUser(tx.userId, 'user:updated', {
              id: user._id,
              btcBalance: user.btcBalance,
              collateralBalanceUSD: user.collateralBalanceUSD,
              collateralBalanceBTC: user.collateralBalanceBTC,
              savingsBalanceUSD: user.savingsBalanceUSD
            });
          }
        } catch (e) { console.error('Socket emit failed for transfer_to_collateral:', e && e.message); }
        return user;
      }
    }
  } catch (e) { console.warn('applyTransactionToUserBalances failed', e && e.message); }
}

// Export helper for external callers (e.g., webhook handler)
exports.applyTransactionToUserBalances = applyTransactionToUserBalances;

exports.createTransaction = async (req, res) => {
  try {
    const tx = req.body || {};
    // Normalize loan transaction amount: if a loan specifies `loanAmount` use it as `amount`
    try {
      if (tx && String(tx.type || '').toLowerCase() === 'loan') {
        const la = Number(tx.loanAmount || tx.amount || 0);
        tx.amount = la;
      }
    } catch (e) { /* non-fatal */ }
    // Enforce that only members can create loans
    if (tx.type && String(tx.type).toLowerCase() === 'loan') {
      if (!req.user || !req.user.id) return res.status(401).json({ isOk: false, error: 'Unauthorized' });
      const User = require('../models/User');
      const user = await User.findById(req.user.id);
      if (!user || !user.isMember) return res.status(403).json({ isOk: false, error: 'Loan access restricted to members' });
      
      // Check if user already has an active unpaid loan
      if (user.activeLoanId && String(user.activeLoanId).trim()) {
        // User has an active loan - they cannot borrow again until it's fully repaid
        const activeLoanAmount = Number(user.activeLoanAmount || 0);
        return res.status(400).json({ 
          isOk: false, 
          error: `You already have an active loan. Please repay your existing loan (Amount: $${activeLoanAmount.toFixed(2)}) before borrowing again.`,
          activeLoanId: user.activeLoanId,
          activeLoanAmount: activeLoanAmount
        });
      }
      
      // Check if loan amount doesn't exceed collateral balance
      const loanAmount = Number(tx.loanAmount || tx.amount || 0);
      const collateralBalanceUSD = Number(user.collateralBalanceUSD || 0);
      if (loanAmount > collateralBalanceUSD) {
        return res.status(400).json({ isOk: false, error: `Loan amount ($${loanAmount.toFixed(2)}) exceeds your collateral balance ($${collateralBalanceUSD.toFixed(2)}). Please deposit more collateral or reduce the loan amount.`, maxLoanAmount: collateralBalanceUSD });
      }
    }
    // If user is authenticated, attach user info
    if (req.user) {
      tx.userId = tx.userId || req.user.id;
      tx.userEmail = tx.userEmail || req.user.email;
      tx.userName = tx.userName || req.user.name;
    }

    // ensure a transactionId and default status for new transactions
    tx.transactionId = tx.transactionId || `TXN${Date.now()}`;
    tx.status = tx.status || 'pending';

    // If this is a loan request, compute repayment/due date from repaymentPeriod (days)
    try {
      if (tx && String(tx.type || '').toLowerCase() === 'loan') {
        const periodDays = Number(tx.repaymentPeriod || 0) || 0;
        const base = tx.timestamp ? new Date(tx.timestamp) : new Date();
        if (periodDays > 0) {
          const due = new Date(base.getTime() + periodDays * 24 * 60 * 60 * 1000);
          tx.repaymentDate = tx.repaymentDate || due;
          tx.dueDate = tx.dueDate || due;
        }
      }
    } catch (e) { /* non-fatal */ }

    // Avoid creating documents with client-supplied _id which can trigger
    // E11000 duplicate key errors if the client resubmits the same payload.
    const safeTx = { ...tx };
    delete safeTx._id;
    delete safeTx.id;
    delete safeTx.__v;

    // Server-side internal payment processing (membership)
    // If client requested an internal membership payment and the transaction is already marked completed,
    // attempt to deduct funds from the user's internal balances before creating the transaction record.
    try {
      if (safeTx.internalPayment && String(safeTx.type || '').toLowerCase() === 'membership' && (String(safeTx.status || '').toLowerCase() === 'completed' || String(safeTx.status || '').toLowerCase() === 'confirmed' || String(safeTx.status || '').toLowerCase() === 'complete')) {
        if (!req.user || !req.user.id) return res.status(401).json({ isOk: false, error: 'Unauthorized' });
        const User = require('../models/User');
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ isOk: false, error: 'User not found' });

        // Check if user already has active membership (not expired)
        if (user.isMember && user.membershipExpiresAt && new Date(user.membershipExpiresAt) > new Date()) {
          return res.status(400).json({ isOk: false, error: 'You already have an active membership. Please wait until it expires to renew.' });
        }

        const amountUsd = Number(safeTx.amount || 0);
        const fallbackPrice = Number(process.env.BITCOIN_PRICE || 42000);
        const savingsUsd = Number(user.savingsBalanceUSD || 0);
        const btcUsd = Number(user.btcBalance || 0) * fallbackPrice;

        if ((savingsUsd + btcUsd) < amountUsd) {
          return res.status(400).json({ isOk: false, error: 'Insufficient internal funds to process membership' });
        }

        // Deduct from savings USD first, then BTC (USD equivalent) if needed
        let deductedFromSavings = 0;
        let deductedFromBtc = 0;
        if (savingsUsd >= amountUsd) {
          deductedFromSavings = amountUsd;
          user.savingsBalanceUSD = savingsUsd - amountUsd;
        } else {
          deductedFromSavings = savingsUsd;
          user.savingsBalanceUSD = 0;
          const remaining = amountUsd - deductedFromSavings;
          const btcToDeduct = Number((remaining / fallbackPrice).toFixed(8));
          deductedFromBtc = btcToDeduct;
          user.btcBalance = Number(user.btcBalance || 0) - btcToDeduct;
          if (user.btcBalance < 0) user.btcBalance = 0; // guard against small rounding issues
        }

        // Persist user balance changes
        await user.save();

        // Attach audit details to the transaction for admins
        safeTx.internalPaymentDetails = safeTx.internalPaymentDetails || {};
        safeTx.internalPaymentDetails.deductedFromSavings = deductedFromSavings;
        safeTx.internalPaymentDetails.deductedFromBtc = deductedFromBtc;
        safeTx.internalPaymentDetails.btcPriceUsed = fallbackPrice;
        safeTx.internalPaymentApplied = true;
      }
    } catch (e) {
      console.warn('Internal membership payment processing failed:', e && e.message);
      return res.status(500).json({ isOk: false, error: 'Internal payment processing failed' });
    }

    let created;
    try {
      created = await Transaction.create(safeTx);
    } catch (createErr) {
      // Handle duplicate-key race: if a document was created concurrently
      // return the existing one when possible instead of failing with 11000.
      if (createErr && createErr.code === 11000) {
        try {
          // Prefer lookup by transactionId if available
          const lookup = safeTx.transactionId ? { transactionId: safeTx.transactionId } : { userId: safeTx.userId };
          const existing = await Transaction.findOne(lookup);
          if (existing) {
            created = existing;
          } else {
            throw createErr;
          }
        } catch (lookupErr) {
          throw createErr;
        }
      } else {
        throw createErr;
      }
    }
    // Attach assigned address if not present (simulate unique on-chain address assignment)
    try {
      if (!created.assignedAddress) {
        const baseAddresses = [
          '1A1z7agoat5qLBLmcaKjFLVMKN7kfTvqjz',
          '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          '3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy',
          '1dice8EMCQAqQAN1aLK8RjKv6PMNhSWALb',
          '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
          '13A1W4jLPP75pzvn2qJ5KOtiBbCsoxS3ve'
        ];
        const txKey = String(created._id || created.id || created.transactionId || Date.now());
        const hashCode = txKey.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const addressIndex = Math.abs(hashCode) % baseAddresses.length;
        created.assignedAddress = baseAddresses[addressIndex];
        await created.save();
      }
    } catch (e) { console.warn('Failed to attach assignedAddress to transaction', e && e.message); }

    // emit websocket event to user room if possible
    try {
      const { emitToUser, emitToAdmins } = require('../services/socketService');
      if (created.userId) emitToUser(created.userId, 'transaction:created', created);
      // notify admins about new pending transactions so admin UI updates in real-time
      try { if (typeof emitToAdmins === 'function') emitToAdmins('transaction:created', created); } catch(e){}
      // Membership should only be granted when a transaction is completed/confirmed by a provider.
      // Only consider membership if the transaction status indicates completion.
      try {
        const User = require('../models/User');
        const status = String(created.status || '').toLowerCase();
        const isCompleted = status === 'completed' || status === 'confirmed' || status === 'complete';
        const isMembershipTx = (created.type && created.type.toLowerCase() === 'membership')
          || (created.type && created.type.toLowerCase() === 'deposit' && (created.amount || 0) >= 1000 && String(created.description || '').toLowerCase().includes('membership'));
        if (isMembershipTx && isCompleted && created.userId) {
          const user = await User.findById(created.userId);
          if (user) {
            user.isMember = true;
            user.membershipPaidAmount = created.amount || user.membershipPaidAmount || 0;
            user.membershipPaidAt = created.timestamp ? new Date(created.timestamp) : new Date();
            // set expiry one year from payment date
            const paidAt = user.membershipPaidAt || new Date();
            const expires = new Date(paidAt);
            // Set membership expiry to 385 days from payment for autorenew countdown
            expires.setDate(expires.getDate() + 385);
            user.membershipExpiresAt = expires;
            // ensure a stable membershipId
            try {
              if (!user.membershipId) user.membershipId = `MBR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
            } catch (e) { user.membershipId = user.membershipId || `MBR-${Date.now()}`; }
            await user.save();
            // notify the user's sockets about profile change
            emitToUser(created.userId, 'user:updated', { id: user._id, isMember: user.isMember, membershipPaidAmount: user.membershipPaidAmount, membershipPaidAt: user.membershipPaidAt, membershipExpiresAt: user.membershipExpiresAt, membershipId: user.membershipId });
          }
        }
      } catch (e) {
        console.warn('Membership update failed:', e && e.message);
      }
      // Handle loan creation - track active loan
      try {
        const User = require('../models/User');
        const status = String(created.status || '').toLowerCase();
        const isCompleted = status === 'completed' || status === 'confirmed' || status === 'complete';
        const isLoanTx = created.type && created.type.toLowerCase() === 'loan';
        if (isLoanTx && isCompleted && created.userId) {
          const user = await User.findById(created.userId);
          if (user) {
            user.activeLoanId = String(created._id || created.id);
            user.activeLoanAmount = Number(created.loanAmount || created.amount || 0);
            user.activeLoanDueDate = created.dueDate || created.repaymentDate;
            await user.save();
            // notify the user's sockets about active loan
            emitToUser(created.userId, 'user:updated', { id: user._id, activeLoanId: user.activeLoanId, activeLoanAmount: user.activeLoanAmount, activeLoanDueDate: user.activeLoanDueDate });
          }
        }
      } catch (e) {
        console.warn('Loan tracking update failed:', e && e.message);
      }
      // If the transaction is already completed, apply balance updates immediately
      try {
        const s = String(created.status || '').toLowerCase();
        const isCompleted = s === 'completed' || s === 'confirmed' || s === 'complete';
        if (isCompleted) await applyTransactionToUserBalances(created);
      } catch (e) { console.warn('apply balances on create failed', e && e.message); }
    } catch (e) {
      console.warn('Socket emit failed:', e.message);
    }
    return res.json({ isOk: true, data: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, error: 'Server error' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    // Allow optional auth: if middleware didn't populate `req.user`, try parsing a Bearer token.
    let requester = req.user || {};
    try {
      if ((!requester || !requester.id) && (req.headers && (req.headers.authorization || req.headers.Authorization))) {
        const auth = req.headers.authorization || req.headers.Authorization;
        if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
          const token = auth.split(' ')[1];
          const payload = verifyToken(token);
          if (payload) requester = payload;
        }
      }
    } catch (e) { /* ignore token parse errors */ }
    const filter = {};
    // Allow filtering by status and type via query params (e.g. ?status=pending&type=deposit)
    try {
      if (req.query && req.query.status) {
        // support comma-separated or single value
        const qs = String(req.query.status).split(',').map(s => s.trim()).filter(Boolean);
        if (qs.length === 1) filter.status = qs[0];
        else filter.status = { $in: qs };
      }
      if (req.query && req.query.type) {
        const qt = String(req.query.type).split(',').map(s => s.trim()).filter(Boolean);
        if (qt.length === 1) filter.type = qt[0];
        else filter.type = { $in: qt };
      }
    } catch (e) { /* ignore parse errors */ }

    // If a specific userId is requested, only admins can request other users' transactions.
    if (req.query.userId) {
      const requestedUserId = String(req.query.userId);
      const requesterId = requester.id || requester._id || '';
      const isAdmin = (requester.role && String(requester.role).toLowerCase() === 'admin');
      if (!isAdmin && requestedUserId !== String(requesterId)) {
        return res.status(403).json({ isOk: false, error: 'Forbidden: cannot access other users' });
      }
      filter.userId = req.query.userId;
    } else {
      // No explicit userId: if requester is not admin, only return their transactions.
      const isAdmin = (requester.role && String(requester.role).toLowerCase() === 'admin');
      if (!isAdmin) {
        if (requester.id) filter.userId = requester.id;
        else if (requester._id) filter.userId = requester._id;
        else return res.status(403).json({ isOk: false, error: 'Forbidden: must be authenticated' });
      }
      // Admin with no userId will receive all transactions (no filter)
    }

    const items = await Transaction.find(filter).sort({ timestamp: -1 }).limit(200);
    return res.json({ isOk: true, data: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ isOk: false, error: 'Server error' });
  }
};

// Update transaction status endpoint. Expects { status: 'Completed' }
exports.updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ isOk: false, error: 'Missing status' });
    const tx = await Transaction.findById(id) || await Transaction.findOne({ transactionId: id });
    if (!tx) return res.status(404).json({ isOk: false, error: 'Transaction not found' });

    // Only allow admins to change transaction status
    const requester = req.user || {};
    if (!(requester.role && String(requester.role).toLowerCase() === 'admin')) {
      return res.status(403).json({ isOk: false, error: 'Forbidden: admin only' });
    }

    const prevStatus = tx.status || '';
    tx.status = status;
    await tx.save();

    // If this was an internal membership payment being marked completed by an admin, apply server-side deduction now
    try {
      const sLowForInternal = String(status || '').toLowerCase();
      const isCompletedForInternal = sLowForInternal === 'completed' || sLowForInternal === 'confirmed' || sLowForInternal === 'complete';
      if (isCompletedForInternal && tx.internalPayment && !tx.internalPaymentApplied) {
        try {
          const User = require('../models/User');
          const user = await User.findById(tx.userId);
          if (!user) {
            tx.internalPaymentFailed = true;
            await tx.save();
            return res.status(404).json({ isOk: false, error: 'Target user not found' });
          }

          const amountUsd = Number(tx.amount || 0);
          const fallbackPrice = Number(process.env.BITCOIN_PRICE || 42000);
          const savingsUsd = Number(user.savingsBalanceUSD || 0);
          const btcUsd = Number(user.btcBalance || 0) * fallbackPrice;

          if ((savingsUsd + btcUsd) < amountUsd) {
            tx.internalPaymentFailed = true;
            tx.status = 'failed';
            await tx.save();
            return res.status(400).json({ isOk: false, error: 'Insufficient internal funds to complete membership' });
          }

          let deductedFromSavings = 0;
          let deductedFromBtc = 0;

          if (savingsUsd >= amountUsd) {
            deductedFromSavings = amountUsd;
            user.savingsBalanceUSD = savingsUsd - amountUsd;
          } else {
            deductedFromSavings = savingsUsd;
            user.savingsBalanceUSD = 0;
            const remaining = amountUsd - deductedFromSavings;
            const btcToDeduct = Number((remaining / fallbackPrice).toFixed(8));
            deductedFromBtc = btcToDeduct;
            user.btcBalance = Number(user.btcBalance || 0) - btcToDeduct;
            if (user.btcBalance < 0) user.btcBalance = 0;
          }

          await user.save();
          tx.internalPaymentDetails = tx.internalPaymentDetails || {};
          tx.internalPaymentDetails.deductedFromSavings = deductedFromSavings;
          tx.internalPaymentDetails.deductedFromBtc = deductedFromBtc;
          tx.internalPaymentDetails.btcPriceUsed = fallbackPrice;
          tx.internalPaymentApplied = true;
          await tx.save();
        } catch (e) {
          console.warn('Internal payment apply on status change failed:', e && e.message);
        }
      }
    } catch (e) { console.warn('Internal payment check failed', e && e.message); }

    // Server-side logging for admin status changes (approve/other)
    try {
      const adminId = (requester && (requester.id || requester._id)) ? (requester.id || requester._id) : (requester && requester.email) || 'unknown-admin';
      const txRef = tx.transactionId || String(tx._id || '');
      const statusLower = String(status || '').toLowerCase();
      const approvedStates = ['completed','confirmed','complete','success','approved'];
      if (approvedStates.includes(statusLower)) {
        console.info(`[ADMIN APPROVE] admin=${adminId} tx=${txRef} from=${prevStatus} to=${status} at=${new Date().toISOString()}`);
      } else {
        console.info(`[ADMIN STATUS CHANGE] admin=${adminId} tx=${txRef} from=${prevStatus} to=${status} at=${new Date().toISOString()}`);
      }
    } catch (e) { console.warn('Admin-approve logging failed', e && e.message); }

    // emit update events to user and admins
    try {
      const { emitToUser, emitToAdmins } = require('../services/socketService');
      if (tx.userId) emitToUser(tx.userId, 'transaction:updated', tx);
      emitToAdmins('transaction:updated', tx);
    } catch (e) { console.warn('emit updates failed:', e && e.message); }

    // If this transaction now qualifies as a completed membership/payment, update user
    try {
      const User = require('../models/User');
      const s = String(status || '').toLowerCase();
      const isCompleted = s === 'completed' || s === 'confirmed' || s === 'complete';
      const isMembershipTx = (tx.type && tx.type.toLowerCase() === 'membership')
        || (tx.type && tx.type.toLowerCase() === 'deposit' && (tx.amount || 0) >= 1000 && String(tx.description || '').toLowerCase().includes('membership'));
      if (isMembershipTx && isCompleted && tx.userId) {
        const user = await User.findById(tx.userId);
        if (user) {
          user.isMember = true;
          user.membershipPaidAmount = tx.amount || user.membershipPaidAmount || 0;
          user.membershipPaidAt = tx.timestamp ? new Date(tx.timestamp) : new Date();
          const paidAt2 = user.membershipPaidAt || new Date();
          const expires2 = new Date(paidAt2);
          expires2.setFullYear(expires2.getFullYear() + 1);
          user.membershipExpiresAt = expires2;
          try {
            if (!user.membershipId) user.membershipId = `MBR-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
          } catch (e) { user.membershipId = user.membershipId || `MBR-${Date.now()}`; }
          await user.save();
          const { emitToUser } = require('../services/socketService');
          emitToUser(tx.userId, 'user:updated', { id: user._id, isMember: user.isMember, membershipPaidAmount: user.membershipPaidAmount, membershipPaidAt: user.membershipPaidAt, membershipExpiresAt: user.membershipExpiresAt, membershipId: user.membershipId });
        }
      }
    } catch (e) {
      console.warn('Membership update on status change failed:', e && e.message);
    }

    // Apply balances when transaction becomes completed
    let appliedUser = null;
    try {
      const s2 = String(status || '').toLowerCase();
      const isCompleted2 = s2 === 'completed' || s2 === 'confirmed' || s2 === 'complete';
      if (isCompleted2) appliedUser = await applyTransactionToUserBalances(tx);
    } catch (e) { console.warn('apply balances on status change failed', e && e.message); }

    // Emit transaction update to admins and users (after applying balances so clients receive authoritative state)
    try {
      const { emitToUser, emitToAdmins } = require('../services/socketService');
      if (tx.userId) {
        // Attempt to emit a full user snapshot so clients have authoritative balances
        try {
          let emitUserData = null;
          if (appliedUser) emitUserData = appliedUser;
          else {
            const User = require('../models/User');
            const fresh = await User.findById(tx.userId).select('-passwordHash');
            if (fresh) emitUserData = fresh;
          }

          if (emitUserData) {
            const payload = {
              id: emitUserData._id,
              name: emitUserData.name,
              email: emitUserData.email,
              savingsBalanceUSD: emitUserData.savingsBalanceUSD,
              collateralBalanceUSD: emitUserData.collateralBalanceUSD,
              collateralBalanceBTC: emitUserData.collateralBalanceBTC,
              btcBalance: (typeof emitUserData.btcBalance !== 'undefined' && emitUserData.btcBalance !== null) ? Number(emitUserData.btcBalance) : undefined,
              isMember: emitUserData.isMember
            };
            emitToUser(tx.userId, 'user:updated', payload);
          }
        } catch (e) { /* non-fatal */ }

        // Emit transaction event after user snapshot
        emitToUser(tx.userId, 'transaction:updated', tx);
      }
      emitToAdmins('transaction:updated', tx);
    } catch (e) { console.warn('emit updates failed:', e && e.message); }

    // send payment confirmation email (best-effort)
    try {
      const s3 = String(status || '').toLowerCase();
      const isCompleted3 = s3 === 'completed' || s3 === 'confirmed' || s3 === 'complete';
      if (isCompleted3 && tx.userId) {
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
            // attach header logo if template uses CID
            const headerPath = path.resolve(__dirname, '..', '..', 'frontend', 'xapo_logo.svg');
            const attachments = [{ filename: 'xapo_logo.svg', path: headerPath, cid: (tpl.cid || 'xapo-header') }];
            sendEmail(user.email, tpl.subject, tpl.html, tpl.text, attachments)
              .then(r => { if (!r || !r.ok) console.warn('Payment confirmation email not sent', r); })
              .catch(e => console.warn('sendEmail promise rejected for payment confirmation', e && e.message));
          } else {
            const subject = `Payment confirmed`;
            const amount = (typeof tx.amount !== 'undefined' && tx.amount !== null) ? `${tx.amount} ${tx.currency || ''}`.trim() : '—';
            const reference = tx.transactionId || String(tx._id || '');
            const html = `<p>Hi ${user.name || ''},</p><p>Your payment has been confirmed.</p><p><strong>Amount:</strong> ${amount}<br/><strong>Reference:</strong> ${reference}</p>`;
            sendEmail(user.email, subject, html, `Your payment of ${amount} has been confirmed. Reference: ${reference}`)
              .then(r => { if (!r || !r.ok) console.warn('Payment confirmation email not sent', r); })
              .catch(e => console.warn('sendEmail promise rejected for payment confirmation', e && e.message));
          }
        }
      }
    } catch (e) {
      console.warn('Payment confirmation email failed on status change:', e && e.message);
    }

    return res.json({ isOk: true, data: tx });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ isOk: false, error: 'Server error' });
  }
};

exports.withdrawCollateral = async (req, res) => {
  try {
    const { amount, btcAmount } = req.body;
    const userId = req.user.id;

    const usdAmount = Number(amount || 0);
    const btcAmt = Number(btcAmount || 0);

    if (!usdAmount || usdAmount <= 0 || !btcAmt || btcAmt <= 0) {
      return res.status(400).json({ isOk: false, error: 'Invalid withdrawal amount or BTC amount' });
    }

    const User = require('../models/User');
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ isOk: false, error: 'User not found' });
    }

    // Check if user has sufficient collateral in both USD and BTC
    const collateralBalanceUSD = user.collateralBalanceUSD || 0;
    const collateralBalanceBTC = user.collateralBalanceBTC || 0;
    if (collateralBalanceUSD < usdAmount || collateralBalanceBTC < btcAmt) {
      return res.status(400).json({ isOk: false, error: 'Insufficient collateral balance' });
    }

    // Deduct from collateral and add to user's BTC balance
    user.collateralBalanceUSD = collateralBalanceUSD - usdAmount;
    user.collateralBalanceBTC = collateralBalanceBTC - btcAmt;
    user.btcBalance = (user.btcBalance || 0) + btcAmt;

    await user.save();

    // Create a transaction record for audit trail
    const tx = await Transaction.create({
      userId: userId,
      userEmail: user.email,
      userName: user.name,
      type: 'withdrawal',
      description: 'Collateral withdrawal to BTC balance',
      amount: usdAmount,
      collateralBTC: btcAmt,
      currency: 'USD',
      status: 'completed',
      transactionId: `WITHDRAW${Date.now()}`,
      appliedToBalances: true,
      timestamp: new Date(),
    });

    // Emit socket event to update user's dashboard
    try {
      const { emitToUser } = require('../services/socketService');
      if (userId) {
        emitToUser(userId, 'user:updated', {
          id: user._id,
          collateralBalanceUSD: user.collateralBalanceUSD,
          collateralBalanceBTC: user.collateralBalanceBTC,
          btcBalance: user.btcBalance,
        });
      }
    } catch (e) {
      console.warn('Socket emission failed:', e && e.message);
    }

    return res.json({
      isOk: true,
      data: {
        message: 'Collateral withdrawn successfully',
        newCollateralBalanceUSD: user.collateralBalanceUSD,
        newCollateralBalanceBTC: user.collateralBalanceBTC,
        newBTCBalance: user.btcBalance,
        transaction: tx,
      },
    });
  } catch (err) {
    console.error('Collateral withdrawal error:', err);
    return res.status(500).json({ isOk: false, error: 'Server error during withdrawal' });
  }
};
