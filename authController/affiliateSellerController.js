// authController/affiliateSellerController.js
//
// Flujo de VENDEDOR del Programa de Afiliados.
//
// Usa el modelo real '../models/productoModel' (exporta como "Product").
// El dueño del producto se guarda en el campo `user` (no `seller`), y la
// imagen es un único String `image` (no hay array `images`).
//
// El chequeo de rol se hace en línea en cada handler (sin middleware
// adicional), y la pertenencia (ownership) se valida siempre filtrando
// por `user: sellerId` en cada query de producto.

const mongoose = require('mongoose');
const Product = require('../models/productoModel');
const AffiliateOffer = require('../models/AffiliateOffer');
const AffiliateOfferApplication = require('../models/AffiliateOfferApplication');
const AffiliateSellerApplication = require('../models/AffiliateSellerApplication');
const AffiliateBuyerApplication = require('../models/AffiliateBuyerApplication');
const generateAffiliateCode = require('../utils/generateAffiliateCode');
const sendEmail = require('../utils/sendMail');

// Ajustar si la ruta pública de tienda/producto es otra.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mercadorosario.com';
const BACKEND_URL = process.env.BACKEND_URL || 'https://new-backend-lovat.vercel.app';

function isSeller(req) {
  return !!req.user && req.user.role === 'seller';
}

function getSellerId(req) {
  return req.user.id || req.user._id;
}

async function getActiveSellerProgram(userId) {
  return AffiliateSellerApplication.findOne({ user: userId, status: 'active' });
}

// Antes apuntaba a /tienda/:sellerId/producto/:productId, una ruta que no
// existe en el frontend (y sellerId era el User id, no el Business id que
// espera /negocio/[id]). Ahora reutilizamos el endpoint /p/:id que YA
// resuelve el businessId correcto desde el producto y ya tiene el sistema
// de OG cards para WhatsApp/Telegram. Solo le sumamos ?ref= con el código
// de afiliado, que getProductShareCard propaga al redirect final.
function buildAffiliateLink(sellerId, productId, affiliateCode) {
  return `${BACKEND_URL}/p/${productId}?ref=${affiliateCode}`;
}

function mapBuyerData(buyerDoc) {
  if (!buyerDoc) return null;
  return {
    userId: buyerDoc.user,
    firstName: buyerDoc.firstName,
    lastName: buyerDoc.lastName,
    email: buyerDoc.email,
    phone: buyerDoc.phone,
    city: buyerDoc.city,
    province: buyerDoc.province,
    socialMedia: buyerDoc.socialMedia,
    salesExperience: buyerDoc.salesExperience,
  };
}

/**
 * GET /api/affiliates/seller/products
 * query: page (def 1), limit (def 5, max 20), search
 * Lista los productos del vendedor de a 5 (o el limit pedido) por vez,
 * indicando si cada uno ya está habilitado como oferta.
 */
exports.getSellerProducts = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const search = (req.query.search || '').trim();

    // Solo productos propios y no bloqueados por moderación pueden ser oferta.
    const filter = { user: sellerId, blocked: { $ne: true } };
    if (search) filter.name = { $regex: search, $options: 'i' };

    const total = await Product.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const products = await Product.find(filter)
      .select('name image price')
      .sort({ name: 1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const offers = await AffiliateOffer.find({
      seller: sellerId,
      product: { $in: products.map((p) => p._id) },
    }).lean();

    const offersByProduct = new Map(offers.map((o) => [String(o.product), o]));

    const items = products.map((p) => {
      const offer = offersByProduct.get(String(p._id));
      return {
        productId: p._id,
        name: p.name,
        image: p.image || null,
        price: p.price,
        isOffer: !!offer,
        offerId: offer ? offer._id : null,
        commissionPercentage: offer ? offer.commissionPercentage : null,
        offerActive: offer ? offer.active : false,
      };
    });

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateSellerController.getSellerProducts]', err);
    return res.status(500).json({ message: 'Error al obtener los productos' });
  }
};

/**
 * POST /api/affiliates/seller/offers
 * body: { productId, commissionPercentage?, active? }
 * Crea o actualiza la oferta de afiliados para un producto propio.
 */
