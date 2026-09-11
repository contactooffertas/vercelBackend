const express = require("express");
const router = express.Router();
const {
  publicCategories,
  suggest,
  resolve,
  smartSearch,
} = require("../authController/searchController");

router.get("/categories", publicCategories);
router.get("/suggest", suggest);
router.get("/resolve", resolve);
router.get("/", smartSearch);

module.exports = router;
