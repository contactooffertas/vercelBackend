// authController/productController.js
const Product  = require("../models/productoModel");
const Business = require("../models/businessModel");
const Featured = require("../models/featuredModel");
const User     = require("../models/userModel");
const cloudinary = require("../config/cloudinary");
const fs = require("fs");

function getPushNotifier() {
  return require("../routes/pushRoute").notifyBusinessFollowers;
}

/* ── Helper: notificación en BD ───────────────────────────────────────────── */
async function createDBNotification(userId, title, message, type = "general", meta = {}) {
  try {
    let Notification;
    try { Notification = require("../models/notificationModel"); } catch (_) { return; }
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) {
    console.error("[createDBNotification]", err.message);
  }
}

function calcularDistanciaKM(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BIZ_SELECT = "name city logo blocked verified rating totalRatings followers phone location address featuredPaid featuredUntil cuotaSuscriptor";

function mapBusiness(p) {
  const { businessId, ...rest } = p;
  return { ...rest, business: businessId ?? null };
}

// ─────────────────────────────────────────────
// RUTAS PRIVADAS
// ─────────────────────────────────────────────

exports.getMyProducts = async (req, res) => {
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) return res.json([]);
    const products = await Product.find({ businessId: business._id });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error al obtener tus productos" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) return res.status(400).json({ message: "Crea tu negocio primero" });
    if (!business.location?.coordinates?.length)
      return res.status(400).json({ message: "Tu negocio no tiene ubicación. Editá tu negocio y agregá una dirección." });

    let imageUrl = null, publicId = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "products" });
      imageUrl = result.secure_url;
      publicId = result.public_id;
      fs.unlinkSync(req.file.path);
    }

    const { price, discount, stock, deliveryRadius, originalPrice, ...rest } = req.body;
    const newProduct = await Product.create({
      ...rest,
      price:          parseFloat(price),
      originalPrice:  originalPrice ? parseFloat(originalPrice) : null,
      discount:       parseFloat(discount || 0),
      stock:          parseInt(stock || 10),
      deliveryRadius: parseFloat(deliveryRadius || 0),
      user:           req.user.id,
      businessId:     business._id,
      image:          imageUrl,
      imagePublicId:  publicId,
      location:       { type: "Point", coordinates: business.location.coordinates },
      blocked:        false,
      blockedReason:  "",
    });

    getPushNotifier()({
      businessId:      business._id.toString(),
      businessName:    business.name,
      productName:     newProduct.name,
      productId:       newProduct._id.toString(),
      productImageUrl: newProduct.image,
    }).catch(() => {});

    res.status(201).json(newProduct);
  } catch (err) {
    res.status(500).json({ message: "Error creando producto", detail: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    if (req.file) {
      if (product.imagePublicId) await cloudinary.uploader.destroy(product.imagePublicId);
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "products" });
      product.image = result.secure_url;
      product.imagePublicId = result.public_id;
      fs.unlinkSync(req.file.path);
    }

    const { price, discount, stock, deliveryRadius, originalPrice, ...rest } = req.body;
    if (price !== undefined)          product.price          = parseFloat(price);
    if (originalPrice !== undefined)  product.originalPrice  = originalPrice ? parseFloat(originalPrice) : null;
    if (discount !== undefined)       product.discount       = parseFloat(discount);
    if (stock !== undefined)          product.stock          = parseInt(stock);
    if (deliveryRadius !== undefined) product.deliveryRadius = parseFloat(deliveryRadius);

    // Nunca permitir que el vendedor se desbloquee a sí mismo vía este endpoint
    const { blocked, blockedReason, ...safeRest } = rest;
    Object.assign(product, safeRest);

    if (product.businessId) {
      const biz = await Business.findById(product.businessId).select("location");
      if (biz?.location?.coordinates?.length)
        product.location = { type: "Point", coordinates: biz.location.coordinates };
    }

    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Error actualizando producto", detail: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });
    if (product.imagePublicId) await cloudinary.uploader.destroy(product.imagePublicId);
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Producto eliminado" });
  } catch (err) {
    res.status(500).json({ message: "Error eliminando producto" });
  }
};

