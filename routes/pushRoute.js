// routes/pushRoute.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const webpush = require("web-push");
const PushSub = require("../models/pushsuscriptionmodel");
const User = require("../models/userModel");
const FcmDevice = require('../models/fcmDeviceModel');

function firebaseMessaging() {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (!raw) return null;
      const credentials = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(credentials) });
    }
    return admin.messaging();
  } catch (err) { console.error('[FCM init]', err.message); return null; }
}

// ── Configurar VAPID (generá las keys con: npx web-push generate-vapid-keys) ──
webpush.setVapidDetails(
  `mailto:ala282016@gmail.com`,
  "BLR8fiu0VNED_-qHI0rOQn_UPEtJptD4wiYJXuBQxgBhFFRf_SvU54F95IBaBG86V-cv3wwZ4l_NlLD236io1rw",
  "aGmJeLDh7nI-_FnpDVVhrx2Yk8xDa80unM1b1t__MB8",
);

// Diagnostic contains no credential material. It verifies that the deployed
// backend and the Android app point to the same Firebase project.
router.get("/fcm/diagnostics", (_req, res) => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return res.status(503).json({
      configured: false,
      expectedProjectId: "rosariomarket-fdd7d",
      error: "FIREBASE_SERVICE_ACCOUNT_JSON is missing",
    });
  }
  try {
    const credentials = JSON.parse(raw);
    const projectId = credentials.project_id || "";
    const messaging = firebaseMessaging();
    return res.status(messaging ? 200 : 503).json({
      configured: Boolean(messaging),
      projectId,
      expectedProjectId: "rosariomarket-fdd7d",
      projectMatches: projectId === "rosariomarket-fdd7d",
    });
  } catch (error) {
    return res.status(503).json({
      configured: false,
      expectedProjectId: "rosariomarket-fdd7d",
      error: "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON",
    });
  }
});

// ─── POST /api/push/subscribe ─────────────────────────────────────────────
// El browser llama esto cuando el user acepta notificaciones
router.post("/subscribe", auth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({ message: "Suscripción inválida" });
    }

    // Upsert: si ya existe el endpoint lo actualiza, si no lo crea
    await PushSub.findOneAndUpdate(
      { "subscription.endpoint": subscription.endpoint },
      { user: req.user.id, subscription },
      { upsert: true, new: true },
    );

    res.json({ message: "Suscripción guardada" });
  } catch (err) {
    console.error("Error /push/subscribe:", err);
    res.status(500).json({ message: "Error guardando suscripción" });
  }
});

// ─── DELETE /api/push/unsubscribe ─────────────────────────────────────────
router.delete("/unsubscribe", auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSub.deleteOne({
      "subscription.endpoint": endpoint,
      user: req.user.id,
    });
    res.json({ message: "Suscripción eliminada" });
  } catch (err) {
    res.status(500).json({ message: "Error eliminando suscripción" });
  }
});

router.post('/fcm/register', auth, async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token.length < 80) return res.status(400).json({ message: 'Token FCM inválido' });
  await FcmDevice.findOneAndUpdate({ token }, { user: req.user.id, platform: 'android', active: true, lastSeenAt: new Date() }, { upsert: true, new: true });
  await User.findByIdAndUpdate(req.user.id, { notificationsEnabled: true, pushEnabled: true });
  res.json({ ok: true });
});

router.delete('/fcm/unregister', auth, async (req, res) => {
  const token = String(req.body.token || '').trim();
  await FcmDevice.deleteOne({ token, user: req.user.id }); res.json({ ok: true });
});

// ─── PUT /api/push/location ───────────────────────────────────────────────
// Guarda la ubicación del usuario en su documento de User
router.put("/location", auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ message: "lat y lng son requeridos" });
    }

    await User.findByIdAndUpdate(req.user.id, {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      locationEnabled: true,
    });

    res.json({ message: "Ubicación guardada", lat, lng });
  } catch (err) {
    console.error("Error /push/location:", err);
    res.status(500).json({ message: "Error guardando ubicación" });
  }
});

