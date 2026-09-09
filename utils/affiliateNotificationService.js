const mongoose = require('mongoose');
const AffiliateReadState = require('../models/AffiliateReadState');
const AffiliateOffer = require('../models/AffiliateOffer');
const AffiliateOfferApplication = require('../models/AffiliateOfferApplication');
const AffiliateSale = require('../models/AffiliateSale');

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_WINDOW_MS = 5 * DAY_MS;

function roleFor(req) {
  return req.user?.role === 'seller' ? 'seller' : 'buyer';
}

function userIdFor(req) {
  return req.user?.id || req.user?._id;
}

async function getState(userId, role) {
  return AffiliateReadState.findOneAndUpdate(
    { user: userId, role },
    { $setOnInsert: { user: userId, role } },
    { upsert: true, new: true },
  ).lean();
}

async function markSeen(userId, role, section) {
  const fieldMap = {
    stores: 'storesSeenAt',
    applications: 'applicationsSeenAt',
    sales: 'salesSeenAt',
    payments: 'paymentsSeenAt',
  };
  const field = fieldMap[section];
  if (!field) return;
  await AffiliateReadState.findOneAndUpdate(
    { user: userId, role },
    { $set: { [field]: new Date() }, $setOnInsert: { user: userId, role } },
    { upsert: true },
  );
}

function markSectionAfterSuccess(section) {
  return (req, res, next) => {
    const userId = userIdFor(req);
    const role = roleFor(req);
    if (!userId) return next();
    res.on('finish', () => {
      if (res.statusCode < 400) {
        markSeen(userId, role, section).catch((err) =>
          console.warn('[AffiliateReadState] markSeen:', err.message),
        );
      }
    });
    next();
  };
}

async function buyerBadge(req, res) {
  try {
    const buyerId = userIdFor(req);
    if (!buyerId || req.user?.role === 'seller' || req.user?.role === 'admin') {
      return res.status(200).json({ count: 0, pendingApplications: 0, urgentSales: 0, newStores: 0 });
    }

    const state = await getState(buyerId, 'buyer');
    const now = new Date();
    const urgentThresholdSeen = state.paymentsSeenAt || new Date(0);

    const [applicationUpdates, salesCreated, paymentUpdates, newStoreAgg, urgentAgg] = await Promise.all([
      AffiliateOfferApplication.countDocuments({
        buyer: buyerId,
        status: { $in: ['accepted', 'rejected', 'blocked'] },
        updatedAt: { $gt: state.applicationsSeenAt || new Date(0) },
      }),
      AffiliateSale.countDocuments({
        affiliate: buyerId,
        createdAt: { $gt: state.salesSeenAt || new Date(0) },
      }),
      AffiliateSale.countDocuments({
        affiliate: buyerId,
        paidAt: { $gt: state.paymentsSeenAt || new Date(0) },
      }),
      AffiliateOffer.aggregate([
        { $match: { active: true } },
        { $group: { _id: '$seller', joinedAt: { $min: '$createdAt' } } },
        { $match: { joinedAt: { $gt: state.storesSeenAt || new Date(0) } } },
        { $count: 'total' },
      ]),
      AffiliateSale.aggregate([
        { $match: { affiliate: new mongoose.Types.ObjectId(String(buyerId)), paid: false } },
        {
          $addFields: {
            urgentAt: { $subtract: ['$dueDate', URGENT_WINDOW_MS] },
          },
        },
        {
          $match: {
            urgentAt: { $lte: now, $gt: urgentThresholdSeen },
          },
        },
        { $count: 'total' },
      ]),
    ]);

    const newStores = newStoreAgg[0]?.total || 0;
    const urgentTransitions = urgentAgg[0]?.total || 0;
    const urgentSales = salesCreated + paymentUpdates + urgentTransitions;

    return res.status(200).json({
      count: applicationUpdates + urgentSales + newStores,
      pendingApplications: applicationUpdates,
      urgentSales,
      newStores,
    });
  } catch (err) {
    console.error('[affiliateNotificationService.buyerBadge]', err);
    return res.status(200).json({ count: 0, pendingApplications: 0, urgentSales: 0, newStores: 0 });
  }
}

async function sellerBadge(req, res) {
  try {
    const sellerId = userIdFor(req);
    if (!sellerId || req.user?.role !== 'seller') {
      return res.status(200).json({ count: 0, pendingApplications: 0, urgentOrDisputed: 0 });
    }

    const state = await getState(sellerId, 'seller');
    const now = new Date();

    const [newApplications, newSales, disputedSales, urgentAgg] = await Promise.all([
      AffiliateOfferApplication.countDocuments({
        seller: sellerId,
        status: 'pending',
        appliedAt: { $gt: state.applicationsSeenAt || new Date(0) },
      }),
      AffiliateSale.countDocuments({
        seller: sellerId,
        createdAt: { $gt: state.salesSeenAt || new Date(0) },
      }),
      AffiliateSale.countDocuments({
        seller: sellerId,
        rejected: true,
        rejectedAt: { $gt: state.paymentsSeenAt || new Date(0) },
      }),
      AffiliateSale.aggregate([
        { $match: { seller: new mongoose.Types.ObjectId(String(sellerId)), paid: false } },
        { $addFields: { urgentAt: { $subtract: ['$dueDate', URGENT_WINDOW_MS] } } },
        {
          $match: {
            urgentAt: { $lte: now, $gt: state.paymentsSeenAt || new Date(0) },
          },
        },
        { $count: 'total' },
      ]),
    ]);

    const urgentOrDisputed = newSales + disputedSales + (urgentAgg[0]?.total || 0);

    return res.status(200).json({
      count: newApplications + urgentOrDisputed,
      pendingApplications: newApplications,
      urgentOrDisputed,
    });
  } catch (err) {
    console.error('[affiliateNotificationService.sellerBadge]', err);
    return res.status(200).json({ count: 0, pendingApplications: 0, urgentOrDisputed: 0 });
  }
}

module.exports = {
  buyerBadge,
  sellerBadge,
  markSectionAfterSuccess,
  markSeen,
};
