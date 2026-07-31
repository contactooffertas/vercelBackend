// routes/cart.js
const express = require("express");
const router = express.Router();
const Cart = require("../models/cartModel");
const Product = require("../models/productoModel");
const auth = require("../middleware/authMiddleware");

const PRODUCT_POPULATE = {
  path: "items.product",
  select: "name price originalPrice discount image stock businessId flashOffer",
  populate: {
    path: "businessId",
    select: "name city logo phone",
  },
};

function getFlashFinalPrice(product) {
  if (!product.flashOffer?.active) return null;
  const base = product.originalPrice?? product.price;
  const discount = product.flashOffer.discount || 0;
  return base * (1 - discount / 100);
}

function isFlashValid(product) {
  if (!product.flashOffer?.active) return false;
  if (product.flashOffer.endDate && new Date(product.flashOffer.endDate) < new Date()) return false;
  return true;
}

function formatItems(cartItems) {
  return cartItems.map(i => ({
    _id: i._id,
    productId: i.product._id,
    name: i.product.name,
    price: i.price, // YA ES EL FINAL (52k si fue flash)
    originalPrice: i.originalPrice?? i.product.originalPrice?? i.product.price,
    discount: i.discount?? i.product.discount,
    image: i.product.image,
    stock: i.product.stock || 99,
    quantity: i.quantity,
    isFlashOffer: i.isFlashOffer || false,
    businessId: i.product.businessId?._id || i.product.businessId || null,
    businessName: i.product.businessId?.name || null,
    businessPhone: i.product.businessId?.phone || "",
  }));
}

// ─── GET /api/cart ─────────────────────────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id }).populate(PRODUCT_POPULATE);
    if (!cart) return res.json({ items: [] });
    res.json({ items: formatItems(cart.items), updatedAt: cart.updatedAt });
  } catch (err) {
    res.status(500).json({ message: "Error al obtener el carrito" });
  }
});

// ─── POST /api/cart/add ───────────────────────────────────────────────────
router.post("/add", auth, async (req, res) => {
  try {
    const { productId, quantity = 1, price: frontPrice, originalPrice: frontOriginal, discount: frontDiscount, isFlashOffer: frontIsFlash } = req.body;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });

    // ── CALCULO DE PRECIO CON PRIORIDAD FLASH ──
    let finalPrice;
    let finalOriginalPrice;
    let finalDiscount;
    let finalIsFlash = false;

    if (frontIsFlash && isFlashValid(product)) {
      // Caso 1: viene de oferta flash y sigue vigente -> prioridad 100%
      const base = product.originalPrice?? product.price;
      finalOriginalPrice = base;
      finalDiscount = product.flashOffer.discount;
      finalPrice = getFlashFinalPrice(product);
      finalIsFlash = true;
    } else if (frontPrice && frontIsFlash) {
      // Fallback si el front ya calculó (por si el back no tiene originalPrice)
      finalPrice = frontPrice;
      finalOriginalPrice = frontOriginal;
      finalDiscount = frontDiscount;
      finalIsFlash = true;
    } else {
      // Precio normal
      finalOriginalPrice = product.originalPrice || product.price;
      finalDiscount = product.discount || 0;
      finalPrice = product.discount
       ? product.price * (1 - product.discount / 100) // si tenes descuento ya aplicado en price, usa solo product.price
        : product.price;
      // Si tu price en DB ya es el precio con 5% (61k) entonces finalPrice = product.price
      // Si tu price es 65k y discount 5, entonces descomenta la linea de arriba
      // Para tu caso: 65k originalPrice, price 61k -> usamos product.price directo
      if (product.discount) {
         // si guardas price=61750 y discount=5, el price ya es final
         finalPrice = product.price;
      }
    }

    const existing = cart.items.find(i => i.product.toString() === productId);
    if (existing) {
      existing.quantity = Math.min(product.stock || 99, existing.quantity + quantity);
      // Si agrega como flash, pisamos el precio al de flash
      if (finalIsFlash) {
        existing.price = finalPrice;
        existing.originalPrice = finalOriginalPrice;
        existing.discount = finalDiscount;
        existing.isFlashOffer = true;
      }
    } else {
      cart.items.push({
        product: productId,
        quantity,
        price: finalPrice,
        originalPrice: finalOriginalPrice,
        discount: finalDiscount,
        isFlashOffer: finalIsFlash
      });
    }

    cart.updatedAt = new Date();
    await cart.save();
    await cart.populate(PRODUCT_POPULATE);

    res.json({ items: formatItems(cart.items) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al agregar al carrito" });
  }
});

