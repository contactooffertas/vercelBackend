// models/pushSubscriptionModel.js
const mongoose = require("mongoose");

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      required: true,
    },
    // El objeto completo que devuelve el browser (endpoint + keys)
    subscription: {
      endpoint: { type: String, required: true },
      keys: {
        p256dh: { type: String, required: true },
        auth:   { type: String, required: true },
      },
    },
  },
  { timestamps: true }
);

// Un usuario puede tener varias suscripciones (distintos dispositivos/browsers)
// Pero evitamos duplicar el mismo endpoint
pushSubscriptionSchema.index({ "subscription.endpoint": 1 }, { unique: true });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);