// routes/cart.js
const express = require("express");
const router = express.Router();
const Cart = require("../models/cartModel");
const Product = require("../models/productoModel");
const auth = require("../middleware/authMiddleware");
const AffiliateOffer = require("../models/AffiliateOffer");
const AffiliateOfferApplication = require("../models/AffiliateOfferApplication");
const AffiliateSale = require("../models/AffiliateSale");

const PRODUCT_POPULATE = {
  path: "items.product",
  select: "name price originalPrice discount image stock businessId flashOffer",
  populate: {
    path: "businessId",
    select: "name city logo phone",
  },
};

// Precio final que paga el comprador por un item del carrito, aplicando
// descuento normal o precio flash. Esta es la MISMA lógica que usa el
// frontend (panel.tsx -> getFinalPrice) para mostrar el carrito. Se usa
// tanto para mostrar el carrito como para calcular el total de la orden
// en el checkout, así los dos números SIEMPRE coinciden.
function getFinalUnitPrice(item) {
  if (item.isFlashOffer) return item.price;
  if (item.discount) return item.price * (1 - item.discount / 100);
  return item.price;
}

function formatItems(cartItems) {
  return cartItems.map(i => {
    // Si el item no tiene product populado (borrado) lo salteamos
    if (!i.product || !i.product._id) return null;
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
      affiliateCode: i.affiliateCode || null,
    };
  }).filter(Boolean);
}

// Valida que el código de afiliado corresponda a una afiliación ACEPTADA
// para ese producto puntual. Si no es válido (vencido, inventado, oferta
// desactivada, etc.) devuelve null y el item se agrega como venta normal,
// sin acreditarle nada a nadie.
async function resolveAffiliateCode(productId, affiliateCode) {
  if (!affiliateCode) return null;
  try {
    const offer = await AffiliateOffer.findOne({ product: productId, active: true }).select("_id").lean();
    if (!offer) return null;
    const application = await AffiliateOfferApplication.findOne({
      offer: offer._id,
      affiliateCode,
      status: "accepted",
    }).select("_id").lean();
    return application ? affiliateCode : null;
  } catch {
    return null;
  }
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
    const { productId, quantity = 1, affiliateCode } = req.body;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) cart = new Cart({ user: req.user.id, items: [] });

    // Si el producto tiene flashOffer activa, esa manda SIEMPRE
    const hasFlash = product.flashOffer && product.flashOffer.active === true;
    const basePrice = product.originalPrice || product.price;

    let finalPrice;
    let finalOriginalPrice;
    let finalDiscount;
    let finalIsFlash;

    if (hasFlash) {
      finalOriginalPrice = basePrice;
      finalDiscount = product.flashOffer.discount;
      finalPrice = basePrice * (1 - finalDiscount / 100);
      finalIsFlash = true;
    } else {
      // Precio normal: guardamos el precio BASE + el % de descuento por
      // separado. El precio final con descuento se calcula siempre con
      // getFinalUnitPrice(), tanto para mostrar el carrito como para
      // armar la orden en el checkout.
      finalOriginalPrice = product.originalPrice || product.price;
      finalDiscount = product.discount || 0;
      finalPrice = product.price;
      finalIsFlash = false;
    }

    // Programa de Afiliados: validamos el ?ref= contra una afiliación
    // aceptada para este producto puntual antes de confiar en él.
    const validAffiliateCode = await resolveAffiliateCode(productId, affiliateCode);

    const existingIndex = cart.items.findIndex(i => i.product.toString() === productId);

    if (existingIndex > -1) {
      // Si ya existe, actualizamos cantidad Y PISAMOS EL PRECIO con el nuevo
      cart.items[existingIndex].quantity = Math.min(product.stock || 99, cart.items[existingIndex].quantity + quantity);
      cart.items[existingIndex].price = finalPrice;
      cart.items[existingIndex].originalPrice = finalOriginalPrice;
      cart.items[existingIndex].discount = finalDiscount;
      cart.items[existingIndex].isFlashOffer = finalIsFlash;
      // Si esta vez vino con un ref válido, lo actualizamos (última visita manda).
      // Si no vino ref pero ya tenía uno guardado, lo conservamos.
      if (validAffiliateCode) cart.items[existingIndex].affiliateCode = validAffiliateCode;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        price: finalPrice,
        originalPrice: finalOriginalPrice,
        discount: finalDiscount,
        isFlashOffer: finalIsFlash,
        affiliateCode: validAffiliateCode,
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

    cart.items = cart.items.filter(i => i.product.toString() !== req.params.productId);
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

      // ACA ESTA EL FIX: aplicamos el descuento (o precio flash) al
      // precio unitario, igual que hace el frontend con getFinalPrice().
      // Antes se usaba i.price "a secas", que es el precio BASE sin
      // descontar, y por eso la orden quedaba con el precio de $65 en
      // vez del $61 que se veía en el carrito.
      const unitPrice = getFinalUnitPrice(i);

      groupsByBusiness[bizId].items.push({
        product: i.product._id,
        name: i.product.name,
        price: unitPrice,
        quantity: i.quantity,
        affiliateCode: i.affiliateCode || null,
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

      // ── Programa de Afiliados: acreditar la venta con detalle real ──────
      // Por cada item que llegó con un affiliateCode válido: sumamos el
      // contador legacy (salesCount, se sigue usando en otros lados de la
      // UI) y además creamos un AffiliateSale con el producto, cantidad,
      // precio y comisión exactos de ESA venta puntual, para que tanto el
      // vendedor como el afiliado puedan ver el detalle y no solo un
      // número acumulado.
      for (const item of group.items) {
        if (!item.affiliateCode) continue;
        try {
          const application = await AffiliateOfferApplication.findOneAndUpdate(
            { affiliateCode: item.affiliateCode, status: "accepted" },
            { $inc: { salesCount: item.quantity } },
            { new: true }
          );
          if (!application) continue;

          const offerDoc = await AffiliateOffer.findById(application.offer)
            .select("commissionPercentage")
            .lean();
          const commissionPercentage = offerDoc?.commissionPercentage ?? 0;
          const commissionAmount = item.price * item.quantity * (commissionPercentage / 100);

          await AffiliateSale.create({
            application: application._id,
            offer: application.offer,
            seller: application.seller,
            affiliate: application.buyer,
            customer: req.user.id,
            order: order._id,
            product: item.product,
            productName: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            commissionPercentage,
            commissionAmount,
          });
        } catch (affErr) {
          console.error("[cart/checkout] Error acreditando venta a afiliado:", affErr.message);
        }
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
