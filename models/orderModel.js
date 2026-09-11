const mongoose = require("mongoose");
const orderItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  name:     String,
  price:    Number,
  quantity: Number,
});
const orderSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items:  [orderItemSchema],
  total:  { type: Number, required: true },
  status: {
    type:    String,
    enum:    ["pending", "confirmed", "shipped", "delivered", "returned"],
    default: "pending",
  },
  businessName:  { type: String, default: "" },
  businessPhone: { type: String, default: "" },
  businessId:    { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
  date: { type: Date, default: Date.now },
  payment: {
    method: {
      type: String,
      enum: ["direct", "bna", "santafe", "mercadopago"],
      default: "direct",
    },
    status: {
      type: String,
      enum: ["unpaid", "pending", "verifying", "paid", "rejected", "refunded"],
      default: "unpaid",
    },
    providerUrl: { type: String, default: "" },
    externalReference: { type: String, default: "" },
    initiatedAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    refundStatus: {
      type: String,
      enum: ["none", "requested", "refunded"],
      default: "none",
    },
    refundRequestedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
  },
  // ── Calificaciones ────────────────────────────────────────────────────
  buyerRating: {
    rating:    { type: Number, min: 1, max: 5, default: null },
    comment:   { type: String, default: "" },
    ratedAt:   { type: Date, default: null },
  },
  sellerRating: {
    rating:    { type: Number, min: 1, max: 5, default: null },
    comment:   { type: String, default: "" },
    ratedAt:   { type: Date, default: null },
  },
}, { timestamps: true });
module.exports = mongoose.model("Order", orderSchema);
