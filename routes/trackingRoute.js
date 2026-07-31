// routes/tracking.routes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/trackingController');

// Público: cualquier web puede trackear (después le pones rate-limit)
router.post('/event', controller.trackEvent);


// Privado: solo el dueño del negocio
const { protect } = require('../middlewares/authMiddleware'); // tu middleware
router.get('/leads/:businessId', protect, controller.getLeadsByBusiness);

module.exports = router;