// ─────────────────────────────────────────────
// ENVIAR PRODUCTO A REVISIÓN
// PATCH /api/products/:id/request-review
// Permite al vendedor enviar un producto bloqueado a revisión del admin
// Body: { note?: string }
// ─────────────────────────────────────────────
exports.requestProductReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { note = "" } = req.body;

    const product = await Product.findById(id).populate("businessId", "name owner");
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    // Verificar que el producto pertenece al usuario autenticado
    const business = await Business.findOne({ owner: req.user.id });
    if (!business || product.businessId?._id?.toString() !== business._id.toString()) {
      return res.status(403).json({ message: "No tenés permiso para gestionar este producto" });
    }

    if (!product.blocked) {
      return res.status(400).json({ message: "El producto no está bloqueado" });
    }

    if (product.blockType === "permanent") {
      return res.status(400).json({ message: "Este producto tiene un bloqueo permanente y no puede ser enviado a revisión" });
    }

    if (product.underReview) {
      return res.status(400).json({ message: "Este producto ya está bajo revisión" });
    }

    product.underReview = true;
    product.reviewNote  = note;
    await product.save();

    // Notificar a todos los admins via socket
    const io = req.app.get("io");
    if (io) {
      io.to("admins").emit("product_review_requested", {
        productId:    product._id,
        productName:  product.name,
        businessName: product.businessId?.name || "",
        sellerNote:   note,
        message:      `⚠️ El vendedor solicitó revisión para el producto "${product.name}"`,
      });
    }

    // Notificación en BD para admins
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    for (const admin of admins) {
      await createDBNotification(
        admin._id,
        "⚠️ Revisión de producto solicitada",
        `El vendedor solicitó revisión para "${product.name}". Nota: ${note || "Sin nota"}`,
        "product_review",
        { productId: product._id, businessName: product.businessId?.name }
      );
    }

    res.json({ message: "Producto enviado a revisión. El equipo lo revisará pronto.", product });
  } catch (err) {
    console.error("requestProductReview:", err);
    res.status(500).json({ message: "Error enviando a revisión", error: err.message });
  }
};

// ─────────────────────────────────────────────
// HELPERS DE FILTRADO
// ─────────────────────────────────────────────

function estaEnRango({ p, userLat, userLng, hasUserLocation, maxUserRadiusKM }) {
  if (!hasUserLocation) return !p.deliveryRadius || p.deliveryRadius === 0;

  const refLat = p.location?.coordinates?.[1] ?? p.business?.location?.coordinates?.[1];
  const refLng = p.location?.coordinates?.[0] ?? p.business?.location?.coordinates?.[0];

  if (refLat == null || refLng == null) return !p.deliveryRadius || p.deliveryRadius === 0;

  const dist = calcularDistanciaKM(userLat, userLng, refLat, refLng);

  if (p.deliveryRadius && p.deliveryRadius > 0) return dist <= p.deliveryRadius;
  if (maxUserRadiusKM && maxUserRadiusKM > 0)   return dist <= maxUserRadiusKM;
  return true;
}

