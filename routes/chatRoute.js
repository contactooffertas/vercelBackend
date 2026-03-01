// routes/chatRoute.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const auth = require('../middleware/authMiddleware');
const {
  startConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  deleteConversation,
  deleteMessage,
  unblockConversation,    // nuevo — solo admin
} = require('../authController/chatController');

const uploadDir = path.join(__dirname, '../uploads/chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename:    (_, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits:     { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

router.post('/start',                           auth, startConversation);
router.get('/conversations',                    auth, getConversations);
router.get('/conversations/:id/messages',       auth, getMessages);
router.post('/conversations/:id/read',          auth, markAsRead);
router.delete('/conversations/:id',             auth, deleteConversation);
router.patch('/conversations/:id/unblock',      auth, unblockConversation);  // admin only
router.post('/messages', auth, upload.single('image'), sendMessage);
router.delete('/messages/:id',                  auth, deleteMessage);

module.exports = router;