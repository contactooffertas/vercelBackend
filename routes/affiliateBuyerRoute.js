// routes/affiliateBuyerRoute.js
// En index.js agregar:const express = require('express');
// En index.js agregar:const router = express.Router();
// En index.js agregar:const authMiddleware = require('../middleware/authMiddleware');
// En index.js agregar:const {
// En index.js agregar:  getAvailableOffers,
// En index.js agregar:  applyToOffer,
// En index.js agregar:  listMyApplications,
// En index.js agregar:  getEarningsSummary,
// En index.js agregar:  rejectPayment,
// En index.js agregar:  getProfile,
// En index.js agregar:  updateProfile,
// En index.js agregar:  listMySales,
// En index.js agregar:} = require('../authController/affiliateBuyerController');

// En index.js agregar:router.get('/offers', authMiddleware, getAvailableOffers);
// En index.js agregar:router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
// En index.js agregar:router.get('/mis-ofertas', authMiddleware, listMyApplications);
// En index.js agregar:router.get('/resumen', authMiddleware, getEarningsSummary);
// En index.js agregar:router.patch('/sales/:saleId/reject-payment', authMiddleware, rejectPayment);
// En index.js agregar:router.get('/mis-ventas', authMiddleware, listMySales);
// En index.js agregar:router.get('/perfil', authMiddleware, getProfile);
// En index.js agregar:router.patch('/perfil', authMiddleware, updateProfile);

// En index.js agregar:module.exports = router;
// app.use('/api/affiliates/buyer', require('./routes/affiliateBuyerRoute'));



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

router.get('/stores', authMiddleware, getAvailableStores);
router.get('/stores/:sellerId/products', authMiddleware, getStoreProducts);
router.post('/offers/:offerId/apply', authMiddleware, applyToOffer);
router.get('/mis-ofertas', authMiddleware, listMyApplications);
router.get('/resumen', authMiddleware, getEarningsSummary);
router.patch('/sales/:saleId/reject-payment', authMiddleware, rejectPayment);
router.get('/mis-ventas', authMiddleware, listMySales);
router.get('/perfil', authMiddleware, getProfile);
router.patch('/perfil', authMiddleware, updateProfile);

module.exports = router;
