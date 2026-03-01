const Business = require("../models/businessModel");
const User = require("../models/userModel");
const Product = require("../models/productoModel");
const cloudinary = require("../config/cloudinary");
const fs = require("fs");

const VALID_CATEGORIES = [
  "tecnologia", "ropa", "alimentos", "hogar",
  "deportes", "belleza", "mascotas", "juguetes",
];

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;


console.log("✅ [businessController] Módulo cargado correctamente");
console.log("🔑 [businessController] GOOGLE_KEY presente:", !!GOOGLE_KEY);

/* ── HELPERS GOOGLE ──────────────────────────────────────────────────────────*/
async function googleAutocomplete(input, userLat, userLng) {
  try {
    const params = new URLSearchParams({
      input,
      key:        GOOGLE_KEY,
      language:   "es",
      components: "country:ar",
    });
    if (userLat && userLng) {
      params.append("location", `${userLat},${userLng}`);
      params.append("radius", "50000");
    }
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Autocomplete error:", data.status, data.error_message);
      return [];
    }
    return (data.predictions || []).map((p) => ({
      label:       p.description,
      placeId:     p.place_id,
      description: p.description,
    }));
  } catch (e) {
    console.error("googleAutocomplete error:", e);
    return [];
  }
}

async function googlePlaceDetails(placeId) {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      key:      GOOGLE_KEY,
      language: "es",
      fields:   "formatted_address,geometry,name",
    });
    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK") {
      console.error("Google Place Details error:", data.status);
      return null;
    }
    const result = data.result;
    return {
      label:   result.formatted_address,
      lat:     result.geometry.location.lat,
      lng:     result.geometry.location.lng,
      address: result.formatted_address,
    };
  } catch (e) {
    console.error("googlePlaceDetails error:", e);
    return null;
  }
}

