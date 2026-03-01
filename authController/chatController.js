// authController/chatController.js

const path       = require('path');
const fs         = require('fs');
const { Conversation, Message } = require('../models/chatModel');
const cloudinary = require('../config/cloudinary');

// ─── Helpers privados ─────────────────────────────────────────────────────────

async function _unreadCount(convId, userId) {
  return Message.countDocuments({
    conversation: convId,
    readBy:       { $nin: [userId] },
    sender:       { $ne:  userId  },
    deletedBy:    { $nin: [userId] },
  });
}

async function _formatConv(conv, userId) {
  const other = conv.participants.find(
    p => p._id.toString() !== userId.toString()
  );
  const last = conv.lastMessage;
  const uc   = await _unreadCount(conv._id, userId);

  return {
    _id:          conv._id,
    participants: conv.participants,
    other,
    lastMessage: last
      ? { text: last.text, image: last.image, createdAt: last.createdAt }
      : null,
    updatedAt:    conv.updatedAt,
    unreadCount:  uc,
    isBlocked:     conv.isBlocked     || false,
    blockedBy:     conv.blockedBy?.toString() || null,
    blockedAt:     conv.blockedAt     || null,
    blockReportId: conv.blockReportId?.toString() || null,
  };
}

// ─── POST /api/chat/start ─────────────────────────────────────────────────────
exports.startConversation = async (req, res) => {
  try {
    const mongoose = require('mongoose');

    const me = req.user?._id || req.user?.id;
    if (!me) return res.status(401).json({ error: 'Usuario no autenticado correctamente' });

    let other = req.body.participantId;
    if (other && typeof other === 'object') other = other._id;
    if (other) other = other.toString().trim();

    if (!other)
      return res.status(400).json({ error: 'participantId requerido' });
    if (!mongoose.Types.ObjectId.isValid(other))
      return res.status(400).json({ error: 'participantId inválido' });
    if (me.toString() === other)
      return res.status(400).json({ error: 'No podés chatear contigo mismo' });

    let conv = await Conversation.findOne({
      participants: { $all: [me, other], $size: 2 },
      deletedBy:    { $nin: [me] },
    })
      .populate('participants', 'name avatar logo')
      .populate({ path: 'lastMessage', select: 'text image createdAt' });

    if (!conv) {
      const created = await Conversation.create({ participants: [me, other] });
      conv = await Conversation.findById(created._id)
        .populate('participants', 'name avatar logo')
        .populate({ path: 'lastMessage', select: 'text image createdAt' });
    } else {
      await Conversation.updateOne({ _id: conv._id }, { $pull: { deletedBy: me } });
    }

    res.json(await _formatConv(conv, me));
  } catch (err) {
    console.error('[chat] startConversation ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Error al iniciar conversación' });
  }
};

// ─── GET /api/chat/conversations ──────────────────────────────────────────────
exports.getConversations = async (req, res) => {
  try {
    const me = req.user?._id || req.user?.id;

    const convs = await Conversation.find({
      participants: me,
      deletedBy:    { $nin: [me] },
    })
      .populate('participants', 'name avatar logo')
      .populate({ path: 'lastMessage', select: 'text image createdAt' })
      .sort({ updatedAt: -1 });

    const result = await Promise.all(convs.map(c => _formatConv(c, me)));
    res.json(result);
  } catch (err) {
    console.error('[chat] getConversations:', err);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
};

// ─── GET /api/chat/conversations/:id/messages ─────────────────────────────────
exports.getMessages = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const me     = req.user?._id || req.user?.id;
    const convId = req.params.id;
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip   = parseInt(req.query.skip) || 0;

    if (!me) return res.status(401).json({ error: 'No autenticado' });
    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ error: 'ID de conversación inválido' });

    const conv = await Conversation.findOne({ _id: convId, participants: me });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const msgs = await Message.find({
      conversation: convId,
      deletedBy:    { $nin: [me] },
    })
      .populate('sender', 'name avatar logo')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit);

    res.json({
      messages:      msgs,
      isBlocked:     conv.isBlocked     || false,
      blockedBy:     conv.blockedBy?.toString() || null,
      blockedAt:     conv.blockedAt     || null,
      blockReportId: conv.blockReportId?.toString() || null,
    });
  } catch (err) {
    console.error('[chat] getMessages ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Error al obtener mensajes' });
  }
};

