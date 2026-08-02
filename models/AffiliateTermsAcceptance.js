// models/AffiliateTermsAcceptance.js
const mongoose = require('mongoose');

const affiliateTermsAcceptanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['seller', 'buyer'],
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    acceptedAt: {
      type: Date,
      default: Date.now,
    },
    ip: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Un usuario puede tener una aceptación vigente por rol; el historial completo
// queda igual en la colección (no se pisa), así que no se usa unique aquí.
affiliateTermsAcceptanceSchema.index({ user: 1, role: 1, version: 1 });

module.exports = mongoose.model('AffiliateTermsAcceptance', affiliateTermsAcceptanceSchema);
