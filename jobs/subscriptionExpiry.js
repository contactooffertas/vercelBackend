// jobs/subscriptionExpiry.js
// Cron que corre todos los días a las 8:00 AM (Argentina = 11:00 UTC).
// Avisa a los vendedores cuando quedan 3 días o 1 día para vencer su cuota.
//
// Uso en server.js / app.js (igual que abandonedCartEmail):
//   const { startSubscriptionExpiryJob } = require('./jobs/subscriptionExpiry');
//   server.listen(PORT, () => {
//     startAbandonedCartJob();
//     startSubscriptionExpiryJob(app);
//   });
//
// Requiere: npm install node-cron

const cron     = require("node-cron");
const Business = require("../models/businessModel");

// ─── Helper: notificación en BD ───────────────────────────────────────────────
async function createDBNotification(userId, title, message, type = "general", meta = {}) {
  try {
    const Notification = require("../models/notificationModel");
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) {
    console.error("[createDBNotification]", err.message);
  }
}

// ─── Lógica principal ─────────────────────────────────────────────────────────
async function runSubscriptionExpiryNotifications(io) {
  try {
    const now     = new Date();
    const in1Day  = new Date(now.getTime() + 1 * 86400000);
    const in2Days = new Date(now.getTime() + 2 * 86400000);
    const in3Days = new Date(now.getTime() + 3 * 86400000);
    const in4Days = new Date(now.getTime() + 4 * 86400000);

    // ── Negocios que vencen entre 3 y 4 días desde ahora ─────────────────
    const expiring3 = await Business.find({
      cuotaSuscriptor: true,
      fechaFinaliza:   { $gte: in3Days, $lt: in4Days },
    })
      .populate("owner", "_id name")
      .lean();

    for (const biz of expiring3) {
      const ownerId = biz.owner?._id;
      if (!ownerId) continue;

      const msg = `Quedan 3 días para vencer tu cuota en "${biz.name}". Renová antes para no perder los beneficios.`;

      io?.to(`user_${ownerId.toString()}`).emit("subscription_expiring", {
        businessName: biz.name,
        daysLeft:     3,
        message:      msg,
      });

      await createDBNotification(
        ownerId,
        "Cuota por vencer",
        msg,
        "subscription_expiring",
        { businessId: biz._id, daysLeft: 3 }
      );
    }

    // ── Negocios que vencen entre 1 y 2 días desde ahora ─────────────────
    const expiring1 = await Business.find({
      cuotaSuscriptor: true,
      fechaFinaliza:   { $gte: in1Day, $lt: in2Days },
    })
      .populate("owner", "_id name")
      .lean();

    for (const biz of expiring1) {
      const ownerId = biz.owner?._id;
      if (!ownerId) continue;

      const msg = `Mañana vence tu cuota en "${biz.name}". ¡Renová hoy para no perder los beneficios!`;

      io?.to(`user_${ownerId.toString()}`).emit("subscription_expiring", {
        businessName: biz.name,
        daysLeft:     1,
        message:      msg,
      });

      await createDBNotification(
        ownerId,
        "Cuota vence mañana",
        msg,
        "subscription_expiring",
        { businessId: biz._id, daysLeft: 1 }
      );
    }
  } catch (err) {
    console.error("[SubscriptionExpiry] Error en el job:", err);
  }
}

// ─── Iniciar cron ─────────────────────────────────────────────────────────────
function startSubscriptionExpiryJob(app) {
  const io = app.get("io");

  // Ejecutar todos los días a las 8:00 AM Argentina (UTC-3 → 11:00 UTC)
  cron.schedule("0 11 * * *", () => {
    runSubscriptionExpiryNotifications(io);
  });
}

module.exports = { startSubscriptionExpiryJob, runSubscriptionExpiryNotifications };