const twilio = require('twilio');

// Initialize Twilio client
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    console.warn('Twilio credentials not configured');
    return null;
  }
  
  return twilio(accountSid, authToken);
}

// Send WhatsApp message
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    const client = getTwilioClient();
    if (!client) {
      return { ok: false, error: 'Twilio not configured' };
    }

    const fromNumber = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
    const toNumber = `whatsapp:${phoneNumber}`;

    const result = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body: message
    });

    console.log('WhatsApp sent:', result.sid);
    return { ok: true, messageId: result.sid };
  } catch (err) {
    console.error('sendWhatsAppMessage error:', err && err.message);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Handle incoming WhatsApp webhook
async function handleWhatsAppWebhook(req) {
  try {
    const Chat = require('../models/Chat');
    const { From, Body, MessageSid } = req.body;

    // Extract phone number from format 'whatsapp:+1234567890'
    const phoneNumber = From.replace('whatsapp:', '');
    
    if (!Body || !phoneNumber) {
      return { ok: false, error: 'Missing message or phone number' };
    }

    // Save incoming message
    const chat = await Chat.create({
      userEmail: phoneNumber,
      userName: `WhatsApp User`,
      whatsappNumber: phoneNumber,
      message: Body,
      messageType: 'whatsapp',
      whatsappMessageId: MessageSid,
      isFromUser: true,
      status: 'delivered'
    });

    console.log('WhatsApp message received:', chat._id);

    // Emit socket event to notify admins
    try {
      const { emitToAdmins } = require('./socketService');
      if (typeof emitToAdmins === 'function') {
        emitToAdmins('whatsapp:message', {
          id: chat._id,
          from: phoneNumber,
          message: Body,
          timestamp: chat.createdAt
        });
      }
    } catch (e) {
      console.warn('Socket emit failed:', e && e.message);
    }

    return { ok: true, messageId: chat._id };
  } catch (err) {
    console.error('handleWhatsAppWebhook error:', err && err.message);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Send WhatsApp message to user from admin
async function sendWhatsAppReply(phoneNumber, message) {
  return sendWhatsAppMessage(phoneNumber, message);
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppReply,
  handleWhatsAppWebhook,
  getTwilioClient
};
