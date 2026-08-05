// routes/affiliateSellerRoute.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getSellerProducts,
  upsertOffer,
  toggleOffer,
  listOffers,
  listOfferApplications,
  acceptApplication,
  rejectApplication,
  setApplicationStatus,
  deleteApplication,
  rateApplication,
  listMyAffiliates,
  getPayablesSummary,
  markSaleAsPaid,
  updateSaleProof,
  getProfile,
  updateProfile,
  listOfferSales,
  getNotificationBadge,
} = require('../authController/affiliateSellerController');
router.get('/products', authMiddleware, getSellerProducts);
router.post('/offers', authMiddleware, upsertOffer);
router.patch('/offers/:offerId/toggle', authMiddleware, toggleOffer);
router.get('/offers', authMiddleware, listOffers);
router.get('/offers/:offerId/applications', authMiddleware, listOfferApplications);
router.get('/offers/:offerId/sales', authMiddleware, listOfferSales);
router.post('/applications/:applicationId/accept', authMiddleware, acceptApplication);
router.post('/applications/:applicationId/reject', authMiddleware, rejectApplication);
router.patch('/applications/:applicationId/status', authMiddleware, setApplicationStatus);
router.delete('/applications/:applicationId', authMiddleware, deleteApplication);
router.patch('/applications/:applicationId/rating', authMiddleware, rateApplication);
router.get('/mis-afiliados', authMiddleware, listMyAffiliates);
router.get('/resumen', authMiddleware, getPayablesSummary);
router.patch('/sales/:saleId/pay', authMiddleware, markSaleAsPaid);
router.patch('/sales/:saleId/proof', authMiddleware, updateSaleProof);
router.get('/perfil', authMiddleware, getProfile);
router.patch('/perfil', authMiddleware, updateProfile);
router.get('/notifications-badge', authMiddleware, getNotificationBadge);
module.exports = router;
