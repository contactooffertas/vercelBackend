const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
  {
    // ── Campos base ────────────────────────────────────────────────────
    name: { type: String, required: true },
    description: { type: String, default: "" },
    city: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    logo: { type: String, default: "" },
    logoPublicId: { type: String, default: "" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verified: { type: Boolean, default: false },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, default: "" },
    categories: [String],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    rating: { type: Number, default: 0 },
    totalRatings: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    totalProducts: { type: Number, default: 0 },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    appealStatus: {
      type: String,
      enum: ["none", "pending", "reviewed", "rejected"],
      default: "none",
    },
    appealNote: { type: String, default: null }, // mensaje del dueño
    appealAdminNote: { type: String, default: null }, // nota del admin al resolver
    appealSubmittedAt: { type: Date, default: null },
    appealResolvedAt: { type: Date, default: null },

    // ── Destacado ───────────────────────────────────────────────────────
    featured: { type: Boolean, default: false },
    featuredPaid: { type: Boolean, default: false },
    featuredDays: { type: Number, default: 0 },
    featuredUntil: { type: Date, default: null },

    // ── Sistema de strikes ─────────────────────────────────────────────
    strikeCount: { type: Number, default: 0 },
    suspended: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: "" },

    // ── Sistema de suscripción ─────────────────────────────────────────
    cuotaSuscriptor: { type: Boolean, default: false },
    fechaPago: { type: Date, default: null },
    fechaFinaliza: { type: Date, default: null },
  },
  { timestamps: true },
);

businessSchema.index({ location: "2dsphere" });
businessSchema.index({ owner: 1 });

module.exports = mongoose.model("Business", businessSchema);
