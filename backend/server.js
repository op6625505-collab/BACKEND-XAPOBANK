require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const net = require('net');
const { connectDB } = require('./db');
const config = require('./config/config');

function tryRequireRoute(path, name) {
  try {
    return require(path);
  } catch (e) {
    console.warn(`Optional route ${path} not found — skipping /api/${name}`, e.message);
    return null;
  }
}

let authRoutes = tryRequireRoute('./routes/auth', 'auth');
let transactionRoutes = tryRequireRoute('./routes/transactions', 'transactions');
let webhookRoutes = tryRequireRoute('./routes/webhooks', 'webhooks');
let testEmailRoutes = tryRequireRoute('./routes/testEmail', 'testEmail');
let chatRoutes = tryRequireRoute('./routes/chat', 'chat');

let stocksRoutes = tryRequireRoute('./routes/stocks', 'stocks');
let adminEmailsRoutes = tryRequireRoute('./routes/adminEmails', 'adminEmails');
let adminUsersRoutes = tryRequireRoute('./routes/adminUsers', 'adminUsers');
let adminTransactionsRoutes = tryRequireRoute('./routes/adminTransactions', 'adminTransactions');
let adminPromosRoutes = tryRequireRoute('./routes/adminPromos', 'adminPromos');
let supportRoutes = tryRequireRoute('./routes/support', 'support');
let identityRoutes = tryRequireRoute('./routes/identity', 'identity');
let devRoutes = tryRequireRoute('./routes/dev', 'dev');

const app = express();

// Configure CORS to expose custom headers so SW / clients can read
// diagnostic headers like X-Token-Present and X-Token-Length on cross-origin responses.
app.use(cors({ exposedHeaders: ['X-Token-Present', 'X-Token-Length', 'Content-Type'] }));
// Increase body size limits to allow image uploads as base64 in JSON payloads
// Allow larger request bodies for base64 uploads (increase if needed)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Development-friendly Content Security Policy to allow local sockets and API calls.
// This keeps the site reasonably locked down while letting the frontend talk to
// the local backend and socket endpoints during development.
app.use((req, res, next) => {
  // More permissive CSP for local development and DevTools (keeps site secure while
  // allowing devtools/dev servers, sockets and local API calls). Tighten for production.
  // Development CSP: allow connections to localhost and devtools targets.
  // NOTE: this is permissive for local development only. Tighten for production.
  const csp = "default-src 'self' http: https: data: blob:; " +
    // Allow connections to local backend, sockets, DevTools and Binance API for price updates
    "connect-src 'self' http://localhost:5000 http://127.0.0.1:5000 http://127.0.0.1 ws://localhost:5000 wss://localhost:5000 http://localhost https://localhost https://api.binance.com https://api.coingecko.com chrome-devtools://* devtools://*; " +
    "img-src 'self' data: file: blob: https:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://telegram.org http://localhost:5000; " +
    "script-src-elem 'self' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://telegram.org 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com;";
  res.setHeader('Content-Security-Policy', csp);
  next();
});

// Serve a small appspecific manifest to satisfy Chrome DevTools requests (dev only)
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  console.log('Serving /.well-known/appspecific/com.chrome.devtools.json');
  res.type('application/json');
  res.send(JSON.stringify({ name: 'xapobank-dev', url: config.CLIENT_URL || 'http://localhost:8000' }));
});

