const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  iconName: { type: String, required: true, trim: true, default: "Tag" },
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

categorySchema.index({ active: 1, order: 1 });

module.exports = mongoose.model("Category", categorySchema);
