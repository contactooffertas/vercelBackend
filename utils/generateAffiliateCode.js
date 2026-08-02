// utils/generateAffiliateCode.js
const crypto = require('crypto');

/**
 * Genera un código corto y único para el link de afiliado.
 * 12 caracteres hexadecimales, suficiente entropía para este uso
 * y prolijo dentro de una URL.
 */
function generateAffiliateCode() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = generateAffiliateCode;
