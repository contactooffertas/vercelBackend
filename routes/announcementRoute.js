// routes/announcementRoute.js
const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/authMiddleware');
const { getActiveAnnouncements } = require('../authController/announcementController');

router.get('/active', auth, getActiveAnnouncements);

module.exports = router;