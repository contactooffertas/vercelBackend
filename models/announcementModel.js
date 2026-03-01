  const mongoose = require("mongoose");
  const announcementSchema = new mongoose.Schema({
    title:         { type: String, required: true },
    message:       { type: String, required: true },
    audience:      { type: String, enum: ["all","seller","buyer"], default: "all" },
    durationHours: { type: Number, default: 24 },
    link:          { type: String, default: "" },
    expiresAt:     { type: Date,   required: true },
    active:        { type: Boolean, default: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  }, { timestamps: true });
  module.exports = mongoose.model("Announcement", announcementSchema);

  