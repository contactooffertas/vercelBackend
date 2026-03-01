// authController/adminController.js
const User     = require("../models/userModel");
const Business = require("../models/businessModel");
const Featured = require("../models/featuredModel");
const Product  = require("../models/productoModel");

/* ── Helper: obtener instancia io ──────────────────────────────────────────── */
function getIO(req) {
  return req.app.get("io");
}

/* ── Helper: notificación persistente en BD ────────────────────────────────── */
async function createDBNotification(userId, title, message, type = "general", meta = {}) {
  try {
    let Notification;
    try { Notification = require("../models/notificationModel"); } catch (_) { return; }
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) {
    console.error("[createDBNotification]", err.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   MIDDLEWARE
═══════════════════════════════════════════════════════════════════════════════ */
exports.requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Acceso denegado" });
  next();
};

/* ════════════════════════════════════════════════════════════════════════════
   DASHBOARD — GET /api/admin/stats
═══════════════════════════════════════════════════════════════════════════════ */
exports.getDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const [
      totalUsers, totalBusinesses, totalProducts,
      activeFeaturedBiz, activeFeaturedProducts,
      blockedUsers, blockedBusinesses,
    ] = await Promise.all([
      User.countDocuments(),
      Business.countDocuments(),
      Product.countDocuments(),
      Featured.countDocuments({ active: true, paid: true, endDate: { $gte: now } }),
      Product.countDocuments({ featuredPaid: true, featuredUntil: { $gte: now } }),
      User.countDocuments({ blocked: true }),
      Business.countDocuments({ blocked: true }),
    ]);

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name email role createdAt");

    res.json({
      totalUsers, totalBusinesses, totalProducts,
      activeFeaturedBiz, activeFeaturedProducts,
      blockedUsers, blockedBusinesses,
      recentUsers,
    });
  } catch (err) {
    console.error("getDashboardStats:", err);
    res.status(500).json({ message: "Error obteniendo stats" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   USUARIOS
═══════════════════════════════════════════════════════════════════════════════ */
exports.getAllUsers = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 20 } = req.query;
    const query = search
      ? { $or: [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }] }
      : {};
    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .select("-password -verificationCode"),
      User.countDocuments(query),
    ]);
    res.json({ users, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: "Error obteniendo usuarios" });
  }
};

exports.toggleBlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    if (user.role === "admin") return res.status(400).json({ message: "No se puede bloquear a un admin" });
    user.blocked = !user.blocked;
    await user.save();
    res.json({ message: user.blocked ? "Usuario bloqueado" : "Usuario desbloqueado", blocked: user.blocked });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.changeUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!["user", "seller", "admin"].includes(role))
      return res.status(400).json({ message: "Rol inválido" });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-password");
    res.json({ message: "Rol actualizado", user });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   NEGOCIOS
═══════════════════════════════════════════════════════════════════════════════ */
exports.getAllBusinesses = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 20 } = req.query;
    const query = search ? { name: { $regex: search, $options: "i" } } : {};
    const now   = new Date();

    const [businesses, total] = await Promise.all([
      Business.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .populate("owner", "name email"),
      Business.countDocuments(query),
    ]);

    const withFeatured = await Promise.all(
      businesses.map(async (b) => {
        const featured = await Featured.findOne({
          business: b._id, active: true, endDate: { $gte: now },
        });
        const featuredProductsCount = await Product.countDocuments({
          businessId: b._id,
          featuredPaid: true,
          featuredUntil: { $gte: now },
        });
        return { ...b.toObject(), featuredInfo: featured || null, featuredProductsCount };
      })
    );

    res.json({ businesses: withFeatured, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: "Error obteniendo negocios" });
  }
};

