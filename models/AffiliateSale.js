// models/AffiliateSale.js
const mongoose = require('mongoose');
const AffiliateSellerApplication = require('./AffiliateSellerApplication');

const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Se completa solo en el pre-validate según el ciclo de pago (15 o 30
    // días) que tenga configurado el vendedor EN ESE MOMENTO. Si el
    // creador de la venta ya manda un dueDate explícito, se respeta ese.
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

// ANTES: siempre sumaba 30 días fijos (THIRTY_DAYS_MS), sin importar lo que
// el vendedor tuviera configurado en su perfil (paymentTermDays: 15 o 30).
// AHORA: si no viene un dueDate explícito, busca el ciclo de pago vigente
// del vendedor y calcula el vencimiento en base a eso. Si por algún motivo
// no encuentra el perfil del vendedor, cae al default de 30 días (nunca
// queda en null).
//
// ⚠️ FIX: la función era `async function setDueDate(next)` y llamaba a
// next()/next(err). Al ser async, Mongoose espera la promesa sola y NO
// pasa un `next` real, entonces `next` llegaba undefined -> "next is not
// a function". Se saca el parámetro `next` y se usa throw para errores.
affiliateSaleSchema.pre('validate', async function setDueDate() {
  if (this.dueDate) return;

  const base = this.date instanceof Date ? this.date : new Date();
  let termDays = DEFAULT_TERM_DAYS;

  if (this.seller) {
    const sellerProgram = await AffiliateSellerApplication.findOne({ user: this.seller })
      .select('paymentTermDays')
      .lean();
    if (sellerProgram?.paymentTermDays === 15 || sellerProgram?.paymentTermDays === 30) {
      termDays = sellerProgram.paymentTermDays;
    }
  }

  this.dueDate = new Date(base.getTime() + termDays * DAY_MS);
});

affiliateSaleSchema.set('toJSON', { virtuals: true });
affiliateSaleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('AffiliateSale', affiliateSaleSchema);
