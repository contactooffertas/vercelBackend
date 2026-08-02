// models/AffiliateOfferApplication.js
//
// Solicitud de un comprador (afiliado) para vender los productos de una
// oferta puntual de un vendedor. `seller` queda desnormalizado para poder
// filtrar rápido "mis solicitudes" / "mis afiliados" sin populate extra.
//
// Estados:
//  - pending   -> recién aplicó, el vendedor todavía no decidió
//  - accepted  -> el vendedor lo aceptó, tiene affiliateCode y link activo
//  - rejected  -> el vendedor lo rechazó (se le avisa por mail)
//  - blocked   -> fue aceptado pero el vendedor lo inhabilitó después

const mongoose = require('mongoose');

const affiliateOfferApplicationSchema = new mongoose.Schema(
  {
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AffiliateOffer',
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'blocked'],
      default: 'pending',
      index: true,
    },
    affiliateCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: null,
    },
    salesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

affiliateOfferApplicationSchema.index({ offer: 1, buyer: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateOfferApplication', affiliateOfferApplicationSchema);
