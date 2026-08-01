// routes/affiliateRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const affiliateController = require('../authController/affiliateController');

router.get('/status', authMiddleware, affiliateController.getStatus);
router.post('/terms/accept', authMiddleware, affiliateController.acceptTerms);
router.post('/apply/seller', authMiddleware, affiliateController.submitSellerApplication);
router.post('/apply/buyer', authMiddleware, affiliateController.submitBuyerApplication);

module.exports = router;
