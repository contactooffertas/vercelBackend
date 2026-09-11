const express  = require("express");
const router   = express.Router();
const auth     = require("../middleware/authMiddleware");
const Order    = require("../models/orderModel");
const Business = require("../models/businessModel");
const User     = require("../models/userModel");

function Product() {
  return require("mongoose").model("Product");
}

router.post("/", auth, async (req, res) => {
  try {
    const Prod = Product();
    const { items, businessId, businessName, businessPhone, total } = req.body;

    // ── PASO 1: Verificar y descontar stock de forma atómica ──────────────
    for (const item of items) {
      const updated = await Prod.findOneAndUpdate(
        {
          _id:   item.product,
          stock: { $gte: item.quantity },
        },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );

      if (!updated) {
        return res.status(400).json({
          message: `Stock insuficiente para "${item.name}". Verificá la cantidad disponible e intentá de nuevo.`,
        });
      }
    }

    // ── PASO 2: Crear la orden (stock ya reservado) ───────────────────────
    const order = await Order.create({
      user:          req.user.id,
      items,
      businessId,
      businessName,
      businessPhone,
      total,
      status:        "pending",
    });

    // ── PASO 3: Notificar al vendedor via socket ──────────────────────────
    const io = req.app.get("io");
    if (io && businessId) {
      const biz = await Business.findById(businessId).select("owner").lean();
      if (biz) {
        io.to(`user_${biz.owner}`).emit("newOrder", { orderId: order._id });
      }
    }

    res.status(201).json({ message: "Orden creada con éxito", order });
  } catch (err) {
    console.error("Error POST /orders:", err);
    res.status(500).json({ message: "Error al crear la orden" });
  }
});

