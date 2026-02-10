const express = require('express');
const router = express.Router();
const { sendSupport } = require('../controllers/supportController');
// Use optionalAuth so anonymous users can submit support messages
const optionalAuth = require('../middleware/optionalAuth');

// Allow anonymous messages but also accept authenticated users
router.post('/', optionalAuth, sendSupport);

module.exports = router;
