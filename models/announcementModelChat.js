// models/announcementModel.js
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type:     String,
      required: true,
      trim:     true,
      maxlength: 120,
    },
    message: {
      type:     String,
      required: true,
      trim:     true,
      maxlength: 1000,
    },
    audience: {
      type:    String,
      enum:    ['all', 'seller', 'buyer'],
      default: 'all',
    },
    durationHours: {
      type:    Number,
      default: 24,
      min:     1,
      max:     720, // 30 días máximo
    },
    link: {
      type:    String,
      trim:    true,
      default: null,
    },
    expiresAt: {
      type:     Date,
      required: true,
      index:    true,
    },
    active: {
      type:    Boolean,
      default: true,
      index:   true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
  },
  {
    timestamps: true,
  }
);


announcementSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Announcement', announcementSchema);