exports.upsertOffer = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { productId, commissionPercentage, active } = req.body;

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Producto inválido' });
    }

    const program = await getActiveSellerProgram(sellerId);
    if (!program) {
      return res.status(403).json({ message: 'Debés tener tu programa de afiliados activo' });
    }

    const product = await Product.findOne({ _id: productId, user: sellerId, blocked: { $ne: true } })
      .select('_id')
      .lean();
    if (!product) {
      return res.status(404).json({ message: 'Producto no encontrado' });
    }

    const percentage =
      commissionPercentage === undefined || commissionPercentage === null || commissionPercentage === ''
        ? program.defaultPercentage
        : Number(commissionPercentage);

    if (Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
      return res.status(400).json({ message: 'Porcentaje de comisión inválido' });
    }

    const offer = await AffiliateOffer.findOneAndUpdate(
      { seller: sellerId, product: productId },
      {
        seller: sellerId,
        product: productId,
        commissionPercentage: percentage,
        active: active === undefined ? true : !!active,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ message: 'Oferta guardada correctamente', offer });
  } catch (err) {
    console.error('[affiliateSellerController.upsertOffer]', err);
    return res.status(500).json({ message: 'Error al guardar la oferta' });
  }
};

/**
 * PATCH /api/affiliates/seller/offers/:offerId/toggle
 * body: { active }
 * Activa/desactiva una oferta sin borrar las solicitudes asociadas.
 */
exports.toggleOffer = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { offerId } = req.params;

    const offer = await AffiliateOffer.findOneAndUpdate(
      { _id: offerId, seller: sellerId },
      { active: !!req.body.active },
      { new: true }
    );
    if (!offer) return res.status(404).json({ message: 'Oferta no encontrada' });

    return res.status(200).json({ message: 'Oferta actualizada', offer });
  } catch (err) {
    console.error('[affiliateSellerController.toggleOffer]', err);
    return res.status(500).json({ message: 'Error al actualizar la oferta' });
  }
};

/**
 * GET /api/affiliates/seller/offers
 * Ofertas activas del vendedor, con cantidad de solicitudes pendientes/aceptadas.
 */
