// authController/announcementController.js
const Announcement = require('../models/announcementModelChat');
const Business     = require('../models/businessModel');

/* ─── Helper IO ──────────────────────────────────────────────────────────────── */
function getIO(req) {
  return req.app.get('io');
}

/* ─── Helper: notificación en BD ────────────────────────────────────────────── */
async function createDBNotification(userId, title, message, type = 'general', meta = {}) {
  try {
    const Notification = require('../models/notificationModel');
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) {
    console.error('[createDBNotification]', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   ADMIN — crear, listar y eliminar anuncios
══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/announcements
 * Lista todos los anuncios (activos + expirados) para el panel admin.
 */
exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ announcements });
  } catch (err) {
    console.error('[getAnnouncements]', err);
    res.status(500).json({ message: 'Error obteniendo anuncios' });
  }
};

/**
 * POST /api/admin/announcements
 * Crea un anuncio y lo emite en tiempo real por socket a la audiencia correcta.
 *
 * Body: { title, message, audience: 'all'|'seller'|'buyer', durationHours, link? }
 */
exports.createAnnouncement = async (req, res) => {
  try {
    const { title, message, audience = 'all', durationHours = 24, link } = req.body;

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Título y mensaje son requeridos' });
    }

    const hours = Math.max(1, Math.min(720, Number(durationHours) || 24));

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    const announcement = await Announcement.create({
      title:        title.trim(),
      message:      message.trim(),
      audience,
      durationHours: hours,
      link:         link?.trim() || undefined,
      expiresAt,
      active:       true,
      createdBy:    req.user.id,
    });

    // ── Emitir por socket a la audiencia correcta ─────────────────────────
    const io = getIO(req);
    if (io) {
      const payload = {
        _id:          announcement._id,
        title:        announcement.title,
        message:      announcement.message,
        audience:     announcement.audience,
        durationHours: announcement.durationHours,
        link:         announcement.link,
        createdAt:    announcement.createdAt,
        expiresAt:    announcement.expiresAt,
      };

      // 'all' → todos los sockets conectados
      // 'seller' → solo los sockets de vendedores  (filtrado en cliente por rol)
      // 'buyer'  → solo los sockets de compradores (filtrado en cliente por rol)
      // Como el backend filtra por rol en getActiveAnnouncements, emitir a todos
      // y dejar que el cliente decida si mostrarlo (el fetch al endpoint ya filtra).
      io.emit('new_announcement', payload);
    }

    res.status(201).json({
      message:      `Anuncio creado y enviado a "${audience}"`,
      announcement,
    });
  } catch (err) {
    console.error('[createAnnouncement]', err);
    res.status(500).json({ message: 'Error creando anuncio' });
  }
};

/**
 * DELETE /api/admin/announcements/:id
 * Elimina un anuncio.
 */