function interleaveProducts(featured, organic, featuredEvery = 4) {
  const result = [];
  let fi = 0;
  let oi = 0;

  while (oi < organic.length || fi < featured.length) {
    for (let i = 0; i < featuredEvery && oi < organic.length; i++, oi++) {
      result.push(organic[oi]);
    }
    if (fi < featured.length) {
      result.push(featured[fi++]);
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// RUTAS PÚBLICAS
// ─────────────────────────────────────────────

exports.getFeaturedProducts = async (req, res) => {
  try {
    const { lat, lng, userRadius, userId, limit } = req.query;
    const now = new Date();
    const MAX_PER_BIZ    = 3;
    const FEATURED_EVERY = 4;

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const hasUserLocation = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng);
    const maxUserRadiusKM = userRadius ? parseInt(userRadius) / 1000 : null;
    const maxResults = parseInt(limit) || 40;

    const featuredIndividual = await Product.find({
      featuredPaid:  true,
      featuredUntil: { $gte: now },
      blocked:       { $ne: true },
    })
      .populate("businessId", BIZ_SELECT)
      .lean();

    const featuredIndividualIds = new Set(featuredIndividual.map(p => p._id.toString()));

    const featuredBizDocs = await Business.find({
      featuredPaid:  true,
      featuredUntil: { $gte: now },
      blocked:       { $ne: true },
    }).select("_id").lean();

    const featuredBizIds = featuredBizDocs.map(b => b._id);
    let featuredByBiz = [];

    if (featuredBizIds.length) {
      const allBizProducts = await Product.find({
        businessId: { $in: featuredBizIds },
        _id:        { $nin: [...featuredIndividualIds] },
        blocked:    { $ne: true },
      })
        .populate("businessId", BIZ_SELECT)
        .lean();

      const countPerBiz = {};
      featuredByBiz = allBizProducts.filter(p => {
        const bizId = p.businessId?._id?.toString();
        if (!bizId) return false;
        countPerBiz[bizId] = (countPerBiz[bizId] || 0) + 1;
        return countPerBiz[bizId] <= MAX_PER_BIZ;
      });
    }

    const allFeatured = [
      ...featuredIndividual.map(p => ({ ...mapBusiness(p), _featuredSource: "product" })),
      ...featuredByBiz.map(p =>     ({ ...mapBusiness(p), _featuredSource: "business" })),
    ]
      .filter(p => !p.business?.blocked)
      .map(p => ({
        ...p,
        _outOfRange: hasUserLocation && !estaEnRango({ p, userLat, userLng, hasUserLocation, maxUserRadiusKM }),
        _isFeatured: true,
      }));

    allFeatured.sort((a, b) => Number(a._outOfRange) - Number(b._outOfRange));

    const excludeIds = new Set([
      ...featuredIndividual.map(p => p._id.toString()),
      ...featuredByBiz.map(p => p._id.toString()),
    ]);

    let followedIds = new Set();
    if (userId) {
      try {
        const u = await User.findById(userId).select("followingBusinesses").lean();
        if (u?.followingBusinesses?.length)
          followedIds = new Set(u.followingBusinesses.map(id => id.toString()));
      } catch { /* silencioso */ }
    }

    let organicForMix = [];
    if (allFeatured.length > 0) {
      const organicRaw = await Product.find({
        _id:          { $nin: [...excludeIds] },
        featuredPaid: { $ne: true },
        blocked:      { $ne: true },
      })
        .limit(maxResults * 3)
        .populate("businessId", BIZ_SELECT)
        .lean();

      const organicMapped = organicRaw
        .map(mapBusiness)
        .filter(p => {
          if (p.business?.blocked) return false;
          const bizId = p.business?._id?.toString();
          if (bizId && followedIds.has(bizId)) return true;
          return estaEnRango({ p, userLat, userLng, hasUserLocation, maxUserRadiusKM });
        })
        .map(p => ({ ...p, _isFeatured: false }));

      organicMapped.sort((a, b) => {
        const aF = followedIds.has(a.business?._id?.toString()) ? 1 : 0;
        const bF = followedIds.has(b.business?._id?.toString()) ? 1 : 0;
        if (aF !== bF) return bF - aF;
        return (b.business?.rating ?? 0) - (a.business?.rating ?? 0);
      });

      organicForMix = organicMapped;
    }

    const mixed = allFeatured.length > 0
      ? interleaveProducts(allFeatured, organicForMix, FEATURED_EVERY)
      : [];

    res.json({
      products: mixed.slice(0, maxResults),
      featuredCount: allFeatured.length,
      hasMoreOrganic: organicForMix.length > maxResults,
    });
  } catch (err) {
    console.error("getFeaturedProducts:", err);
    res.status(500).json({ message: err.message });
  }
};

function buildOrganicQuery(excludeIds, category, search, businessId) {
  const query = {
    blocked: { $ne: true },
  };
  if (excludeIds?.length) query._id = { $nin: excludeIds };
  if (category)   query.category   = category;
  if (search)     query.name       = { $regex: search, $options: "i" };
  if (businessId) query.businessId = businessId;
  return query;
}

exports.getPublicProducts = async (req, res) => {
  try {
    const { lat, lng, category, search, businessId, limit, userId, userRadius, excludeIds } = req.query;

    const parsedExclude = excludeIds ? JSON.parse(excludeIds) : [];
    const maxResults    = parseInt(limit) || 100;
    const query         = buildOrganicQuery(parsedExclude, category, search, businessId);

    const raw      = await Product.find(query).limit(maxResults * 3).populate("businessId", BIZ_SELECT).lean();
    const products = raw.map(mapBusiness);

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const hasUserLocation = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng);
    const maxUserRadiusKM = userRadius ? parseInt(userRadius) / 1000 : null;

    let followedIds = new Set();
    if (userId) {
      try {
        const u = await User.findById(userId).select("followingBusinesses").lean();
        if (u?.followingBusinesses?.length)
          followedIds = new Set(u.followingBusinesses.map(id => id.toString()));
      } catch { /* silencioso */ }
    }

    const filtered = products.filter(p => {
      if (p.business?.blocked) return false;
      const bizId = p.business?._id?.toString();
      if (bizId && followedIds.has(bizId)) return true;
      return estaEnRango({ p, userLat, userLng, hasUserLocation, maxUserRadiusKM });
    });

    filtered.sort((a, b) => {
      const aFoll = followedIds.has(a.business?._id?.toString()) ? 1 : 0;
      const bFoll = followedIds.has(b.business?._id?.toString()) ? 1 : 0;
      if (aFoll !== bFoll) return bFoll - aFoll;
      return (b.business?.rating ?? 0) - (a.business?.rating ?? 0);
    });

    res.json({ products: filtered.slice(0, maxResults) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getRandomProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const { lat, lng, userId, userRadius, excludeIds } = req.query;

    const parsedExclude = excludeIds ? JSON.parse(excludeIds) : [];
    const matchQuery    = buildOrganicQuery(parsedExclude);

    const raw       = await Product.aggregate([{ $match: matchQuery }, { $sample: { size: limit * 3 } }]);
    const populated = await Product.populate(raw, { path: "businessId", select: BIZ_SELECT });
    const products  = populated.map(mapBusiness);

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const hasUserLocation = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng);
    const maxUserRadiusKM = userRadius ? parseInt(userRadius) / 1000 : null;

    let followedIds = new Set();
    if (userId) {
      try {
        const u = await User.findById(userId).select("followingBusinesses").lean();
        if (u?.followingBusinesses?.length)
          followedIds = new Set(u.followingBusinesses.map(id => id.toString()));
      } catch { /* silencioso */ }
    }

    const filtered = products.filter(p => {
      if (p.business?.blocked) return false;
      const bizId = p.business?._id?.toString();
      if (bizId && followedIds.has(bizId)) return true;
      return estaEnRango({ p, userLat, userLng, hasUserLocation, maxUserRadiusKM });
    });

    filtered.sort((a, b) => {
      const aFoll = followedIds.has(a.business?._id?.toString()) ? 1 : 0;
      const bFoll = followedIds.has(b.business?._id?.toString()) ? 1 : 0;
      if (aFoll !== bFoll) return bFoll - aFoll;
      return (b.business?.rating ?? 0) - (a.business?.rating ?? 0);
    });

    res.json({ products: filtered.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getFeaturedBusinesses = async (req, res) => {
  try {
    const now = new Date();
    const featured = await Featured.find({ active: true, paid: true, endDate: { $gte: now } })
      .populate({
        path: "business",
        select: "name city logo verified rating totalRatings followers description totalProducts location address blocked featuredPaid featuredUntil cuotaSuscriptor",
      })
      .lean();
    res.json(featured.filter(f => f.business && !f.business.blocked));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPublicStats = async (req, res) => {
  try {
    const [totalProducts, totalBusinesses] = await Promise.all([
      Product.countDocuments({ blocked: { $ne: true } }),
      Business.countDocuments({ blocked: { $ne: true } }),
    ]);
    res.json({ totalProducts, totalBusinesses });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};