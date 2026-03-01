// authController/reportController.js
const Report   = require("../models/reportModel");
const User     = require("../models/userModel");
const Product  = require("../models/productoModel");
const Business = require("../models/businessModel");

/* ─── Helper: IO ──────────────────────────────────────────────────────────── */
function getIO(req) { return req.app.get("io"); }
function notifyAdmins(io, event, payload) {
  if (!io) return;
  io.to("admins").emit(event, payload);
}

/* ─── Helper: notificación en BD ─────────────────────────────────────────── */
async function createDBNotification(userId, title, message, type = "general", meta = {}) {
  try {
    let Notification;
    try { Notification = require("../models/notificationModel"); } catch (_) { return; }
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) { console.error("[createDBNotification]", err.message); }
}

/* ─── Helper: bloquear conversación entre dos usuarios ───────────────────── */
async function blockConversationBetween(reporterId, reportedId, reportId, io) {
  try {
    const { Conversation } = require("../models/chatModel");

    const conv = await Conversation.findOneAndUpdate(
      {
        participants: { $all: [reporterId, reportedId], $size: 2 },
        isBlocked:    false,
      },
      {
        $set: {
          isBlocked:     true,
          blockedBy:     reporterId,
          blockedAt:     new Date(),
          blockReportId: reportId,
        },
      },
      { new: true }
    );

    if (conv && io) {
      conv.participants.forEach(pid => {
        io.to(`user_${pid.toString()}`).emit("conversation_blocked", {
          conversationId: conv._id.toString(),
          blockedBy:      reporterId.toString(),
          reason:         "Esta conversación fue bloqueada por un reporte.",
        });
      });
    }

    return conv;
  } catch (err) {
    console.error("[blockConversationBetween]", err.message);
    return null;
  }
}

/* ─── Helper: desbloquear conv vinculada a un reporte ────────────────────── */
async function unblockConvByReport(reportId, reason, io) {
  try {
    const { Conversation } = require("../models/chatModel");
    const conv = await Conversation.findOneAndUpdate(
      { blockReportId: reportId },
      { $set: { isBlocked: false, blockedBy: null, blockedAt: null, blockReportId: null } },
      { new: true }
    );
    if (conv && io) {
      conv.participants.forEach(pid => {
        io.to(`user_${pid.toString()}`).emit("conversation_unblocked", {
          conversationId: conv._id.toString(),
          reason,
        });
      });
    }
    return conv;
  } catch (err) {
    console.error("[unblockConvByReport]", err.message);
    return null;
  }
}