exports.deleteAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ message: 'Anuncio no encontrado' });

    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Anuncio eliminado' });
  } catch (err) {
    console.error('[deleteAnnouncement]', err);
    res.status(500).json({ message: 'Error eliminando anuncio' });
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   USUARIO — obtener anuncios activos filtrados por su rol
══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/announcements/active
 * Devuelve los anuncios activos según el rol del usuario autenticado.
 * Requiere auth middleware antes de llamar esta función.
 */
exports.getActiveAnnouncements = async (req, res) => {
  try {
    const now      = new Date();
    const userRole = req.user?.role || 'user'; // 'user' | 'seller' | 'admin'

    // Mapear rol a tipo de audiencia
    // user/buyer → reciben 'all' y 'buyer'
    // seller     → reciben 'all' y 'seller'
    // admin      → recibe todo
    let audienceFilter;
    if (userRole === 'admin') {
      audienceFilter = { audience: { $in: ['all', 'seller', 'buyer'] } };
    } else if (userRole === 'seller') {
      audienceFilter = { audience: { $in: ['all', 'seller'] } };
    } else {
      // user / buyer
      audienceFilter = { audience: { $in: ['all', 'buyer'] } };
    }

    const announcements = await Announcement.find({
      ...audienceFilter,
      expiresAt: { $gt: now },
      active:    true,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ announcements });
  } catch (err) {
    console.error('[getActiveAnnouncements]', err);
    res.status(500).json({ message: 'Error obteniendo anuncios' });
  }
};

/* ══════════════════════════════════════════════════════════════════════════════
   SUSCRIPTORES — gestión de cuotas
══════════════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/subscribers
 * Lista todos los negocios (tengan o no suscripción activa).
 */
exports.getSubscribers = async (req, res) => {
  try {
    const { search = '', limit = 100 } = req.query;
    const query = search ? { name: { $regex: search, $options: 'i' } } : {};

    const businesses = await Business.find(query)
      .sort({ cuotaSuscriptor: -1, createdAt: -1 })
      .limit(Number(limit))
      .populate('owner', 'name email')
      .lean();

    res.json({ businesses });
  } catch (err) {
    console.error('[getSubscribers]', err);
    res.status(500).json({ message: 'Error obteniendo suscriptores' });
  }
};

/**
 * PATCH /api/admin/businesses/:id/subscription
 * Activa, actualiza o elimina la suscripción de un negocio.
 * Notifica al vendedor por socket + BD cuando se activa.
 *
 * Body: { cuotaSuscriptor: bool, fechaPago: string, fechaFinaliza: string }
 */
exports.updateSubscription = async (req, res) => {
  try {
    const { id }                              = req.params;
    const { cuotaSuscriptor, fechaPago, fechaFinaliza } = req.body;

    const biz = await Business.findById(id).populate('owner', '_id name email');
    if (!biz) return res.status(404).json({ message: 'Negocio no encontrado' });

    const wasActive = biz.cuotaSuscriptor;

    biz.cuotaSuscriptor = Boolean(cuotaSuscriptor);
    biz.fechaPago       = fechaPago    ? new Date(fechaPago)    : null;
    biz.fechaFinaliza   = fechaFinaliza ? new Date(fechaFinaliza) : null;
    await biz.save();

    // ── Notificar al dueño si se activa/actualiza ─────────────────────────
    const ownerId = biz.owner?._id;
    if (ownerId && cuotaSuscriptor) {
      const io = getIO(req);

      const fechaPagoFmt    = fechaPago    ? new Date(fechaPago).toLocaleDateString('es-AR')    : '—';
      const fechaFinalizaFmt = fechaFinaliza ? new Date(fechaFinaliza).toLocaleDateString('es-AR') : '—';

      const msg = wasActive
        ? `✅ Tu suscripción en "${biz.name}" fue actualizada. Vigente hasta el ${fechaFinalizaFmt}.`
        : `🎉 ¡Tu suscripción en "${biz.name}" fue activada! Fecha de pago: ${fechaPagoFmt}. Válida hasta: ${fechaFinalizaFmt}.`;

      // Socket — intentar ambos formatos de room
      if (io) {
        io.to(`user_${ownerId.toString()}`).emit('subscription_activated', {
          businessName:  biz.name,
          fechaPago:     fechaPagoFmt,
          fechaFinaliza: fechaFinalizaFmt,
          message:       msg,
        });
        io.to(`user:${ownerId.toString()}`).emit('subscription_activated', {
          businessName:  biz.name,
          fechaPago:     fechaPagoFmt,
          fechaFinaliza: fechaFinalizaFmt,
          message:       msg,
        });
      }

      // Notificación persistente en BD
      await createDBNotification(
        ownerId,
        wasActive ? '✅ Suscripción actualizada' : '🎉 ¡Suscripción activada!',
        msg,
        'subscription_activated',
        {
          businessId:    biz._id,
          fechaPago,
          fechaFinaliza,
        }
      );
    }

    res.json({
      message: cuotaSuscriptor
        ? 'Suscripción activada y notificación enviada al vendedor'
        : 'Suscripción removida',
      business: {
        _id:             biz._id,
        cuotaSuscriptor: biz.cuotaSuscriptor,
        fechaPago:       biz.fechaPago,
        fechaFinaliza:   biz.fechaFinaliza,
      },
    });
  } catch (err) {
    console.error('[updateSubscription]', err);
    res.status(500).json({ message: 'Error actualizando suscripción' });
  }
};