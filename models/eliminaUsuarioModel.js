// models/eliminaUsuarioModel.js
const mongoose = require("mongoose");

const eliminaUsuarioSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    userRole: { type: String, enum: ["buyer", "seller", "admin"], default: "buyer" },

    // Razón ingresada por el usuario
    reason: { type: String, default: "" },

    // Estado del proceso
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "cancelled"],
      default: "pending",
    },

    // Resumen de lo que se eliminó
    deletionSummary: {
      products:      { type: Number, default: 0 },
      business:      { type: Boolean, default: false },
      businessName:  { type: String, default: "" },
      conversations: { type: Number, default: 0 },
      orders:        { type: Number, default: 0 },
      reports:       { type: Number, default: 0 },
      cartItems:     { type: Number, default: 0 },
      pushSubs:      { type: Number, default: 0 },
    },

    // Tokens / IP para auditoría
    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    ipAddress:   { type: String },

    // El mail de confirmación se envió
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EliminaUsuario", eliminaUsuarioSchema);