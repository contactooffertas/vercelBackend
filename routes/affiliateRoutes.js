// routes/affiliateRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getStatus,
  acceptTerms,
  submitSellerApplication,
  submitBuyerApplication,
} = require('../authController/affiliateController');

router.get('/status', authMiddleware, getStatus);
router.post('/terms/accept', authMiddleware, acceptTerms);
router.post('/apply/seller', authMiddleware, submitSellerApplication);
router.post('/apply/buyer', authMiddleware, submitBuyerApplication);

module.exports = router;
