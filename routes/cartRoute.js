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

function formatItems(cartItems) {
  return cartItems.map(i => {
    // Si el item no tiene product populado (borrado) lo salteamos
    if (!i.product ||!i.product._id) return null;
    return {
      _id: i._id,
      productId: i.product._id,
      name: i.product.name,
      price: i.price, // este es el que importa: 52000 si fue flash
      originalPrice: i.originalPrice || i.product.originalPrice || i.product.price,
      discount: i.discount,
      image: i.product.image,
      stock: i.product.stock || 99,
      quantity: i.quantity,
      isFlashOffer: i.isFlashOffer || false,
      businessId: i.product.businessId?._id || i.product.businessId || null,
      businessName: i.product.businessId?.name || null,
      businessPhone: i.product.businessId?.phone || "",
    };
  }).filter(Boolean);
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
    const { productId, quantity = 1 } = req.body;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });

    // ── ACA ESTA EL FIX ──
    // Si el producto tiene flashOffer activa, esa manda SIEMPRE
    const hasFlash = product.flashOffer && product.flashOffer.active === true;
    const basePrice = product.originalPrice || product.price; // 65000 en tu ejemplo

    let finalPrice;
    let finalOriginalPrice;
    let finalDiscount;
    let finalIsFlash;

    if (hasFlash) {
      finalOriginalPrice = basePrice; // 65000
      finalDiscount = product.flashOffer.discount; // 20
      finalPrice = basePrice * (1 - finalDiscount / 100); // 65000 * 0.8 = 52000
      finalIsFlash = true;
    } else {
      // Precio normal
      finalOriginalPrice = product.originalPrice || product.price;
      finalDiscount = product.discount || 0;
      finalPrice = product.price; // 61750 (tu precio ya con 5%)
      finalIsFlash = false;
    }

    const existingIndex = cart.items.findIndex(i => i.product.toString() === productId);

    if (existingIndex > -1) {
      // Si ya existe, actualizamos cantidad Y PISAMOS EL PRECIO con el nuevo (52k)
      cart.items[existingIndex].quantity = Math.min(product.stock || 99, cart.items[existingIndex].quantity + quantity);
      cart.items[existingIndex].price = finalPrice;
      cart.items[existingIndex].originalPrice = finalOriginalPrice;
      cart.items[existingIndex].discount = finalDiscount;
      cart.items[existingIndex].isFlashOffer = finalIsFlash;
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
    console.error("ADD CART ERROR:", err);
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

      // ACA USAMOS EL PRECIO GUARDADO (52000), NO RECALCULAMOS
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
