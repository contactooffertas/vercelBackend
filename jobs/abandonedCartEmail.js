// jobs/abandonedCartEmail.js
// Cron que corre cada hora y envía email a usuarios con carrito abandonado > 3 días.
// Configuración: npm install node-cron nodemailer

const cron     = require("node-cron");
const nodemailer = require("nodemailer");
const Cart     = require("../models/cartModel");
const User     = require("../models/userModel");

// ─── Transporter ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   "smtp.gmail.com",
  port:   "587",
  secure: false,
  auth: {
    user: "gjoaquinreynoso@.gmail.com",
    pass: "onxu lhhe epmh ujzg",
  },
});

// ─── HTML del email ───────────────────────────────────────────────────────────
function buildEmailHtml(userName, items) {
  const total = items.reduce((acc, i) => {
    const price = i.discount ? i.price * (1 - i.discount / 100) : i.price;
    return acc + price * i.quantity;
  }, 0);

  const itemRows = items.map(i => {
    const finalPrice = i.discount ? i.price * (1 - i.discount / 100) : i.price;
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f3f4f6">
          ${i.image ? `<img src="${i.image}" width="50" height="50" style="border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:10px" />` : ""}
          <span style="font-weight:600;color:#111">${i.name}</span>
          <span style="color:#9ca3af;font-size:13px"> ×${i.quantity}</span>
        </td>
        <td style="text-align:right;padding:10px 0;border-bottom:1px solid #f3f4f6;color:#f97316;font-weight:700">
          $${(finalPrice * i.quantity).toLocaleString("es-AR")}
        </td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#f97316,#fb923c);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:24px;font-weight:800">Offertas</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Tu carrito te está esperando 🛒</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px">
          <h2 style="margin:0 0 8px;color:#111;font-size:20px">Hola, ${userName} 👋</h2>
          <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6">
            Notamos que dejaste algunos productos en tu carrito hace más de 3 días. ¡No te los pierdas, pueden agotarse!
          </p>

          <!-- Items -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <thead>
              <tr>
                <th style="text-align:left;color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;padding-bottom:8px">Producto</th>
                <th style="text-align:right;color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;padding-bottom:8px">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <!-- Total -->
          <div style="background:#fff7ed;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;margin-bottom:28px;border:1px solid #fed7aa">
            <span style="font-weight:700;color:#111">Total estimado</span>
            <span style="font-weight:800;color:#f97316;font-size:18px">$${total.toLocaleString("es-AR")}</span>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:24px">
            <a href="https://ofertas-vercel.vercel.app/panel?tab=cart"
              style="display:inline-block;background:#f97316;color:#fff;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;box-shadow:0 4px 14px rgba(249,115,22,0.4)">
              Completar mi compra →
            </a>
          </div>

          <p style="color:#9ca3af;font-size:13px;text-align:center">
            Si ya no te interesa, podés vaciar tu carrito desde tu panel.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #f3f4f6">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            Recibís este mail porque tenés cuenta en Offertas.<br>
            <a href="https://ofertas-vercel.vercel.app/profile" style="color:#f97316">Administrar preferencias</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `;
}

// ─── Job: cada hora revisa carritos abandonados ───────────────────────────────
async function checkAbandonedCarts() {
  try {
    const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Carritos con items, no modificados en 3 días, email aún no enviado
    const carts = await Cart.find({
      "items.0": { $exists: true },
      updatedAt: { $lt: THREE_DAYS_AGO },
      $or: [
        { abandonedEmailSentAt: { $exists: false } },
        { abandonedEmailSentAt: null },
        // Re-enviar si pasaron otros 3 días desde el último email
        { abandonedEmailSentAt: { $lt: THREE_DAYS_AGO } },
      ],
    })
    .populate("user", "name email notificationsEnabled")
    .populate("items.product", "name price discount image stock");
    for (const cart of carts) {
      if (!cart.user?.email) continue;

      const items = cart.items
        .filter(i => i.product) // por si el producto fue eliminado
        .map(i => ({
          name:     i.product.name,
          price:    i.product.price,
          discount: i.product.discount,
          image:    i.product.image,
          quantity: i.quantity,
        }));

      if (items.length === 0) continue;

      try {
        await transporter.sendMail({
          from:    `"Offertas" <gjoaquinreynoso@gmail>`,
          to:      cart.user.email,
          subject: `🛒 ${cart.user.name.split(" ")[0]}, tu carrito te está esperando`,
          html:    buildEmailHtml(cart.user.name.split(" ")[0], items),
        });

        // Marcar que se envió el email
        cart.abandonedEmailSentAt = new Date();
        await cart.save();

      } catch (mailErr) {
        console.error(`[AbandonedCart] Error enviando a ${cart.user.email}:`, mailErr.message);
      }
    }
  } catch (err) {
    console.error("[AbandonedCart] Error en el job:", err);
  }
}

// ─── Iniciar cron (cada hora) ────────────────────────────────────────────────
function startAbandonedCartJob() {
  // Ejecutar al inicio
  checkAbandonedCarts();

  // Luego cada hora
  cron.schedule("0 * * * *", () => {
    console.log("[AbandonedCart] Ejecutando job...");
    checkAbandonedCarts();
  });

}

module.exports = { startAbandonedCartJob, checkAbandonedCarts };