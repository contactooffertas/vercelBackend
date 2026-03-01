// models/reportModel.js
const mongoose = require("mongoose");

const BANNED_KEYWORDS = [
  "pene","pija","pito","verga","culo","vagina","concha","tetas",
  "porno","pornografia","sexo","coger","cojiendo","follar","mamar",
  "chupame","orgia","prostituta","puta","prostitucion","prostitucion",
  "escort","desnudo","desnuda","xxx","onlyfans","desnudos","desnudas",
  "pelada","pelado","encuerado","encuerada","striptease","strip tease",
  "porn","sex","sexy","sexual","adultos","adulto",
  "contenido adulto","material adulto","pelicula adulto","pelicula porno",
  "video adulto","video porno","revista adulto","revista porno",
  "juguete sexual","juguete erotico","lenceria","ropa interior erotica",
  "webcam","camgirl","camboy","streaming adulto","contenido explicito",
  "material explicito","mayores 18","+18","18+","adultos 18",
  "cocaina","coca","droga","drogas","marihuana","faso","porro",
  "extasis","heroina","crack","merca",
  "pasta base","clorhidrato","anfetamina","metanfetamina","lsd",
  "hongos","narco","narcotrafico",
  "mariguana","marijuana","cannabis","weed","thc","cbd","hierba",
  "canuto","bareto","petardo","maria","ganja",
  "hachis","resina","aceite de cannabis","aceite thc",
  "perico","farlopa","nieve","polvo blanco",
  "speed","tachas","pastillas","pastis","ruedas","mdma","molly",
  "ketamina","ket","keta","popper","poppers","buprex","subuxon",
  "tranquilizantes","sedantes","opio","morfina","codeina",
  "fentanilo","opioides","benzodiacepinas","alprazolam","clonazepam",
  "rivotril","valium","diazepam","lorazepam","tafil","xanax",
  "arma","pistola","revolver","fusil","rifle","escopeta","granada",
  "bomba","explosivo","detonador","municion","bala","balas",
  "arma blanca","arma de fuego","arma corta","arma larga",
  "subfusil","ametralladora","metralleta","silenciador",
  "cartuchos","proyectiles","polvora",
  "taser","electroshock","gas pimienta",
  "navaja","punal","daga","machete","katana","espada",
  "nunchaku","estrella ninja","shuriken","manopla",
  "violencia","violento","golpe","golpes","pelea","peleas",
  "agresion","agredir","agrediendo","agresivo",
  "matar","muerte","muerto","asesinato","asesinar","homicidio",
  "tortura","torturar","maltrato","maltratar","abusar","abuso",
  "secuestro","secuestrar","raptar","rapto","extorsion",
  "amenaza","amenazar","intimidar","intimidacion",
  "spam","publicidad enganosa","publicidad no deseada",
  "gana dinero","hacete rico","dinero facil","dinero rapido",
  "esquema piramidal","piramide","estafa piramidal",
  "phishing","suplantacion","robo de identidad",
  "clonacion de tarjeta","tarjeta clonada",
  "estafa","estafar","estafador","trampa","engano","enganar",
  "falso","falsificado","falsificacion",
  "billete falso","dinero falso","moneda falsa",
  "scam","scammer","fraude","fraudulento",
  "virus","malware","ransomware","troyano","keylogger",
  "hackear","hacker","hackeo","hack","crackear",
  "descarga ilegal","pirata","pirateria",
  "serial","keygen","crackeado",
  "pussy","dick","cock","cocaine","drugs","marijuana",
  "gun","weapon","knife","bomb","explosive",
  "nude","naked","sex tape","adult video","adult movie",
  "hardcore","blowjob","handjob","oral sex","anal sex","gangbang",
  "heroin","morphine","meth","amphetamine","acid",
  "weed shop","dispensary","cannabis store","marijuana for sale",
  "guns for sale","weapons for sale","firearms","ammunition",
  "bullet","bullets","grenade","bomb making","explosives",
  "kill","murder","assassination","torture","abuse",
  "cracked","modded","unlocked","premium hack",
];