// ============================================================
//  CREAR REPORTE
// ============================================================
exports.createReport = async (req, res) => {
  try {
    const { targetType, targetId, targetName, reason, category } = req.body;
    const reportedBy = req.user._id || req.user.id;

    if (!targetType || !targetId || !reason)
      return res.status(400).json({ message: "Faltan campos requeridos" });
    if (reason.length < 10)
      return res.status(400).json({ message: "La razón debe tener al menos 10 caracteres" });

    let businessId = null, businessName = "", ownerId = null;

    if (targetType === "product") {
      const product = await Product.findById(targetId).populate("businessId").lean();
      if (product) {
        businessId   = product.businessId?._id || product.businessId;
        businessName = product.businessId?.name || "";
      }
    }

    if (targetType === "business") {
      const biz = await Business.findById(targetId).lean();
      if (biz) { businessId = biz._id; businessName = biz.name || ""; ownerId = biz.owner; }
    }

    if (targetType === "product" && businessId) {
      const biz = await Business.findById(businessId).select("owner").lean();
      ownerId = biz?.owner || null;
    }

    const report = new Report({
      targetType,
      targetId,
      targetName: targetName || "",
      reportedBy,
      businessId,
      businessName,
      reason,
      category: category || "other",
    });
    await report.save();

    // ── Bloqueo automático de producto ──
    let wasAutoBlocked = false;
    if (targetType === "product") {
      await Product.findByIdAndUpdate(targetId, {
        blocked: true,
        blockedReason: report.autoBlocked
          ? `Auto-bloqueado: ${report.detectedKeywords.join(", ")}`
          : "Bloqueado temporalmente por reporte pendiente",
        featured: false, featuredPaid: false,
      });
      wasAutoBlocked = true;
    }
    if (targetType === "business" && report.autoBlocked) {
      await Business.findByIdAndUpdate(targetId, {
        blocked: true,
        blockedReason: `Auto-bloqueado: ${report.detectedKeywords.join(", ")}`,
      });
      wasAutoBlocked = true;
    }

    const io = getIO(req);

    // ── Bloquear conversación directa (cuando se reporta un usuario vía chat) ──
    // targetType === "business" pero targetId es un User ID enviado desde el chat
    let conversationBlocked = false;
    let blockedConversationId = null;

    if (targetType === "business") {
      const blockedConv = await blockConversationBetween(reportedBy, targetId, report._id, io);
      if (blockedConv) {
        conversationBlocked   = true;
        blockedConversationId = blockedConv._id.toString();
      }
    }

    // ── Notificar al reportado ──
    const notifyTarget = ownerId || (conversationBlocked ? targetId : null);
    if (notifyTarget) {
      const ownerMsg = conversationBlocked
        ? `⚠️ Un usuario te reportó desde el chat. La conversación fue bloqueada temporalmente mientras el equipo revisa el caso.`
        : targetType === "product"
          ? `⚠️ Tu producto "${targetName}" fue reportado y bloqueado temporalmente.`
          : report.autoBlocked
            ? `⚠️ Tu negocio "${targetName}" fue bloqueado automáticamente por palabras prohibidas.`
            : `⚠️ Tu negocio "${targetName}" recibió un reporte. El equipo lo revisará.`;

      io?.to(`user:${notifyTarget.toString()}`).emit("report_received", {
        reportId: report._id, targetType, targetName,
        autoBlocked: wasAutoBlocked || report.autoBlocked,
        conversationBlocked, blockedConversationId, message: ownerMsg,
      });
      await createDBNotification(
        notifyTarget,
        conversationBlocked ? "⚠️ Chat bloqueado por reporte" : "⚠️ Reporte recibido",
        ownerMsg, "report_received",
        { reportId: report._id, targetType, targetId, conversationBlocked, blockedConversationId }
      );
    }

    // ── Confirmar al reportador ──
    const reporterMsg = conversationBlocked
      ? `✅ Reporte enviado. La conversación con "${targetName}" fue bloqueada. El equipo revisará el caso.`
      : targetType === "product"
        ? `✅ El producto "${targetName}" fue bloqueado temporalmente mientras el equipo lo revisa.`
        : report.autoBlocked
          ? `✅ El negocio fue bloqueado automáticamente por palabras prohibidas.`
          : `✅ Tu reporte sobre "${targetName}" fue recibido. La administración lo revisará.`;

    io?.to(`user:${reportedBy.toString()}`).emit("report_sent", {
      reportId: report._id, autoBlocked: wasAutoBlocked || report.autoBlocked,
      conversationBlocked, blockedConversationId, message: reporterMsg,
    });
    await createDBNotification(
      reportedBy,
      conversationBlocked ? "✅ Reporte enviado y chat bloqueado" : "✅ Reporte enviado",
      reporterMsg, "report_sent",
      { reportId: report._id, targetType, targetId, conversationBlocked, blockedConversationId }
    );

    // ── Notificar admins ──
    notifyAdmins(io, "new_report_admin", {
      reportId: report._id, targetType, targetName,
      autoBlocked: wasAutoBlocked || report.autoBlocked,
      conversationBlocked, blockedConversationId,
      category: report.category, businessName,
    });

    return res.status(201).json({
      message: conversationBlocked
        ? `Reporte enviado. La conversación con "${targetName}" fue bloqueada temporalmente.`
        : targetType === "product"
          ? "Producto reportado y bloqueado temporalmente."
          : report.autoBlocked
            ? "Negocio reportado y bloqueado automáticamente."
            : "Reporte enviado. El equipo lo revisará.",
      autoBlocked:         wasAutoBlocked || report.autoBlocked,
      productBlocked:      targetType === "product",
      conversationBlocked,
      blockedConversationId,
      reportId:            report._id,
    });
  } catch (err) {
    console.error("[createReport ERROR]", err);
    return res.status(500).json({ message: "Error interno al procesar el reporte", error: err.message });
  }
};

