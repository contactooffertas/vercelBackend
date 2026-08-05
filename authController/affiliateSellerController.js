// authController/affiliateSellerController.js
//
const mongoose = require('mongoose');
const Product = require('../models/productoModel');
const AffiliateOffer = require('../models/AffiliateOffer');
const AffiliateOfferApplication = require('../models/AffiliateOfferApplication');
const AffiliateSellerApplication = require('../models/AffiliateSellerApplication');
const AffiliateBuyerApplication = require('../models/AffiliateBuyerApplication');
const AffiliateSale = require('../models/AffiliateSale');
const generateAffiliateCode = require('../utils/generateAffiliateCode');
const sendEmail = require('../utils/sendMail');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ofertas-lime-ten.vercel.app';
const BACKEND_URL = process.env.BACKEND_URL || 'https://new-backend-lovat.vercel.app';
const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function isSeller(req) {
  return !!req.user && req.user.role === 'seller';
}

function getSellerId(req) {
  return req.user.id || req.user._id;
}

async function getActiveSellerProgram(userId) {
  return AffiliateSellerApplication.findOne({ user: userId, status: 'active' });
}

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

function daysBetween(from, to) {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

// NUEVO: antes se mandaba sale.dueDate crudo, que podía venir null en
// registros viejos (o generados antes de este fix) y el frontend terminaba
// mostrando "-" o "null". Ahora, si no hay dueDate guardado, se calcula uno
// en base a la fecha de la venta + 30 días por defecto, para que SIEMPRE
// haya una fecha de vencimiento válida.
function resolveDueDate(sale) {
  if (sale.dueDate) return new Date(sale.dueDate);
  const base = sale.date ? new Date(sale.date) : new Date(sale.createdAt || Date.now());
  return new Date(base.getTime() + DEFAULT_TERM_DAYS * DAY_MS);
}

/**
 * GET /api/affiliates/seller/products
 */
exports.getSellerProducts = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const search = (req.query.search || '').trim();

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

    const appIds = applications.map((a) => a._id);
    const salesAgg = await AffiliateSale.aggregate([
      { $match: { application: { $in: appIds } } },
      {
        $group: {
          _id: '$application',
          totalSalesAmount: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
          totalCommissionOwed: { $sum: '$commissionAmount' },
          totalCommissionPending: {
            $sum: { $cond: [{ $eq: ['$paid', false] }, '$commissionAmount', 0] },
          },
        },
      },
    ]);
    const salesByApp = new Map(salesAgg.map((s) => [String(s._id), s]));

    const items = applications.map((a) => {
      const productId = a.offer?.product ? String(a.offer.product) : null;
      const salesSummary = salesByApp.get(String(a._id));
      return {
        applicationId: a._id,
        status: a.status,
        rating: a.rating,
        salesCount: a.salesCount,
        totalSalesAmount: salesSummary?.totalSalesAmount || 0,
        totalCommissionOwed: salesSummary?.totalCommissionOwed || 0,
        totalCommissionPending: salesSummary?.totalCommissionPending || 0,
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

/**
 * GET /api/affiliates/seller/resumen
 * FIX: usa resolveDueDate en vez de sale.dueDate crudo, así nunca llega
 * null al frontend aunque la venta sea vieja o le falte el campo.
 */
exports.getPayablesSummary = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const now = new Date();

    const sales = await AffiliateSale.find({ seller: sellerId }).sort({ date: -1 }).lean();

    const buyerIds = [...new Set(sales.map((s) => String(s.affiliate)))];
    const buyerApplications = await AffiliateBuyerApplication.find({ user: { $in: buyerIds } }).lean();
    const buyerDataById = new Map(buyerApplications.map((b) => [String(b.user), b]));

    let totalToPay = 0;
    let totalPaidHistoric = 0;
    const pendingSales = [];
    const urgentSales = [];
    const disputedSales = [];
    const paidSales = [];
    const byAffiliateMap = new Map();

    for (const sale of sales) {
      if (sale.paid) {
        totalPaidHistoric += sale.commissionAmount;
        paidSales.push({
          saleId: sale._id,
          productName: sale.productName,
          affiliate: mapBuyerData(buyerDataById.get(String(sale.affiliate))),
          date: sale.date,
          paidAt: sale.paidAt,
          quantity: sale.quantity,
          unitPrice: sale.unitPrice,
          totalAmount: sale.quantity * sale.unitPrice,
          commissionAmount: sale.commissionAmount,
          proofUrl: sale.paymentProofUrl || null,
        });
        continue;
      }

      totalToPay += sale.commissionAmount;
      const dueDate = resolveDueDate(sale);
      const daysRemaining = daysBetween(now, dueDate);
      const buyerData = mapBuyerData(buyerDataById.get(String(sale.affiliate)));
      const item = {
        saleId: sale._id,
        productName: sale.productName,
        affiliate: buyerData,
        date: sale.date,
        dueDate,
        daysRemaining,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        totalAmount: sale.quantity * sale.unitPrice,
        commissionAmount: sale.commissionAmount,
        paymentDisputed: sale.rejected,
        disputeReason: sale.rejectionReason || null,
      };
      pendingSales.push(item);
      if (daysRemaining <= 5) urgentSales.push(item);
      if (sale.rejected) disputedSales.push(item);

      const key = String(sale.affiliate);
      const entry = byAffiliateMap.get(key) || { affiliate: buyerData, totalPending: 0, sales: [] };
      entry.totalPending += sale.commissionAmount;
      entry.sales.push(item);
      byAffiliateMap.set(key, entry);
    }

    pendingSales.sort((a, b) => a.daysRemaining - b.daysRemaining);
    urgentSales.sort((a, b) => a.daysRemaining - b.daysRemaining);
    disputedSales.sort((a, b) => a.daysRemaining - b.daysRemaining);
    paidSales.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    const byAffiliate = Array.from(byAffiliateMap.values()).sort((a, b) => b.totalPending - a.totalPending);

    return res.status(200).json({
      totalToPay,
      totalPaidHistoric,
      pendingSales,
      urgentSales,
      disputedSales,
      paidSales,
      byAffiliate,
    });
  } catch (err) {
    console.error('[affiliateSellerController.getPayablesSummary]', err);
    return res.status(500).json({ message: 'Error al obtener el resumen de pagos' });
  }
};

/**
 * PATCH /api/affiliates/seller/sales/:saleId/pay
 */
exports.markSaleAsPaid = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { saleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ message: 'Venta inválida' });
    }

    const sale = await AffiliateSale.findOneAndUpdate(
      { _id: saleId, seller: sellerId, paid: false },
      { paid: true, paidAt: new Date() },
      { new: true }
    );
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada o ya estaba pagada' });

    return res.status(200).json({ message: 'Venta marcada como pagada', sale });
  } catch (err) {
    console.error('[affiliateSellerController.markSaleAsPaid]', err);
    return res.status(500).json({ message: 'Error al marcar la venta como pagada' });
  }
};