// Serve a small runtime config JS so static sites can read backend URL at runtime.
app.get('/config.js', (req, res) => {
  try {
    // Return the backend's origin so static frontends know where to reach the API.
    // Prefer an explicit env var `BACKEND_ORIGIN` (for proxies or custom domains),
    // otherwise derive from the incoming request host.
    const apiBase = (config.BACKEND_ORIGIN || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
    res.type('application/javascript');
    return res.send(`window.API_BASE = '${apiBase}';`);
  } catch (e) {
    res.type('application/javascript');
    return res.send(`window.API_BASE = '';`);
  }
});

// API routes — mount only routes that loaded successfully
if (authRoutes) app.use('/api/auth', authRoutes); else console.warn('Skipping mounting /api/auth — route failed to load');
if (transactionRoutes) app.use('/api/transactions', transactionRoutes); else console.warn('Skipping mounting /api/transactions — route failed to load');
if (testEmailRoutes) app.use('/api/test', testEmailRoutes); else console.warn('Skipping mounting /api/test — route failed to load');
if (chatRoutes) app.use('/api/chat', chatRoutes); else console.warn('Skipping mounting /api/chat — route failed to load');
if (stocksRoutes) app.use('/api/stocks', stocksRoutes);
// Dev helper routes (only use in local/dev environment)
if (devRoutes) app.use('/api/dev', devRoutes); else console.warn('Skipping mounting /api/dev — route failed to load');

// Lightweight health check for load balancers and Render
app.get('/api/health', (req, res) => {
  try {
    return res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// TCP connect test endpoint: /api/test/tcp-connect?host=smtp.postmarkapp.com&port=587&timeout=5000
app.get('/api/test/tcp-connect', (req, res) => {
  try {
    const host = String(req.query.host || 'smtp.postmarkapp.com');
    const port = Number(req.query.port || 587);
    const timeout = Number(req.query.timeout || 5000);
    const start = Date.now();
    const socket = new net.Socket();
    let finished = false;
    const cleanup = () => {
      try { socket.destroy(); } catch (e) {}
    };
    const done = (ok, info) => {
      if (finished) return;
      finished = true;
      cleanup();
      info = info || {};
      info.host = host;
      info.port = port;
      info.elapsed = Date.now() - start;
      return res.json({ ok: !!ok, info });
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => done(true, { message: 'connected' }));
    socket.on('timeout', () => done(false, { error: 'timeout' }));
    socket.on('error', (err) => done(false, { error: String(err && err.message ? err.message : err) }));
    socket.connect(port, host);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// Redirect root path to signin page
app.get('/', (req, res) => {
  res.redirect('/signin.html');
});

// Serve frontend static files (optional)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Also serve the sign-up / sign-in pages under /signsignup URI by mapping to the
// frontend folder (these files live in frontend). This allows
// requests to /signsignup/signin.html and /signsignup/signup.html to resolve.
app.use('/signsignup', express.static(path.join(__dirname, '..', 'frontend')));
// Also allow the explicit folder path to be reachable (so requests to
// /frontend/index.html work and receive the server CSP headers).
app.use('/frontend', express.static(path.join(__dirname, '..', 'frontend')));
// Serve the standalone admin site so it can be accessed over HTTP (avoids file:// CSP restrictions)
app.use('/admin', express.static(path.join(__dirname, '..', 'transaction-admin-site')));

// Redirect /admin to /admin/admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin/admin.html');
});

// Admin UI removed

// Serve the root normally; client-side will redirect unauthenticated users to signup.

const start = async () => {
  try {
    // Sanity checks for common misconfiguration when deploying to cloud hosts (Render)
    if (!config.MONGO_URI || String(config.MONGO_URI).trim() === '') {
      console.error('FATAL: MONGO_URI is not set. Please configure MONGO_URI as an environment variable on your host (Render).');
      console.error('Example: mongodb+srv://USER:PASS@cluster0.mongodb.net/xapobank?retryWrites=true&w=majority');
      process.exit(1);
    }

    // Warn if using localhost DB in non-local environment
    const isLocalDB = String(config.MONGO_URI).includes('127.0.0.1') || String(config.MONGO_URI).toLowerCase().includes('localhost');
    if (isLocalDB && process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() !== 'development') {
      console.error('FATAL: MONGO_URI points to a local MongoDB instance (127.0.0.1 or localhost).');
      console.error('On Render you must use a cloud-hosted MongoDB (Atlas) and set MONGO_URI accordingly.');
      process.exit(1);
    }

    if (!config.JWT_SECRET || String(config.JWT_SECRET).includes('change-me')) {
      console.warn('WARNING: JWT_SECRET is not configured or is using the default. It is recommended to set a strong JWT_SECRET in environment variables.');
    }

    await connectDB(config.MONGO_URI);
    // Ensure admin user exists when ADMIN_ID or ADMIN_EMAIL provided in env/config
    try {
      const User = require('./models/User');
      const { hashPassword } = require('./services/hashService');
      const adminId = config.ADMIN_ID;
      const adminEmail = config.ADMIN_EMAIL;
      if (adminId || adminEmail) {
        let existing = null;
        try {
          if (adminId) existing = await User.findById(adminId);
        } catch (e) { existing = null; }
        if (!existing && adminEmail) {
          existing = await User.findOne({ email: adminEmail });
        }
        if (!existing) {
          // create admin user with a random password
          const pwd = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2,6);
          const passwordHash = await hashPassword(pwd);
          const createData = { name: 'Admin', email: adminEmail || (`admin-${String(Date.now()).slice(-6)}@local`), passwordHash, role: 'admin' };
          if (adminId) createData._id = adminId;
          const created = await User.create(createData);
          console.log('Auto-created admin user at startup:');
          console.log('  id:   ', created._id.toString());
          console.log('  email:', created.email);
          console.log('  password (temporary):', pwd);
        } else {
          console.log('Admin user already exists:', existing._id ? String(existing._id) : existing.email);
        }
      }
    } catch (e) {
      console.warn('Admin auto-create check failed', e && e.message ? e.message : e);
    }
    const server = require('http').createServer(app);
    // initialize socket service
    const { init: initSockets } = require('./services/socketService');
    initSockets(server);
    // serve uploaded files
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    // identity routes (optional)
    if (identityRoutes) app.use('/api/identity', identityRoutes); else console.warn('Skipping mounting /api/identity — route failed to load');
    // support route (optional)
    if (supportRoutes) app.use('/api/support', supportRoutes); else console.warn('Skipping mounting /api/support — route failed to load');
    // admin debug routes (optional)
    if (adminEmailsRoutes) app.use('/api/admin', adminEmailsRoutes); else console.warn('Skipping mounting adminEmailsRoutes — route failed to load');
    if (adminUsersRoutes) app.use('/api/admin', adminUsersRoutes); else console.warn('Skipping mounting adminUsersRoutes — route failed to load');
    if (adminTransactionsRoutes) app.use('/api/admin', adminTransactionsRoutes); else console.warn('Skipping mounting adminTransactionsRoutes — route failed to load');
    if (adminPromosRoutes) app.use('/api/admin', adminPromosRoutes); else console.warn('Skipping mounting adminPromosRoutes — route failed to load');
    // mount webhook routes (optional)
    if (webhookRoutes) app.use('/api/webhooks', webhookRoutes); else console.warn('Skipping mounting /api/webhooks — route failed to load');
    server.listen(config.PORT, () => {
      console.log(`Server listening on port ${config.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
};

start();

module.exports = app;