exports.listOffers = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);

    const offers = await AffiliateOffer.find({ seller: sellerId, active: true })
      .populate('product', 'name image price')
      .sort({ createdAt: -1 })
      .lean();

    const counts = await AffiliateOfferApplication.aggregate([
      { $match: { seller: new mongoose.Types.ObjectId(sellerId) } },
      { $group: { _id: { offer: '$offer', status: '$status' }, count: { $sum: 1 } } },
    ]);

    const countsByOffer = new Map();
    for (const c of counts) {
      const key = String(c._id.offer);
      const entry = countsByOffer.get(key) || { pending: 0, accepted: 0, rejected: 0, blocked: 0 };
      entry[c._id.status] = c.count;
      countsByOffer.set(key, entry);
    }

    const items = offers.map((o) => ({
      offerId: o._id,
      productId: o.product ? o.product._id : null,
      productName: o.product ? o.product.name : 'Producto eliminado',
      commissionPercentage: o.commissionPercentage,
      pendingCount: countsByOffer.get(String(o._id))?.pending || 0,
      acceptedCount: countsByOffer.get(String(o._id))?.accepted || 0,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[affiliateSellerController.listOffers]', err);
    return res.status(500).json({ message: 'Error al obtener las ofertas' });
  }
};

/**
 * GET /api/affiliates/seller/offers/:offerId/applications
 * query: status (def 'pending'), page, limit (def 5)
 * Trae, de a 5 por vez, quién aplicó a esa oferta puntual.
 */
exports.listOfferApplications = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { offerId } = req.params;
    const status = ['pending', 'accepted', 'rejected', 'blocked'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

    const offer = await AffiliateOffer.findOne({ _id: offerId, seller: sellerId }).lean();
    if (!offer) return res.status(404).json({ message: 'Oferta no encontrada' });

    const filter = { offer: offerId, seller: sellerId, status };
    const total = await AffiliateOfferApplication.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const applications = await AffiliateOfferApplication.find(filter)
      .sort({ appliedAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const buyerIds = applications.map((a) => a.buyer);
    const buyerApplications = await AffiliateBuyerApplication.find({ user: { $in: buyerIds } }).lean();
    const buyerDataById = new Map(buyerApplications.map((b) => [String(b.user), b]));

    const items = applications.map((a) => ({
      applicationId: a._id,
      status: a.status,
      appliedAt: a.appliedAt,
      decidedAt: a.decidedAt,
      rating: a.rating,
      salesCount: a.salesCount,
      affiliateCode: a.affiliateCode,
      buyer: mapBuyerData(buyerDataById.get(String(a.buyer))),
    }));

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateSellerController.listOfferApplications]', err);
    return res.status(500).json({ message: 'Error al obtener las solicitudes' });
  }
};

/**
 * POST /api/affiliates/seller/applications/:applicationId/accept
 * Acepta al afiliado, genera su código/link único y le avisa por mail.
 */
exports.acceptApplication = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { applicationId } = req.params;

    const application = await AffiliateOfferApplication.findOne({
      _id: applicationId,
      seller: sellerId,
    }).populate('offer');
    if (!application) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'La solicitud ya fue procesada' });
    }

    application.status = 'accepted';
    application.decidedAt = new Date();
    application.affiliateCode = generateAffiliateCode();
    await application.save();

    const buyerData = await AffiliateBuyerApplication.findOne({ user: application.buyer }).lean();
    const link = buildAffiliateLink(sellerId, application.offer.product, application.affiliateCode);

    if (buyerData?.email) {
      const firstName = buyerData.firstName || '';
      await sendEmail(
        buyerData.email,
        'Tu solicitud de afiliado fue aceptada',
        `Hola ${firstName}, tu solicitud para el programa de afiliados fue aceptada. Tu link de afiliado es: ${link}`,
        `<p>Hola ${firstName},</p><p>Tu solicitud para el Programa de Afiliados fue <strong>aceptada</strong>.</p><p>Ya podés ver tu link de afiliado en la sección <strong>Mis Afiliados</strong> de la plataforma:</p><p><a href="${link}">${link}</a></p>`
      );
    }

    return res.status(200).json({ message: 'Solicitud aceptada', application, affiliateLink: link });
  } catch (err) {
    console.error('[affiliateSellerController.acceptApplication]', err);
    return res.status(500).json({ message: 'Error al aceptar la solicitud' });
  }
};

/**
 * POST /api/affiliates/seller/applications/:applicationId/reject
 * Rechaza la solicitud y avisa por mail.
 */
exports.rejectApplication = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { applicationId } = req.params;

    const application = await AffiliateOfferApplication.findOne({ _id: applicationId, seller: sellerId });
    if (!application) return res.status(404).json({ message: 'Solicitud no encontrada' });
    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'La solicitud ya fue procesada' });
    }

    application.status = 'rejected';
    application.decidedAt = new Date();
    await application.save();

    const buyerData = await AffiliateBuyerApplication.findOne({ user: application.buyer }).lean();
    if (buyerData?.email) {
      const firstName = buyerData.firstName || '';
      await sendEmail(
        buyerData.email,
        'Actualización sobre tu solicitud de afiliado',
        `Hola ${firstName}, tu solicitud para este programa de afiliados no fue aceptada en esta oportunidad.`,
        `<p>Hola ${firstName},</p><p>Tu solicitud para este Programa de Afiliados <strong>no fue aceptada</strong> en esta oportunidad.</p><p>Podés seguir aplicando a otras tiendas dentro de la plataforma.</p>`
      );
    }

    return res.status(200).json({ message: 'Solicitud rechazada', application });
  } catch (err) {
    console.error('[affiliateSellerController.rejectApplication]', err);
    return res.status(500).json({ message: 'Error al rechazar la solicitud' });
  }
};

/**
 * PATCH /api/affiliates/seller/applications/:applicationId/status
 * body: { status: 'accepted' | 'blocked' }
 * Bloquea/inhabilita o reactiva a un afiliado ya aceptado.
 */
