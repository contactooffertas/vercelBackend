// authController/affiliateBuyerController.js
//
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

function daysBetween(from, to) {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * GET /api/affiliates/buyer/offers
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

    const appIds = applications.map((a) => a._id);
    const salesAgg = await AffiliateSale.aggregate([
      { $match: { application: { $in: appIds } } },
      {
        $group: {
          _id: '$application',
          totalSalesAmount: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
          totalEarnedCommission: { $sum: '$commissionAmount' },
          totalPendingCommission: {
            $sum: { $cond: [{ $eq: ['$paid', false] }, '$commissionAmount', 0] },
          },
        },
      },
    ]);
    const salesByApp = new Map(salesAgg.map((s) => [String(s._id), s]));

    const items = applications.map((a) => {
      const salesSummary = salesByApp.get(String(a._id));
      return {
        applicationId: a._id,
        status: a.status,
        appliedAt: a.appliedAt,
        decidedAt: a.decidedAt,
        rating: a.rating,
        salesCount: a.salesCount,
        totalSalesAmount: salesSummary?.totalSalesAmount || 0,
        totalEarnedCommission: salesSummary?.totalEarnedCommission || 0,
        totalPendingCommission: salesSummary?.totalPendingCommission || 0,
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
      };
    });

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateBuyerController.listMyApplications]', err);
    return res.status(500).json({ message: 'Error al obtener tus solicitudes' });
  }
};

/**
 * GET /api/affiliates/buyer/resumen
 */
exports.getEarningsSummary = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const now = new Date();

    const sales = await AffiliateSale.find({ affiliate: buyerId }).sort({ date: -1 }).lean();

    const sellerIds = [...new Set(sales.map((s) => String(s.seller)))];
    const sellerApplications = await AffiliateSellerApplication.find({ user: { $in: sellerIds } }).lean();
    const sellerDataById = new Map(sellerApplications.map((s) => [String(s.user), s]));

    let totalEarned = 0;
    let totalPending = 0;
    let totalCollected = 0;
    const pendingSales = [];
    const urgentSales = [];

    for (const sale of sales) {
      totalEarned += sale.commissionAmount;

      if (sale.paid) {
        totalCollected += sale.commissionAmount;
        continue;
      }

      totalPending += sale.commissionAmount;
      const daysRemaining = daysBetween(now, new Date(sale.dueDate));
      const item = {
        saleId: sale._id,
        productName: sale.productName,
        seller: mapSellerData(sellerDataById.get(String(sale.seller))),
        date: sale.date,
        dueDate: sale.dueDate,
        daysRemaining,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        totalAmount: sale.quantity * sale.unitPrice,
        commissionAmount: sale.commissionAmount,
        rejected: sale.rejected,
      };
      pendingSales.push(item);
      if (daysRemaining <= 5) urgentSales.push(item);
    }

    pendingSales.sort((a, b) => a.daysRemaining - b.daysRemaining);
    urgentSales.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return res.status(200).json({
      totalEarned,
      totalPending,
      totalCollected,
      pendingSales,
      urgentSales,
    });
  } catch (err) {
    console.error('[affiliateBuyerController.getEarningsSummary]', err);
    return res.status(500).json({ message: 'Error al obtener tu resumen de ganancias' });
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
      dueDate: s.dueDate,
      paid: s.paid,
      paidAt: s.paidAt,
      rejected: s.rejected,
      rejectedAt: s.rejectedAt,
      rejectionReason: s.rejectionReason,
      productName: s.productName,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      totalAmount: s.quantity * s.unitPrice,
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
          totalAmount: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
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
      totalAmount: totalsAgg[0]?.totalAmount || 0,
    });
  } catch (err) {
    console.error('[affiliateBuyerController.listMySales]', err);
    return res.status(500).json({ message: 'Error al obtener tus ventas' });
  }
};

exports.rejectPayment = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const { saleId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ message: 'Venta inválida' });
    }

    const sale = await AffiliateSale.findOne({ _id: saleId, affiliate: buyerId });
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada' });

    if (sale.paid) {
      return res.status(400).json({ message: 'No podés rechazar una venta que ya fue pagada' });
    }

    if (sale.rejected) {
      return res.status(200).json({ message: 'Esta venta ya estaba marcada como rechazada', sale });
    }

    sale.rejected = true;
    sale.rejectedAt = new Date();
    if (reason !== undefined) sale.rejectionReason = String(reason).trim();
    await sale.save();

    return res.status(200).json({ message: 'Venta marcada como rechazada correctamente', sale });
  } catch (err) {
    console.error('[affiliateBuyerController.rejectPayment]', err);
    return res.status(500).json({ message: 'Error al rechazar el pago de la venta' });
  }
};
