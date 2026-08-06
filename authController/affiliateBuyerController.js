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

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ofertas-lime-ten.vercel.app';
const BACKEND_URL = process.env.BACKEND_URL || 'https://new-backend-lovat.vercel.app';
const CURRENT_TERMS_VERSION = 1;
const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_STORE_WINDOW_MS = 30 * DAY_MS;

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
    paymentTermDays: sellerApp.paymentTermDays === 15 ? 15 : 30,
  };
}

function daysBetween(from, to) {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

function resolveDueDate(sale) {
  if (sale.dueDate) return new Date(sale.dueDate);
  const base = sale.date ? new Date(sale.date) : new Date(sale.createdAt || Date.now());
  return new Date(base.getTime() + DEFAULT_TERM_DAYS * DAY_MS);
}

/**
 * GET /api/affiliates/buyer/stores
 * Lista TIENDAS (no productos) con paginación de a 3, con tabs: todas | nuevas | mis-tiendas
 */
exports.getAvailableStores = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 3));
    const tab = ['todas', 'nuevas', 'mis-tiendas'].includes(req.query.tab) ? req.query.tab : 'todas';
    const search = (req.query.search || '').trim();

    const matchStage = { active: true };

    if (tab === 'mis-tiendas') {
      const mySellers = await AffiliateOfferApplication.find({ buyer: buyerId, status: 'accepted' }).distinct('seller');
      if (mySellers.length === 0) {
        return res.status(200).json({ items: [], page: 1, totalPages: 1, total: 0, limit, tab });
      }
      matchStage.seller = { $in: mySellers };
    }

    const grouped = await AffiliateOffer.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      { $unwind: '$productDoc' },
      { $match: { 'productDoc.blocked': { $ne: true } } },
      {
        $group: {
          _id: '$seller',
          minCommission: { $min: '$commissionPercentage' },
          maxCommission: { $max: '$commissionPercentage' },
          offerCount: { $sum: 1 },
          categories: { $push: '$productDoc.category' },
          joinedAt: { $min: '$createdAt' },
        },
      },
    ]);

    const sellerIds = grouped.map((g) => g._id);
    const sellerApplications = await AffiliateSellerApplication.find({ user: { $in: sellerIds } }).lean();
    const sellerDataById = new Map(sellerApplications.map((s) => [String(s.user), s]));

    let stores = grouped
      .filter((g) => sellerDataById.has(String(g._id)))
      .map((g) => {
        const sellerApp = sellerDataById.get(String(g._id));
        const categoryCounts = {};
        for (const cat of g.categories) {
          const key = cat || 'general';
          categoryCounts[key] = (categoryCounts[key] || 0) + 1;
        }
        const mainCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';

        return {
          sellerId: g._id,
          businessName: sellerApp.businessName,
          contactName: sellerApp.contactName,
          email: sellerApp.email,
          phone: sellerApp.phone,
          description: sellerApp.description,
          category: mainCategory,
          offerCount: g.offerCount,
          commissionMin: g.minCommission,
          commissionMax: g.maxCommission,
          joinedAt: g.joinedAt,
        };
      });

    if (search) {
      const re = new RegExp(search, 'i');
      stores = stores.filter((s) => re.test(s.businessName || ''));
    }

    if (tab === 'nuevas') {
      const now = Date.now();
      stores = stores.filter((s) => now - new Date(s.joinedAt).getTime() <= NEW_STORE_WINDOW_MS);
    }

    stores.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));

    const total = stores.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const items = stores.slice((safePage - 1) * limit, safePage * limit);

    return res.status(200).json({ items, page: safePage, totalPages, total, limit, tab });
  } catch (err) {
    console.error('[affiliateBuyerController.getAvailableStores]', err);
    return res.status(500).json({ message: 'Error al obtener las tiendas' });
  }
};

/**
 * GET /api/affiliates/buyer/stores/:sellerId/products
 * Productos en oferta de UNA tienda puntual, marcando a cuáles ya estoy afiliado.
 */
