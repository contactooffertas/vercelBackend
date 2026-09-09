// routes/affiliateBuyerRoute.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getAvailableStores,
  getStoreProducts,
  applyToOffer,
  listMyApplications,
  getEarningsSummary,
  rejectPayment,
  getProfile,
  updateProfile,
  listMySales,
} = require('../authController/affiliateBuyerController');
const {
  buyerBadge,
  markSectionAfterSuccess,
} = require('../utils/affiliateNotificationService');

router.get('/stores', authMiddleware, markSectionAfterSuccess('stores'), getAvailableStores);
router.get('/stores/:sellerId/products', authMiddleware, getStoreProducts);
router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
router.get('/mis-ofertas', authMiddleware, markSectionAfterSuccess('applications'), listMyApplications);
router.get('/resumen', authMiddleware, markSectionAfterSuccess('sales'), markSectionAfterSuccess('payments'), getEarningsSummary);
router.patch('/sales/:saleId/reject-payment', authMiddleware, rejectPayment);
router.get('/mis-ventas', authMiddleware, markSectionAfterSuccess('sales'), markSectionAfterSuccess('payments'), listMySales);
router.get('/perfil', authMiddleware, getProfile);
router.patch('/perfil', authMiddleware, updateProfile);
router.get('/notifications-badge', authMiddleware, buyerBadge);
module.exports = router;
