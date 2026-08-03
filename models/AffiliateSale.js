// models/AffiliateSale.js
//
const mongoose = require('mongoose');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const affiliateSaleSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AffiliateOfferApplication',
      required: true,
      index: true,
    },
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
    affiliate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Se completa solo en el pre-validate si no vino seteada.
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    // El vendedor le paga la comisión al afiliado; esto marca ese pago.
    paid: {
      type: Boolean,
      default: false,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    // Comprobante de pago que el vendedor adjunta al pagarle al afiliado
    // (ej. captura de la transferencia).
    paymentProofUrl: {
      type: String,
      trim: true,
      default: '',
    },
    paymentProofNote: {
      type: String,
      trim: true,
      default: '',
    },
    paymentProofUpdatedAt: {
      type: Date,
      default: null,
    },
    // El afiliado puede rechazar/objetar una venta no pagada (ej. pago
    // que no le llegó, monto incorrecto, etc.).
    rejected: {
      type: Boolean,
      default: false,
      index: true,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);
affiliateSaleSchema.virtual('totalAmount').get(function getTotalAmount() {
  return this.quantity * this.unitPrice;
});
affiliateSaleSchema.pre('validate', function setDueDate(next) {
  if (!this.dueDate) {
    const base = this.date instanceof Date ? this.date : new Date();
    this.dueDate = new Date(base.getTime() + THIRTY_DAYS_MS);
  }
  next();
});
affiliateSaleSchema.set('toJSON', { virtuals: true });
affiliateSaleSchema.set('toObject', { virtuals: true });
module.exports = mongoose.model('AffiliateSale', affiliateSaleSchema);
