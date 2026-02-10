const Chat = require('../models/Chat');
const { sendWhatsAppMessage, handleWhatsAppWebhook } = require('../services/whatsappService');

// Get chat history for authenticated user or by phone number
exports.getChatHistory = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { limit = 50, skip = 0 } = req.query;
    const filter = { userEmail: req.user.email };

    const messages = await Chat.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await Chat.countDocuments(filter);

    return res.json({ success: true, data: messages, total });
  } catch (err) {
    console.error('getChatHistory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Send a chat message (from user to admin)
exports.sendChatMessage = async (req, res) => {
  try {
    const { message, phoneNumber } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message required' });
    }

    const userEmail = (req.user && req.user.email) || req.body.email || 'unknown@local';
    const userName = (req.user && req.user.name) || req.body.name || 'Anonymous User';

    // Save message to database
    const chat = await Chat.create({
      userId: req.user ? req.user.id : null,
      userEmail,
      userName,
      message,
      messageType: 'user_to_admin',
      whatsappNumber: phoneNumber || null,
      isFromUser: true,
      status: 'sent'
    });

    // If WhatsApp number provided, send via WhatsApp too
    if (phoneNumber) {
      try {
        const wpResult = await sendWhatsAppMessage(phoneNumber, message);
        if (wpResult.ok) {
          chat.whatsappMessageId = wpResult.messageId;
          chat.messageType = 'whatsapp';
          await chat.save();
          console.log('Message also sent via WhatsApp');
        }
      } catch (e) {
        console.warn('WhatsApp send failed, but chat message saved:', e && e.message);
      }
    }

    // Notify admins via socket
    try {
      const { emitToAdmins } = require('../services/socketService');
      if (typeof emitToAdmins === 'function') {
        emitToAdmins('chat:message', chat);
      }
    } catch (e) {
      console.warn('Socket emit failed:', e && e.message);
    }

    return res.json({ success: true, data: chat });
  } catch (err) {
    console.error('sendChatMessage error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Admin sends reply to user
exports.adminReply = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { toEmail, message, whatsappNumber } = req.body;
    
    if (!toEmail || !message) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    // Save admin reply
    const chat = await Chat.create({
      userEmail: toEmail,
      userName: `Admin Reply`,
      message,
      messageType: 'admin_to_user',
      whatsappNumber: whatsappNumber || null,
      isFromUser: false,
      status: 'sent'
    });

    // Send via WhatsApp if number provided
    if (whatsappNumber) {
      try {
        const wpResult = await sendWhatsAppMessage(whatsappNumber, message);
        if (wpResult.ok) {
          chat.whatsappMessageId = wpResult.messageId;
          chat.messageType = 'whatsapp';
          await chat.save();
        }
      } catch (e) {
        console.warn('WhatsApp reply failed:', e && e.message);
      }
    }

    // Notify user via socket
    try {
      const { emitToUser } = require('../services/socketService');
      const User = require('../models/User');
      const user = await User.findOne({ email: toEmail });
      if (user && typeof emitToUser === 'function') {
        emitToUser(user._id, 'chat:message', {
          message,
          from: 'admin',
          timestamp: chat.createdAt
        });
      }
    } catch (e) {
      console.warn('Socket emit to user failed:', e && e.message);
    }

    return res.json({ success: true, data: chat });
  } catch (err) {
    console.error('adminReply error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Webhook for incoming WhatsApp messages
exports.whatsappWebhook = async (req, res) => {
  try {
    const result = await handleWhatsAppWebhook(req);
    
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.error });
    }

    // Twilio expects a 200 response quickly
    return res.json({ success: true, messageSid: result.messageId });
  } catch (err) {
    console.error('whatsappWebhook error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get admin chat inbox (all conversations)
exports.getAdminChatInbox = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    // Get latest message from each unique user
    const pipeline = [
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: '$userEmail',
          lastMessage: { $first: '$$ROOT' }
        }
      },
      {
        $sort: { 'lastMessage.createdAt': -1 }
      },
      {
        $limit: 100
      }
    ];

    const conversations = await Chat.aggregate(pipeline);
    
    return res.json({ success: true, data: conversations });
  } catch (err) {
    console.error('getAdminChatInbox error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
