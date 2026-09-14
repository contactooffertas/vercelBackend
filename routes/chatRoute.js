// routes/chatRoute.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');

const auth = require('../middleware/authMiddleware');
const {
  startConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  markDelivered,
  deleteConversation,
  deleteMessage,
  editMessage,
  clearConversation,
  toggleUserBlock,
  setTemporaryMode,
  unblockConversation,    // nuevo — solo admin
  createGroup,
  reactToMessage,
} = require('../authController/chatController');

const upload = multer({
  // Vercel solo garantiza almacenamiento efímero en /tmp. Mantener el archivo
  // en memoria permite enviarlo directamente a Cloudinary sin tocar disco.
  storage: multer.memoryStorage(),
  limits:     { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

router.post('/start',                           auth, startConversation);
router.post('/groups',                          auth, createGroup);
router.get('/conversations',                    auth, getConversations);
router.get('/conversations/:id/messages',       auth, getMessages);
router.post('/conversations/:id/read',          auth, markAsRead);
router.post('/messages/:id/delivered',           auth, markDelivered);
router.delete('/conversations/:id',             auth, deleteConversation);
router.delete('/conversations/:id/messages',    auth, clearConversation);
router.patch('/conversations/:id/block',        auth, toggleUserBlock);
router.patch('/conversations/:id/temporary',    auth, setTemporaryMode);
router.patch('/conversations/:id/unblock',      auth, unblockConversation);  // admin only
router.post('/messages', auth, upload.single('image'), sendMessage);
router.patch('/messages/:id',                   auth, editMessage);
router.delete('/messages/:id',                  auth, deleteMessage);
router.post('/messages/:id/reactions',          auth, reactToMessage);

module.exports = router;