// ─── GET /api/orders/my ───────────────────────────────────────────────────
router.get("/my", auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    const formatted = orders.map(o => ({
      _id:           o._id,
      date:          o.date || o.createdAt,
      total:         o.total,
      status:        o.status,
      businessName:  o.businessName  || "",
      businessPhone: o.businessPhone || "",
      businessId:    o.businessId    || null,
      buyerRating:   o.buyerRating   || null,
      sellerRating:  o.sellerRating  || null,
      items: o.items.map(i => ({
        productId: i.product,
        name:      i.name,
        quantity:  i.quantity,
        price:     i.price,
      })),
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error /orders/my:", err);
    res.status(500).json({ message: "Error al obtener pedidos" });
  }
});

// ─── GET /api/orders/seller ───────────────────────────────────────────────
router.get("/seller", auth, async (req, res) => {
  try {
    const Prod     = Product();
    const business = await Business.findOne({ owner: req.user.id }).lean();

    const myProducts = business
      ? await Prod.find({ businessId: business._id }).select("_id").lean()
      : [];
    const myProductIds = myProducts.map(p => p._id.toString());

    let orders = [];
    if (business) {
      orders = await Order.find({
        $or: [
          { businessName: business.name },
          { businessId: business._id },
          { "items.product": { $in: myProductIds } },
        ],
      })
        .populate("user", "name email avatar buyerRating buyerTotalRatings")
        .sort({ createdAt: -1 })
        .lean();
    } else {
      orders = await Order.find({ "items.product": { $in: myProductIds } })
        .populate("user", "name email avatar buyerRating buyerTotalRatings")
        .sort({ createdAt: -1 })
        .lean();
    }

    const seen   = new Set();
    const unique = orders.filter(o => {
      const id = o._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const formatted = unique.map(o => ({
      _id:           o._id,
      date:          o.date || o.createdAt,
      total:         o.total,
      status:        o.status,
      businessName:  o.businessName  || "",
      businessPhone: o.businessPhone || "",
      buyerRating:   o.buyerRating   || null,
      sellerRating:  o.sellerRating  || null,
      buyer: {
        _id:               o.user?._id,
        name:              o.user?.name  || "Comprador",
        email:             o.user?.email || "",
        avatar:            o.user?.avatar || "",
        buyerRating:       o.user?.buyerRating       || 0,
        buyerTotalRatings: o.user?.buyerTotalRatings || 0,
      },
      items: o.items
        .filter(i => myProductIds.includes(i.product?.toString()))
        .map(i => ({
          productId: i.product,
          name:      i.name,
          quantity:  i.quantity,
          price:     i.price,
        })),
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error /orders/seller:", err);
    res.status(500).json({ message: "Error al obtener pedidos del vendedor" });
  }
});

// ─── PAGOS EXTERNOS: BNA / BANCO SANTA FE ───────────────────────────────
// Rosario Market no procesa tarjetas ni guarda credenciales bancarias.
// El regreso del comprador solo pasa el pago a "verifying". El vendedor
// confirma después de verificar la acreditación en su proveedor.

router.post("/:id/payment/start", auth, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!["bna", "santafe"].includes(provider)) {
      return res.status(400).json({ message: "Medio de pago inválido" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });
    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "No autorizado" });
    }

    const business = await Business.findById(order.businessId).select("paymentMethods name").lean();
    if (!business) return res.status(404).json({ message: "Negocio no encontrado" });

    const config = business.paymentMethods?.[provider];
    if (!config?.enabled || !config?.paymentLink) {
      return res.status(400).json({ message: "Este negocio no tiene habilitado ese medio de pago." });
    }

    order.payment.method = provider;
    order.payment.status = "pending";
    order.payment.providerUrl = config.paymentLink;
    order.payment.externalReference = order._id.toString();
    order.payment.initiatedAt = new Date();
    order.payment.returnedAt = null;
    order.payment.confirmedAt = null;
    order.payment.confirmedBy = null;
    await order.save();

    res.json({
      orderId: order._id,
      provider,
      redirectUrl: config.paymentLink,
      returnUrl: `https://www.rosariomarket.com.ar/pago/retorno?orderId=${order._id}&provider=${provider}`,
      paymentStatus: order.payment.status,
      message: "Pago iniciado. Al volver, quedará en verificación hasta confirmar la acreditación.",
    });
  } catch (err) {
    console.error("Error /payment/start:", err);
    res.status(500).json({ message: "Error iniciando el pago" });
  }
});

router.patch("/:id/payment/returned", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });
    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "No autorizado" });
    }
    if (!["bna", "santafe"].includes(order.payment?.method)) {
      return res.status(400).json({ message: "La orden no tiene un pago bancario iniciado." });
    }
    if (order.payment.status === "paid") {
      return res.json({ message: "El pago ya está confirmado.", payment: order.payment });
    }

    order.payment.status = "verifying";
    order.payment.returnedAt = new Date();
    await order.save();

    const business = await Business.findById(order.businessId).select("owner").lean();
    const io = req.app.get("io");
    if (io && business?.owner) {
      io.to(`user_${business.owner}`).emit("paymentVerificationRequested", { orderId: order._id });
    }

    res.json({
      message: "Recibimos tu aviso de pago. El vendedor debe confirmar la acreditación antes del envío.",
      payment: order.payment,
    });
  } catch (err) {
    console.error("Error /payment/returned:", err);
    res.status(500).json({ message: "Error registrando el regreso del pago" });
  }
});

router.patch("/:id/payment/confirm", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    const business = await Business.findOne({ owner: req.user.id }).lean();
    if (!business || order.businessId?.toString() !== business._id.toString()) {
      return res.status(403).json({ message: "No autorizado" });
    }
    if (!["pending", "verifying"].includes(order.payment?.status)) {
      return res.status(400).json({ message: "El pago no está pendiente de confirmación." });
    }

    order.payment.status = "paid";
    order.payment.confirmedAt = new Date();
    order.payment.confirmedBy = req.user.id;
    if (order.status === "pending") order.status = "confirmed";
    await order.save();

    const io = req.app.get("io");
    if (io) io.to(`user_${order.user}`).emit("paymentConfirmed", { orderId: order._id });

    res.json({
      message: "Pago confirmado. El pedido ya puede prepararse y despacharse.",
      order,
    });
  } catch (err) {
    console.error("Error /payment/confirm:", err);
    res.status(500).json({ message: "Error confirmando el pago" });
  }
});

