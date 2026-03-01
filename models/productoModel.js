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

    // ── Destacado individual ─────────────────────────────────────────
    featured:      { type: Boolean, default: false },
    featuredPaid:  { type: Boolean, default: false },
    featuredDays:  { type: Number,  default: 0 },
    featuredUntil: { type: Date,    default: null },

    // ── Moderación / Reportes ────────────────────────────────────────
    // blocked      → true = oculto al público
    // blockedReason → motivo visible al vendedor y al admin
    // blockType    → "temp" = puede pedir revisión / "permanent" = no puede
    blocked:       { type: Boolean, default: false },
    blockedReason: { type: String,  default: "" },
    blockType:     { type: String,  enum: ["temp", "permanent"], default: "temp" },

    // ── Revisión solicitada por el vendedor ──────────────────────────
    // underReview  → true = el vendedor envió el producto a revisión admin
    // reviewNote   → mensaje que el vendedor escribe al pedir revisión
    underReview: { type: Boolean, default: false },
    reviewNote:  { type: String,  default: "" },

    // ── Nota interna del admin tras moderar ──────────────────────────
    // adminNote → se envía al vendedor como notificación tras la decisión
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

productoSchema.index({ location: "2dsphere" });
productoSchema.index({ featured: 1, featuredPaid: 1, featuredUntil: 1 });
productoSchema.index({ businessId: 1 });
productoSchema.index({ blocked: 1 });
productoSchema.index({ underReview: 1, blocked: 1 }); // acelera la query del panel admin

module.exports = mongoose.model("Product", productoSchema);