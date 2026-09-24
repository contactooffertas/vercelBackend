const express = require("express");
const router  = express.Router();
const Order = require('../models/orderModel');
const { canAdminCompleteDelivery } = require('../utils/orderLifecycle');
const auth    = require("../middleware/authMiddleware");
const { getAdminFunnel, clearAdminFunnel } = require("../authController/adminFunnelController");
const {
  adminGetDictionary,
  adminCreateKeyword,
  adminUpdateKeyword,
  adminDeleteKeyword,
  adminCreateForbidden,
  adminUpdateForbidden,
  adminDeleteForbidden,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
} = require("../authController/searchController");

const {
  requireAdmin,
  getDashboardStats,
  getAllUsers,
  toggleBlockUser,
  changeUserRole,
  getAllBusinesses,
  toggleVerifyBusiness,
  toggleBlockBusiness,
  getAllFeatured,
  setFeatured,
  confirmFeaturedPayment,
  removeFeatured,
  getAllFeaturedProducts,
  searchProducts,
  getBusinessProducts,
  setFeaturedProduct,
  setFeaturedProductsBulk,
  confirmFeaturedProductPayment,
  removeFeaturedProduct,
  getProductsUnderReview,
  moderateProduct,
  adminDeleteProduct,
  getBusinessAppeals,
  resolveBusinessAppeal,
} = require("../authController/adminController");

const {
  getReports,
  resolveReport,
  deleteReport,
  getReportStats,
} = require("../authController/reportController");

const {
  getSubscribers,
  updateSubscription,
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
} = require("../authController/announcementController");

// ─── Todas las rutas requieren auth + rol admin ───────────────────────────────
// router.use aplica el middleware a TODAS las rutas de este router,
// así que NO hay que repetir isAdmin / requireAdmin ruta por ruta.
router.use(auth, requireAdmin);

// Cola de entregas sin confirmar; una alerta no equivale a una entrega.
router.get('/orders/delivery-review', async (_req, res) => {
  try {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const orders = await Order.find({ status: 'shipped', $or: [
      { deliveryReviewRequestedAt: { $ne: null } },
      { shippedAt: { $lte: cutoff } },
      { shippedAt: null, updatedAt: { $lte: cutoff } },
    ] }).select('user businessId businessName items shippedAt deliveryReviewRequestedAt deliveryReviewReason createdAt')
      .populate('user', 'name email').populate('businessId', 'name phone')
      .sort({ shippedAt: 1 }).limit(100).lean();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'No se pudo consultar las entregas pendientes' });
  }
});

router.patch('/orders/:id/complete-delivery', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Pedido no encontrado' });
    if (!canAdminCompleteDelivery(order, req.body.verificationNote))
      return res.status(400).json({ message: 'La entrega debe estar despachada y verificada. Registrá cómo se confirmó.' });
    order.status = 'delivered';
    order.deliveredAt = new Date();
    order.adminCompletedAt = new Date();
    order.adminCompletionNote = req.body.verificationNote.trim().slice(0, 500);
    order.deliveryReviewRequestedAt = null;
    order.sellerSeenAt = null;
    await order.save();
    res.json({ message: 'Entrega verificada y venta terminada' });
  } catch (err) {
    res.status(500).json({ message: 'No se pudo cerrar la venta' });
  }
});

// ── DASHBOARD ────────────────────────────────────────────────────────────────
router.get("/stats", getDashboardStats);
router.get("/funnel", getAdminFunnel);
router.delete("/funnel", clearAdminFunnel);

// ── BUSCADOR / DICCIONARIO ───────────────────────────────────────────────────
router.get("/search-dictionary", adminGetDictionary);
router.post("/search-dictionary/keywords", adminCreateKeyword);
router.put("/search-dictionary/keywords/:id", adminUpdateKeyword);
router.delete("/search-dictionary/keywords/:id", adminDeleteKeyword);
router.post("/search-dictionary/forbidden", adminCreateForbidden);
router.put("/search-dictionary/forbidden/:id", adminUpdateForbidden);
router.delete("/search-dictionary/forbidden/:id", adminDeleteForbidden);
router.post("/categories", adminCreateCategory);
router.put("/categories/:id", adminUpdateCategory);
router.delete("/categories/:id", adminDeleteCategory);

// ── USUARIOS ─────────────────────────────────────────────────────────────────
router.get("/users",              getAllUsers);
router.patch("/users/:id/block",  toggleBlockUser);
router.patch("/users/:id/role",   changeUserRole);

// ── NEGOCIOS ─────────────────────────────────────────────────────────────────
router.get("/businesses",                         getAllBusinesses);
router.patch("/businesses/:id/verify",            toggleVerifyBusiness);
router.patch("/businesses/:id/block",             toggleBlockBusiness);
router.patch("/businesses/:id/subscription",      updateSubscription);

// ── APELACIONES DE NEGOCIO ────────────────────────────────────────────────────
router.get("/business-appeals",               getBusinessAppeals);
router.patch("/businesses/:id/appeal",        resolveBusinessAppeal);

// ── SUSCRIPTORES ──────────────────────────────────────────────────────────────
router.get("/subscribers", getSubscribers);

// ── PRODUCTOS DE UN NEGOCIO (para destacar) ───────────────────────────────────
router.get("/businesses/:businessId/products", getBusinessProducts);

// ── DESTACADOS - NEGOCIOS ─────────────────────────────────────────────────────
router.get("/featured-businesses",                                 getAllFeatured);
router.post("/featured-businesses",                                setFeatured);
router.patch("/featured-businesses/:featuredId/confirm-payment",  confirmFeaturedPayment);
router.delete("/featured-businesses/:businessId",                  removeFeatured);

// ── DESTACADOS - PRODUCTOS ────────────────────────────────────────────────────
router.get("/featured-products",                                   getAllFeaturedProducts);
router.post("/featured-products",                                  setFeaturedProduct);
router.post("/featured-products/bulk",                             setFeaturedProductsBulk);
router.patch("/featured-products/:productId/confirm-payment",      confirmFeaturedProductPayment);
router.delete("/featured-products/:productId",                     removeFeaturedProduct);

// ── BÚSQUEDA DE PRODUCTOS ─────────────────────────────────────────────────────
router.get("/products/search", searchProducts);

// ── PRODUCTOS BAJO REVISIÓN ───────────────────────────────────────────────────
// IMPORTANTE: rutas estáticas (/search, /under-review) ANTES de rutas con param (:productId)
router.get("/products/under-review",           getProductsUnderReview);
router.patch("/products/:productId/moderate",  moderateProduct);
router.delete("/products/:productId",          adminDeleteProduct);

// ── REPORTES ──────────────────────────────────────────────────────────────────
router.get("/reports",                    getReports);
router.get("/reports/stats",              getReportStats);
router.patch("/reports/:reportId/resolve", resolveReport);
router.delete("/reports/:reportId",       deleteReport);

// ── ANUNCIOS ──────────────────────────────────────────────────────────────────
router.get("/announcements",         getAnnouncements);
router.post("/announcements",        createAnnouncement);
router.delete("/announcements/:id",  deleteAnnouncement);

module.exports = router;
