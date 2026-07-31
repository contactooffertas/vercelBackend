// models/TrackingEvent.js
const mongoose = require('mongoose');

const TrackingEventSchema = new mongoose.Schema({
  business_id: { type: String, required: true, index: true },
  profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadProfile' },

  anonymous_id: { type: String, required: true, index: true },
  user_id: { type: String, default: null },
  session_id: { type: String, required: true },

  event_name: {
    type: String,
    required: true,
    enum: ['page_enter', 'product_view', 'dwell_time', 'product_click', 'lead_conversion', 'whatsapp_click', 'page_leave']
  },

  properties: { type: Object, default: {} }, // { product_id, category, seconds }

  url: { type: String },
  ip_hash: { type: String }, // NO guardes la IP en claro
  user_agent: { type: String },

  createdAt: { type: Date, default: Date.now, index: true }
});

// Para el embudo de leads por negocio
TrackingEventSchema.index({ business_id: 1, event_name: 1, createdAt: -1 });
TrackingEventSchema.index({ business_id: 1, "properties.product_id": 1 });

module.exports = mongoose.model('TrackingEvent', TrackingEventSchema);
