const mongoose = require("mongoose");

const searchKeywordSchema = new mongoose.Schema({
  keyword: { type: String, required: true, trim: true, lowercase: true },
  normalized: { type: String, required: true, trim: true, lowercase: true },
  category: { type: String, required: true, index: true },
  source: { type: String, enum: ["seed", "product", "admin"], default: "product" },
  usageCount: { type: Number, default: 1 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

searchKeywordSchema.index({ normalized: 1, category: 1 }, { unique: true });
searchKeywordSchema.index({ normalized: "text", keyword: "text" });

module.exports = mongoose.model("SearchKeyword", searchKeywordSchema);