// ─── PUT /api/cart/update ─────────────────────────────────────────────────
router.put("/update", auth, async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (quantity < 1) return res.status(400).json({ message: "Cantidad invalida" });

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) return res.status(404).json({ message: "Carrito no encontrado" });

    const item = cart.items.find(i => i.product.toString() === productId);
    if (!item) return res.status(404).json({ message: "Producto no esta en el carrito" });

    const product = await Product.findById(productId);
    item.quantity = Math.min(product?.stock || 99, quantity);
    cart.updatedAt = new Date();
    await cart.save();
    await cart.populate(PRODUCT_POPULATE);

    res.json({ items: formatItems(cart.items) });
  } catch (err) {
    res.status(500).json({ message: "Error al actualizar el carrito" });
  }
});

// ─── DELETE /api/cart/remove/:productId ──────────────────────────────────
router.delete("/remove/:productId", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) return res.status(404).json({ message: "Carrito no encontrado" });

    cart.items = cart.items.filter(i => i.product.toString()!== req.params.productId);
    cart.updatedAt = new Date();
    await cart.save();
    await cart.populate(PRODUCT_POPULATE);

    res.json({ items: formatItems(cart.items) });
  } catch (err) {
    res.status(500).json({ message: "Error al eliminar del carrito" });
  }
});

// ─── DELETE /api/cart/clear ───────────────────────────────────────────────
router.delete("/clear", auth, async (req, res) => {
  try {
    await Cart.findOneAndUpdate(
      { user: req.user.id },
      { items: [], updatedAt: new Date() }
    );
    res.json({ items: [] });
  } catch (err) {
    res.status(500).json({ message: "Error al vaciar el carrito" });
  }
});

// ─── POST /api/cart/checkout ──────────────────────────────────────────────
router.post("/checkout", auth, async (req, res) => {
  try {
    const Order = require("../models/orderModel");

    const cart = await Cart.findOne({ user: req.user.id }).populate({
      path: "items.product",
      select: "name price discount stock businessId",
      populate: { path: "businessId", select: "name phone owner" },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "El carrito esta vacio" });
    }

    for (const i of cart.items) {
      const updated = await Product.findOneAndUpdate(
        { _id: i.product._id, stock: { $gte: i.quantity } },
        { $inc: { stock: -i.quantity } },
        { new: true }
      );
      if (!updated) {
        const failedIndex = cart.items.indexOf(i);
        for (let j = 0; j < failedIndex; j++) {
          const prev = cart.items[j];
          await Product.findByIdAndUpdate(prev.product._id, { $inc: { stock: prev.quantity } });
        }
        return res.status(400).json({ message: `Stock insuficiente para "${i.product.name}"` });
      }
    }

    const groupsByBusiness = {};
    for (const i of cart.items) {
      const bizId = i.product.businessId?._id?.toString() || "sin-negocio";
      const bizName = i.product.businessId?.name || "";
      const bizPhone = i.product.businessId?.phone || "";
      const bizOwner = i.product.businessId?.owner || null;

      if (!groupsByBusiness[bizId]) {
        groupsByBusiness[bizId] = {
          businessId: i.product.businessId?._id || null,
          businessName: bizName,
          businessPhone: bizPhone,
          businessOwner: bizOwner,
          items: [],
          total: 0,
        };
      }

      // USAMOS EL PRECIO GUARDADO EN EL CARRITO, NO RECALCULAMOS
      const unitPrice = i.price;

      groupsByBusiness[bizId].items.push({
        product: i.product._id,
        name: i.product.name,
        price: unitPrice,
        quantity: i.quantity,
      });
      groupsByBusiness[bizId].total += unitPrice * i.quantity;
    }

    const orders = [];
    const io = req.app.get("io");

    for (const group of Object.values(groupsByBusiness)) {
      const order = await Order.create({
        user: req.user.id,
        items: group.items,
        total: group.total,
        status: "pending",
        businessId: group.businessId,
        businessName: group.businessName,
        businessPhone: group.businessPhone,
        stockDescontado: true,
        date: new Date(),
      });
      orders.push(order);
      if (io && group.businessOwner) {
        io.to(`user_${group.businessOwner}`).emit("newOrder", { orderId: order._id });
      }
    }

    cart.items = [];
    cart.updatedAt = new Date();
    await cart.save();

    res.json({
      success: true,
      orders: orders.map(o => ({ orderId: o._id, total: o.total, businessName: o.businessName })),
      total: orders.reduce((acc, o) => acc + o.total, 0),
    });
  } catch (err) {
    console.error("Error checkout:", err);
    res.status(500).json({ message: "Error al procesar el pedido" });
  }
});

module.exports = router;
