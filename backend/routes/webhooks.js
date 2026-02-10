const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Example generic webhook endpoint for crypto provider callbacks
router.post('/crypto', express.json(), webhookController.handleCryptoWebhook);

module.exports = router;
