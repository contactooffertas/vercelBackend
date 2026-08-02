// models/AffiliateOffer.js
//
// Representa un producto propio del vendedor habilitado dentro del
// Programa de Afiliados ("oferta"). Un mismo producto sólo puede tener
// una oferta por vendedor (índice único seller+product).

const mongoose = require('mongoose');

const affiliateOfferSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    product: {
      // Referencia al modelo exportado como "Product" en models/productoModel.js
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    commissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

affiliateOfferSchema.index({ seller: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateOffer', affiliateOfferSchema);
