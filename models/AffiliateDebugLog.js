// models/AffiliateDebugLog.js
const mongoose = require('mongoose');

const affiliateDebugLogSchema = new mongoose.Schema(
  {
    context: { type: String, required: true }, // ej: "cart/checkout" o "AffiliateSale.pre-validate"
    message: { type: String, required: true },
    stack: { type: String, default: '' },
    // Guardamos el payload que intentábamos crear, para poder reintentar
    // manualmente o ver qué faltaba.
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AffiliateDebugLog', affiliateDebugLogSchema);
