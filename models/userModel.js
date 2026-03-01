// models/userModel.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name:     String,
    email:    { type: String, unique: true },
    password: String,
    role:     { type: String, enum: ["user", "seller", "admin"], default: "user" },
    avatar:        { type: String, default: "/assets/offerton.jpg" },
    avatarPublicId: String,
    businessId:    { type: mongoose.Schema.Types.ObjectId, ref: "Business" },

    verificationCode:        String,
    verificationCodeExpires: Date,
    verified:                { type: Boolean, default: false },

    resetPasswordCode:        { type: String, default: null },
    resetPasswordCodeExpires: { type: Date,   default: null },

    purchases: { type: Number, default: 0 },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    followingBusinesses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Business" }],
    favoriteBusinesses:  [{ type: mongoose.Schema.Types.ObjectId, ref: "Business" }],

    ratedBusinesses: [
      {
        businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
        rating:     Number,
      },
    ],

    pushSubscription: { type: Object, default: null },

    // ── Reputación comprador ──────────────────────────────────────────────
    buyerRating:       { type: Number, default: 0 },
    buyerRatingSum:    { type: Number, default: 0 },
    buyerTotalRatings: { type: Number, default: 0 },

    // ── Reputación reportero ──────────────────────────────────────────────
    reporterReputation: { type: Number, default: 0 },

    // ── Ubicación ─────────────────────────────────────────────────────────
    lat:             { type: Number,  default: null  },
    lng:             { type: Number,  default: null  },
    locationEnabled: { type: Boolean, default: false },

    // ── Notificaciones ────────────────────────────────────────────────────
    notificationsEnabled: { type: Boolean, default: false },
    pushEnabled:          { type: Boolean, default: false },

    // ── Términos y Condiciones ────────────────────────────────────────────
    // true  = el usuario aceptó explícitamente al registrarse
    // false = no aceptó (no debería llegar a crearse, pero queda como guardia)
    terminosAceptados:   { type: Boolean, default: false },
    // fecha exacta en que aceptó — útil para auditoría legal
    terminosAceptadosAt: { type: Date,    default: null  },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);