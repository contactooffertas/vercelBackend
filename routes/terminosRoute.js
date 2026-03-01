const express = require("express");
const router  = express.Router();

const {
  getTerminos,
  crearTerminos,
  actualizarTerminos,
} = require("../authController/terminosController");

// ✅ Tu authMiddleware exporta la función directamente (module.exports = fn)
const authMiddleware = require("../middleware/authMiddleware");

// ✅ Guard de admin: va inline aquí, no hace falta archivo aparte
const soloAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") return next();
  return res.status(403).json({ message: "Acceso denegado. Solo administradores." });
};

// GET  /api/terminos       → público
router.get("/", getTerminos);

// POST /api/terminos       → solo admin
router.post("/", authMiddleware, soloAdmin, crearTerminos);

// PUT  /api/terminos/:id   → solo admin
router.put("/:id", authMiddleware, soloAdmin, actualizarTerminos);

module.exports = router;