// models/AffiliateSellerApplication.js
const mongoose = require('mongoose');
const affiliateSellerApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    defaultPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    maxAffiliates: {
      type: Number,
      required: true,
      min: 1,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    paymentTermDays: {
      type: Number,
      enum: [15, 30],
      default: 30,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model('AffiliateSellerApplication', affiliateSellerApplicationSchema);
