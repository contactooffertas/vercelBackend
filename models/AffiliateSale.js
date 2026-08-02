// models/AffiliateSale.js
//
// Registro detallado de cada venta generada por un afiliado del Programa
// de Afiliados. Antes solo se incrementaba un contador (`salesCount`) en
// AffiliateOfferApplication, sin guardar qué producto, a qué precio, ni
// cuánta comisión correspondía. Este modelo guarda un snapshot completo
// de cada venta puntual para que tanto el vendedor como el afiliado
// puedan controlar el detalle (no solo un número acumulado).
//
// Se crea en routes/cart.js dentro del checkout, una vez por cada item
// del carrito que llegó con un affiliateCode válido.
const mongoose = require('mongoose');

const affiliateSaleSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AffiliateOfferApplication',
      required: true,
      index: true,
    },
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AffiliateOffer',
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // El comprador (afiliado) que generó la venta con su link.
    affiliate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // El cliente final que efectivamente compró el producto.
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // Snapshot del nombre, por si el producto se borra o cambia después.
    productName: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    // Precio unitario efectivamente cobrado (ya con flash/descuento si aplicaba).
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // Snapshot del % de comisión al momento de la venta (por si el vendedor
    // lo cambia después, la venta ya facturada no debe recalcularse).
    commissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    // unitPrice * quantity * (commissionPercentage / 100), calculado una
    // sola vez al crear el registro.
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

affiliateSaleSchema.index({ affiliate: 1, date: -1 });
affiliateSaleSchema.index({ offer: 1, date: -1 });

module.exports = mongoose.model('AffiliateSale', affiliateSaleSchema);
