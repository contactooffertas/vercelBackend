const mongoose = require("mongoose");

const forbiddenTermSchema = new mongoose.Schema({
  term: { type: String, required: true, trim: true, lowercase: true, unique: true },
  normalized: { type: String, required: true, trim: true, lowercase: true, unique: true },
  active: { type: Boolean, default: true },
  exceptions: [{ type: String, trim: true, lowercase: true }],
  source: { type: String, enum: ["seed", "admin"], default: "admin" },
}, { timestamps: true });

module.exports = mongoose.model("ForbiddenTerm", forbiddenTermSchema);
