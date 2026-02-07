const express = require('express');
const router = express.Router();
const { sendSupport } = require('../controllers/supportController');
const authMiddleware = require('../middleware/authMiddleware');

// Allow anonymous messages but also accept authenticated users
router.post('/', authMiddleware, sendSupport);

module.exports = router;
