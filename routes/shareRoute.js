// routes/shareRoute.js
const express = require("express");
const router  = express.Router();
const { getProductShareCard } = require("../authController/productController");
 
router.get("/:id", getProductShareCard);
 
module.exports = router;
