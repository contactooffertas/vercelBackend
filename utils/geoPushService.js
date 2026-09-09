const webpush = require("web-push");
const PushSub = require("../models/pushsuscriptionmodel");
const User = require("../models/userModel");
const Business = require("../models/businessModel");
const Product = require("../models/productoModel");
const NearbyPushLog = require("../models/nearbyPushLogModel");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.rosariomarket.com.ar";
const DEFAULT_ICON = `${FRONTEND_URL}/assets/offerton-192.png`;
const DEFAULT_BADGE = `${FRONTEND_URL}/assets/offerton-192.png`;

const NEARBY_RADIUS_METERS = 300;
const NEARBY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PRODUCT_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SEND_BATCH_SIZE = 25;

function assetUrl(url, fallback = DEFAULT_ICON) {
  if (!url) return fallback;
  if (/^https?:\/\//i.test(url)) return url;
  return `${FRONTEND_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function sendPayloadToSubscriptions(subs, payload) {
  let delivered = 0;

  for (let i = 0; i < subs.length; i += SEND_BATCH_SIZE) {
    const batch = subs.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (doc) => {
        try {
          await webpush.sendNotification(doc.subscription, JSON.stringify(payload));
          return true;
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await PushSub.deleteOne({ _id: doc._id });
          }
          return false;
        }
      }),
    );

    delivered += results.filter(
      (r) => r.status === "fulfilled" && r.value === true,
    ).length;
  }

  return delivered;
}

async function notifyNearbyBusinessesForUser({ userId, lat, lng }) {
  const user = await User.findById(userId)
    .select("_id notificationsEnabled")
    .lean();

  if (!user?.notificationsEnabled) return { delivered: 0 };

  const subs = await PushSub.find({ user: userId }).lean();
  if (!subs.length) return { delivered: 0 };

  const businesses = await Business.find({
    blocked: { $ne: true },
    suspended: { $ne: true },
    owner: { $ne: userId },
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: NEARBY_RADIUS_METERS,
      },
    },
  })
    .select("_id name logo address categories location")
    .limit(5)
    .lean();

  if (!businesses.length) return { delivered: 0 };

  const cooldownCutoff = new Date(Date.now() - NEARBY_COOLDOWN_MS);

  for (const business of businesses) {
    const recent = await NearbyPushLog.findOne({
      user: userId,
      business: business._id,
      lastSentAt: { $gt: cooldownCutoff },
    })
      .select("_id")
      .lean();

    if (recent) continue;

    const coords = business.location?.coordinates || [];
    const meters = coords.length === 2
      ? Math.round(distanceMeters(lat, lng, coords[1], coords[0]))
      : null;

    const category = business.categories?.[0];
    const body = [
      meters != null ? `A ${meters} m` : "Muy cerca tuyo",
      category,
      business.address,
    ]
      .filter(Boolean)
      .join(" · ");

    const delivered = await sendPayloadToSubscriptions(subs, {
      title: `📍 ${business.name} está cerca tuyo`,
      body: body || "Tenés un negocio de Rosario a pocos pasos.",
      url: `/negocio/${business._id}`,
      icon: assetUrl(business.logo),
      badge: DEFAULT_BADGE,
      tag: `nearby-${business._id}`,
      renotify: false,
      requireInteraction: false,
      vibrate: [120, 60, 120],
      meta: {
        type: "nearby_business",
        businessId: String(business._id),
        distanceMeters: meters,
      },
    });

    if (delivered > 0) {
      await NearbyPushLog.findOneAndUpdate(
        { user: userId, business: business._id },
        { lastSentAt: new Date(), lastDistanceMeters: meters },
        { upsert: true, new: true },
      );
      return { delivered, businessId: business._id, distanceMeters: meters };
    }
  }

  return { delivered: 0 };
}

async function notifyProductAudience(args) {
  try {
    const { businessId, productId } = args;

    const [business, product] = await Promise.all([
      Business.findById(businessId)
        .select("_id name logo location owner")
        .lean(),
      Product.findById(productId)
        .select("_id name image price originalPrice discount category stock")
        .lean(),
    ]);

    if (!business || !product) return;

    const businessName = args.businessName || business.name;
    const businessLogo = args.businessLogo || business.logo;
    const ownerUserId = args.ownerUserId || business.owner;
    const productName = args.productName || product.name;
    const productImageUrl = args.productImageUrl || product.image;
    const price = args.price ?? product.price;
    const originalPrice = args.originalPrice ?? product.originalPrice;
    const discount = args.discount ?? product.discount;
    const category = args.category || product.category;
    const stock = args.stock ?? product.stock;

    const followers = await User.find({
      followingBusinesses: businessId,
      notificationsEnabled: true,
    })
      .select("_id")
      .lean();

    let nearbyUsers = [];
    const coords = business.location?.coordinates || [];

    if (coords.length === 2 && !(coords[0] === 0 && coords[1] === 0)) {
      nearbyUsers = await User.find({
        _id: { $ne: ownerUserId },
        locationEnabled: true,
        notificationsEnabled: true,
        lastLocationAt: {
          $gte: new Date(Date.now() - PRODUCT_LOCATION_MAX_AGE_MS),
        },
        geoLocation: {
          $near: {
            $geometry: { type: "Point", coordinates: coords },
            $maxDistance: NEARBY_RADIUS_METERS,
          },
        },
      })
        .select("_id")
        .limit(2500)
        .lean();
    }

    const audience = new Map();
    followers.forEach((u) => audience.set(String(u._id), u._id));
    nearbyUsers.forEach((u) => audience.set(String(u._id), u._id));
    if (ownerUserId) audience.delete(String(ownerUserId));

    const userIds = Array.from(audience.values());
    if (!userIds.length) return;

    const subs = await PushSub.find({ user: { $in: userIds } }).lean();
    if (!subs.length) return;

    const numericPrice = Number(price);
    const numericDiscount = Number(discount || 0);
    const details = [];

    if (Number.isFinite(numericPrice)) {
      details.push(`$${numericPrice.toLocaleString("es-AR")}`);
    }
    if (numericDiscount > 0) details.push(`${numericDiscount}% OFF`);
    if (category) details.push(category);
    if (Number(stock) > 0 && Number(stock) <= 5) details.push("últimas unidades");

    const payload = {
      title: `🛍️ Nuevo en ${businessName}`,
      body: `${productName}${details.length ? ` · ${details.join(" · ")}` : ""}`,
      url: `/negocio/${businessId}?p=${productId}`,
      icon: assetUrl(businessLogo),
      badge: DEFAULT_BADGE,
      image: productImageUrl ? assetUrl(productImageUrl, undefined) : undefined,
      tag: `producto-${productId}`,
      renotify: true,
      requireInteraction: false,
      vibrate: [160, 70, 160],
      meta: {
        type: "new_product",
        businessId,
        productId,
        price: numericPrice,
        originalPrice: Number(originalPrice) || null,
        discount: numericDiscount,
      },
    };

    const delivered = await sendPayloadToSubscriptions(subs, payload);
    console.log(
      `[Push] Producto ${productId}: ${delivered}/${subs.length} dispositivos; seguidores=${followers.length}; cercanos=${nearbyUsers.length}`,
    );
  } catch (err) {
    console.error("[Push] notifyProductAudience:", err);
  }
}

module.exports = {
  notifyNearbyBusinessesForUser,
  notifyProductAudience,
};