router.patch("/:id/payment/reject", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    const business = await Business.findOne({ owner: req.user.id }).lean();
    if (!business || order.businessId?.toString() !== business._id.toString()) {
      return res.status(403).json({ message: "No autorizado" });
    }

    order.payment.status = "rejected";
    await order.save();

    res.json({ message: "Pago marcado como no acreditado.", order });
  } catch (err) {
    res.status(500).json({ message: "Error actualizando el pago" });
  }
});

router.patch("/:id/payment/refund-request", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });
    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({ message: "No autorizado" });
    }
    if (order.payment?.status !== "paid") {
      return res.status(400).json({ message: "Solo podés solicitar devolución de un pago confirmado." });
    }

    order.payment.refundStatus = "requested";
    order.payment.refundRequestedAt = new Date();
    await order.save();

    res.json({
      message: "Solicitud registrada. La devolución monetaria se procesa en el mismo proveedor de pago.",
      payment: order.payment,
    });
  } catch (err) {
    res.status(500).json({ message: "Error solicitando devolución" });
  }
});

router.patch("/:id/payment/refunded", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    const business = await Business.findOne({ owner: req.user.id }).lean();
    if (!business || order.businessId?.toString() !== business._id.toString()) {
      return res.status(403).json({ message: "No autorizado" });
    }

    order.payment.status = "refunded";
    order.payment.refundStatus = "refunded";
    order.payment.refundedAt = new Date();
    await order.save();

    res.json({
      message: "Devolución marcada como realizada. El reintegro debe haberse ejecutado en el proveedor.",
      order,
    });
  } catch (err) {
    res.status(500).json({ message: "Error registrando la devolución" });
  }
});

// ─── PATCH /api/orders/:id/ship ───────────────────────────────────────────
// Stock no se toca — ya fue descontado al crear la orden.
router.patch("/:id/ship", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.payment?.method && order.payment.method !== "direct" && order.payment.status !== "paid") {
      return res.status(400).json({
        message: "No podés despachar este pedido hasta que el pago esté confirmado.",
        code: "PAYMENT_NOT_CONFIRMED",
      });
    }

    order.status = "shipped";
    await order.save();

    const io = req.app.get("io");
    if (io) io.to(`user_${order.user}`).emit("orderShipped", { orderId: order._id });

    res.json({ message: "Pedido marcado como enviado", order });
  } catch (err) {
    console.error("Error /ship:", err);
    res.status(500).json({ message: "Error al despachar pedido" });
  }
});

// ─── PATCH /api/orders/:id/keep ───────────────────────────────────────────
// Comprador confirma recepción → delivered. Stock no se toca (venta definitiva).
// NUEVO: notifica al vendedor via socket.
router.patch("/:id/keep", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.user.toString() !== req.user.id)
      return res.status(403).json({ message: "No autorizado" });

    order.status = "delivered";
    await order.save();

    // ── Notificar al vendedor que el pedido fue recibido ──────────────────
    const io = req.app.get("io");
    if (io && order.businessId) {
      const biz = await Business.findById(order.businessId).select("owner").lean();
      if (biz) {
        io.to(`user_${biz.owner}`).emit("orderDelivered", { orderId: order._id });
      }
    }

    res.json({ message: "Pedido finalizado como entregado", order });
  } catch (err) {
    console.error("Error /keep:", err);
    res.status(500).json({ message: "Error al actualizar pedido" });
  }
});

// ─── PATCH /api/orders/:id/return ────────────────────────────────────────
// Comprador devuelve → returned. Se restaura el stock de cada item.
router.patch("/:id/return", auth, async (req, res) => {
  try {
    const Prod  = Product();
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.user.toString() !== req.user.id)
      return res.status(403).json({ message: "No autorizado" });

    order.status = "returned";
    await order.save();

    for (const item of order.items) {
      if (item.product) {
        await Prod.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
      }
    }

    res.json({ message: "Devolución procesada y stock restituido", order });
  } catch (err) {
    console.error("Error /return:", err);
    res.status(500).json({ message: "Error al procesar devolución" });
  }
});

