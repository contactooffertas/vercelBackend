// routes/affiliateBuyerRoute.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getAvailableOffers,
  applyToOffer,
  listMyApplications,
  getEarningsSummary,
  rejectPayment,
  getProfile,
  updateProfile,
  listMySales,
} = require('../authController/affiliateBuyerController');

router.get('/offers', authMiddleware, getAvailableOffers);
router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
router.get('/mis-ofertas', authMiddleware, listMyApplications);
router.get('/resumen', authMiddleware, getEarningsSummary);
router.patch('/sales/:saleId/reject-payment', authMiddleware, rejectPayment);
router.get('/mis-ventas', authMiddleware, listMySales);
router.get('/perfil', authMiddleware, getProfile);
router.patch('/perfil', authMiddleware, updateProfile);

module.exports = router;

// En index.js agregar:
// app.use('/api/affiliates/buyer', require('./routes/affiliateBuyerRoute'));
