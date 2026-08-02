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
} = require('../authController/affiliateSellerController');

router.get('/products', authMiddleware, getSellerProducts);
router.post('/offers', authMiddleware, upsertOffer);
router.patch('/offers/:offerId/toggle', authMiddleware, toggleOffer);
router.get('/offers', authMiddleware, listOffers);
router.get('/offers/:offerId/applications', authMiddleware, listOfferApplications);
router.post('/applications/:applicationId/accept', authMiddleware, acceptApplication);
router.post('/applications/:applicationId/reject', authMiddleware, rejectApplication);
router.patch('/applications/:applicationId/status', authMiddleware, setApplicationStatus);
router.delete('/applications/:applicationId', authMiddleware, deleteApplication);
router.patch('/applications/:applicationId/rating', authMiddleware, rateApplication);
router.get('/mis-afiliados', authMiddleware, listMyAffiliates);

module.exports = router;

// En index.js agregar:
// app.use('/api/affiliates/seller', require('./routes/affiliateSellerRoute'));
