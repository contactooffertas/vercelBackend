// routes/productRoute.js
const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");
const upload  = require("../middleware/upload");
const {
  // Rutas privadas
  getMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  requestProductReview,
  setFlashOffer,
  // Rutas públicas
  getFeaturedProducts,
  getPublicProducts,
  getRandomProducts,
  getFeaturedBusinesses,
  getPublicStats,
  getProductShareCard,
} = require("../authController/productController");

// ===== RUTAS PÚBLICAS (no requieren autenticación) =====
router.get("/featured",            getFeaturedProducts);
router.get("/random",              getRandomProducts);
router.get("/public-stats",        getPublicStats);
router.get("/featured-businesses", getFeaturedBusinesses);
router.get("/:id/share",           getProductShareCard);
router.get("/",                    getPublicProducts);

// ===== RUTAS PRIVADAS =====
router.get("/my-products",         auth, getMyProducts);
router.post("/",                   auth, upload.single("image"), createProduct);
router.put("/:id",                 auth, upload.single("image"), updateProduct);
router.delete("/:id",              auth, deleteProduct);

// ── Oferta Flash ─────────────────────────────────────────────────────────
router.patch("/:id/flash-offer",    auth, setFlashOffer);

// ── Solicitar revisión de producto bloqueado ────────────────────────────────
router.post("/:id/submit-review",   auth, requestProductReview);
router.patch("/:id/submit-review",  auth, requestProductReview);
router.patch("/:id/request-review", auth, requestProductReview);

module.exports = router;
