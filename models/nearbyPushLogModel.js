const mongoose = require("mongoose");

const nearbyPushLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastDistanceMeters: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

// Un solo registro por usuario/negocio: se reutiliza como cooldown.
nearbyPushLogSchema.index({ user: 1, business: 1 }, { unique: true });

module.exports = mongoose.model("NearbyPushLog", nearbyPushLogSchema);
