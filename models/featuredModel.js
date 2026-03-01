// models/featuredModel.js
// Solo se usa para destacado de NEGOCIOS completos.
// El destacado de productos individuales vive en el propio productoModel.
const mongoose = require("mongoose");

const featuredSchema = new mongoose.Schema(
  {
    business:  { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
    type:      { type: String, enum: ["daily", "weekly", "monthly", "custom"], default: "weekly" },
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },
    active:    { type: Boolean, default: true },
    paid:      { type: Boolean, default: false },  // true = pago confirmado, aparece en el feed
    days:      { type: Number, default: 0 },
    note:      { type: String },
    addedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

featuredSchema.index({ business: 1, active: 1, endDate: 1 });

module.exports = mongoose.model("Featured", featuredSchema);