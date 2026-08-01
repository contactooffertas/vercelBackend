// controllers/affiliateController.js
const AffiliateTermsAcceptance = require('../models/AffiliateTermsAcceptance');
const AffiliateSellerApplication = require('../models/AffiliateSellerApplication');
const AffiliateBuyerApplication = require('../models/AffiliateBuyerApplication');
const User = require('../models/userModel');

// Versión vigente de los Términos y Condiciones del Programa de Afiliados.
// Cuando en el futuro se agregue el CRUD de versiones desde el panel admin,
// este valor pasará a leerse desde la base de datos (colección AffiliateTerms).
const CURRENT_TERMS_VERSION = 1;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

/**
 * GET /api/affiliates/status
 * Devuelve el estado actual del usuario autenticado dentro del programa:
 * si ya aceptó los TyC vigentes y si ya envió su solicitud/configuración.
 */
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId).select('role name businessId');
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const role = user.role === 'seller' ? 'seller' : user.role === 'admin' ? 'admin' : 'buyer';

    const acceptance = await AffiliateTermsAcceptance.findOne({
      user: userId,
      role,
      version: CURRENT_TERMS_VERSION,
    }).sort({ acceptedAt: -1 });

    const sellerApplication =
      role === 'seller' ? await AffiliateSellerApplication.findOne({ user: userId }) : null;
    const buyerApplication =
      role === 'buyer' ? await AffiliateBuyerApplication.findOne({ user: userId }) : null;

    return res.status(200).json({
      role,
      name: user.name,
      businessId: user.businessId || null,
      termsVersion: CURRENT_TERMS_VERSION,
      hasAcceptedTerms: !!acceptance,
      acceptedAt: acceptance ? acceptance.acceptedAt : null,
      hasApplication: !!(sellerApplication || buyerApplication),
      application: sellerApplication || buyerApplication || null,
    });
  } catch (err) {
    console.error('[affiliateController.getStatus]', err);
    return res.status(500).json({ message: 'Error al obtener el estado del programa de afiliados' });
  }
};

/**
 * POST /api/affiliates/terms/accept
 * body: { role: 'seller' | 'buyer' }
 * Guarda la aceptación de TyC con usuario, fecha, hora, ip, userAgent y versión.
 */
exports.acceptTerms = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { role } = req.body;

    if (!['seller', 'buyer'].includes(role)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const acceptance = await AffiliateTermsAcceptance.create({
      user: userId,
      role,
      version: CURRENT_TERMS_VERSION,
      acceptedAt: new Date(),
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    return res.status(201).json({
      message: 'Términos y condiciones aceptados correctamente',
      acceptedAt: acceptance.acceptedAt,
      version: acceptance.version,
    });
  } catch (err) {
    console.error('[affiliateController.acceptTerms]', err);
    return res.status(500).json({ message: 'Error al registrar la aceptación de los términos' });
  }
};

/**
 * POST /api/affiliates/apply/seller
 * Crea o actualiza la configuración del programa de afiliados del vendedor.
 * Requiere que el usuario ya haya aceptado los TyC vigentes como seller.
 */
exports.submitSellerApplication = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const acceptance = await AffiliateTermsAcceptance.findOne({
      user: userId,
      role: 'seller',
      version: CURRENT_TERMS_VERSION,
    });
    if (!acceptance) {
      return res.status(403).json({ message: 'Debés aceptar los Términos y Condiciones antes de continuar' });
    }

    const {
      businessName,
      contactName,
      email,
      phone,
      defaultPercentage,
      maxAffiliates,
      description,
    } = req.body;

    if (
      !businessName ||
      !contactName ||
      !email ||
      !phone ||
      defaultPercentage === undefined ||
      maxAffiliates === undefined ||
      !description
    ) {
      return res.status(400).json({ message: 'Faltan campos obligatorios del formulario' });
    }

    const application = await AffiliateSellerApplication.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        businessName,
        contactName,
        email,
        phone,
        defaultPercentage: Number(defaultPercentage),
        maxAffiliates: Number(maxAffiliates),
        description,
        status: 'active',
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      message: 'Programa de afiliados configurado correctamente',
      application,
    });
  } catch (err) {
    console.error('[affiliateController.submitSellerApplication]', err);
    return res.status(500).json({ message: 'Error al guardar la configuración del programa de afiliados' });
  }
};

/**
 * POST /api/affiliates/apply/buyer
 * Crea o actualiza la solicitud del comprador para sumarse como afiliado.
 * Requiere que el usuario ya haya aceptado los TyC vigentes como buyer.
 */
exports.submitBuyerApplication = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const acceptance = await AffiliateTermsAcceptance.findOne({
      user: userId,
      role: 'buyer',
      version: CURRENT_TERMS_VERSION,
    });
    if (!acceptance) {
      return res.status(403).json({ message: 'Debés aceptar los Términos y Condiciones antes de continuar' });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      city,
      province,
      socialMedia,
      salesExperience,
      privacyAccepted,
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !city || !province) {
      return res.status(400).json({ message: 'Faltan campos obligatorios del formulario' });
    }
    if (!privacyAccepted) {
      return res.status(400).json({ message: 'Debés aceptar la política de privacidad' });
    }

    const application = await AffiliateBuyerApplication.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        firstName,
        lastName,
        email,
        phone,
        city,
        province,
        socialMedia: socialMedia || '',
        salesExperience: salesExperience || '',
        privacyAccepted: true,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      message: 'Solicitud enviada correctamente',
      application,
    });
  } catch (err) {
    console.error('[affiliateController.submitBuyerApplication]', err);
    return res.status(500).json({ message: 'Error al enviar la solicitud de afiliado' });
  }
};
