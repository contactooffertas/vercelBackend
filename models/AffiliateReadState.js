const mongoose = require('mongoose');

const affiliateReadStateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['buyer', 'seller'],
      required: true,
    },
    storesSeenAt: { type: Date, default: () => new Date(0) },
    applicationsSeenAt: { type: Date, default: () => new Date(0) },
    salesSeenAt: { type: Date, default: () => new Date(0) },
    paymentsSeenAt: { type: Date, default: () => new Date(0) },
  },
  { timestamps: true },
);

affiliateReadStateSchema.index({ user: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateReadState', affiliateReadStateSchema);