// ─── Función exportada para enviar push a seguidores de un negocio ────────
// La llama productController cuando se crea un producto nuevo
async function notifyBusinessFollowers({
  businessId,
  businessName,
  productName,
  productId,
  productImageUrl,
}) {
  try {
    // Buscar todos los usuarios que siguen este negocio
    const followers = await User.find({
      followingBusinesses: businessId,
    })
      .select("_id")
      .lean();

    if (!followers.length) return;

    const followerIds = followers.map((f) => f._id);

    // Buscar todas las suscripciones push de esos usuarios
    const subs = await PushSub.find({ user: { $in: followerIds } }).lean();

    if (!subs.length) return;

       const payload = JSON.stringify({
  title: `🔥 Nueva oferta en ${businessName}`,
  body: `${productName} ya está disponible. Tocá para verla antes que se agote 👀`,
  url: `/negocio/${businessId}`,
  icon: "https://ofert.vercel.app/assets/offerton.jpg",
  badge: "https://ofert.vercel.app/assets/offerton.jpg",
  image: productImageUrl, // imagen real del producto (clave para impacto)
  vibrate: [200, 100, 200],
  tag: `producto-${businessId}`,
  renotify: true,
  requireInteraction: false
});
    // Enviar a todos en paralelo, ignorar los que fallen (token expirado, etc.)
    const sends = subs.map(async (doc) => {
      try {
        await webpush.sendNotification(doc.subscription, payload);
      } catch (err) {
        // Si el endpoint ya no existe (410 Gone), borrarlo
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSub.deleteOne({ _id: doc._id });
        }
      }
    });

    await Promise.allSettled(sends);
    console.log(
      `[Push] Notificaciones enviadas a ${subs.length} dispositivos — negocio: ${businessName}`,
    );
  } catch (err) {
    console.error("[Push] Error notifyBusinessFollowers:", err);
  }
}

async function notifyUsers(userIds, data) {
  const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
  if (!ids.length) return;
  const subs = await PushSub.find({ user: { $in: ids } }).lean();
  const payload = JSON.stringify({
    title: data.title || 'Rosario Market', body: data.body || '', url: data.url || '/',
    icon: data.icon || 'https://www.rosariomarket.com.ar/assets/offerton-192.png',
    badge: 'https://www.rosariomarket.com.ar/assets/offerton-192.png',
    tag: data.tag || 'rm-message', renotify: true, vibrate: [180, 80, 180],
    badgeCount: Number(data.badgeCount || 1), type: data.type || 'general',
  });
  await Promise.allSettled(subs.map(async doc => {
    try { await webpush.sendNotification(doc.subscription, payload); }
    catch (err) { if ([404, 410].includes(err.statusCode)) await PushSub.deleteOne({ _id: doc._id }); }
  }));
  const messaging = firebaseMessaging();
  if (messaging) {
    const devices = await FcmDevice.find({ user: { $in: ids }, active: true }).lean();
    await Promise.allSettled(devices.map(async device => {
      try {
        // Data-only: Android always wakes RosarioMessagingService, even when
        // the WebView/app is backgrounded. This is required for the native
        // notification, launcher badge and delivery acknowledgement to share
        // one reliable code path.
        await messaging.send({
          token: device.token,
          data: {
            title: String(data.title || 'Rosario Market'),
            body: String(data.body || 'Tenés una notificación nueva'),
            url: String(data.url || '/'),
            icon: String(data.icon || ''),
            image: String(data.image || ''),
            conversationId: String(data.conversationId || ''),
            messageId: String(data.messageId || ''),
            badgeCount: String(data.badgeCount || 1),
            type: String(data.type || 'general'),
            tag: String(data.messageId || data.tag || ('rm-' + Date.now())),
          },
          android: {
            priority: 'high',
            ttl: 86400000,
          },
        });
      } catch (err) {
        console.error('[FCM send]', {
          code: err.code || 'unknown',
          message: err.message,
          user: String(device.user),
        });
        if (['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(err.code)) await FcmDevice.deleteOne({ _id: device._id });
      }
    }));
  }
}

module.exports = { router, notifyBusinessFollowers, notifyUsers };