// ─── Función standalone ───────────────────────────────────────────────────────
function detectKeywords(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text
    .toLowerCase()
    .replace(/[áàäâã]/g, "a")
    .replace(/[éèëêẽ]/g, "e")
    .replace(/[íìïîĩ]/g, "i")
    .replace(/[óòöôõ]/g, "o")
    .replace(/[úùüûũ]/g, "u")
    .replace(/[ñ]/g, "n")
    .replace(/[ç]/g, "c")
    .replace(/[ýỳŷÿ]/g, "y");
  const found = new Set();
  BANNED_KEYWORDS.forEach((kw) => {
    if (lower.includes(kw.toLowerCase())) found.add(kw);
  });
  return Array.from(found);
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const reportSchema = new mongoose.Schema(
  {
    targetType:  { type: String, enum: ["product", "business"], required: true },
    targetId:    { type: mongoose.Schema.Types.ObjectId, required: true },
    targetName:  { type: String, default: "" },

    reportedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reporterName:       { type: String, default: "" },
    reporterReputation: { type: Number, default: 0 },

    businessId:   { type: mongoose.Schema.Types.ObjectId, ref: "Business", default: null },
    businessName: { type: String, default: "" },

    reason:   { type: String, required: true, minlength: 10, maxlength: 1000 },
    category: {
      type: String,
      enum: ["spam", "fraud", "adult", "drugs", "weapons", "violence", "other"],
      default: "other",
    },

    autoBlocked:      { type: Boolean, default: false },
    detectedKeywords: [String],
    keywordCount:     { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "action_taken"],
      default: "pending",
    },

    adminNote: { type: String, default: "" },

    // ── CAMBIO CLAVE: adminAction ahora es String libre, sin enum ─────────
    // Antes era enum de valor único → ahora guarda múltiples acciones
    // separadas por coma: "strike,warn", "block_product,strike", etc.
    // El valor "none" sigue siendo válido para reportes sin resolución.
    adminAction: { type: String, default: "none" },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },

    notificationSent:   { type: Boolean, default: false },
    notificationSentAt: { type: Date, default: null },
    duplicateOf:        { type: mongoose.Schema.Types.ObjectId, ref: "Report", default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ─── Índices ──────────────────────────────────────────────────────────────────
reportSchema.index({ targetId: 1, status: 1 });
reportSchema.index({ reportedBy: 1, createdAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ businessId: 1, status: 1 });
reportSchema.index({ autoBlocked: 1, status: 1 });
reportSchema.index({ keywordCount: -1 });

// ─── Virtual ──────────────────────────────────────────────────────────────────
reportSchema.virtual("timeSinceCreation").get(function () {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60));
});

// ─── Statics ──────────────────────────────────────────────────────────────────
reportSchema.statics.detectKeywords = detectKeywords;

reportSchema.statics.hasPendingReports = async function (targetId) {
  const count = await this.countDocuments({
    targetId,
    status: { $in: ["pending", "action_taken"] },
  });
  return count > 0;
};

reportSchema.statics.getStats = async function () {
  const rows = await this.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const result = { pending: 0, reviewed: 0, dismissed: 0, action_taken: 0, total: 0 };
  rows.forEach((s) => {
    result[s._id] = s.count;
    result.total += s.count;
  });
  result.autoBlocked = await this.countDocuments({ autoBlocked: true });
  return result;
};

// ─── Pre-save ──────────────────────────────────────────────────────────────────
reportSchema.pre("save", async function () {
  if (this.isModified("reason") || this.isNew) {
    const kws = detectKeywords(this.reason || "");
    this.detectedKeywords = kws;
    this.keywordCount     = kws.length;
    if (kws.length >= 3) this.autoBlocked = true;
  }
  if (this.reportedBy && typeof this.reportedBy === "object" && this.reportedBy.name) {
    this.reporterName = this.reportedBy.name;
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = mongoose.model("Report", reportSchema);
module.exports.BANNED_KEYWORDS = BANNED_KEYWORDS;