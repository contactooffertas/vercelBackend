// utils/contentPolicy.js
// Política única para texto público enviado a Rosario Market.
// Se normalizan mayúsculas y acentos, y se buscan palabras completas para
// evitar falsos positivos dentro de otras palabras.

const FORBIDDEN_PATTERNS = [
  /\bviolacion(?:es)?\b/,
  /\basesinato(?:s)?\b/,
  /\basesin[oa]s?\b/,
  /\bput[oa]s?\b/,
  /\bhijo\s+de\s+mil\s+puta\b/,
  /\bcojer\b/,
  /\bcoger\b/,
  /\bcojiendo\b/,
  /\bcogiendo\b/,
  /\banal\b/,
  /\bcagar\b/,
];

const SKIP_KEYS = new Set([
  'password', 'confirm', 'newpassword', 'currentpassword',
  'token', 'accesstoken', 'refreshtoken',
  'verificationcode', 'resetpasswordcode', 'code',
  'email',
]);

function normalizePublicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findForbiddenText(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = normalizePublicText(value);
  return FORBIDDEN_PATTERNS.find((pattern) => pattern.test(normalized)) || null;
}

function findForbiddenInObject(value, key = '') {
  if (SKIP_KEYS.has(String(key).toLowerCase())) return null;

  if (typeof value === 'string') {
    return findForbiddenText(value) ? { key, value } : null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findForbiddenInObject(value[i], key);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = findForbiddenInObject(childValue, childKey);
      if (found) return found;
    }
  }

  return null;
}

function blockForbiddenContent(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const found = findForbiddenInObject(req.body);
  if (!found) return next();

  return res.status(400).json({
    message: 'El contenido contiene palabras o expresiones no permitidas. Corregilo para continuar.',
    code: 'CONTENT_NOT_ALLOWED',
  });
}

module.exports = {
  normalizePublicText,
  findForbiddenText,
  findForbiddenInObject,
  blockForbiddenContent,
};