// ─── POST /api/chat/messages ──────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    const me     = req.user?._id || req.user?.id;
    const { conversationId, text } = req.body;

    if (!conversationId) return res.status(400).json({ error: 'conversationId requerido' });
    if (!text?.trim() && !req.file) return res.status(400).json({ error: 'Enviá texto o imagen' });

    const conv = await Conversation.findOne({ _id: conversationId, participants: me });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    if (conv.isBlocked) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({
        error:      'Esta conversación está bloqueada por un reporte',
        isBlocked:  true,
        blockedBy:  conv.blockedBy?.toString() || null,
        iAmBlocker: me.toString() === conv.blockedBy?.toString(),
      });
    }

    // ── Subir imagen a Cloudinary ─────────────────────────────────────────
    let imageUrl = null;
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder:        'chat',
          resource_type: 'image',
        });
        imageUrl = result.secure_url;
      } catch (uploadErr) {
        console.error('[chat] Cloudinary error:', uploadErr.message);
        return res.status(500).json({ error: 'Error al subir la imagen' });
      } finally {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
    }

    const msg = await Message.create({
      conversation: conversationId,
      sender:       me,
      text:         text?.trim() || '',
      image:        imageUrl,
      readBy:       [me],
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: msg._id,
      updatedAt:   msg.createdAt,
      $pull: { deletedBy: { $in: conv.participants } },
    });

    const populated = await Message.findById(msg._id)
      .populate('sender', 'name avatar logo');

    // ── FIX CRÍTICO: emitir a sala personal de cada participante ──────────
    // pid es un ObjectId de Mongoose → hay que convertir a string con .toString()
    // sin esto, `user_${pid}` genera "user_[object Object]" y nadie recibe nada
    const io = req.app.get('io');
    if (io) {
      conv.participants.forEach(pid => {
        const pidStr = pid.toString();  // ← THE FIX
        console.log(`[chat] → new_message a user_${pidStr}`);
        io.to(`user_${pidStr}`).emit('new_message', populated);
      });
    } else {
      console.error('[chat] ⚠️ io no disponible — Socket.IO no inicializado correctamente');
    }

    res.status(201).json(populated);
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[chat] sendMessage:', err);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
};

// ─── POST /api/chat/conversations/:id/read ───────────────────────────────────
exports.markAsRead = async (req, res) => {
  try {
    const me     = req.user?._id || req.user?.id;
    const convId = req.params.id;

    const conv = await Conversation.findOne({ _id: convId, participants: me });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    await Message.updateMany(
      { conversation: convId, readBy: { $nin: [me] } },
      { $addToSet: { readBy: me } }
    );

    const io = req.app.get('io');
    if (io) {
      conv.participants.forEach(pid => {
        io.to(`user_${pid.toString()}`).emit('messages_read', { conversationId: convId });
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[chat] markAsRead:', err);
    res.status(500).json({ error: 'Error al marcar como leído' });
  }
};

// ─── DELETE /api/chat/conversations/:id ──────────────────────────────────────
exports.deleteConversation = async (req, res) => {
  try {
    const me     = req.user?._id || req.user?.id;
    const convId = req.params.id;

    const conv = await Conversation.findOne({ _id: convId, participants: me });
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    await Conversation.updateOne({ _id: convId }, { $addToSet: { deletedBy: me } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat] deleteConversation:', err);
    res.status(500).json({ error: 'Error al borrar conversación' });
  }
};

// ─── DELETE /api/chat/messages/:id ───────────────────────────────────────────
exports.deleteMessage = async (req, res) => {
  try {
    const me  = req.user?._id || req.user?.id;
    const msg = await Message.findOne({ _id: req.params.id, sender: me });
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });

    await Message.updateOne({ _id: msg._id }, { $addToSet: { deletedBy: me } });

    const io = req.app.get('io');
    if (io) {
      const conv = await Conversation.findById(msg.conversation);
      conv?.participants.forEach(pid => {
        io.to(`user_${pid.toString()}`).emit('message_deleted', {
          messageId:      msg._id,
          conversationId: msg.conversation,
        });
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[chat] deleteMessage:', err);
    res.status(500).json({ error: 'Error al borrar mensaje' });
  }
};

// ─── PATCH /api/chat/conversations/:id/unblock  (solo admin) ─────────────────
exports.unblockConversation = async (req, res) => {
  try {
    const User  = require('../models/userModel');
    const admin = await User.findById(req.user?._id || req.user?.id);
    if (admin?.role !== 'admin')
      return res.status(403).json({ error: 'Solo admins pueden desbloquear conversaciones' });

    const conv = await Conversation.findByIdAndUpdate(
      req.params.id,
      { $set: { isBlocked: false, blockedBy: null, blockedAt: null, blockReportId: null } },
      { new: true }
    );
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const io = req.app.get('io');
    if (io) {
      conv.participants.forEach(pid => {
        io.to(`user_${pid.toString()}`).emit('conversation_unblocked', {
          conversationId: conv._id.toString(),
          reason:         'El administrador desbloqueó esta conversación.',
        });
      });
    }

    res.json({ ok: true, conversationId: conv._id });
  } catch (err) {
    console.error('[chat] unblockConversation:', err);
    res.status(500).json({ error: 'Error al desbloquear conversación' });
  }
};