// ============================================================
//  CHECK STATUS
// ============================================================
exports.checkReportStatus = async (req, res) => {
  try {
    const { targetId } = req.params;
    if (!targetId) return res.status(400).json({ message: "targetId requerido" });
    const pendingReport = await Report.findOne({
      targetId, status: { $in: ["pending", "action_taken"] },
    }).select("status createdAt autoBlocked");
    res.json({
      hasPendingReport: !!pendingReport,
      hasActionTaken:   pendingReport?.status === "action_taken",
      isAutoBlocked:    pendingReport?.autoBlocked || false,
      reportDate:       pendingReport?.createdAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Error al verificar estado del reporte", error: error.message });
  }
};

// ============================================================
//  NOTIFICACIONES
// ============================================================
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const user   = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
    let reports = [];
    if (user.role === "admin") {
      reports = await Report.find({ status: "pending" })
        .populate("reportedBy", "name email")
        .populate("resolvedBy", "name email")
        .sort({ createdAt: -1, keywordCount: -1 }).limit(100);
    } else {
      const businesses  = await Business.find({ owner: userId }).select("_id name");
      const businessIds = businesses.map(b => b._id);
      reports = await Report.find({
        $or: [
          { targetType: "product",  businessId: { $in: businessIds } },
          { targetType: "business", targetId:   { $in: businessIds } },
          { reportedBy: userId },
        ],
        status: { $in: ["pending", "action_taken", "dismissed"] },
        notificationSent: false,
      }).populate("reportedBy", "name email").populate("businessId", "name logo").sort({ createdAt: -1 });
    }
    res.json({ success: true, notifications: reports, count: reports.length });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener notificaciones", error: error.message });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    const { reportIds } = req.body;
    if (!Array.isArray(reportIds) || !reportIds.length)
      return res.status(400).json({ message: "Se requiere un array de reportIds" });
    await Report.updateMany(
      { _id: { $in: reportIds }, notificationSent: false },
      { $set: { notificationSent: true, notificationSentAt: new Date() } }
    );
    res.json({ success: true, message: "Notificaciones marcadas como leídas", updatedCount: reportIds.length });
  } catch (error) {
    res.status(500).json({ message: "Error al marcar notificaciones", error: error.message });
  }
};

// ============================================================
//  ADMIN: GET REPORTS
// ============================================================
exports.getReports = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.role !== "admin") return res.status(403).json({ message: "Acceso denegado" });
    const { status, targetType, limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};
    if (status     && status     !== "all") query.status     = status;
    if (targetType && targetType !== "all") query.targetType = targetType;
    const reports = await Report.find(query)
      .populate("reportedBy", "name email reporterReputation")
      .populate("resolvedBy", "name email")
      .populate("businessId", "name logo")
      .sort({ autoBlocked: -1, keywordCount: -1, createdAt: -1 })
      .skip(skip).limit(parseInt(limit));
    const total = await Report.countDocuments(query);
    const stats = await Report.getStats();
    res.json({ success: true, reports, stats, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener reportes", error: error.message });
  }
};

