const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema(
  {
    // User who sent/received the message
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    
    // Message content
    message: { type: String, required: true },
    messageType: { type: String, enum: ['text', 'user_to_admin', 'admin_to_user', 'whatsapp'], default: 'user_to_admin' },
    
    // WhatsApp specific fields
    whatsappNumber: { type: String, required: false },
    whatsappMessageId: { type: String, required: false },
    
    // Direction
    isFromUser: { type: Boolean, default: true },
    
    // Status
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
    
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Index for quick lookups
ChatSchema.index({ userId: 1, createdAt: -1 });
ChatSchema.index({ userEmail: 1, createdAt: -1 });
ChatSchema.index({ whatsappNumber: 1, createdAt: -1 });

module.exports = mongoose.model('Chat', ChatSchema);