/**
 * PATCH /api/affiliates/seller/sales/:saleId/proof
 */
exports.updateSaleProof = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { saleId } = req.params;
    const { proofUrl, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ message: 'Venta inválida' });
    }

    if (proofUrl !== undefined && !String(proofUrl).trim()) {
      return res.status(400).json({ message: 'El comprobante no puede estar vacío' });
    }

    const update = { paymentProofUpdatedAt: new Date() };
    if (proofUrl !== undefined) update.paymentProofUrl = String(proofUrl).trim();
    if (note !== undefined) update.paymentProofNote = String(note).trim();

    const sale = await AffiliateSale.findOneAndUpdate(
      { _id: saleId, seller: sellerId },
      update,
      { new: true, runValidators: true }
    );
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada' });

    return res.status(200).json({ message: 'Comprobante actualizado correctamente', sale });
  } catch (err) {
    console.error('[affiliateSellerController.updateSaleProof]', err);
    return res.status(500).json({ message: 'Error al actualizar el comprobante de pago' });
  }
};

/**
 * GET /api/affiliates/seller/perfil
 */
exports.getProfile = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const profile = await AffiliateSellerApplication.findOne({ user: sellerId }).lean();
    if (!profile) return res.status(404).json({ message: 'No tenés un perfil de vendedor afiliado cargado' });

    return res.status(200).json({
      profile: { ...profile, paymentTermDays: profile.paymentTermDays === 15 ? 15 : 30 },
    });
  } catch (err) {
    console.error('[affiliateSellerController.getProfile]', err);
    return res.status(500).json({ message: 'Error al obtener el perfil' });
  }
};

/**
 * PATCH /api/affiliates/seller/perfil
 * FIX: ahora sí lee y guarda paymentTermDays (15 o 30). Antes el campo
 * llegaba en el body pero se ignoraba por completo, por eso el select del
 * frontend nunca surtía efecto.
 */