// ============================================================
//  ADMIN: RESOLVER REPORTE
// ============================================================
exports.resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    let { actions, action, adminNote } = req.body;
    if (!actions?.length) actions = action ? [action] : [];

    const admin = await User.findById(req.user.id);
    if (admin.role !== "admin") return res.status(403).json({ message: "Acceso denegado" });

    const validActions = [
      "dismiss", "warn", "strike",
      "block_product", "block_business", "unblock_product", "unblock_business",
      "unblock_conversation",   // nueva acción
    ];
    for (const a of actions) {
      if (!validActions.includes(a))
        return res.status(400).json({ message: `Acción inválida: ${a}`, validActions });
    }
    if (!actions.length) return res.status(400).json({ message: "Se requiere al menos una acción" });

    const report = await Report.findById(reportId);
    if (!report) return res.status(404).json({ message: "Reporte no encontrado" });

    const newStatus = actions.length === 1 && actions[0] === "dismiss" ? "dismissed" : "action_taken";
    report.status      = newStatus;
    report.adminAction = actions.join(",");
    report.adminNote   = adminNote || "";
    report.resolvedBy  = req.user.id;
    report.resolvedAt  = new Date();
    await report.save();

    const io = getIO(req);
    let ownerId = null;
    if (report.businessId) {
      const biz = await Business.findById(report.businessId).select("owner").lean();
      ownerId = biz?.owner || null;
    }

    const executedActions = [], ownerParts = [], reporterParts = [];

    for (const act of actions) {
      switch (act) {
        case "dismiss":
          executedActions.push("dismiss");
          ownerParts.push(`El reporte sobre "${report.targetName}" fue desestimado. No se tomó ninguna acción.`);
          reporterParts.push(`Tu reporte sobre "${report.targetName}" fue revisado pero no se encontró violación.`);
          if (report.targetType === "product")
            await Product.findByIdAndUpdate(report.targetId, { blocked: false, blockedReason: "" });
          // Si había conv bloqueada por este reporte, desbloquearla
          await unblockConvByReport(report._id, "El reporte fue desestimado. Podés continuar la conversación.", io);
          break;

        case "warn":
          executedActions.push("warn");
          ownerParts.push(`⚠️ Recibiste una advertencia. Revisá las políticas de la plataforma.`);
          reporterParts.push(`✅ Se envió una advertencia al usuario reportado.`);
          break;

        case "strike":
          if (report.businessId) {
            const biz = await Business.findByIdAndUpdate(report.businessId, { $inc: { strikeCount: 1 } }, { new: true });
            if (biz?.strikeCount >= 3) {
              await Business.findByIdAndUpdate(report.businessId, { $set: { suspended: true, suspendedAt: new Date(), suspendedReason: "3 strikes" } });
              ownerParts.push(`🚨 Tu negocio fue suspendido por 3 strikes.`);
            } else {
              ownerParts.push(`🚨 Strike aplicado. Acumulados: ${biz?.strikeCount}/3.`);
            }
          }
          reporterParts.push(`✅ Strike aplicado. +10 puntos de reputación.`);
          executedActions.push("strike");
          break;

        case "block_product":
          if (report.targetType === "product") {
            await Product.findByIdAndUpdate(report.targetId, { blocked: true, blockedReason: adminNote || "Bloqueado por reporte", featured: false, featuredPaid: false });
            ownerParts.push(`🚫 Tu producto "${report.targetName}" fue bloqueado.`);
            reporterParts.push(`✅ Producto bloqueado. +10 puntos.`);
            executedActions.push("block_product");
          }
          break;

        case "unblock_product":
          if (report.targetType === "product") {
            await Product.findByIdAndUpdate(report.targetId, { blocked: false, blockedReason: "" });
            ownerParts.push(`✅ Tu producto fue desbloqueado.`);
            executedActions.push("unblock_product");
          }
          break;

        case "block_business":
          await Business.findByIdAndUpdate(report.businessId || report.targetId, { blocked: true, blockedReason: adminNote || "Bloqueado por reporte" });
          ownerParts.push(`🚫 Tu negocio fue bloqueado.`);
          reporterParts.push(`✅ Negocio bloqueado. +10 puntos.`);
          executedActions.push("block_business");
          break;

        case "unblock_business":
          await Business.findByIdAndUpdate(report.businessId || report.targetId, { blocked: false, blockedReason: "" });
          ownerParts.push(`✅ Tu negocio fue desbloqueado.`);
          executedActions.push("unblock_business");
          break;

        case "unblock_conversation":
          await unblockConvByReport(report._id, "El administrador desbloqueó la conversación.", io);
          ownerParts.push(`✅ La conversación bloqueada fue restaurada.`);
          reporterParts.push(`ℹ️ La conversación fue restaurada por el equipo tras revisión.`);
          executedActions.push("unblock_conversation");
          break;
      }
    }

    const ownerMsg    = ownerParts.join(" | ");
    const reporterMsg = reporterParts.length ? reporterParts.join(" | ") : `✅ Reporte resuelto: ${executedActions.join(", ")}.`;
    const isDismissed = executedActions.includes("dismiss");
    const isNegative  = executedActions.some(a => ["block_product", "block_business", "strike"].includes(a));

    if (ownerId && ownerMsg) {
      io?.to(`user:${ownerId.toString()}`).emit("report_resolved", { reportId: report._id, targetName: report.targetName, actions: executedActions, message: ownerMsg, adminNote: adminNote || "" });
      await createDBNotification(ownerId, isDismissed ? "ℹ️ Reporte desestimado" : isNegative ? "🚨 Acción sobre tu contenido" : "ℹ️ Reporte resuelto", ownerMsg, isDismissed ? "report_dismissed" : isNegative ? "report_action_taken" : "report_resolved", { reportId: report._id, actions: executedActions });
    }

    if (report.reportedBy) {
      io?.to(`user:${report.reportedBy.toString()}`).emit("report_action_taken", { reportId: report._id, targetName: report.targetName, actions: executedActions, message: reporterMsg, isDismissed });
      await createDBNotification(report.reportedBy, isDismissed ? "ℹ️ Reporte revisado" : "✅ Tu reporte fue procesado", reporterMsg, isDismissed ? "report_dismissed" : "report_action_taken", { reportId: report._id, actions: executedActions });
      const rewardActions = ["strike", "block_product", "block_business"];
      if (executedActions.some(a => rewardActions.includes(a)))
        await User.findByIdAndUpdate(report.reportedBy, { $inc: { reporterReputation: 10 } });
    }

    notifyAdmins(io, "report_updated", { reportId: report._id, newStatus, actions: executedActions });

    res.json({ success: true, message: "Reporte resuelto correctamente", report, executedActions });
  } catch (error) {
    console.error("resolveReport:", error);
    res.status(500).json({ message: "Error al resolver el reporte", error: error.message });
  }
};

