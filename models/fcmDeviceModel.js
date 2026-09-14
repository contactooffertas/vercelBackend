const mongoose = require('mongoose');

const fcmDeviceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['android','ios'], default: 'android' },
  active: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('FcmDevice', fcmDeviceSchema);