// ─── DELETE /api/orders/:id ───────────────────────────────────────────────
router.delete("/:id", auth, async (req, res) => {
  try {
    const Prod  = Product();
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (!["delivered", "returned"].includes(order.status))
      return res.status(400).json({ message: "Solo podés borrar órdenes finalizadas" });

    const business     = await Business.findOne({ owner: req.user.id }).lean();
    const myProducts   = business ? await Prod.find({ businessId: business._id }).select("_id").lean() : [];
    const myProductIds = myProducts.map(p => p._id.toString());

    const isBuyer  = order.user.toString() === req.user.id;
    const isSeller = order.items.some(i => myProductIds.includes(i.product?.toString()));

    if (!isBuyer && !isSeller)
      return res.status(403).json({ message: "No autorizado" });

    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: "Orden eliminada del historial" });
  } catch (err) {
    console.error("Error /delete order:", err);
    res.status(500).json({ message: "Error al eliminar la orden" });
  }
});

// ─── POST /api/orders/:id/rate-seller ────────────────────────────────────
router.post("/:id/rate-seller", auth, async (req, res) => {
  try {
    const { rating, comment = "" } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Rating debe ser entre 1 y 5" });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.user.toString() !== req.user.id)
      return res.status(403).json({ message: "No autorizado" });

    if (order.status !== "delivered")
      return res.status(400).json({ message: "Solo podés calificar órdenes entregadas" });

    if (order.sellerRating?.rating)
      return res.status(400).json({ message: "Ya calificaste este pedido" });

    order.sellerRating = { rating, comment, ratedAt: new Date() };
    await order.save();

    let biz = null;
    if (order.businessId) biz = await Business.findById(order.businessId);
    if (!biz && order.businessName) biz = await Business.findOne({ name: order.businessName });

    if (biz) {
      const newTotal = (biz.totalRatings || 0) + 1;
      const newSum   = (biz.ratingSum    || 0) + rating;
      await Business.findByIdAndUpdate(biz._id, {
        totalRatings: newTotal,
        ratingSum:    newSum,
        rating:       Math.round((newSum / newTotal) * 10) / 10,
      });
    }

    res.json({ message: "Calificación enviada al negocio", sellerRating: order.sellerRating });
  } catch (err) {
    console.error("Error /rate-seller:", err);
    res.status(500).json({ message: "Error al calificar" });
  }
});

// ─── POST /api/orders/:id/rate-buyer ─────────────────────────────────────
router.post("/:id/rate-buyer", auth, async (req, res) => {
  try {
    const { rating, comment = "" } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Rating debe ser entre 1 y 5" });

    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Orden no encontrada" });

    if (order.status !== "delivered")
      return res.status(400).json({ message: "Solo podés calificar órdenes entregadas" });

    const business = await Business.findOne({ owner: req.user.id }).lean();
    if (!business) return res.status(403).json({ message: "No sos vendedor" });

    const isSeller =
      order.businessId?.toString() === business._id.toString() ||
      order.businessName === business.name;
    if (!isSeller) return res.status(403).json({ message: "No autorizado" });

    if (order.buyerRating?.rating)
      return res.status(400).json({ message: "Ya calificaste a este comprador" });

    await Order.findByIdAndUpdate(req.params.id, {
      buyerRating: { rating, comment, ratedAt: new Date() },
    });

    const buyer = await User.findById(order.user);
    if (buyer) {
      const newTotal = (buyer.buyerTotalRatings || 0) + 1;
      const newSum   = (buyer.buyerRatingSum    || 0) + rating;
      await User.findByIdAndUpdate(order.user, {
        buyerTotalRatings: newTotal,
        buyerRatingSum:    newSum,
        buyerRating:       Math.round((newSum / newTotal) * 10) / 10,
      });
    }

    res.json({ message: "Calificación enviada al comprador" });
  } catch (err) {
    console.error("Error /rate-buyer:", err);
    res.status(500).json({ message: "Error al calificar" });
  }
});

module.exports = router;
