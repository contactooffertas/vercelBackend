const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const User = require("../models/userModel");
const { notifyNearbyBusinessesForUser } = require("../utils/geoPushService");

router.put("/location", auth, async (req, res) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) {
      return res.status(400).json({ message: "lat y lng inválidos" });
    }

    await User.findByIdAndUpdate(req.user.id, {
      lat,
      lng,
      locationEnabled: true,
      geoLocation: { type: "Point", coordinates: [lng, lat] },
      lastLocationAt: new Date(),
    });

    const nearbyNotification = await notifyNearbyBusinessesForUser({
      userId: req.user.id,
      lat,
      lng,
    }).catch((err) => {
      console.error("[GeoPush] nearby alert:", err.message);
      return { delivered: 0 };
    });

    res.json({
      message: "Ubicación guardada",
      lat,
      lng,
      nearbyNotification,
    });
  } catch (err) {
    console.error("[GeoPush] location:", err);
    res.status(500).json({ message: "Error guardando ubicación" });
  }
});

module.exports = router;
