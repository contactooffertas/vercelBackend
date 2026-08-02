// authController/affiliateBuyerController.js
//
// Flujo de COMPRADOR (afiliado) del Programa de Afiliados.
//
// El comprador navega las ofertas activas de todos los vendedores (de a 5
// en 5, con búsqueda por nombre de producto), aplica a la que le interese,
// y ve el estado de sus solicitudes / afiliaciones ya aceptadas, con los
// datos del vendedor en una card tipo carnet y su link de afiliado.

const mongoose = require('mongoose');
const Product = require('../models/productoModel');
const AffiliateOffer = require('../models/AffiliateOffer');
const AffiliateOfferApplication = require('../models/AffiliateOfferApplication');
const AffiliateSellerApplication = require('../models/AffiliateSellerApplication');
const AffiliateBuyerApplication = require('../models/AffiliateBuyerApplication');
const AffiliateTermsAcceptance = require('../models/AffiliateTermsAcceptance');
const AffiliateSale = require('../models/AffiliateSale');
const sendEmail = require('../utils/sendMail');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mercadorosario.com';
const BACKEND_URL = process.env.BACKEND_URL || 'https://new-backend-lovat.vercel.app';
const CURRENT_TERMS_VERSION = 1;

function isBuyer(req) {
  return !!req.user && req.user.role !== 'seller' && req.user.role !== 'admin';
}

function getBuyerId(req) {
  return req.user.id || req.user._id;
}

// Antes apuntaba a /tienda/:sellerId/producto/:productId, ruta inexistente
// en el frontend (y con el User id del vendedor en vez del Business id).
// Ahora reutiliza /p/:id, que ya resuelve el businessId correcto desde el
// producto y ya tiene el sistema de OG cards para WhatsApp/Telegram.
function buildAffiliateLink(sellerId, productId, affiliateCode) {
  return `${BACKEND_URL}/p/${productId}?ref=${affiliateCode}`;
}

function mapSellerData(sellerApp) {
  if (!sellerApp) return null;
  return {
    sellerId: sellerApp.user,
    businessName: sellerApp.businessName,
    contactName: sellerApp.contactName,
    email: sellerApp.email,
    phone: sellerApp.phone,
    description: sellerApp.description,
  };
}

/**
 * GET /api/affiliates/buyer/offers
 * query: page (def 1), limit (def 5, max 20), search
 * Lista, de a 5 en 5, las ofertas activas de todos los vendedores.
 */
exports.getAvailableOffers = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const search = (req.query.search || '').trim();

    const filter = { active: true };
    if (search) {
      const matchingProducts = await Product.find({
        name: { $regex: search, $options: 'i' },
        blocked: { $ne: true },
      }).select('_id').lean();
      filter.product = { $in: matchingProducts.map((p) => p._id) };
    }

    const total = await AffiliateOffer.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const offers = await AffiliateOffer.find(filter)
      .populate('product', 'name image price')
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const sellerIds = offers.map((o) => o.seller);
    const sellerApplications = await AffiliateSellerApplication.find({ user: { $in: sellerIds } }).lean();
    const sellerDataById = new Map(sellerApplications.map((s) => [String(s.user), s]));

    const myApplications = await AffiliateOfferApplication.find({
      buyer: buyerId,
      offer: { $in: offers.map((o) => o._id) },
    }).lean();
    const myStatusByOffer = new Map(myApplications.map((a) => [String(a.offer), a.status]));

    const items = offers
      .filter((o) => o.product)
      .map((o) => ({
        offerId: o._id,
        commissionPercentage: o.commissionPercentage,
        product: {
          productId: o.product._id,
          name: o.product.name,
          image: o.product.image || null,
          price: o.product.price,
        },
        seller: mapSellerData(sellerDataById.get(String(o.seller))),
        applicationStatus: myStatusByOffer.get(String(o._id)) || null,
      }));

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateBuyerController.getAvailableOffers]', err);
    return res.status(500).json({ message: 'Error al obtener las ofertas disponibles' });
  }
};

/**
 * POST /api/affiliates/buyer/offers/:offerId/apply
 * Aplica a una oferta puntual. Requiere TyC aceptados y perfil de comprador cargado.
 */