exports.getStoreProducts = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const { sellerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ message: 'Tienda inválida' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const search = (req.query.search || '').trim();

    const sellerApp = await AffiliateSellerApplication.findOne({ user: sellerId }).lean();
    if (!sellerApp) return res.status(404).json({ message: 'Tienda no encontrada' });

    const filter = { active: true, seller: sellerId };
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
      .populate('product', 'name image price category')
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

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
          category: o.product.category,
        },
        applicationStatus: myStatusByOffer.get(String(o._id)) || null,
      }));

    return res.status(200).json({
      items,
      page: safePage,
      totalPages,
      total,
      limit,
      store: {
        sellerId,
        businessName: sellerApp.businessName,
        contactName: sellerApp.contactName,
        email: sellerApp.email,
        phone: sellerApp.phone,
        description: sellerApp.description,
        paymentTermDays: sellerApp.paymentTermDays === 15 ? 15 : 30,
      },
    });
  } catch (err) {
    console.error('[affiliateBuyerController.getStoreProducts]', err);
    return res.status(500).json({ message: 'Error al obtener los productos de la tienda' });
  }
};

/**
 * POST /api/affiliates/buyer/offers/:offerId/apply
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
 * Agrupado por TIENDA (paginado de a 3 tiendas), cada tienda trae sus productos/aplicaciones adentro.
 *
 * Cada aplicación incluye ahora:
 *  - product.stock: stock actual del producto (si el campo en Product se llama
 *    distinto de "stock", ajustar el select de abajo y este mapeo).
 *  - offerActive: true si la oferta del vendedor sigue activa, false si la
 *    desactivó (o si el offer ya no existe). El frontend usa esto y el stock
 *    para OCULTAR el producto de "Mis Ofertas" cuando no está disponible, así
 *    el afiliado no sigue compartiendo un link que no le va a generar comisión.
 */
exports.listMyApplications = async (req, res) => {
  try {
    if (!isBuyer(req)) return res.status(403).json({ message: 'Solo los compradores pueden acceder' });

    const buyerId = getBuyerId(req);
    const status = ['pending', 'accepted', 'rejected', 'blocked'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 3));

    const applications = await AffiliateOfferApplication.find({ buyer: buyerId, status })
      .populate({ path: 'offer', populate: { path: 'product', select: 'name image price stock' } })
      .sort({ appliedAt: -1 })
      .lean();

    const sellerIds = [...new Set(applications.map((a) => String(a.seller)))];
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

    const storeMap = new Map();
    for (const a of applications) {
      const sellerKey = String(a.seller);
      if (!storeMap.has(sellerKey)) {
        storeMap.set(sellerKey, {
          sellerId: a.seller,
          seller: mapSellerData(sellerDataById.get(sellerKey)),
          latestAppliedAt: a.appliedAt,
          applications: [],
          totalSalesAmount: 0,
          totalEarnedCommission: 0,
          totalPendingCommission: 0,
        });
      }
      const storeEntry = storeMap.get(sellerKey);
      const salesSummary = salesByApp.get(String(a._id));
      const item = {
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
          stock: typeof a.offer.product.stock === 'number' ? a.offer.product.stock : undefined,
        } : null,
        // true = oferta activa. false = el vendedor la desactivó o el offer
        // ya no existe. El frontend oculta el producto de "Mis Ofertas" si
        // esto es false o si el stock llegó a 0.
        offerActive: a.offer ? !!a.offer.active : false,
        affiliateLink:
          a.status === 'accepted' && a.affiliateCode && a.offer?.product
            ? buildAffiliateLink(a.seller, a.offer.product._id, a.affiliateCode)
            : null,
      };
      storeEntry.applications.push(item);
      storeEntry.totalSalesAmount += item.totalSalesAmount;
      storeEntry.totalEarnedCommission += item.totalEarnedCommission;
      storeEntry.totalPendingCommission += item.totalPendingCommission;
      if (new Date(a.appliedAt) > new Date(storeEntry.latestAppliedAt)) {
        storeEntry.latestAppliedAt = a.appliedAt;
      }
    }

    let stores = Array.from(storeMap.values()).filter((s) => s.seller);
    stores.sort((a, b) => new Date(b.latestAppliedAt) - new Date(a.latestAppliedAt));

    const total = stores.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const items = stores.slice((safePage - 1) * limit, safePage * limit);

    return res.status(200).json({ items, page: safePage, totalPages, total, limit });
  } catch (err) {
    console.error('[affiliateBuyerController.listMyApplications]', err);
    return res.status(500).json({ message: 'Error al obtener tus solicitudes' });
  }
};

