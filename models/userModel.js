// models/userModel.js
const mongoose = require("mongoose");

// Un GeoJSON Point solo debe existir cuando tenemos coordenadas reales.
// Mantenerlo como subdocumento opcional evita crear { type: "Point" } vacío
// durante el registro y que el índice 2dsphere rechace el usuario.
const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: "geoLocation.coordinates debe contener [lng, lat]",
      },
    },
  },
  { _id: false },
);

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
    // lat/lng se mantienen por compatibilidad con el frontend actual.
    lat:             { type: Number,  default: null  },
    lng:             { type: Number,  default: null  },
    locationEnabled: { type: Boolean, default: false },
    geoLocation:     { type: geoPointSchema, default: undefined },
    lastLocationAt:  { type: Date, default: null },

    // ── Notificaciones ────────────────────────────────────────────────────
    notificationsEnabled: { type: Boolean, default: false },
    pushEnabled:          { type: Boolean, default: false },

    // ── Términos y Condiciones ────────────────────────────────────────────
    terminosAceptados:   { type: Boolean, default: false },
    terminosAceptadosAt: { type: Date,    default: null  },
  },
  { timestamps: true },
);

// Fundamental para buscar usuarios cercanos sin recorrer toda la colección.
userSchema.index({ geoLocation: "2dsphere" }, { sparse: true });
userSchema.index({ locationEnabled: 1, notificationsEnabled: 1 });

module.exports = mongoose.model("User", userSchema);
