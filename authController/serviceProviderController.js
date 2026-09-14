const ServiceProvider = require('../models/serviceProviderModel');
const Business = require('../models/businessModel');
const cloudinary = require('../config/cloudinary');
const User = require('../models/userModel');
const ServiceReview = require('../models/serviceReviewModel');

const TRADE_BUSINESS_MAP = {
  electricista: ['Ferretería','Electricidad','Electrónica','Iluminación'],
  gasista: ['Ferretería','Gas','Construcción'],
  plomero: ['Ferretería','Plomería','Construcción'],
  cerrajero: ['Ferretería','Cerrajería'],
  refrigeracion: ['Ferretería','Climatización','Electrodomésticos'],
  albañil: ['Ferretería','Construcción'],
  pintor: ['Ferretería','Pinturería','Construcción'],
  tecnico: ['Ferretería','Electricidad','Electrónica'],
  enfermero: ['Farmacia','Ortopedia','Salud'],
  enfermera: ['Farmacia','Ortopedia','Salud'],
  'acompañante terapéutico': ['Farmacia','Ortopedia','Salud'],
  'cuidador de adulto mayor': ['Farmacia','Ortopedia','Salud'],
  'cuidadora de adulto mayor': ['Farmacia','Ortopedia','Salud'],
};

const cleanArray = value => (Array.isArray(value) ? value : String(value || '').split(','))
  .map(x => String(x).trim()).filter(Boolean).slice(0, 20);
const cleanPhone = value => String(value || '').replace(/[^0-9+]/g, '').slice(0, 20);

exports.upsertMine = async (req, res) => {
  try {
    const body = req.body || {};
    const trades = cleanArray(body.trades);
    if (!body.displayName?.trim() || !trades.length) return res.status(400).json({ message: 'Nombre y al menos un oficio son obligatorios' });
    const update = {
      displayName: body.displayName.trim(), gender: ['male','female'].includes(body.gender) ? body.gender : '', headline: String(body.headline || '').trim(), bio: String(body.bio || '').trim(),
      trades, serviceArea: ['technical','care','general'].includes(body.serviceArea) ? body.serviceArea : 'technical',
      careSettings: cleanArray(body.careSettings).filter(x => ['home','hospital','clinic','overnight','hourly'].includes(x)),
      professionalRegistration: String(body.professionalRegistration || '').trim(), backgroundCheck: body.backgroundCheck === true || body.backgroundCheck === 'true',
      experienceYears: Number(body.experienceYears || 0), received: body.received === true || body.received === 'true',
      phone: cleanPhone(body.phone), whatsapp: cleanPhone(body.whatsapp), contactPreference: body.contactPreference || 'both',
      address: String(body.address || '').trim(), showAddress: body.showAddress === true || body.showAddress === 'true',
      neighborhoods: cleanArray(body.neighborhoods), serviceRadiusKm: Number(body.serviceRadiusKm || 8),
      availableNow: body.availableNow === true || body.availableNow === 'true', emergencyService: body.emergencyService === true || body.emergencyService === 'true',
      schedule: String(body.schedule || '').trim(), startingPrice: body.startingPrice === '' ? null : Number(body.startingPrice || 0), pricingUnit: ['hour','visit','shift','day'].includes(body.pricingUnit) ? body.pricingUnit : 'visit',
      paymentMethods: cleanArray(body.paymentMethods).filter(x => ['cash','transfer','mercadopago','card'].includes(x)), active: body.active !== false && body.active !== 'false',
    };
    if (body.lat && body.lng) update.location = { type: 'Point', coordinates: [Number(body.lng), Number(body.lat)] };
    const current = await ServiceProvider.findOne({ owner: req.user.id });
    if (req.file) {
      const uploaded = await cloudinary.uploader.upload(req.file.path, { folder: 'service-providers', transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'face' }] });
      update.avatar = uploaded.secure_url; update.avatarPublicId = uploaded.public_id;
      if (current?.avatarPublicId) await cloudinary.uploader.destroy(current.avatarPublicId).catch(() => null);
    }
    const profile = await ServiceProvider.findOneAndUpdate({ owner: req.user.id }, { $set: update }, { upsert: true, new: true, runValidators: true });
    res.json(profile);
  } catch (err) { console.error('[services] upsert', err); res.status(500).json({ message: 'No se pudo guardar el perfil' }); }
};

exports.getMine = async (req, res) => { const p = await ServiceProvider.findOne({ owner: req.user.id }).lean(); res.json(p || null); };

exports.deleteMyAvatar = async (req, res) => {
  const p = await ServiceProvider.findOne({ owner: req.user.id });
  if (!p) return res.status(404).json({ message: 'Perfil no encontrado' });
  if (p.avatarPublicId) await cloudinary.uploader.destroy(p.avatarPublicId).catch(() => null);
  p.avatar = ''; p.avatarPublicId = ''; await p.save(); res.json({ ok: true, profile: p });
};

exports.deleteMine = async (req, res) => {
  const p = await ServiceProvider.findOne({ owner: req.user.id });
  if (!p) return res.status(404).json({ message: 'Perfil no encontrado' });
  if (p.avatarPublicId) await cloudinary.uploader.destroy(p.avatarPublicId).catch(() => null);
  await ServiceReview.deleteMany({ provider: p._id }); await p.deleteOne(); res.json({ ok: true });
};