exports.toggleVerifyBusiness = async (req, res) => {
  try {
    const biz = await Business.findById(req.params.id);
    if (!biz) return res.status(404).json({ message: "Negocio no encontrado" });
    biz.verified = !biz.verified;
    await biz.save();
    res.json({ message: biz.verified ? "Negocio verificado" : "Verificación removida", verified: biz.verified });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.toggleBlockBusiness = async (req, res) => {
  try {
    const { reason } = req.body;
    const biz = await Business.findById(req.params.id);
    if (!biz) return res.status(404).json({ message: "Negocio no encontrado" });

    const wasBlocked = biz.blocked;
    biz.blocked       = !biz.blocked;
    biz.blockedReason = biz.blocked ? (reason || "Bloqueado por administrador") : null;

    if (biz.blocked && !wasBlocked) {
      // Recién bloqueado: resetear apelación para que el dueño pueda apelar
      biz.appealStatus    = "none";
      biz.appealNote      = null;
      biz.appealAdminNote = null;
    }
    if (!biz.blocked) {
      // Desbloqueado manualmente: limpiar apelación pendiente si hubiera
      biz.appealStatus     = "none";
      biz.appealNote       = null;
      biz.appealAdminNote  = null;
      biz.appealResolvedAt = new Date();
    }

    await biz.save();

    // Notificar al dueño si fue desbloqueado
    if (!biz.blocked && wasBlocked) {
      const io = getIO(req);
      const ownerId = biz.owner;
      if (io && ownerId) {
        const msg = `✅ Tu negocio "${biz.name}" fue desbloqueado por el equipo de administración.`;
        io.to(`user_${ownerId.toString()}`).emit("business_unblocked", {
          businessId: biz._id, businessName: biz.name, message: msg,
        });
        io.to(`user:${ownerId.toString()}`).emit("business_unblocked", {
          businessId: biz._id, businessName: biz.name, message: msg,
        });
        await createDBNotification(ownerId, "✅ Negocio desbloqueado", msg, "business_unblocked", { businessId: biz._id });
      }
    }

    res.json({ message: biz.blocked ? "Negocio bloqueado" : "Negocio desbloqueado", blocked: biz.blocked });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   APELACIONES DE NEGOCIO
═══════════════════════════════════════════════════════════════════════════════ */

// GET /api/admin/business-appeals
// Lista todos los negocios con apelación pendiente
exports.getBusinessAppeals = async (req, res) => {
  try {
    const businesses = await Business.find({ appealStatus: "pending" })
      .populate("owner", "name email")
      .sort({ appealSubmittedAt: 1 })
      .lean();
    res.json({ businesses });
  } catch (err) {
    console.error("getBusinessAppeals:", err);
    res.status(500).json({ message: "Error obteniendo apelaciones" });
  }
};

// PATCH /api/admin/businesses/:id/appeal
// Body: { action: 'approve' | 'reject', adminNote?: string }
exports.resolveBusinessAppeal = async (req, res) => {
  try {
    const { id }                     = req.params;
    const { action, adminNote = "" } = req.body;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usá "approve" o "reject"' });
    }

    const biz = await Business.findById(id).populate("owner", "_id name email");
    if (!biz) return res.status(404).json({ message: "Negocio no encontrado" });

    if (biz.appealStatus !== "pending") {
      return res.status(400).json({ message: "Este negocio no tiene una apelación pendiente" });
    }

    const ownerId = biz.owner?._id;
    const io      = getIO(req);

    if (action === "approve") {
      biz.blocked          = false;
      biz.blockedReason    = null;
      biz.appealStatus     = "reviewed";
      biz.appealAdminNote  = adminNote.trim() || null;
      biz.appealResolvedAt = new Date();
      await biz.save();

      if (io && ownerId) {
        const payload = {
          businessId:   biz._id,
          businessName: biz.name,
          message:      `✅ ¡Tu negocio "${biz.name}" fue desbloqueado! Tu apelación fue aprobada.${adminNote ? ` Nota: ${adminNote}` : ""}`,
          adminNote:    adminNote.trim() || null,
        };
        io.to(`user_${ownerId.toString()}`).emit("business_appeal_approved", payload);
        io.to(`user:${ownerId.toString()}`).emit("business_appeal_approved", payload);
      }

      if (ownerId) {
        await createDBNotification(
          ownerId,
          "✅ Negocio desbloqueado",
          `Tu apelación para "${biz.name}" fue aprobada. Tu negocio volvió a estar activo.`,
          "business_unblocked",
          { businessId: biz._id, adminNote: adminNote.trim() }
        );
      }

      return res.json({
        message:  `Negocio "${biz.name}" desbloqueado y vendedor notificado`,
        business: { _id: biz._id, blocked: biz.blocked, appealStatus: biz.appealStatus },
      });
    }

    // ── reject ────────────────────────────────────────────────────────────
    biz.appealStatus     = "rejected";
    biz.appealAdminNote  = adminNote.trim() || null;
    biz.appealResolvedAt = new Date();
    await biz.save();

    if (io && ownerId) {
      const payload = {
        businessId:   biz._id,
        businessName: biz.name,
        message:      `❌ Tu apelación para "${biz.name}" fue rechazada. Tu negocio sigue bloqueado.${adminNote ? ` Nota: ${adminNote}` : ""}`,
        adminNote:    adminNote.trim() || null,
      };
      io.to(`user_${ownerId.toString()}`).emit("business_appeal_rejected", payload);
      io.to(`user:${ownerId.toString()}`).emit("business_appeal_rejected", payload);
    }

    if (ownerId) {
      await createDBNotification(
        ownerId,
        "❌ Apelación rechazada",
        `Tu apelación para "${biz.name}" fue rechazada.${adminNote ? " Nota: " + adminNote : ""}`,
        "business_appeal_rejected",
        { businessId: biz._id, adminNote: adminNote.trim() }
      );
    }

    res.json({
      message:  `Apelación rechazada para "${biz.name}"`,
      business: { _id: biz._id, blocked: biz.blocked, appealStatus: biz.appealStatus },
    });
  } catch (err) {
    console.error("resolveBusinessAppeal:", err);
    res.status(500).json({ message: "Error al resolver la apelación" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   DESTACADOS — NEGOCIOS
═══════════════════════════════════════════════════════════════════════════════ */
exports.getAllFeatured = async (req, res) => {
  try {
    const now      = new Date();
    const featured = await Featured.find({ active: true, endDate: { $gte: now } })
      .populate({
        path:     "business",
        select:   "name city logo verified owner",
        populate: { path: "owner", select: "name email" },
      })
      .populate("addedBy", "name")
      .sort({ endDate: 1 });
    res.json(featured);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.setFeatured = async (req, res) => {
  try {
    const { businessId, type, days, note, paid = false } = req.body;
    const biz = await Business.findById(businessId);
    if (!biz) return res.status(404).json({ message: "Negocio no encontrado" });

    const durationMap  = { daily: 1, weekly: 7, monthly: 30 };
    const durationDays = type === "custom" ? Number(days) : (durationMap[type] || 7);
    if (!durationDays || durationDays <= 0)
      return res.status(400).json({ message: "Días inválidos" });

    const startDate = new Date();
    const endDate   = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    await Featured.updateMany({ business: businessId, active: true }, { active: false });

    const featured = await Featured.create({
      business: businessId, type, startDate, endDate,
      active: true, paid: Boolean(paid), days: durationDays, note, addedBy: req.user.id,
    });

    biz.featured      = Boolean(paid);
    biz.featuredPaid  = Boolean(paid);
    biz.featuredDays  = durationDays;
    biz.featuredUntil = Boolean(paid) ? endDate : null;
    await biz.save();

    res.status(201).json({
      message: paid ? `Negocio destacado por ${durationDays} días` : "Destacado pendiente de pago",
      featured,
    });
  } catch (err) {
    console.error("setFeatured:", err);
    res.status(500).json({ message: "Error" });
  }
};

exports.confirmFeaturedPayment = async (req, res) => {
  try {
    const feat = await Featured.findById(req.params.featuredId).populate("business");
    if (!feat) return res.status(404).json({ message: "No encontrado" });
    if (feat.paid) return res.status(400).json({ message: "Ya confirmado" });
    feat.paid = true;
    await feat.save();
    await Business.findByIdAndUpdate(feat.business._id, {
      featured: true, featuredPaid: true, featuredUntil: feat.endDate,
    });
    res.json({ message: "Pago confirmado. Negocio visible en todo el país.", feat });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.removeFeatured = async (req, res) => {
  try {
    await Featured.updateMany({ business: req.params.businessId, active: true }, { active: false });
    await Business.findByIdAndUpdate(req.params.businessId, {
      featured: false, featuredPaid: false, featuredDays: 0, featuredUntil: null,
    });
    res.json({ message: "Destacado de negocio removido" });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   DESTACADOS — PRODUCTOS
═══════════════════════════════════════════════════════════════════════════════ */
exports.getAllFeaturedProducts = async (req, res) => {
  try {
    const now      = new Date();
    const products = await Product.find({ featured: true, featuredUntil: { $gte: now } })
      .populate("businessId", "name city logo verified blocked")
      .sort({ featuredUntil: 1 })
      .lean();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.searchProducts = async (req, res) => {
  try {
    const { q = "", businessId, limit = 30 } = req.query;
    const query = {};
    if (q)          query.name       = { $regex: q, $options: "i" };
    if (businessId) query.businessId = businessId;
    const products = await Product.find(query)
      .limit(Number(limit))
      .populate("businessId", "name city logo")
      .select("name price image category featured featuredPaid featuredUntil businessId cuotaSuscriptor")
      .lean();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error buscando productos" });
  }
};

exports.getBusinessProducts = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { q = "" }     = req.query;
    const now            = new Date();

    const query = { businessId };
    if (q) query.name = { $regex: q, $options: "i" };

    const products = await Product.find(query)
      .select("name price image category featured featuredPaid featuredUntil featuredDays businessId")
      .lean();

    const enriched = products.map(p => ({
      ...p,
      isActivelyFeatured: !!(p.featuredPaid && p.featuredUntil && new Date(p.featuredUntil) >= now),
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: "Error obteniendo productos del negocio" });
  }
};

exports.setFeaturedProduct = async (req, res) => {
  try {
    const { productId, days, note, paid = false } = req.body;
    if (!productId) return res.status(400).json({ message: "productId requerido" });

    const durationDays = Number(days);
    if (!durationDays || durationDays <= 0)
      return res.status(400).json({ message: "Días inválidos" });

    const product = await Product.findById(productId).populate("businessId", "name blocked");
    if (!product)                    return res.status(404).json({ message: "Producto no encontrado" });
    if (product.businessId?.blocked) return res.status(400).json({ message: "El negocio está bloqueado" });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    product.featured      = true;
    product.featuredPaid  = Boolean(paid);
    product.featuredDays  = durationDays;
    product.featuredUntil = Boolean(paid) ? endDate : null;
    await product.save();

    res.status(201).json({
      message: paid ? `Producto destacado por ${durationDays} días` : "Producto marcado, pendiente de pago",
      product,
    });
  } catch (err) {
    console.error("setFeaturedProduct:", err);
    res.status(500).json({ message: "Error" });
  }
};

exports.setFeaturedProductsBulk = async (req, res) => {
  try {
    const { productIds, days, note, paid = false } = req.body;
    if (!productIds?.length) return res.status(400).json({ message: "productIds requerido" });

    const durationDays = Number(days);
    if (!durationDays || durationDays <= 0)
      return res.status(400).json({ message: "Días inválidos" });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    const results = await Promise.allSettled(
      productIds.map(async (productId) => {
        const product = await Product.findById(productId).populate("businessId", "name blocked");
        if (!product)                    throw new Error(`Producto ${productId} no encontrado`);
        if (product.businessId?.blocked) throw new Error("Negocio bloqueado");
        product.featured      = true;
        product.featuredPaid  = Boolean(paid);
        product.featuredDays  = durationDays;
        product.featuredUntil = Boolean(paid) ? endDate : null;
        await product.save();
        return product;
      })
    );

    const succeeded = results.filter(r => r.status === "fulfilled").length;
    const failed    = results.filter(r => r.status === "rejected").length;

    res.status(201).json({
      message: `${succeeded} producto(s) destacado(s)${failed > 0 ? `, ${failed} error(es)` : ""}`,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error("setFeaturedProductsBulk:", err);
    res.status(500).json({ message: "Error" });
  }
};

exports.confirmFeaturedProductPayment = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product)             return res.status(404).json({ message: "Producto no encontrado" });
    if (!product.featured)    return res.status(400).json({ message: "No está marcado como destacado" });
    if (product.featuredPaid) return res.status(400).json({ message: "Ya confirmado" });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (product.featuredDays || 7));
    product.featuredPaid  = true;
    product.featuredUntil = endDate;
    await product.save();

    res.json({ message: "Pago confirmado. Producto visible como destacado.", product });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

exports.removeFeaturedProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });
    product.featured      = false;
    product.featuredPaid  = false;
    product.featuredDays  = 0;
    product.featuredUntil = null;
    await product.save();
    res.json({ message: "Destacado de producto removido" });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   PRODUCTOS BAJO REVISIÓN
═══════════════════════════════════════════════════════════════════════════════ */

// GET /api/admin/products/under-review
exports.getProductsUnderReview = async (req, res) => {
  try {
    const products = await Product.find({ blocked: true, underReview: true })
      .populate("businessId", "name city logo owner")
      .populate("user", "name email")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ products });
  } catch (err) {
    console.error("getProductsUnderReview:", err);
    res.status(500).json({ message: "Error obteniendo productos bajo revisión" });
  }
};

// PATCH /api/admin/products/:productId/moderate
// Body: { action: 'unblock' | 'keep_blocked' | 'permanent_block', adminNote?: string }
exports.moderateProduct = async (req, res) => {
  try {
    const { productId }              = req.params;
    const { action, adminNote = "" } = req.body;

    if (!["unblock", "keep_blocked", "permanent_block"].includes(action)) {
      return res.status(400).json({ message: "Acción inválida. Use: unblock, keep_blocked, permanent_block" });
    }

    const product = await Product.findById(productId)
      .populate("businessId", "name owner")
      .populate("user", "name email");

    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    const io      = getIO(req);
    const ownerId = product.businessId?.owner || product.user?._id || null;

    let updateOp   = {};
    let notifTitle = "";
    let notifMsg   = "";
    let notifType  = "";

    switch (action) {
      case "unblock":
        updateOp = {
          $set: {
            blocked:       false,
            blockedReason: "",
            underReview:   false,
            reviewNote:    "",
            adminNote:     adminNote || "Revisión aprobada — producto visible nuevamente.",
          },
          $unset: { blockType: "" },
        };
        notifTitle = "✅ Producto desbloqueado";
        notifMsg   = adminNote
          ? `✅ Tu producto "${product.name}" fue revisado y aprobado. Nota: ${adminNote}`
          : `✅ Tu producto "${product.name}" fue aprobado y está visible nuevamente.`;
        notifType  = "product_approved";
        break;

      case "keep_blocked":
        updateOp = {
          $set: {
            underReview: false,
            reviewNote:  "",
            adminNote:   adminNote || "Revisión rechazada — el producto no cumple las políticas.",
          },
        };
        notifTitle = "🔒 Revisión rechazada";
        notifMsg   = adminNote
          ? `🔒 Tu solicitud de revisión para "${product.name}" fue rechazada. Nota: ${adminNote}`
          : `🔒 Tu solicitud de revisión para "${product.name}" fue rechazada. El producto sigue bloqueado.`;
        notifType  = "product_rejected";
        break;

      case "permanent_block":
        updateOp = {
          $set: {
            underReview:   false,
            reviewNote:    "",
            blockType:     "permanent",
            blockedReason: adminNote || "Bloqueo permanente por violación grave de políticas",
            adminNote:     adminNote || "Bloqueo permanente aplicado.",
          },
        };
        notifTitle = "🚫 Bloqueo permanente";
        notifMsg   = adminNote
          ? `🚫 Tu producto "${product.name}" fue bloqueado permanentemente. Motivo: ${adminNote}`
          : `🚫 Tu producto "${product.name}" fue bloqueado permanentemente por violar las políticas.`;
        notifType  = "product_permanent_block";
        break;
    }

    await Product.updateOne({ _id: productId }, updateOp);

    const updatedProduct = await Product.findById(productId)
      .populate("businessId", "name owner")
      .populate("user", "name email")
      .lean();

    if (ownerId && io) {
      io.to(`user_${ownerId.toString()}`).emit("product_moderated", {
        productId, productName: product.name, action, message: notifMsg,
      });
      io.to(`user:${ownerId.toString()}`).emit("product_moderated", {
        productId, productName: product.name, action, message: notifMsg,
      });
    }

    if (ownerId) {
      await createDBNotification(ownerId, notifTitle, notifMsg, notifType, { productId, action });
    }

    const messages = {
      unblock:         "Producto desbloqueado y visible al público",
      keep_blocked:    "Producto mantenido bloqueado (revisión rechazada)",
      permanent_block: "Bloqueo permanente aplicado",
    };

    res.json({ message: messages[action], product: updatedProduct });
  } catch (err) {
    console.error("moderateProduct:", err);
    res.status(500).json({ message: "Error moderando producto", error: err.message });
  }
};

// DELETE /api/admin/products/:productId
exports.adminDeleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId)
      .populate("businessId", "name owner")
      .populate("user", "name email");

    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    const io      = getIO(req);
    const ownerId = product.businessId?.owner || product.user?._id || null;

    if (ownerId) {
      const msg = `🗑️ Tu producto "${product.name}" fue eliminado por el equipo de moderación.`;
      io?.to(`user_${ownerId.toString()}`).emit("product_deleted_admin", {
        productId: product._id, productName: product.name, message: msg,
      });
      io?.to(`user:${ownerId.toString()}`).emit("product_deleted_admin", {
        productId: product._id, productName: product.name, message: msg,
      });
      await createDBNotification(ownerId, "🗑️ Producto eliminado", msg, "product_deleted", { productId: product._id });
    }

    if (product.imagePublicId) {
      try {
        const cloudinary = require("../config/cloudinary");
        await cloudinary.uploader.destroy(product.imagePublicId);
      } catch (_) {}
    }

    await Product.findByIdAndDelete(productId);
    res.json({ message: "Producto eliminado por el administrador" });
  } catch (err) {
    console.error("adminDeleteProduct:", err);
    res.status(500).json({ message: "Error eliminando producto", error: err.message });
  }
};