const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Sanitize stack traces to remove absolute host-specific paths (e.g. /opt/render/project/src/)
function sanitizeStack(stack) {
  if (!stack || typeof stack !== 'string') return stack;
  try {
    const cwd = process.cwd();
    // Escape for use in RegExp
    const esc = cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove the current working directory prefix and normalize repeated slashes
    let s = stack.replace(new RegExp(esc, 'g'), '');
    // Also strip common CI/host prefixes that may appear
    s = s.replace(/\/opt\/render\/project\/src\//g, '');
    s = s.replace(/\\\\/g, '/');
    return s;
  } catch (e) {
    return stack;
  }
}

// Reads SMTP configuration from env. Set the following in backend/.env:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS, NOTIFY_FROM

function createTransporter() {
  let hostRaw = process.env.SMTP_HOST || '';
  if (!hostRaw) return null;
  // sanitize host: if user accidentally pasted a URL (e.g. http://localhost:8000)
  // extract only the hostname portion so nodemailer does DNS lookups correctly.
  try {
    if (/^https?:\/\//i.test(hostRaw)) {
      const u = new URL(hostRaw);
      hostRaw = u.hostname;
    } else {
      hostRaw = hostRaw.split('/')[0];
    }
  } catch (e) {
    // fallback: keep original hostRaw
  }
  const host = hostRaw;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  const auth = process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined;
  try {
    const emailDebug = String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true';
    // Allow tuning timeouts via env or sensible defaults (ms)
    const connectionTimeout = Number(process.env.SMTP_CONN_TIMEOUT || process.env.SMTP_CONNECTION_TIMEOUT || 10000);
    const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT || 10000);
    const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT || 30000);
    const transportOpts = {
      host,
      port,
      secure,
      auth,
      logger: emailDebug,
      debug: emailDebug,
      connectionTimeout,
      greetingTimeout,
      socketTimeout
    };
    // avoid logging secrets
    const logSafe = { host, port, secure, user: auth && auth.user ? auth.user : undefined, debug: emailDebug, connectionTimeout };
    console.debug('Creating email transporter', logSafe);
    const transporter = nodemailer.createTransport(transportOpts);
    // Helpful quick verification during startup/send.
    transporter.verify().then(() => {
      console.debug('Email transporter verified OK', logSafe);
    }).catch(err => {
      console.warn('Email transporter verify failed', err && err.message ? err.message : String(err));
      if (emailDebug && err && err.stack) console.warn(sanitizeStack(err.stack));
    });
    return transporter;
  } catch (err) {
    console.error('createTransporter error', err);
    return null;
  }
}

