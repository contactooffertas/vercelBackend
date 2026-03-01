// authController/eliminaUsuarioController.js
const User            = require("../models/userModel");
const Business        = require("../models/businessModel");
const Product         = require("../models/productoModel");
const { Conversation, Message } = require("../models/chatModel");
const Report          = require("../models/reportModel");
const EliminaUsuario  = require("../models/eliminaUsuarioModel");
const cloudinary      = require("../config/cloudinary");
const nodemailer      = require("nodemailer");

// ── Mailer ─────────────────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransporter({
    host:   process.env.SMTP_HOST   || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendDeletionEmail({ to, name, summary, reason }) {
  try {
    const transporter = createTransporter();

    const summaryLines = [];
    if (summary.business)      summaryLines.push(`• Negocio eliminado: <strong>${summary.businessName}</strong>`);
    if (summary.products > 0)  summaryLines.push(`• Productos eliminados: <strong>${summary.products}</strong>`);
    if (summary.conversations > 0) summaryLines.push(`• Conversaciones eliminadas: <strong>${summary.conversations}</strong>`);
    if (summary.orders > 0)    summaryLines.push(`• Órdenes desvinculadas: <strong>${summary.orders}</strong>`);
    if (summary.reports > 0)   summaryLines.push(`• Reportes eliminados: <strong>${summary.reports}</strong>`);
    if (summary.cartItems > 0) summaryLines.push(`• Items de carrito eliminados: <strong>${summary.cartItems}</strong>`);

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:40px 40px 32px;text-align:center;">
            <div style="width:64px;height:64px;background:rgba(255,255,255,0.1);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
              <span style="font-size:28px;">🗑️</span>
            </div>
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Cuenta eliminada</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">Hemos procesado tu solicitud correctamente</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="color:#d1d5db;font-size:16px;margin:0 0 8px;">Hola, <strong style="color:#f9fafb;">${name}</strong></p>
            <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 28px;">
              Tu cuenta en <strong style="color:#f97316;">Ofertas Marketplace</strong> y todos los datos asociados 
              han sido eliminados permanentemente de nuestros servidores.
            </p>

            ${reason ? `
            <div style="background:#1f1f1f;border-left:3px solid #6b7280;border-radius:8px;padding:16px 20px;margin-bottom:28px;">
              <p style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Razón indicada</p>
              <p style="color:#d1d5db;font-size:14px;margin:0;">"${reason}"</p>
            </div>
            ` : ""}

            ${summaryLines.length > 0 ? `
            <div style="background:#111;border:1px solid #2a2a2a;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
              <p style="color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;">Datos eliminados</p>
              ${summaryLines.map(l => `<p style="color:#d1d5db;font-size:14px;margin:0 0 8px;line-height:1.5;">${l}</p>`).join("")}
            </div>
            ` : ""}

            <div style="background:#1c1917;border:1px solid #292524;border-radius:12px;padding:20px 24px;">
              <p style="color:#a8a29e;font-size:13px;line-height:1.7;margin:0;">
                Esta acción es <strong style="color:#ef4444;">irreversible</strong>. Si creés que fue un error 
                o querés volver a registrarte en el futuro, podés hacerlo con el mismo correo en cualquier momento.
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 40px 36px;">
            <hr style="border:none;border-top:1px solid #2a2a2a;margin-bottom:24px;">
            <p style="color:#6b7280;font-size:12px;text-align:center;margin:0;">
              © ${new Date().getFullYear()} Ofertas Marketplace · Este mensaje fue generado automáticamente.<br>
              No respondas a este correo.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from:    `"Ofertas Marketplace" <${process.env.SMTP_USER}>`,
      to,
      subject: "Tu cuenta fue eliminada — Ofertas Marketplace",
      html,
    });

    return true;
  } catch (err) {
    console.error("[EliminaUsuario] Error enviando email:", err.message);
    return false;
  }
}

