const mongoose = require('mongoose');

const serviceReviewSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceProvider', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '', trim: true, maxlength: 600 },
  serviceReceived: { type: Boolean, default: true },
  status: { type: String, enum: ['published','hidden'], default: 'published' },
}, { timestamps: true });

serviceReviewSchema.index({ provider: 1, author: 1 }, { unique: true });
module.exports = mongoose.model('ServiceReview', serviceReviewSchema);
