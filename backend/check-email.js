require('dotenv').config();
const emailService = require('./services/emailService');

(async function(){
  try {
    console.log('Running transporter verify()...');
    const r = await emailService.verifyTransporter();
    console.log('Result:', JSON.stringify(r, null, 2));
    process.exit(r && r.ok ? 0 : 2);
  } catch (e) {
    console.error('verifyTransporter threw:', e && e.stack ? e.stack : e);
    process.exit(3);
  }
})();
