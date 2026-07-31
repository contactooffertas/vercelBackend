
// controllers/tracking.controller.js
const crypto = require('crypto');
const TrackingEvent = require('../models/TrackingEvent');
const LeadProfile = require('../models/LeadProfile');

const hashIp = (ip) => crypto.createHash('sha256').update(ip || '0.0.0.0').digest('hex');

exports.trackEvent = async (req, res) => {
  try {
    const { business_id, anonymous_id, user_id, session_id, event_name, properties, url } = req.body;

    if (!business_id ||!anonymous_id ||!event_name) {
      return res.status(200).json({ ok: false }); // nunca rompas el front
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const fingerprint = hashIp(`${ip}-${userAgent}`).slice(0, 32);

    // --- 1. DEDUPLICACIÓN Y MERGE ---
    let profile = await LeadProfile.findOne({ business_id, anonymous_id });

    if (!profile && user_id) {
      // Si ya existe un perfil con user_id, es el mismo que volvió logueado
      profile = await LeadProfile.findOne({ business_id, user_id });
      if (profile) {
        // actualizamos el anonymous_id al nuevo para no perder la sesión
        profile.anonymous_id = anonymous_id;
      }
    }

    // Intento de resucitar por fingerprint si borró cookies (últimas 24h)
    if (!profile) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      profile = await LeadProfile.findOne({
        business_id,
        fingerprint_hash: fingerprint,
        last_seen: { $gte: yesterday },
        user_id: null // solo anonimos
      });
      if (profile) {
        profile.anonymous_id = anonymous_id; // le reasignamos el nuevo anon_id
      }
    }

    if (!profile) {
      profile = await LeadProfile.create({
        business_id,
        anonymous_id,
        user_id: user_id || null,
        session_id,
        fingerprint_hash: fingerprint,
        first_seen: new Date(),
      });
    } else {
      // MERGE: si era anónimo y ahora se logueó
      if (user_id &&!profile.user_id) {
        profile.user_id = user_id;
      }
      profile.last_seen = new Date();

      // --- 2. LEAD SCORING ---
      if (event_name === 'product_view') profile.lead_score += 10;
      if (event_name === 'dwell_time' && properties?.seconds > 30) profile.lead_score += 15;
      if (event_name === 'product_click') profile.lead_score += 20;
      if (event_name === 'lead_conversion') profile.lead_score += 50;

      // Top productos
      if (properties?.product_id) {
        const prodId = properties.product_id;
        if (!profile.top_products[prodId]) profile.top_products[prodId] = { views: 0, seconds: 0 };
        if (event_name === 'product_view') profile.top_products[prodId].views += 1;
        if (event_name === 'dwell_time') profile.top_products[prodId].seconds += properties.seconds || 0;
        profile.markModified('top_products');
      }

      await profile.save();
    }

    // --- 3. GUARDAR EVENTO GLOBAL ---
    await TrackingEvent.create({
      business_id,
      profile_id: profile._id,
      anonymous_id,
      user_id: user_id || profile.user_id || null,
      session_id,
      event_name,
      properties,
      url,
      ip_hash: hashIp(ip),
      user_agent: userAgent
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Tracking error:", err);
    return res.status(200).json({ ok: false });
  }
};

// Endpoint para que cada negocio vea sus leads
exports.getLeadsByBusiness = async (req, res) => {
  const { businessId } = req.params;
  // acá validas que el que pide sea el dueño del businessId

  const leads = await LeadProfile.find({ business_id: businessId })
   .sort({ lead_score: -1, last_seen: -1 })
   .limit(100);

  const topProducts = await TrackingEvent.aggregate([
    { $match: { business_id: businessId, event_name: 'product_view' } },
    { $group: { _id: "$properties.product_id", totalViews: { $sum: 1 }, totalSeconds: { $sum: "$properties.seconds" } } },
    { $sort: { totalViews: -1 } },
    { $limit: 10 }
  ]);

  res.json({ leads, topProducts });
};