async function googleGeocode(address) {
  try {
    const params = new URLSearchParams({
      address:    address + ", Argentina",
      key:        GOOGLE_KEY,
      language:   "es",
      components: "country:AR",
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Google Geocoding error:", data.status, data.error_message);
      return [];
    }
    return (data.results || []).slice(0, 5).map((r) => ({
      label:   r.formatted_address,
      lat:     r.geometry.location.lat,
      lng:     r.geometry.location.lng,
      address: r.formatted_address,
    }));
  } catch (e) {
    console.error("googleGeocode error:", e);
    return [];
  }
}

/* ── GEOCODIFICACIÓN PREDICTIVA ──────────────────────────────────────────────*/
exports.geocodePredictive = async (req, res) => {
  console.log("📍 [geocodePredictive] Hit →", req.query);
  try {
    if (!GOOGLE_KEY) {
      console.error("❌ [geocodePredictive] GOOGLE_MAPS_API_KEY no configurada");
      return res.status(500).json({ error: "Geocoding no configurado." });
    }
    const { q, placeId, lat, lng } = req.query;
    if (placeId) {
      const details = await googlePlaceDetails(placeId);
      if (!details) return res.json([]);
      return res.json([details]);
    }
    if (!q || q.trim().length < 2) return res.json([]);
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    const suggestions = await googleAutocomplete(q.trim(), userLat, userLng);
    if (suggestions.length > 0) return res.json(suggestions.slice(0, 6));
    const geocoded = await googleGeocode(q.trim());
    return res.json(geocoded.slice(0, 5));
  } catch (error) {
    console.error("❌ [geocodePredictive] Error:", error);
    res.json([]);
  }
};

/* ── UPSERT ──────────────────────────────────────────────────────────────────*/
exports.upsertBusiness = async (req, res) => {
  console.log("💾 [upsertBusiness] Hit → user:", req.user?.id, "| body:", req.body);
  try {
    let logoUrl, logoPublicId;
    if (req.file) {
      const existing = await Business.findOne({ owner: req.user.id });
      if (existing?.logoPublicId) await cloudinary.uploader.destroy(existing.logoPublicId);
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "businesses/logos",
        transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
      });
      logoUrl      = result.secure_url;
      logoPublicId = result.public_id;
      fs.unlinkSync(req.file.path);
    }

    let categories = [];
    if (req.body.categories) {
      try { categories = JSON.parse(req.body.categories); }
      catch { categories = Array.isArray(req.body.categories) ? req.body.categories : [req.body.categories]; }
      categories = categories.filter((c) => VALID_CATEGORIES.includes(c)).slice(0, 2);
    }

    const phone = (req.body.phone || "").trim();
    if (!phone) {
      console.warn("⚠️ [upsertBusiness] Falta phone");
      return res.status(400).json({ message: "El número de celular es obligatorio." });
    }

    const lat     = parseFloat(req.body.lat);
    const lng     = parseFloat(req.body.lng);
    const address = (req.body.address || "").trim();

    if (!req.body.lat || !req.body.lng || isNaN(lat) || isNaN(lng)) {
      console.warn("⚠️ [upsertBusiness] Falta ubicación");
      return res.status(400).json({ message: "La ubicación del negocio es obligatoria." });
    }

    const location   = { type: "Point", coordinates: [lng, lat] };
    const updateData = {
      name: req.body.name, description: req.body.description,
      city: req.body.city, phone, address, location, categories,
      owner: req.user.id,
      ...(logoUrl && { logo: logoUrl, logoPublicId }),
    };

    const business = await Business.findOneAndUpdate(
      { owner: req.user.id }, updateData, { new: true, upsert: true }
    );
    console.log("✅ [upsertBusiness] Guardado → id:", business._id);

    await User.findByIdAndUpdate(req.user.id, { lat, lng, locationEnabled: true });
    await syncProductsLocation(business._id, lng, lat);

    res.json(business);
  } catch (error) {
    console.error("❌ [upsertBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

async function syncProductsLocation(businessId, lng, lat) {
  try {
    await Product.updateMany(
      { businessId },
      { $set: { location: { type: "Point", coordinates: [lng, lat] } } }
    );
  } catch (err) {
    console.error("❌ [syncProductsLocation] Error:", err);
  }
}

/* ── GET MY BUSINESS ─────────────────────────────────────────────────────── */
exports.getMyBusiness = async (req, res) => {
  console.log("🏪 [getMyBusiness] Hit → user:", req.user?.id);
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      console.log("ℹ️ [getMyBusiness] No existe negocio para user:", req.user?.id);
      return res.status(404).json({ message: "No existe negocio" });
    }
    console.log("✅ [getMyBusiness] Encontrado → id:", business._id, "| name:", business.name);
    res.json(business);
  } catch (error) {
    console.error("❌ [getMyBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── GET BY ID (público) ─────────────────────────────────────────────────── */
exports.getBusinessById = async (req, res) => {
  console.log("🔍 [getBusinessById] Hit → id:", req.params.id);
  try {
    const business = await Business.findById(req.params.id);
    if (!business) {
      console.log("ℹ️ [getBusinessById] No encontrado para id:", req.params.id);
      return res.status(404).json({ message: "Negocio no encontrado" });
    }
    console.log("✅ [getBusinessById] Encontrado →", business.name);
    res.json(business);
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ message: "ID inválido" });
    console.error("❌ [getBusinessById] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── FOLLOW ──────────────────────────────────────────────────────────────── */
exports.followBusiness = async (req, res) => {
  console.log("➕ [followBusiness] user:", req.user?.id, "→ biz:", req.params.id);
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await Business.findByIdAndUpdate(id, { $addToSet: { followers: userId } });
    await User.findByIdAndUpdate(userId, { $addToSet: { followingBusinesses: id } });
    const business = await Business.findById(id).select("followers");
    res.json({ followersCount: business.followers.length });
  } catch (error) {
    console.error("❌ [followBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── UNFOLLOW ────────────────────────────────────────────────────────────── */
exports.unfollowBusiness = async (req, res) => {
  console.log("➖ [unfollowBusiness] user:", req.user?.id, "→ biz:", req.params.id);
  try {
    const { id } = req.params;
    const userId = req.user.id;
    await Business.findByIdAndUpdate(id, { $pull: { followers: userId } });
    await User.findByIdAndUpdate(userId, { $pull: { followingBusinesses: id } });
    const business = await Business.findById(id).select("followers");
    res.json({ followersCount: business.followers.length });
  } catch (error) {
    console.error("❌ [unfollowBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── FAVORITE ────────────────────────────────────────────────────────────── */
exports.favoriteBusiness = async (req, res) => {
  console.log("❤️ [favoriteBusiness] user:", req.user?.id, "→ biz:", req.params.id);
  try {
    await User.findByIdAndUpdate(req.user.id, { $addToSet: { favoriteBusinesses: req.params.id } });
    res.json({ saved: true });
  } catch (error) {
    console.error("❌ [favoriteBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── UNFAVORITE ──────────────────────────────────────────────────────────── */
exports.unfavoriteBusiness = async (req, res) => {
  console.log("💔 [unfavoriteBusiness] user:", req.user?.id, "→ biz:", req.params.id);
  try {
    await User.findByIdAndUpdate(req.user.id, { $pull: { favoriteBusinesses: req.params.id } });
    res.json({ saved: false });
  } catch (error) {
    console.error("❌ [unfavoriteBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── RATE ────────────────────────────────────────────────────────────────── */
exports.rateBusiness = async (req, res) => {
  console.log("⭐ [rateBusiness] user:", req.user?.id, "→ biz:", req.params.id, "| rating:", req.body.rating);
  try {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Rating debe ser entre 1 y 5" });

    const userId     = req.user.id;
    const businessId = req.params.id;
    const user       = await User.findById(userId);
    const prevRating = user.ratedBusinesses.find((r) => r.businessId.toString() === businessId);
    const business   = await Business.findById(businessId);
    if (!business) return res.status(404).json({ message: "Negocio no encontrado" });

    if (prevRating) {
      const newSum = business.ratingSum - prevRating.rating + rating;
      const newAvg = newSum / business.totalRatings;
      await Business.findByIdAndUpdate(businessId, { ratingSum: newSum, rating: Math.round(newAvg * 10) / 10 });
      await User.updateOne(
        { _id: userId, "ratedBusinesses.businessId": businessId },
        { $set: { "ratedBusinesses.$.rating": rating } }
      );
    } else {
      const newTotal = business.totalRatings + 1;
      const newSum   = (business.ratingSum || 0) + rating;
      const newAvg   = newSum / newTotal;
      await Business.findByIdAndUpdate(businessId, { totalRatings: newTotal, ratingSum: newSum, rating: Math.round(newAvg * 10) / 10 });
      await User.findByIdAndUpdate(userId, { $push: { ratedBusinesses: { businessId, rating } } });
    }

    const updated = await Business.findById(businessId).select("rating totalRatings");
    res.json({ rating: updated.rating, totalRatings: updated.totalRatings });
  } catch (error) {
    console.error("❌ [rateBusiness] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── SOCIAL STATUS ───────────────────────────────────────────────────────── */
exports.getBusinessSocialStatus = async (req, res) => {
  console.log("📊 [getBusinessSocialStatus] user:", req.user?.id, "→ biz:", req.params.id);
  try {
    const userId     = req.user.id;
    const businessId = req.params.id;
    const user       = await User.findById(userId).select("followingBusinesses favoriteBusinesses ratedBusinesses");
    const business   = await Business.findById(businessId).select("followers rating totalRatings");
    if (!user || !business) return res.status(404).json({ message: "No encontrado" });
    const ratedEntry = user.ratedBusinesses?.find((r) => r.businessId.toString() === businessId);
    res.json({
      following:      user.followingBusinesses.map((id) => id.toString()).includes(businessId),
      saved:          user.favoriteBusinesses.map((id) => id.toString()).includes(businessId),
      myRating:       ratedEntry?.rating || 0,
      followersCount: business.followers.length,
      rating:         business.rating,
      totalRatings:   business.totalRatings,
    });
  } catch (error) {
    console.error("❌ [getBusinessSocialStatus] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ── NEGOCIOS CERCANOS ───────────────────────────────────────────────────── */
exports.getNearbyBusinesses = async (req, res) => {
  try {
    const lat    = parseFloat(req.query.lat);
    const lng    = parseFloat(req.query.lng);
    const radius = parseInt(req.query.radius) || 3000;
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: "Se requieren lat y lng válidos" });
    }
    const businesses = await Business.aggregate([
      {
        $geoNear: {
          near:          { type: "Point", coordinates: [lng, lat] },
          distanceField: "distanceMeters",
          maxDistance:   radius,
          spherical:     true,
          query:         { blocked: { $ne: true } },
        },
      },
      { $limit: 20 },
      {
        $project: {
          name: 1, description: 1, city: 1, logo: 1, rating: 1,
          totalRatings: 1, verified: 1, categories: 1, address: 1,
          phone: 1, followers: 1, distanceMeters: 1,
        },
      },
    ]);
    const result = businesses.map((b) => ({
      ...b,
      distanceLabel: b.distanceMeters < 1000
        ? `${Math.round(b.distanceMeters)} m`
        : `${(b.distanceMeters / 1000).toFixed(1)} km`,
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ── HELPERS NOTIFICACIONES ─────────────────────────────────────────────── */
function getIO(req) { return req.app.get('io'); }

async function createDBNotification(userId, title, message, type = 'general', meta = {}) {
  try {
    const Notification = require('../models/notificationModel');
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (e) {
    console.error("❌ [createDBNotification] Error:", e.message);
  }
}

/* ── APPEAL DEL NEGOCIO (vendedor) ──────────────────────────────────────── */
exports.submitBusinessAppeal = async (req, res) => {
  console.log("📢 [submitBusinessAppeal] Hit → biz:", req.params.id, "| user:", req.user?.id);
  try {
    const { id }         = req.params;
    const { appealNote } = req.body;
    const userId         = req.user.id;

    if (!appealNote?.trim()) {
      return res.status(400).json({ message: 'El mensaje de apelación es obligatorio' });
    }

    const biz = await Business.findById(id).populate('owner', '_id');
    if (!biz) return res.status(404).json({ message: 'Negocio no encontrado' });

    const ownerId = biz.owner?._id?.toString() || biz.owner?.toString();
    if (ownerId !== userId) {
      return res.status(403).json({ message: 'Solo el dueño puede apelar el bloqueo' });
    }
    if (!biz.blocked) {
      return res.status(400).json({ message: 'El negocio no está bloqueado' });
    }
    if (biz.appealStatus === 'pending') {
      return res.status(400).json({ message: 'Ya existe una apelación pendiente' });
    }

    biz.appealStatus      = 'pending';
    biz.appealNote        = appealNote.trim();
    biz.appealSubmittedAt = new Date();
    await biz.save();

    const io = getIO(req);
    if (io) {
      io.to('admins').emit('business_appeal_submitted', {
        businessId: biz._id, businessName: biz.name,
        message: `El negocio "${biz.name}" envió una apelación.`,
        appealNote: appealNote.trim(),
      });
    }

    console.log("✅ [submitBusinessAppeal] Apelación guardada → biz:", biz._id);
    res.json({ message: 'Apelación enviada correctamente', appealStatus: biz.appealStatus, appealNote: biz.appealNote });
  } catch (err) {
    console.error('❌ [submitBusinessAppeal] Error:', err);
    res.status(500).json({ message: 'Error al enviar la apelación' });
  }
};

/* ── ADMIN: LISTAR APELACIONES ───────────────────────────────────────────── */
exports.getBusinessAppeals = async (req, res) => {
  console.log("📋 [getBusinessAppeals] Hit");
  try {
    const businesses = await Business.find({ appealStatus: 'pending' })
      .populate('owner', 'name email')
      .sort({ appealSubmittedAt: 1 })
      .lean();
    console.log("✅ [getBusinessAppeals] Pendientes:", businesses.length);
    res.json({ businesses });
  } catch (err) {
    console.error('❌ [getBusinessAppeals] Error:', err);
    res.status(500).json({ message: 'Error al obtener apelaciones' });
  }
};

/* ── ADMIN: RESOLVER APELACIÓN ───────────────────────────────────────────── */
exports.resolveBusinessAppeal = async (req, res) => {
  console.log("⚖️ [resolveBusinessAppeal] Hit → biz:", req.params.id, "| action:", req.body.action);
  try {
    const { id }                     = req.params;
    const { action, adminNote = '' } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Acción inválida. Usá "approve" o "reject"' });
    }

    const biz = await Business.findById(id).populate('owner', '_id name email');
    if (!biz) return res.status(404).json({ message: 'Negocio no encontrado' });
    if (biz.appealStatus !== 'pending') {
      return res.status(400).json({ message: 'Este negocio no tiene una apelación pendiente' });
    }

    const ownerId = biz.owner?._id;
    const io      = getIO(req);

    if (action === 'approve') {
      biz.blocked          = false;
      biz.blockedReason    = undefined;
      biz.appealStatus     = 'reviewed';
      biz.appealResolvedAt = new Date();
      biz.appealAdminNote  = adminNote.trim() || undefined;
      await biz.save();

      if (io && ownerId) {
        const payload = { businessId: biz._id, businessName: biz.name, message: `✅ Tu negocio "${biz.name}" fue desbloqueado.`, adminNote: adminNote.trim() || null };
        io.to(`user_${ownerId.toString()}`).emit('business_appeal_approved', payload);
        io.to(`user:${ownerId.toString()}`).emit('business_appeal_approved', payload);
      }
      if (ownerId) {
        await createDBNotification(ownerId, '✅ Negocio desbloqueado', `Tu apelación para "${biz.name}" fue aprobada.`, 'business_unblocked', { businessId: biz._id, adminNote: adminNote.trim() });
      }
      console.log("✅ [resolveBusinessAppeal] Aprobada → biz:", biz._id);
      return res.json({ message: `Negocio "${biz.name}" desbloqueado`, business: { _id: biz._id, blocked: biz.blocked, appealStatus: biz.appealStatus } });
    }

    // reject
    biz.appealStatus     = 'rejected';
    biz.appealResolvedAt = new Date();
    biz.appealAdminNote  = adminNote.trim() || undefined;
    await biz.save();

    if (io && ownerId) {
      const payload = { businessId: biz._id, businessName: biz.name, message: `❌ Tu apelación para "${biz.name}" fue rechazada.`, adminNote: adminNote.trim() || null };
      io.to(`user_${ownerId.toString()}`).emit('business_appeal_rejected', payload);
      io.to(`user:${ownerId.toString()}`).emit('business_appeal_rejected', payload);
    }
    if (ownerId) {
      await createDBNotification(ownerId, '❌ Apelación rechazada', `Tu apelación para "${biz.name}" fue rechazada. ${adminNote ? 'Nota: ' + adminNote : ''}`, 'business_appeal_rejected', { businessId: biz._id, adminNote: adminNote.trim() });
    }
    console.log("✅ [resolveBusinessAppeal] Rechazada → biz:", biz._id);
    res.json({ message: `Apelación rechazada para "${biz.name}"`, business: { _id: biz._id, blocked: biz.blocked, appealStatus: biz.appealStatus } });
  } catch (err) {
    console.error('❌ [resolveBusinessAppeal] Error:', err);
    res.status(500).json({ message: 'Error al resolver la apelación' });
  }
};