// ============================================================
//  ADMIN: ELIMINAR REPORTE
// ============================================================
exports.deleteReport = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (admin.role !== "admin") return res.status(403).json({ message: "Acceso denegado" });
    const report = await Report.findByIdAndDelete(req.params.reportId);
    if (!report) return res.status(404).json({ message: "Reporte no encontrado" });
    notifyAdmins(getIO(req), "report_deleted", { reportId: req.params.reportId });
    res.json({ success: true, message: "Reporte eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "Error al eliminar el reporte", error: error.message });
  }
};

// ============================================================
//  ADMIN: ESTADÍSTICAS
// ============================================================
exports.getReportStats = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (admin.role !== "admin") return res.status(403).json({ message: "Acceso denegado" });
    const stats = await Report.getStats();
    const topReporters = await Report.aggregate([
      { $group: { _id: "$reportedBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    ]);
    const topKeywords = await Report.aggregate([
      { $unwind: "$detectedKeywords" },
      { $group: { _id: "$detectedKeywords", count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ]);
    res.json({ success: true, stats, topReporters, topKeywords });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener estadísticas", error: error.message });
  }
};

// ============================================================
//  BATCH CHECK
// ============================================================
exports.batchCheckReports = async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || !productIds.length) return res.json({ reportedIds: [] });
    const reports = await Report.find({ targetId: { $in: productIds }, status: { $in: ["pending", "action_taken"] } }).select("targetId").lean();
    const reportedIds = [...new Set(reports.map(r => r.targetId.toString()))];
    res.json({ reportedIds });
  } catch { res.json({ reportedIds: [] }); }
};

// ============================================================
//  MIS REPORTES / SOBRE MI CONTENIDO
// ============================================================
exports.getMyReports = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const reports = await Report.find({ reportedBy: userId })
      .select("targetType targetName status category adminNote adminAction createdAt resolvedAt autoBlocked")
      .sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener tus reportes", error: error.message });
  }
};

exports.getReportsOnMyContent = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const businesses  = await Business.find({ owner: userId }).select("_id name").lean();
    const businessIds = businesses.map(b => b._id);
    if (!businessIds.length) return res.json({ success: true, reports: [] });
    const reports = await Report.find({
      $or: [
        { targetType: "product",  businessId: { $in: businessIds } },
        { targetType: "business", targetId:   { $in: businessIds } },
      ],
    }).select("targetType targetName status category adminNote adminAction createdAt resolvedAt autoBlocked reason detectedKeywords")
      .sort({ createdAt: -1 }).limit(30).lean();
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener reportes sobre tu contenido", error: error.message });
  }
};