// models/cartModel.js
const mongoose = require("mongoose");
const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  // Precio snapshot al momento de agregar
  price: { type: Number, required: true }, // precio FINAL a cobrar (52k si es flash)
  originalPrice: { type: Number },
  discount: { type: Number, default: 0 },
  isFlashOffer: { type: Boolean, default: false },
  // Código de afiliado (Programa de Afiliados) que originó el agregado al
  // carrito, si el usuario llegó vía un link ?ref=xxxx. Se valida contra
  // AffiliateOfferApplication al momento de agregar (ver routes/cart.js),
  // así que si llega hasta acá ya sabemos que es un afiliado aceptado para
  // ese producto puntual.
  affiliateCode: { type: String, default: null },
});
const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  items: [cartItemSchema],
  updatedAt: { type: Date, default: Date.now },
  abandonedEmailSentAt: { type: Date, default: null },
}, { timestamps: true });
module.exports = mongoose.model("Cart", cartSchema);
