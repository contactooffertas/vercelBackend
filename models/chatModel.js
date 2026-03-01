// models/Chat.js
const mongoose = require('mongoose');

// ════════════════════════════════════════════════
//  CONVERSATION
// ════════════════════════════════════════════════
const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type:     mongoose.Schema.Types.ObjectId,
        ref:      'User',
        required: true,
      },
    ],

    lastMessage: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Message',
      default: null,
    },

    deletedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // ── Bloqueo por reporte ───────────────────────────────────────────────
    // Cuando un user reporta al otro, la conv queda congelada para ambos.
    isBlocked:     { type: Boolean,                             default: false },
    blockedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',   default: null },
    blockedAt:     { type: Date,                                default: null  },
    // ID del Report que originó el bloqueo (para desbloquear al desestimar)
    blockReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ isBlocked: 1 });

// ════════════════════════════════════════════════
//  MESSAGE
// ════════════════════════════════════════════════
const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Conversation',
      required: true,
    },
    sender: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    text:  { type: String, default: ''   },
    image: { type: String, default: null },
    readBy: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
    deletedBy: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ],
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: 1 });

// ════════════════════════════════════════════════
//  EXPORTS
// ════════════════════════════════════════════════
const Conversation = mongoose.models.Conversation
  || mongoose.model('Conversation', conversationSchema);

const Message = mongoose.models.Message
  || mongoose.model('Message', messageSchema);

module.exports = { Conversation, Message };