async function sendEmail(to, subject, html, text, attachments) {
  try {
    const emailDebug = String(process.env.EMAIL_DEBUG || '').toLowerCase() === 'true';
    // Development fallback: if EMAIL_FAKE=true or EMAIL_BACKEND=file, write email to disk
    const useFileBackend = (String(process.env.EMAIL_FAKE || '').toLowerCase() === 'true')
      || (String(process.env.EMAIL_BACKEND || '').toLowerCase() === 'file');
    if (useFileBackend) {
      try {
        const outDir = path.join(__dirname, '..', 'tmp_emails');
        fs.mkdirSync(outDir, { recursive: true });
        const fileName = `${Date.now()}-${(Math.random()*1e9|0)}.json`;
        const filePath = path.join(outDir, fileName);
        const payload = { to, subject, text: text || null, html: html || null, attachments: attachments || null, createdAt: new Date().toISOString() };
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
        console.info('Email written to file (EMAIL_FAKE active):', filePath);
        return { ok: true, info: { file: filePath } };
      } catch (fileErr) {
        console.error('EMAIL_FAKE file write failed', fileErr);
        return { ok: false, error: String(fileErr) };
      }
    }
    const transporter = createTransporter();
    if (!transporter) {
      // If SMTP isn't configured, fall back to writing the email to disk so developers
      // and deploy logs can still inspect outgoing messages. This makes notifications
      // visible during testing even when SMTP env vars are missing.
      try {
        const outDir = path.join(__dirname, '..', 'tmp_emails');
        fs.mkdirSync(outDir, { recursive: true });
        const fileName = `${Date.now()}-${(Math.random()*1e9|0)}.json`;
        const filePath = path.join(outDir, fileName);
        const payload = { to, subject, text: text || null, html: html || null, attachments: attachments || null, createdAt: new Date().toISOString(), fallback: true };
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
        console.warn('SMTP not configured; email written to file fallback:', filePath);
        return { ok: true, info: { file: filePath, fallback: true } };
      } catch (fileErr) {
        console.error('Email fallback file write failed', fileErr && fileErr.message ? fileErr.message : fileErr);
        return { ok: false, error: String(fileErr) };
      }
    }
    const from = process.env.NOTIFY_FROM || process.env.SMTP_USER || 'no-reply@example.com';
    const mailOpts = { from, to, subject, text: text || undefined, html: html || undefined };
    if (attachments && Array.isArray(attachments) && attachments.length > 0) mailOpts.attachments = attachments;
    try {
      const info = await transporter.sendMail(mailOpts);
      return { ok: true, info: { messageId: info && info.messageId, response: info && info.response } };
    } catch (sendErr) {
      const sendMsg = sendErr && sendErr.message ? sendErr.message : String(sendErr);
      const errCode = sendErr && sendErr.code ? String(sendErr.code) : '';
      console.error('sendEmail sendMail error', sendMsg, errCode ? ('code=' + errCode) : '');
      if (emailDebug && sendErr && sendErr.stack) console.error(sanitizeStack(sendErr.stack));

      // Determine if this looks like a network/connectivity error (timeout, DNS, refused, reset)
      const networkErrorCodes = new Set(['ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENOTFOUND','EHOSTUNREACH','EAI_AGAIN']);
      const isNetwork = networkErrorCodes.has(errCode) || /timeout|timed out|connection timeout|connection refused|ENOTFOUND|EAI_AGAIN/i.test(sendMsg);

      // If SMTP send fails due to network/connectivity and SendGrid API key is available,
      // attempt to send via SendGrid HTTP API as a fallback. Also allow fallback if explicitly configured.
            // Try Postmark HTTP fallback first when configured, then SendGrid.
            const pmKey = process.env.POSTMARK_API_TOKEN || '';
            const forcePmFallback = String(process.env.EMAIL_FALLBACK_TO_POSTMARK || '').toLowerCase() === 'true';
            if (pmKey && (isNetwork || forcePmFallback)) {
              try {
                console.info('Attempting Postmark HTTP fallback due to SMTP failure', { isNetwork, errCode });
                const pmRes = await sendViaPostmark({ to, from: mailOpts.from, subject, text, html, attachments }, pmKey);
                if (pmRes && pmRes.ok) {
                  return { ok: true, info: { provider: 'postmark', response: pmRes.response } };
                }
                console.warn('Postmark fallback failed', pmRes && pmRes.error ? pmRes.error : pmRes);
              } catch (pmErr) {
                console.warn('Postmark fallback exception', pmErr && pmErr.message ? pmErr.message : pmErr);
              }
            }

            const sgKey = process.env.SENDGRID_API_KEY || '';
            const forceSgFallback = String(process.env.EMAIL_FALLBACK_TO_SENDGRID || '').toLowerCase() === 'true';
            if (sgKey && (isNetwork || forceSgFallback)) {
              try {
                console.info('Attempting SendGrid HTTP fallback due to SMTP failure', { isNetwork, errCode });
                const sgRes = await sendViaSendGrid({ to, from: mailOpts.from, subject, text, html, attachments }, sgKey);
                if (sgRes && sgRes.ok) {
                  return { ok: true, info: { provider: 'sendgrid', response: sgRes.response } };
                }
                console.warn('SendGrid fallback failed', sgRes && sgRes.error ? sgRes.error : sgRes);
              } catch (sgErr) {
                console.warn('SendGrid fallback exception', sgErr && sgErr.message ? sgErr.message : sgErr);
              }
            }

      // Prepare an error object to surface useful diagnostics to callers/tests.
      const resultErr = { error: sendMsg };
      if (errCode) resultErr.code = errCode;
      if (emailDebug) resultErr.stack = sendErr && sendErr.stack ? sanitizeStack(sendErr.stack) : undefined;
      return Object.assign({ ok: false }, resultErr);
    }
  } catch (err) {
    console.error('sendEmail error', err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { sendEmail };

// Expose a helper to verify transporter connectivity for diagnostics
module.exports.verifyTransporter = async function verifyTransporter() {
  try {
    const transporter = createTransporter();
    if (!transporter) return { ok: false, error: 'no-transporter-configured' };
    try {
      await transporter.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
};

// Send via SendGrid HTTP API as a fallback when SMTP is unavailable
async function sendViaSendGrid(opts, apiKey) {
  try {
    if (!apiKey) return { ok: false, error: 'no-sendgrid-key' };
    const from = (opts && opts.from) ? opts.from : (process.env.NOTIFY_FROM || process.env.SMTP_USER || 'no-reply@example.com');
    const toList = [];
    if (Array.isArray(opts.to)) {
      for (const t of opts.to) if (t) toList.push(String(t));
    } else if (typeof opts.to === 'string') {
      opts.to.split(',').forEach(s => { const v = s.trim(); if (v) toList.push(v); });
    }
    if (toList.length === 0) return { ok: false, error: 'no-recipient' };

    const payload = {
      personalizations: [
        { to: toList.map(email => ({ email })) , subject: opts.subject || '' }
      ],
      from: { email: (from && from.indexOf('<') === -1) ? from : String(from).replace(/^.*<|>$/g, '') },
      content: []
    };
    if (opts.text) payload.content.push({ type: 'text/plain', value: String(opts.text) });
    if (opts.html) payload.content.push({ type: 'text/html', value: String(opts.html) });

    const body = JSON.stringify(payload);

    const reqOpts = {
      method: 'POST',
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    return await new Promise((resolve) => {
      const req = https.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, response: { statusCode: res.statusCode, body: txt } });
          } else {
            resolve({ ok: false, error: `status ${res.statusCode}`, response: { statusCode: res.statusCode, body: txt } });
          }
        });
      });
      req.on('error', (e) => {
        resolve({ ok: false, error: e && e.message ? e.message : String(e) });
      });
      req.write(body);
      req.end();
    });
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Export helper for direct SendGrid testing
module.exports.sendViaSendGrid = sendViaSendGrid;

// Send via Postmark HTTP API as a fallback when SMTP is unavailable
async function sendViaPostmark(opts, apiKey) {
  try {
    if (!apiKey) return { ok: false, error: 'no-postmark-key' };
    const from = (opts && opts.from) ? opts.from : (process.env.NOTIFY_FROM || process.env.SMTP_USER || 'no-reply@example.com');
    const toList = [];
    if (Array.isArray(opts.to)) {
      for (const t of opts.to) if (t) toList.push(String(t));
    } else if (typeof opts.to === 'string') {
      opts.to.split(',').forEach(s => { const v = s.trim(); if (v) toList.push(v); });
    }
    if (toList.length === 0) return { ok: false, error: 'no-recipient' };

    const payload = {
      From: (from && from.indexOf('<') === -1) ? from : String(from).replace(/^.*<|>$/g, ''),
      To: toList.join(','),
      Subject: opts.subject || '',
    };
    if (opts.text) payload.TextBody = String(opts.text);
    if (opts.html) payload.HtmlBody = String(opts.html);

    const body = JSON.stringify(payload);
    const reqOpts = {
      method: 'POST',
      hostname: 'api.postmarkapp.com',
      path: '/email',
      headers: {
        'X-Postmark-Server-Token': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    return await new Promise((resolve) => {
      const req = https.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, response: { statusCode: res.statusCode, body: txt } });
          } else {
            resolve({ ok: false, error: `status ${res.statusCode}`, response: { statusCode: res.statusCode, body: txt } });
          }
        });
      });
      req.on('error', (e) => {
        resolve({ ok: false, error: e && e.message ? e.message : String(e) });
      });
      req.write(body);
      req.end();
    });
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports.sendViaPostmark = sendViaPostmark;
