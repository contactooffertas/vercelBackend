// routes/eliminaUsuarioRoute.js
const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");
const {
  requestDeletion,
  confirmDeletion,
  getDeletionLog,
} = require("../authController/eliminaUsuarioController");

// El usuario registra intención de eliminar su cuenta
router.post("/request", auth, requestDeletion);

// El usuario confirma y se elimina todo (llamada definitiva desde el modal)
router.delete("/confirm", auth, confirmDeletion);

// Admin: ver historial de eliminaciones
router.get("/log", auth, getDeletionLog);

module.exports = router;