/**
 * GET /api/affiliates/buyer/resumen
 * Agrupado por TIENDA.
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
    const urgentSales = [];
    const storeMap = new Map();

    for (const sale of sales) {
      const sellerKey = String(sale.seller);
      if (!storeMap.has(sellerKey)) {
        storeMap.set(sellerKey, {
          sellerId: sale.seller,
          seller: mapSellerData(sellerDataById.get(sellerKey)),
          totalEarned: 0,
          totalPending: 0,
          totalCollected: 0,
          pendingSales: [],
          paidSales: [],
        });
      }
      const storeEntry = storeMap.get(sellerKey);

      totalEarned += sale.commissionAmount;
      storeEntry.totalEarned += sale.commissionAmount;

      if (sale.paid) {
        totalCollected += sale.commissionAmount;
        storeEntry.totalCollected += sale.commissionAmount;
        storeEntry.paidSales.push({
          saleId: sale._id,
          productName: sale.productName,
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

      totalPending += sale.commissionAmount;
      storeEntry.totalPending += sale.commissionAmount;
      const dueDate = resolveDueDate(sale);
      const daysRemaining = daysBetween(now, dueDate);
      const item = {
        saleId: sale._id,
        productName: sale.productName,
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
      storeEntry.pendingSales.push(item);
      if (daysRemaining <= 5) {
        urgentSales.push({ ...item, seller: storeEntry.seller });
      }
    }

    const stores = Array.from(storeMap.values())
      .filter((s) => s.seller)
      .map((s) => {
        s.pendingSales.sort((a, b) => a.daysRemaining - b.daysRemaining);
        s.paidSales.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
        return s;
      })
      .sort((a, b) => b.totalPending - a.totalPending);

    urgentSales.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return res.status(200).json({
      totalEarned,
      totalPending,
      totalCollected,
      stores,
      urgentSales,
    });
  } catch (err) {
    console.error('[affiliateBuyerController.getEarningsSummary]', err);
    return res.status(500).json({ message: 'Error al obtener tu resumen de ganancias' });
  }
};

/**
 * GET /api/affiliates/buyer/perfil
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
      dueDate: resolveDueDate(s),
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

/**
 * PATCH /api/affiliates/buyer/sales/:saleId/reject-payment
 */
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


exports.getNotificationBadge = async (req, res) => {
  try {
    if (!isBuyer(req)) {
      return res.status(200).json({ count: 0, pendingApplications: 0, urgentSales: 0, newStores: 0 });
    }

    const buyerId = getBuyerId(req);
    const now = new Date();

    const [pendingApplications, unpaidSales, newStoreSellers] = await Promise.all([
      AffiliateOfferApplication.countDocuments({ buyer: buyerId, status: 'pending' }),
      AffiliateSale.find({ affiliate: buyerId, paid: false }).select('date dueDate createdAt').lean(),
      AffiliateOffer.aggregate([
        { $match: { active: true } },
        { $group: { _id: '$seller', joinedAt: { $min: '$createdAt' } } },
        { $match: { joinedAt: { $gte: new Date(now.getTime() - NEW_STORE_WINDOW_MS) } } },
        { $count: 'total' },
      ]),
    ]);

    let urgentSales = 0;
    for (const sale of unpaidSales) {
      const dueDate = resolveDueDate(sale);
      const daysRemaining = daysBetween(now, dueDate);
      if (daysRemaining <= 5) urgentSales += 1;
    }

    const newStores = newStoreSellers[0]?.total || 0;

    return res.status(200).json({
      count: pendingApplications + urgentSales,
      pendingApplications,
      urgentSales,
      newStores,
    });
  } catch (err) {
    console.error('[affiliateBuyerController.getNotificationBadge]', err);
    return res.status(200).json({ count: 0, pendingApplications: 0, urgentSales: 0, newStores: 0 });
  }
};
