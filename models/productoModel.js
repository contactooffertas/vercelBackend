// models/productoModel.js
const mongoose = require("mongoose");

const productoSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true },
    description:   { type: String, default: "" },
    price:         { type: Number, required: true },
    originalPrice: { type: Number, default: null },
    discount:      { type: Number, default: 0 },
    stock:         { type: Number, default: 10 },
    category:      { type: String, default: "general" },
    image:         { type: String },
    imagePublicId: { type: String },
    deliveryRadius: { type: Number, default: 0 },

    user:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },

    // ── Ubicación GeoJSON ────────────────────────────────────────────
    location: {
      type:        { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // ── Destacado individual (pago) ──────────────────────────────────
    featured:      { type: Boolean, default: false },
    featuredPaid:  { type: Boolean, default: false },
    featuredDays:  { type: Number,  default: 0 },
    featuredUntil: { type: Date,    default: null },

    // ── Oferta Flash ──────────────────────────────────────────────────
  
    flashOffer: {
      active:        { type: Boolean, default: false },
      discount:      { type: Number, default: 0 }, // % durante la oferta
      startAt:       { type: Date,   default: null },
      endAt:         { type: Date,   default: null },
      durationHours: { type: Number, default: 0 },
    },

    // ── Moderación / Reportes ────────────────────────────────────────
    blocked:       { type: Boolean, default: false },
    blockedReason: { type: String,  default: "" },
    blockType:     { type: String,  enum: ["temp", "permanent"], default: "temp" },

    // ── Revisión solicitada por el vendedor ──────────────────────────
    underReview: { type: Boolean, default: false },
    reviewNote:  { type: String,  default: "" },

    // ── Nota interna del admin tras moderar ──────────────────────────
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

productoSchema.index({ location: "2dsphere" });
productoSchema.index({ featured: 1, featuredPaid: 1, featuredUntil: 1 });
productoSchema.index({ businessId: 1 });
productoSchema.index({ blocked: 1 });
productoSchema.index({ underReview: 1, blocked: 1 });
productoSchema.index({ "flashOffer.active": 1, "flashOffer.endAt": 1 });

module.exports = mongoose.model("Product", productoSchema);
