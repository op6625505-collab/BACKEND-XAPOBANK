const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/xapobank',
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  // Default frontend (static) URL for production static site deploys.
  // Can be overridden via the CLIENT_URL env var in Render.
  CLIENT_URL: process.env.CLIENT_URL || 'https://xapoloan.onrender.com',
  // Backend origin used by runtime /config.js when the backend serves the value.
  // Can be overridden via the BACKEND_ORIGIN env var in Render.
  BACKEND_ORIGIN: process.env.BACKEND_ORIGIN || 'https://xapoloan.onrender.com',
  // Default support email used for incoming support messages
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'xapoloans@gmail.com',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || null,
  ADMIN_ID: process.env.ADMIN_ID || null
};
