// routes/businessRoute.js
const express = require("express");
const router  = express.Router();
const upload  = require("../middleware/upload");
const {
  upsertBusiness,
  getMyBusiness,
  getBusinessById,
  followBusiness,
  unfollowBusiness,
  favoriteBusiness,
  unfavoriteBusiness,
  rateBusiness,
  getBusinessSocialStatus,
  geocodePredictive,
  getNearbyBusinesses,
  submitBusinessAppeal,
} = require("../authController/businessController");
const verifyToken = require("../middleware/authMiddleware");

// Rutas estaticas PRIMERO (antes de /:id)
router.get("/geocode",     geocodePredictive);
router.get("/nearby",      getNearbyBusinesses);
router.post("/",           verifyToken, upload.single("logo"), upsertBusiness);
router.get("/my-business", verifyToken, getMyBusiness);
 router.post('/:id/appeal', verifyToken, submitBusinessAppeal);
// Social
router.post("/:id/follow",     verifyToken, followBusiness);
router.post("/:id/unfollow",   verifyToken, unfollowBusiness);
router.post("/:id/favorite",   verifyToken, favoriteBusiness);
router.post("/:id/unfavorite", verifyToken, unfavoriteBusiness);
router.post("/:id/rate",       verifyToken, rateBusiness);
router.get("/:id/social",      verifyToken, getBusinessSocialStatus);

// Publico al final
router.get("/:id", getBusinessById);

module.exports = router;