exports.applyToOffer = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const { offerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(offerId)) {
      return res.status(400).json({ message: 'Oferta inválida' });
    }

    const acceptance = await AffiliateTermsAcceptance.findOne({
      user: buyerId,
      role: 'buyer',
      version: CURRENT_TERMS_VERSION,
    });
    if (!acceptance) {
      return res.status(403).json({ message: 'Debés aceptar los Términos y Condiciones antes de continuar' });
    }

    const buyerProfile = await AffiliateBuyerApplication.findOne({ user: buyerId }).lean();
    if (!buyerProfile) {
      return res.status(403).json({ message: 'Completá tu perfil de afiliado antes de aplicar' });
    }

    const offer = await AffiliateOffer.findOne({ _id: offerId, active: true }).lean();
    if (!offer) return res.status(404).json({ message: 'Oferta no encontrada' });

    const existing = await AffiliateOfferApplication.findOne({ offer: offerId, buyer: buyerId });
    if (existing) {
      return res.status(200).json({ message: 'Ya aplicaste a esta oferta', application: existing });
    }

    const application = await AffiliateOfferApplication.create({
      offer: offerId,
      seller: offer.seller,
      buyer: buyerId,
      status: 'pending',
    });

    const sellerApp = await AffiliateSellerApplication.findOne({ user: offer.seller }).lean();
    if (sellerApp?.email) {
      const buyerName = `${buyerProfile.firstName || ''} ${buyerProfile.lastName || ''}`.trim();
      await sendEmail(
        sellerApp.email,
        'Nueva solicitud para tu Programa de Afiliados',
        `${buyerName || 'Un comprador'} aplicó a una de tus ofertas. Revisá la solicitud en la sección Programa de Afiliados de la plataforma.`,
        `<p>Hola ${sellerApp.contactName || ''},</p><p><strong>${buyerName || 'Un comprador'}</strong> aplicó a una de tus ofertas del Programa de Afiliados.</p><p>Revisá la solicitud en la sección <strong>Solicitudes</strong> de la plataforma.</p>`
      );
    }

    return res.status(201).json({ message: 'Solicitud enviada correctamente', application });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ message: 'Ya aplicaste a esta oferta' });
    }
    console.error('[affiliateBuyerController.applyToOffer]', err);
    return res.status(500).json({ message: 'Error al aplicar a la oferta' });
  }
};

/**
 * GET /api/affiliates/buyer/mis-ofertas
 * query: status (def 'pending'), page, limit (def 5)
 * Trae, de a 5 por vez, las solicitudes/afiliaciones del comprador.
 */
exports.listMyApplications = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const status = ['pending', 'accepted', 'rejected', 'blocked'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

    const filter = { buyer: buyerId, status };
    const total = await AffiliateOfferApplication.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const applications = await AffiliateOfferApplication.find(filter)
      .populate({ path: 'offer', populate: { path: 'product', select: 'name image price' } })
      .sort({ appliedAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const sellerIds = applications.map((a) => a.seller);
    const sellerApplications = await AffiliateSellerApplication.find({ user: { $in: sellerIds } }).lean();
    const sellerDataById = new Map(sellerApplications.map((s) => [String(s.user), s]));

    const items = applications.map((a) => ({
      applicationId: a._id,
      status: a.status,
      appliedAt: a.appliedAt,
      decidedAt: a.decidedAt,
      rating: a.rating,
      salesCount: a.salesCount,
      commissionPercentage: a.offer ? a.offer.commissionPercentage : null,
      product: a.offer && a.offer.product ? {
        productId: a.offer.product._id,
        name: a.offer.product.name,
        image: a.offer.product.image || null,
        price: a.offer.product.price,
      } : null,
      seller: mapSellerData(sellerDataById.get(String(a.seller))),
      affiliateLink:
        a.status === 'accepted' && a.affiliateCode && a.offer?.product
          ? buildAffiliateLink(a.seller, a.offer.product._id, a.affiliateCode)
          : null,
    }));

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateBuyerController.listMyApplications]', err);
    return res.status(500).json({ message: 'Error al obtener tus solicitudes' });
  }
};

/**
 * GET /api/affiliates/buyer/perfil
 * Devuelve el perfil del comprador afiliado (para precargar el form de edición).
 */
exports.getProfile = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const profile = await AffiliateBuyerApplication.findOne({ user: buyerId }).lean();
    if (!profile) return res.status(404).json({ message: 'No tenés un perfil de afiliado cargado' });

    return res.status(200).json({ profile });
  } catch (err) {
    console.error('[affiliateBuyerController.getProfile]', err);
    return res.status(500).json({ message: 'Error al obtener el perfil' });
  }
};

