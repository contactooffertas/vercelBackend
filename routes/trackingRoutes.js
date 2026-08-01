const express = require('express');
const router = express.Router();
const { trackEvent, getLeadsByBusiness } = require('../authController/trackingController');
const protect = require('../middleware/authMiddleware'); // tu middleware (export por defecto)

// Público: cualquier web puede trackear (después le pones rate-limit)
router.post('/event', trackEvent);
// Privado: solo el dueño del negocio
router.get('/leads/:businessId', protect, getLeadsByBusiness);

module.exports = router;