// ── Helper: destruir imagen en Cloudinary de forma segura ─────────────────────
async function safeCloudinaryDestroy(publicId) {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId); } catch { /* silencioso */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elimina-usuario/request
// El usuario solicita eliminar su propia cuenta
// Body: { reason?: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.requestDeletion = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { reason = "" } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    // Verificar que no haya una solicitud pendiente activa
    const existing = await EliminaUsuario.findOne({ userId, status: { $in: ["pending", "processing"] } });
    if (existing) {
      return res.status(400).json({ message: "Ya tenés una solicitud de eliminación en proceso." });
    }

    // Registrar solicitud
    const deletion = await EliminaUsuario.create({
      userId:    user._id,
      userName:  user.name,
      userEmail: user.email,
      userRole:  user.role,
      reason,
      status:    "pending",
      ipAddress: req.ip,
    });

    res.json({
      message:    "Solicitud registrada. Procesando eliminación...",
      deletionId: deletion._id,
    });
  } catch (err) {
    console.error("[requestDeletion]", err);
    res.status(500).json({ message: "Error al registrar la solicitud" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/elimina-usuario/confirm
// Confirmación final: elimina todo y envía email
// Body: { password: string, reason?: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.confirmDeletion = async (req, res) => {
  const userId = req.user._id || req.user.id;

  let deletion = null;

  try {
    const { reason = "" } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    // Crear/actualizar registro de eliminación
    deletion = await EliminaUsuario.findOneAndUpdate(
      { userId, status: { $in: ["pending", "processing"] } },
      { status: "processing", reason: reason || "" },
      { new: true, upsert: true }
    );

    if (!deletion) {
      deletion = await EliminaUsuario.create({
        userId:    user._id,
        userName:  user.name,
        userEmail: user.email,
        userRole:  user.role,
        reason,
        status:    "processing",
        ipAddress: req.ip,
      });
    }

    const summary = {
      products:      0,
      business:      false,
      businessName:  "",
      conversations: 0,
      orders:        0,
      reports:       0,
      cartItems:     0,
      pushSubs:      0,
    };

    // ── 1. Eliminar negocio y sus productos ────────────────────────────────
    const business = await Business.findOne({ owner: userId });
    if (business) {
      summary.business     = true;
      summary.businessName = business.name;

      // Productos del negocio
      const products = await Product.find({ businessId: business._id });
      summary.products = products.length;

      for (const p of products) {
        await safeCloudinaryDestroy(p.imagePublicId);
        await Product.findByIdAndDelete(p._id);
      }

      // Logo del negocio
      await safeCloudinaryDestroy(business.logoPublicId);
      await Business.findByIdAndDelete(business._id);
    }

    // ── 2. Eliminar productos sueltos del user (por si acaso) ──────────────
    const orphanProducts = await Product.find({ user: userId });
    for (const p of orphanProducts) {
      await safeCloudinaryDestroy(p.imagePublicId);
      await Product.findByIdAndDelete(p._id);
      summary.products += 1;
    }

    // ── 3. Eliminar conversaciones y mensajes ──────────────────────────────
    const convs = await Conversation.find({ participants: userId });
    summary.conversations = convs.length;

    for (const conv of convs) {
      await Message.deleteMany({ conversation: conv._id });
      await Conversation.findByIdAndDelete(conv._id);
    }

    // ── 4. Eliminar reportes relacionados ──────────────────────────────────
    const deletedReports = await Report.deleteMany({
      $or: [{ reportedBy: userId }, { targetId: userId }],
    });
    summary.reports = deletedReports.deletedCount;

    // ── 5. Intentar eliminar órdenes (si existe el modelo) ────────────────
    try {
      const Order = require("../models/orderModel");
      const deletedOrders = await Order.deleteMany({
        $or: [{ buyer: userId }, { seller: userId }],
      });
      summary.orders = deletedOrders.deletedCount;
    } catch { /* el modelo puede no existir */ }

    // ── 6. Carrito ─────────────────────────────────────────────────────────
    try {
      const Cart = require("../models/cartModel");
      const deletedCart = await Cart.deleteMany({ user: userId });
      summary.cartItems = deletedCart.deletedCount;
    } catch { /* silencioso */ }

    // ── 7. Push subscriptions ──────────────────────────────────────────────
    try {
      const PushSub = require("../models/pushSubscriptionModel");
      const deletedPush = await PushSub.deleteMany({ userId });
      summary.pushSubs = deletedPush.deletedCount;
    } catch { /* silencioso */ }

    // ── 8. Notificaciones ─────────────────────────────────────────────────
    try {
      const Notification = require("../models/notificationModel");
      await Notification.deleteMany({ userId });
    } catch { /* silencioso */ }

    // ── 9. Avatar del user ─────────────────────────────────────────────────
    await safeCloudinaryDestroy(user.avatarPublicId);

    // ── 10. Eliminar el User ───────────────────────────────────────────────
    await User.findByIdAndDelete(userId);

    // ── 11. Actualizar registro de eliminación ─────────────────────────────
    const emailOk = await sendDeletionEmail({
      to:      user.email,
      name:    user.name,
      summary,
      reason,
    });

    await EliminaUsuario.findByIdAndUpdate(deletion._id, {
      status:          "completed",
      completedAt:     new Date(),
      emailSent:       emailOk,
      emailSentAt:     emailOk ? new Date() : undefined,
      deletionSummary: summary,
    });

    // ── 12. Notificar via socket (opcional) ────────────────────────────────
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${userId.toString()}`).emit("account_deleted", {
        message: "Tu cuenta fue eliminada exitosamente.",
      });
    }

    return res.json({
      success: true,
      message: "Cuenta eliminada exitosamente. Recibirás un correo de confirmación.",
      summary,
    });
  } catch (err) {
    console.error("[confirmDeletion]", err);

    // Marcar como fallido en el log
    if (deletion?._id) {
      await EliminaUsuario.findByIdAndUpdate(deletion._id, { status: "pending" }).catch(() => {});
    }

    return res.status(500).json({ message: "Error al eliminar la cuenta. Contactá soporte." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/elimina-usuario/log  (solo admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.getDeletionLog = async (req, res) => {
  try {
    const admin = await User.findById(req.user._id || req.user.id);
    if (admin?.role !== "admin") return res.status(403).json({ message: "Acceso denegado" });

    const logs = await EliminaUsuario.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, logs });
  } catch (err) {
    console.error("[getDeletionLog]", err);
    res.status(500).json({ message: "Error al obtener logs" });
  }
};