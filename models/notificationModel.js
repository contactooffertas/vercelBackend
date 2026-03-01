// models/notificationModel.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type:     { type: String, enum: [
      "report_resolved","strike","block_product","block_business",
      "reputation_gained","general"
    ], default: "general" },
    title:    { type: String, required: true },
    message:  { type: String, required: true },
    read:     { type: Boolean, default: false },
    meta:     { type: Object, default: {} }, // datos extras: reportId, strikeCount, etc.
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, read: 1 });

module.exports = mongoose.model("Notification", notificationSchema);