// routes/reportRoute.js
const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");
const {
  createReport,
  checkReportStatus,
  getMyNotifications,
  markNotificationsRead,
  getReports,
  resolveReport,
  deleteReport,
  getReportStats,
  batchCheckReports,
  getMyReports,
  getReportsOnMyContent,
} = require("../authController/reportController");

// ===== RUTAS AUTENTICADAS =====

// Crear reporte
router.post("/", auth, createReport);

// Verificar si un ítem tiene reportes pendientes
router.get("/check/:targetId", auth, checkReportStatus);

// Notificaciones del usuario
router.get("/notifications",         auth, getMyNotifications);
router.patch("/notifications/read",  auth, markNotificationsRead);

// Mis reportes (como comprador)
router.get("/my-reports",            auth, getMyReports);

// Reportes sobre mi contenido (como vendedor)
router.get("/on-my-content",         auth, getReportsOnMyContent);

// Batch check
router.post("/batch-check",          auth, batchCheckReports);

// ===== RUTAS DE ADMIN =====
router.get("/",                         auth, getReports);
router.get("/stats",                    auth, getReportStats);
router.patch("/:reportId/resolve",      auth, resolveReport);
router.delete("/:reportId",             auth, deleteReport);

module.exports = router;