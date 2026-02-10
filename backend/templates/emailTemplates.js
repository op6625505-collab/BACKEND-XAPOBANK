function wrapHtml(title, preheader, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;margin:0;padding:0;color:#111} .container{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e6e9ef} .header{background:#0f1724;color:#fff;padding:16px 20px} .content{padding:20px} h1{margin:0 0 8px;font-size:18px} p{margin:8px 0;color:#334155} .muted{color:#667085;font-size:13px} .btn{display:inline-block;margin-top:12px;padding:10px 14px;background:#0b74ff;color:#fff;border-radius:6px;text-decoration:none} .footer{padding:12px 20px;font-size:12px;color:#98a2b3;background:#fbfdff}</style>
  </head><body><div class="container"><div class="header"><strong>${title}</strong></div><div class="content"><div class="muted">${preheader}</div>${bodyHtml}</div><div class="footer">If you didn't expect this email, reply to this message or contact support.</div></div></body></html>`;
}

function membershipNotification(user, tx) {
  const title = 'Membership Confirmed — Welcome!';
  const pre = `Hi ${user.name || ''}, your membership payment was received.`;
  const body = `<div style="text-align:center;margin-bottom:12px;"><img src="cid:xapo-header" alt="Xapo Bank" style="max-width:100%;height:auto"/></div><h1>You're now a member</h1>
    <p>Thanks for joining — your membership is active. You now have access to loans and member benefits.</p>
    <p><strong>Amount:</strong> ${tx.amount || '—'} ${tx.currency || ''}<br/>
    <strong>Reference:</strong> ${tx.transactionId || tx._id || ''}<br/>
    <strong>Membership ID:</strong> ${user.membershipId || '—'}<br/>
    <strong>Expires:</strong> ${user.membershipExpiresAt ? new Date(user.membershipExpiresAt).toDateString() : '—'}</p>
    <a class="btn" href="${process.env.CLIENT_URL || '#'}">Go to dashboard</a>`;
  const html = wrapHtml(title, pre, body);
  const text = `Hi ${user.name || ''},\n\nYour membership payment of ${tx.amount || '—'} ${tx.currency || ''} was received. Reference: ${tx.transactionId || tx._id || ''}\n\nVisit your dashboard: ${process.env.CLIENT_URL || ''}`;
  return { subject: 'Membership confirmed — Welcome to XapoBank', html, text };
}

function depositNotification(user, tx) {
  const title = 'Deposit Confirmed';
  const pre = `Hi ${user.name || ''}, your deposit was confirmed.`;
  // Prefer showing USD amounts for collateral deposits (tx.amount should be USD)
  const accountLabel = tx.collateralBTC ? 'Collateral (USD)' : 'Savings Account';
  const depositedAt = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : (new Date()).toLocaleString();
  const body = `<div style="text-align:center;margin-bottom:12px;"><img src="cid:xapo-header" alt="Xapo Bank" style="max-width:100%;height:auto"/></div>
    <h1>Deposit Confirmation</h1>
    <p>Dear ${user.name || 'Customer'},</p>
    <p>We are pleased to confirm that we have received your deposit of <strong>${tx.amount || '—'} ${tx.currency || ''}</strong> on <strong>${depositedAt}</strong>. Below are the details of your transaction for your records:</p>
    <ul>
      <li><strong>Transaction ID:</strong> ${tx.transactionId || tx._id || ''}</li>
      <li><strong>Deposit Amount:</strong> ${tx.amount || '—'} ${tx.currency || ''}</li>
      <li><strong>Date of Deposit:</strong> ${depositedAt}</li>
      <li><strong>Account Type:</strong> ${accountLabel}</li>
    </ul>
    <p>Thank you for your prompt payment. Your funds will be processed and made available in your account shortly. If you have any questions or need further assistance, please do not hesitate to contact us at ${process.env.SUPPORT_EMAIL || 'support@xapobank.example'}.</p>
    <p>We appreciate your business!</p>
    <p>Best Regards,<br/>Xapo Bank Team</p>`;
  const html = wrapHtml(title, pre, body);
  const text = `Hi ${user.name || ''},\n\nYour deposit of ${tx.amount || '—'} ${tx.currency || ''} was confirmed into ${accountLabel}. Reference: ${tx.transactionId || tx._id || ''}\n\nView: ${process.env.CLIENT_URL || ''}`;
  return { subject: 'Deposit confirmed', html, text };
}

function loanNotification(user, tx) {
  const title = 'Loan Approved';
  const pre = `Hi ${user.name || ''}, your loan has been processed.`;
  const body = `<h1>Loan processed</h1>
    <p>Your loan request has been approved and processed.</p>
    <p><strong>Amount:</strong> ${tx.amount || '—'} ${tx.currency || ''}<br/>
    <strong>Reference:</strong> ${tx.transactionId || tx._id || ''}<br/>
    <strong>Repayment due:</strong> ${tx.repaymentDate ? new Date(tx.repaymentDate).toDateString() : 'See dashboard'}</p>
    <a class="btn" href="${process.env.CLIENT_URL || '#'}">Manage loan</a>`;
  const html = wrapHtml(title, pre, body);
  const text = `Hi ${user.name || ''},\n\nYour loan of ${tx.amount || '—'} ${tx.currency || ''} was processed. Reference: ${tx.transactionId || tx._id || ''}\n\nManage: ${process.env.CLIENT_URL || ''}`;
  return { subject: 'Loan processed', html, text };
}

