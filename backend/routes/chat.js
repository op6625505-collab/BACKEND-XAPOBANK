const express = require('express');
const router = express.Router();
const { getChatHistory, sendChatMessage, adminReply, whatsappWebhook, getAdminChatInbox } = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuth');

// Get chat history (authenticated users only)
router.get('/history', authMiddleware, getChatHistory);

// Send chat message (authenticated or anonymous)
router.post('/send', optionalAuth, sendChatMessage);

// Admin reply (admin only)
router.post('/admin-reply', authMiddleware, adminReply);

// WhatsApp webhook (public, Twilio will POST here)
router.post('/whatsapp-webhook', whatsappWebhook);

// Get admin inbox (admin only)
router.get('/admin/inbox', authMiddleware, getAdminChatInbox);

module.exports = router;
