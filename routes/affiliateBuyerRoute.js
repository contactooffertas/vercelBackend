// routes/affiliateBuyerRoute.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getAvailableOffers,
  applyToOffer,
  listMyApplications,
} = require('../authController/affiliateBuyerController');

router.get('/offers', authMiddleware, getAvailableOffers);
router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
router.get('/mis-ofertas', authMiddleware, listMyApplications);

module.exports = router;

// En index.js agregar:
// app.use('/api/affiliates/buyer', require('./routes/affiliateBuyerRoute'));
