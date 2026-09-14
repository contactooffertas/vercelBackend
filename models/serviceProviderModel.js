const mongoose = require('mongoose');

const credentialSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  institution: { type: String, default: '', trim: true },
  year: { type: Number, min: 1950, max: 2100 },
  documentUrl: { type: String, default: '' },
  documentPublicId: { type: String, default: '' },
}, { _id: true });

const referenceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  relationship: { type: String, default: 'Cliente', trim: true },
  contact: { type: String, default: '', trim: true, select: false },
  verified: { type: Boolean, default: false },
}, { _id: true });

const serviceProviderSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  displayName: { type: String, required: true, trim: true, maxlength: 80 },
  avatar: { type: String, default: '' },
  avatarPublicId: { type: String, default: '' },
  headline: { type: String, default: '', trim: true, maxlength: 100 },
  bio: { type: String, default: '', trim: true, maxlength: 900 },
  trades: [{ type: String, trim: true }],
  experienceYears: { type: Number, default: 0, min: 0, max: 70 },
  received: { type: Boolean, default: false },
  credentials: [credentialSchema],
  references: [referenceSchema],
  verificationStatus: { type: String, enum: ['unverified','pending','verified','rejected'], default: 'unverified' },
  verificationNote: { type: String, default: '', select: false },
  verifiedAt: { type: Date, default: null },
  phone: { type: String, default: '', trim: true },
  whatsapp: { type: String, default: '', trim: true },
  contactPreference: { type: String, enum: ['chat','whatsapp','both'], default: 'both' },
  address: { type: String, default: '', trim: true, maxlength: 180 },
  showAddress: { type: Boolean, default: false },
  city: { type: String, default: 'Rosario' },
  neighborhoods: [{ type: String, trim: true }],
  serviceRadiusKm: { type: Number, default: 8, min: 1, max: 40 },
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], default: [0,0] } },
  availableNow: { type: Boolean, default: false },
  emergencyService: { type: Boolean, default: false },
  schedule: { type: String, default: '', maxlength: 180 },
  startingPrice: { type: Number, default: null, min: 0 },
  paymentMethods: [{ type: String, enum: ['cash','transfer','mercadopago','card'] }],
  gallery: [{ url: String, publicId: String, caption: String }],
  rating: { type: Number, default: 0, min: 0, max: 5 },
  ratingSum: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  completedJobs: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  blocked: { type: Boolean, default: false },
}, { timestamps: true });

serviceProviderSchema.index({ location: '2dsphere' });
serviceProviderSchema.index({ trades: 1, active: 1, verificationStatus: 1 });
serviceProviderSchema.index({ displayName: 'text', headline: 'text', bio: 'text', trades: 'text' });

module.exports = mongoose.model('ServiceProvider', serviceProviderSchema);