exports.setApplicationStatus = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { applicationId } = req.params;
    const { status } = req.body;

    if (!['accepted', 'blocked'].includes(status)) {
      return res.status(400).json({ message: 'Estado inválido' });
    }

    const application = await AffiliateOfferApplication.findOneAndUpdate(
      { _id: applicationId, seller: sellerId, status: { $in: ['accepted', 'blocked'] } },
      { status },
      { new: true }
    );
    if (!application) return res.status(404).json({ message: 'Afiliado no encontrado' });

    return res.status(200).json({ message: 'Estado actualizado', application });
  } catch (err) {
    console.error('[affiliateSellerController.setApplicationStatus]', err);
    return res.status(500).json({ message: 'Error al actualizar el estado del afiliado' });
  }
};

/**
 * DELETE /api/affiliates/seller/applications/:applicationId
 * Elimina definitivamente la relación de afiliado.
 */
exports.deleteApplication = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { applicationId } = req.params;

    const application = await AffiliateOfferApplication.findOneAndDelete({
      _id: applicationId,
      seller: sellerId,
    });
    if (!application) return res.status(404).json({ message: 'Afiliado no encontrado' });

    return res.status(200).json({ message: 'Afiliado eliminado correctamente' });
  } catch (err) {
    console.error('[affiliateSellerController.deleteApplication]', err);
    return res.status(500).json({ message: 'Error al eliminar el afiliado' });
  }
};

/**
 * PATCH /api/affiliates/seller/applications/:applicationId/rating
 * body: { rating: 0-5 }
 * Puntuación que el vendedor le pone al afiliado según sus ventas.
 */
exports.rateApplication = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { applicationId } = req.params;
    const numericRating = Number(req.body.rating);

    if (Number.isNaN(numericRating) || numericRating < 0 || numericRating > 5) {
      return res.status(400).json({ message: 'Puntuación inválida' });
    }

    const application = await AffiliateOfferApplication.findOneAndUpdate(
      { _id: applicationId, seller: sellerId, status: 'accepted' },
      { rating: numericRating },
      { new: true }
    );
    if (!application) return res.status(404).json({ message: 'Afiliado no encontrado' });

    return res.status(200).json({ message: 'Puntuación guardada', application });
  } catch (err) {
    console.error('[affiliateSellerController.rateApplication]', err);
    return res.status(500).json({ message: 'Error al guardar la puntuación' });
  }
};

/**
 * GET /api/affiliates/seller/mis-afiliados
 * query: page, limit (def 5)
 * Afiliados aceptados/bloqueados, de a 5 por vez, con ventas, antigüedad y link.
 */
exports.listMyAffiliates = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

    const filter = { seller: sellerId, status: { $in: ['accepted', 'blocked'] } };
    const total = await AffiliateOfferApplication.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const applications = await AffiliateOfferApplication.find(filter)
      .populate('offer', 'product commissionPercentage')
      .sort({ decidedAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const buyerIds = applications.map((a) => a.buyer);
    const buyerApplications = await AffiliateBuyerApplication.find({ user: { $in: buyerIds } }).lean();
    const buyerDataById = new Map(buyerApplications.map((b) => [String(b.user), b]));

    const productIds = applications.map((a) => a.offer?.product).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).select('name').lean();
    const productNameById = new Map(products.map((p) => [String(p._id), p.name]));

    const items = applications.map((a) => {
      const productId = a.offer?.product ? String(a.offer.product) : null;
      return {
        applicationId: a._id,
        status: a.status,
        rating: a.rating,
        salesCount: a.salesCount,
        affiliatedSince: a.decidedAt,
        affiliateLink:
          a.affiliateCode && a.offer?.product
            ? buildAffiliateLink(sellerId, a.offer.product, a.affiliateCode)
            : null,
        productName: productId ? productNameById.get(productId) || 'Producto eliminado' : null,
        buyer: mapBuyerData(buyerDataById.get(String(a.buyer))),
      };
    });

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateSellerController.listMyAffiliates]', err);
    return res.status(500).json({ message: 'Error al obtener tus afiliados' });
  }
};