function welcomeNotification(user) {
  const title = 'Welcome to XapoBank';
  const pre = `Hello ${user.name || ''}, your account has been created.`;
  // Build a safe client URL (prefer explicit CLIENT_URL; default to Render host)
  const clientUrl = (process.env.CLIENT_URL || 'https://xapoloan.onrender.com').replace(/\/$/, '');
  const body = `<div style="text-align:center;margin-bottom:12px;"><img src="cid:xapo-header" alt="Xapo Bank" style="max-width:100%;height:auto"/></div><h1>Hello Dear ${user.name || ''},</h1>
    <p>We're excited to let you know that your account has been successfully created! Thank you for joining Xapobank.</p>
    <h3>Getting Started:</h3>
    <ol>
      <li>Log In: Visit <a href="${clientUrl}/signsignup/signin.html">${clientUrl}/signsignup/signin.html</a> and log in using your email and the password you created.</li>
      <li>Explore: Check out our features and find out how you can make the most of your experience.</li>
      <li>Support: If you have any questions, our support team is here to help at ${process.env.SUPPORT_EMAIL || 'support@xapobank.example'}.</li>
    </ol>
    <p>Thank you for choosing us! We’re thrilled to have you on board.</p>
    <p>Best Regards,<br/>Xapo bank Team.</p>
    <hr/>
    <p class="muted" style="font-size:11px">© 2025 Xapo Holdings Limited. One Grand Casemates Square, Gibraltar GX11 1AA. All rights reserved.<br/>
    Privacy policy Contact us Legal notice<br/>
    Xapo Bank Limited is a company registered and incorporated in Gibraltar with company No. 111928. Xapo Bank Limited is regulated by the Gibraltar Financial Services Commission under the Financial Services Act 2019 as a ‘credit institution’ under Permission No. 23171.<br/>
    Xapo VASP Limited is a company registered and incorporated in Gibraltar with company No. 118088. Xapo VASP Limited is regulated by the Gibraltar Financial Services Commission under the Financial Services Act 2019 as a Distributed Ledger Technology Provider under Permission No. 26061.<br/>
    Eligible fiat deposits are protected by the Gibraltar Deposit Guarantee Scheme.</p>`;
  const html = wrapHtml(title, pre, body);
  const text = `Hello ${user.name || ''},\n\nWe're excited to let you know that your account has been successfully created!\n\nLog In: ${clientUrl}/signsignup/signin.html\nSupport: ${process.env.SUPPORT_EMAIL || 'support@xapobank.example'}\n\nBest Regards,\nXapo bank Team.`;
  return { subject: 'Welcome to XapoBank', html, text, cid: 'xapo-header' };
}

function withdrawalNotification(user, tx) {
  const title = 'Withdrawal Confirmed';
  const pre = `Hi ${user.name || ''}, your withdrawal request was processed.`;
  const depositedAt = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : (new Date()).toLocaleString();
  const body = `<div style="text-align:center;margin-bottom:12px;"><img src="cid:xapo-header" alt="Xapo Bank" style="max-width:100%;height:auto"/></div>
    <h1>Withdrawal Successful</h1>
    <p>Dear ${user.name || 'Customer'},</p>
    <p>We have confirmed your withdrawal of <strong>${tx.amount || '—'} ${tx.currency || ''}</strong> on <strong>${depositedAt}</strong>. Please check your wallet to confirm receipt of funds.</p>
    <ul>
      <li><strong>Transaction ID:</strong> ${tx.transactionId || tx._id || ''}</li>
      <li><strong>Withdrawal Amount:</strong> ${tx.amount || '—'} ${tx.currency || ''}</li>
      <li><strong>Date of Withdrawal:</strong> ${depositedAt}</li>
    </ul>
    <p>If you have any questions, contact ${process.env.SUPPORT_EMAIL || 'support@xapobank.example'}.</p>
    <p>Best Regards,<br/>Xapo Bank Team</p>`;
  const html = wrapHtml(title, pre, body);
  const text = `Hi ${user.name || ''},\n\nYour withdrawal of ${tx.amount || '—'} ${tx.currency || ''} was processed. Transaction ID: ${tx.transactionId || tx._id || ''}\n\nPlease check your wallet for the funds.`;
  return { subject: 'Withdrawal processed — check your wallet', html, text, cid: 'xapo-header' };
}

module.exports = { membershipNotification, depositNotification, loanNotification, welcomeNotification, withdrawalNotification };
