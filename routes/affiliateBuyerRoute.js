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
  getNotificationBadge,
} = require('../authController/affiliateBuyerController');
router.get('/stores', authMiddleware, getAvailableStores);
router.get('/stores/:sellerId/products', authMiddleware, getStoreProducts);
router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
router.get('/mis-ofertas', authMiddleware, listMyApplications);
router.get('/resumen', authMiddleware, getEarningsSummary);
router.patch('/sales/:saleId/reject-payment', authMiddleware, rejectPayment);
router.get('/mis-ventas', authMiddleware, listMySales);
router.get('/perfil', authMiddleware, getProfile);
router.patch('/perfil', authMiddleware, updateProfile);
router.get('/notifications-badge', authMiddleware, getNotificationBadge);
module.exports = router;