/**
 * PATCH /api/affiliates/buyer/perfil
 * body: { firstName?, lastName?, email?, phone?, city?, province?, socialMedia?, salesExperience? }
 * El comprador edita sus propios datos (ej. corregir un teléfono mal cargado).
 * Solo actualiza los campos que vienen en el body; el resto queda igual.
 */
exports.updateProfile = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const {
      firstName,
      lastName,
      email,
      phone,
      city,
      province,
      socialMedia,
      salesExperience,
    } = req.body;

    const update = {};

    if (firstName !== undefined) {
      const value = String(firstName).trim();
      if (!value) return res.status(400).json({ message: 'El nombre no puede estar vacío' });
      update.firstName = value;
    }
    if (lastName !== undefined) {
      const value = String(lastName).trim();
      if (!value) return res.status(400).json({ message: 'El apellido no puede estar vacío' });
      update.lastName = value;
    }
    if (email !== undefined) {
      const value = String(email).trim();
      if (!value) return res.status(400).json({ message: 'El email no puede estar vacío' });
      update.email = value.toLowerCase();
    }
    if (phone !== undefined) {
      const value = String(phone).trim();
      if (!value) return res.status(400).json({ message: 'El teléfono no puede estar vacío' });
      update.phone = value;
    }
    if (city !== undefined) {
      const value = String(city).trim();
      if (!value) return res.status(400).json({ message: 'La ciudad no puede estar vacía' });
      update.city = value;
    }
    if (province !== undefined) {
      const value = String(province).trim();
      if (!value) return res.status(400).json({ message: 'La provincia no puede estar vacía' });
      update.province = value;
    }
    // Opcionales en el modelo: se pueden vaciar sin problema.
    if (socialMedia !== undefined) update.socialMedia = String(socialMedia).trim();
    if (salesExperience !== undefined) update.salesExperience = String(salesExperience).trim();

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No se envió ningún dato para actualizar' });
    }

    const profile = await AffiliateBuyerApplication.findOneAndUpdate(
      { user: buyerId },
      update,
      { new: true, runValidators: true }
    );
    if (!profile) return res.status(404).json({ message: 'No tenés un perfil de afiliado cargado' });

    return res.status(200).json({ message: 'Perfil actualizado correctamente', profile });
  } catch (err) {
    console.error('[affiliateBuyerController.updateProfile]', err);
    return res.status(500).json({ message: 'Error al actualizar el perfil' });
  }
};

/**
 * GET /api/affiliates/buyer/mis-ventas
 * query: page, limit (def 5), applicationId? (para filtrar por una sola afiliación)
 * Detalle de las ventas que generó el afiliado: qué producto, a qué vendedor,
 * cuánto vendió y cuánta comisión le corresponde por cada una, más un total
 * acumulado de comisión y cantidad.
 */
exports.listMySales = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const { applicationId } = req.query;

    const filter = { affiliate: buyerId };
    if (applicationId && mongoose.Types.ObjectId.isValid(applicationId)) {
      filter.application = applicationId;
    }

    const total = await AffiliateSale.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const sales = await AffiliateSale.find(filter)
      .sort({ date: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const sellerIds = sales.map((s) => s.seller);
    const sellerApplications = await AffiliateSellerApplication.find({ user: { $in: sellerIds } }).lean();
    const sellerDataById = new Map(sellerApplications.map((s) => [String(s.user), s]));

    const items = sales.map((s) => ({
      saleId: s._id,
      date: s.date,
      productName: s.productName,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      commissionPercentage: s.commissionPercentage,
      commissionAmount: s.commissionAmount,
      seller: mapSellerData(sellerDataById.get(String(s.seller))),
    }));

    const totalsMatch = { affiliate: new mongoose.Types.ObjectId(buyerId) };
    if (filter.application) totalsMatch.application = new mongoose.Types.ObjectId(filter.application);

    const totalsAgg = await AffiliateSale.aggregate([
      { $match: totalsMatch },
      {
        $group: {
          _id: null,
          totalCommission: { $sum: '$commissionAmount' },
          totalQuantity: { $sum: '$quantity' },
        },
      },
    ]);

    return res.status(200).json({
      items,
      page: safePage,
      totalPages,
      total,
      limit,
      totalCommission: totalsAgg[0]?.totalCommission || 0,
      totalQuantity: totalsAgg[0]?.totalQuantity || 0,
    });
  } catch (err) {
    console.error('[affiliateBuyerController.listMySales]', err);
    return res.status(500).json({ message: 'Error al obtener tus ventas' });
  }
};