exports.updateProfile = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const {
      businessName,
      contactName,
      email,
      phone,
      description,
      defaultPercentage,
      maxAffiliates,
      paymentTermDays,
    } = req.body;

    const update = {};

    if (businessName !== undefined) {
      const value = String(businessName).trim();
      if (!value) return res.status(400).json({ message: 'El nombre del negocio no puede estar vacío' });
      update.businessName = value;
    }
    if (contactName !== undefined) {
      const value = String(contactName).trim();
      if (!value) return res.status(400).json({ message: 'El nombre de contacto no puede estar vacío' });
      update.contactName = value;
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
    if (description !== undefined) {
      const value = String(description).trim();
      if (!value) return res.status(400).json({ message: 'La descripción no puede estar vacía' });
      update.description = value;
    }
    if (defaultPercentage !== undefined) {
      const pct = Number(defaultPercentage);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ message: 'El porcentaje por defecto debe estar entre 0 y 100' });
      }
      update.defaultPercentage = pct;
    }
    if (maxAffiliates !== undefined) {
      const max = Number(maxAffiliates);
      if (Number.isNaN(max) || max < 1) {
        return res.status(400).json({ message: 'El máximo de afiliados debe ser al menos 1' });
      }
      update.maxAffiliates = max;
    }
    if (paymentTermDays !== undefined) {
      const term = Number(paymentTermDays);
      if (term !== 15 && term !== 30) {
        return res.status(400).json({ message: 'El ciclo de pago debe ser 15 o 30 días' });
      }
      update.paymentTermDays = term;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No se envió ningún dato para actualizar' });
    }

    const profile = await AffiliateSellerApplication.findOneAndUpdate(
      { user: sellerId },
      update,
      { new: true, runValidators: true }
    );
    if (!profile) return res.status(404).json({ message: 'No tenés un perfil de vendedor afiliado cargado' });

    return res.status(200).json({
      message: 'Perfil actualizado correctamente',
      profile: { ...profile.toObject(), paymentTermDays: profile.paymentTermDays === 15 ? 15 : 30 },
    });
  } catch (err) {
    console.error('[affiliateSellerController.updateProfile]', err);
    return res.status(500).json({ message: 'Error al actualizar el perfil' });
  }
};

/**
 * GET /api/affiliates/seller/offers/:offerId/sales
 */
exports.listOfferSales = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(403).json({ message: 'Solo los vendedores pueden acceder' });

    const sellerId = getSellerId(req);
    const { offerId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

    const offer = await AffiliateOffer.findOne({ _id: offerId, seller: sellerId }).lean();
    if (!offer) return res.status(404).json({ message: 'Oferta no encontrada' });

    const filter = { offer: offerId, seller: sellerId };
    const total = await AffiliateSale.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    const sales = await AffiliateSale.find(filter)
      .sort({ date: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    const affiliateIds = sales.map((s) => s.affiliate);
    const buyerApplications = await AffiliateBuyerApplication.find({ user: { $in: affiliateIds } }).lean();
    const buyerDataById = new Map(buyerApplications.map((b) => [String(b.user), b]));

    const items = sales.map((s) => ({
      saleId: s._id,
      date: s.date,
      dueDate: resolveDueDate(s),
      paid: s.paid,
      paymentProofUrl: s.paymentProofUrl,
      paymentProofNote: s.paymentProofNote,
      productName: s.productName,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      totalAmount: s.quantity * s.unitPrice,
      commissionPercentage: s.commissionPercentage,
      commissionAmount: s.commissionAmount,
      affiliate: mapBuyerData(buyerDataById.get(String(s.affiliate))),
    }));

    const totalsAgg = await AffiliateSale.aggregate([
      {
        $match: {
          offer: new mongoose.Types.ObjectId(offerId),
          seller: new mongoose.Types.ObjectId(sellerId),
        },
      },
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
    console.error('[affiliateSellerController.listOfferSales]', err);
    return res.status(500).json({ message: 'Error al obtener las ventas' });
  }
};

exports.getNotificationBadge = async (req, res) => {
  try {
    if (!isSeller(req)) return res.status(200).json({ count: 0 });

    const sellerId = getSellerId(req);
    const now = new Date();

    const [pendingApps, unpaidSales] = await Promise.all([
      AffiliateOfferApplication.countDocuments({ seller: sellerId, status: 'pending' }),
      AffiliateSale.find({ seller: sellerId, paid: false }).select('date dueDate createdAt rejected').lean(),
    ]);

    let urgentOrDisputed = 0;
    for (const sale of unpaidSales) {
      const dueDate = resolveDueDate(sale);
      const daysRemaining = daysBetween(now, dueDate);
      if (daysRemaining <= 5 || sale.rejected) urgentOrDisputed += 1;
    }

    return res.status(200).json({ count: pendingApps + urgentOrDisputed });
  } catch (err) {
    console.error('[affiliateSellerController.getNotificationBadge]', err);
    return res.status(200).json({ count: 0 });
  }
};
