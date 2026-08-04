// models/AffiliateSale.js
const mongoose = require('mongoose');
const AffiliateSellerApplication = require('./AffiliateSellerApplication');
const AffiliateDebugLog = require('./AffiliateDebugLog');

const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const affiliateSaleSchema = new mongoose.Schema(
  {
    // ... (todo igual, sin cambios en los campos)
  },
  { timestamps: true }
);

affiliateSaleSchema.virtual('totalAmount').get(function getTotalAmount() {
  return this.quantity * this.unitPrice;
});

affiliateSaleSchema.pre('validate', async function setDueDate(next) {
  if (this.dueDate) return next();

  const base = this.date instanceof Date ? this.date : new Date();
  let termDays = DEFAULT_TERM_DAYS;

  if (this.seller) {
    try {
      const sellerProgram = await AffiliateSellerApplication.findOne({ user: this.seller })
        .select('paymentTermDays')
        .lean();
      if (sellerProgram?.paymentTermDays === 15 || sellerProgram?.paymentTermDays === 30) {
        termDays = sellerProgram.paymentTermDays;
      }
    } catch (lookupErr) {
      try {
        await AffiliateDebugLog.create({
          context: 'AffiliateSale.pre-validate',
          message: lookupErr.message,
          stack: lookupErr.stack || '',
          payload: { seller: this.seller, application: this.application },
        });
      } catch (_) { /* si esto también falla, no hacemos nada más */ }
    }
  }

  this.dueDate = new Date(base.getTime() + termDays * DAY_MS);
  next(); // SIEMPRE next() sin error acá
});

affiliateSaleSchema.set('toJSON', { virtuals: true });
affiliateSaleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('AffiliateSale', affiliateSaleSchema);