exports.list = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim(); const trade = String(req.query.trade || '').trim(); const zone = String(req.query.zone || '').trim(); const area = String(req.query.area || '').trim(); const gender = String(req.query.gender || '').trim(); const minRating = Number(req.query.minRating || 0);
    const filter = { active: true, blocked: false };
    if (trade) filter.trades = new RegExp(trade, 'i');
    if (zone) filter.neighborhoods = new RegExp(zone.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
    if (['technical','care','general'].includes(area)) filter.serviceArea = area;
    if (['male','female'].includes(gender)) filter.gender = gender;
    if (minRating > 0) filter.rating = { $gte: Math.min(5, minRating) };
    if (q) filter.$or = ['displayName','headline','bio','trades'].map(k => ({ [k]: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i') }));
    const profiles = await ServiceProvider.find(filter).populate('owner','name avatar').sort({ availableNow: -1, verificationStatus: -1, rating: -1, updatedAt: -1 }).limit(100).lean();
    res.json({ profiles });
  } catch (err) { res.status(500).json({ message: 'No se pudieron cargar los servicios' }); }
};

exports.detail = async (req, res) => {
  try {
    const profile = await ServiceProvider.findOne({ _id: req.params.id, active: true, blocked: false }).populate('owner','name avatar').lean();
    if (!profile) return res.status(404).json({ message: 'Profesional no encontrado' });
    const allowed = [...new Set(profile.trades.flatMap(t => TRADE_BUSINESS_MAP[String(t).toLowerCase()] || ['Ferretería']))];
    const recommendedBusinesses = await Business.find({ blocked: false, suspended: false, categories: { $in: allowed.map(x => new RegExp(x,'i')) } }).select('name logo address categories rating verified').limit(8).lean();
    const reviews = await ServiceReview.find({ provider: profile._id, status: 'published' }).populate('author','name avatar').sort({ createdAt: -1 }).limit(30).lean();
    res.json({ profile, recommendedBusinesses, compatibleCategories: allowed, reviews });
  } catch (err) { res.status(500).json({ message: 'No se pudo cargar el profesional' }); }
};

exports.requestVerification = async (req, res) => {
  const p = await ServiceProvider.findOne({ owner: req.user.id });
  if (!p) return res.status(404).json({ message: 'Primero completá tu perfil' });
  const credentials = Array.isArray(req.body.credentials) ? req.body.credentials.slice(0, 10) : [];
  const references = Array.isArray(req.body.references) ? req.body.references.slice(0, 5) : [];
  p.credentials = credentials; p.references = references; p.verificationStatus = 'pending'; await p.save();
  res.json({ message: 'Verificación enviada para revisión', profile: p });
};

exports.listPendingVerification = async (req, res) => {
  const admin = await User.findById(req.user.id).select('role').lean();
  if (admin?.role !== 'admin') return res.status(403).json({ message: 'Acceso denegado' });
  const profiles = await ServiceProvider.find({ verificationStatus: 'pending' })
    .select('+references.contact +verificationNote').populate('owner', 'name email avatar').sort({ updatedAt: 1 }).lean();
  res.json({ profiles });
};

exports.resolveVerification = async (req, res) => {
  const admin = await User.findById(req.user.id).select('role').lean();
  if (admin?.role !== 'admin') return res.status(403).json({ message: 'Acceso denegado' });
  const status = req.body.status;
  if (!['verified', 'rejected'].includes(status)) return res.status(400).json({ message: 'Estado inválido' });
  const profile = await ServiceProvider.findByIdAndUpdate(req.params.id, {
    verificationStatus: status,
    verificationNote: String(req.body.note || '').trim().slice(0, 500),
    verifiedAt: status === 'verified' ? new Date() : null,
  }, { new: true });
  if (!profile) return res.status(404).json({ message: 'Profesional no encontrado' });
  await require('../routes/pushRoute').notifyUsers([String(profile.owner)], {
    title: status === 'verified' ? 'Perfil profesional verificado' : 'Revisión de perfil profesional',
    body: status === 'verified' ? 'Tu experiencia fue verificada. Ya aparece la insignia de confianza.' : (req.body.note || 'Revisá los datos y volvé a enviar la solicitud.'),
    url: '/servicios', tag: `service-verification-${profile._id}`, type: 'service_verification',
  }).catch(() => null);
  res.json(profile);
};

exports.rate = async (req, res) => {
  const rating = Number(req.body.rating); if (rating < 1 || rating > 5) return res.status(400).json({ message: 'Calificación inválida' });
  const p = await ServiceProvider.findById(req.params.id); if (!p) return res.status(404).json({ message: 'Profesional no encontrado' });
  if (String(p.owner) === String(req.user.id)) return res.status(400).json({ message: 'No podés calificar tu propio perfil' });
  await ServiceReview.findOneAndUpdate({ provider: p._id, author: req.user.id }, { rating, comment: String(req.body.comment || '').trim(), serviceReceived: req.body.serviceReceived !== false }, { upsert: true, new: true, runValidators: true });
  const stats = await ServiceReview.aggregate([{ $match: { provider: p._id, status: 'published' } }, { $group: { _id: null, rating: { $avg: '$rating' }, total: { $sum: 1 } } }]);
  p.rating = stats[0]?.rating || 0; p.totalRatings = stats[0]?.total || 0; p.ratingSum = p.rating * p.totalRatings; await p.save();
  res.json({ rating: p.rating, totalRatings: p.totalRatings });
};
