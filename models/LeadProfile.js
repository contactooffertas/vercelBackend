// models/LeadProfile.js
const mongoose = require('mongoose');

const LeadProfileSchema = new mongoose.Schema({
  business_id: { type: String, required: true, index: true },
  anonymous_id: { type: String, required: true },
  user_id: { type: String, default: null, index: true }, // cuando se loguea
  session_id: { type: String },

  fingerprint_hash: { type: String }, // ip + user_agent hasheado

  first_seen: { type: Date, default: Date.now },
  last_seen: { type: Date, default: Date.now },

  lead_score: { type: Number, default: 0 },
  total_sessions: { type: Number, default: 1 },
  total_time_spent: { type: Number, default: 0 }, // en segundos

  top_products: { type: Object, default: {} },
  // Ej: { "prod_id123": { views: 3, seconds: 120, last_view: Date } }

  merged_into: { type: String, default: null } // si se mergeó con otro
}, { timestamps: true });

// ESTE ES EL QUE EVITA DUPLICADOS: 1 perfil por negocio + anon_id
LeadProfileSchema.index({ business_id: 1, anonymous_id: 1 }, { unique: true });
LeadProfileSchema.index({ business_id: 1, user_id: 1 });

module.exports = mongoose.model('LeadProfile', LeadProfileSchema);
