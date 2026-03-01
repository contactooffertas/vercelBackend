const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");

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

// ── DASHBOARD ────────────────────────────────────────────────────────────────
router.get("/stats", getDashboardStats);

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