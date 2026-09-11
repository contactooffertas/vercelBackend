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
  /\bdroga(?:s)?\b/,
  /\bporro(?:s)?\b/,
  /\bfaso(?:s)?\b/,
  /\bcocaina\b/,
  /\bprostitucion\b/,
  /\bprostitut[oa]s?\b/,
  /\bborracho(?:s)?\b/,
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

async function findManagedForbiddenText(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = normalizePublicText(value);

  // Excepción explícita pedida para el nombre del árbol "palo borracho".
  const normalizedForCheck = normalized.replace(/\bpalo\s+borracho\b/g, ' ');

  const hardcoded = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(normalizedForCheck));
  if (hardcoded) return { source: 'default', term: hardcoded.toString() };

  try {
    const ForbiddenTerm = require('../models/forbiddenTermModel');
    const terms = await ForbiddenTerm.find({ active: true }).select('normalized exceptions').lean();
    for (const item of terms) {
      const term = normalizePublicText(item.normalized);
      if (!term) continue;
      const exceptions = Array.isArray(item.exceptions) ? item.exceptions.map(normalizePublicText) : [];
      const withoutExceptions = exceptions.reduce(
        (text, exception) => exception ? text.replace(new RegExp('\\b' + exception.replace(/[.*+?^$()|[\\]\\\\]/g, '\\$&') + '\\b', 'g'), ' ') : text,
        normalized
      );
      const regex = new RegExp('\\b' + term.replace(/[.*+?^$()|[\\]\\\\]/g, '\\$&') + '\\b', 'i');
      if (regex.test(withoutExceptions)) return { source: 'admin', term };
    }
  } catch (_) {
    // Si la colección todavía no existe o Mongo está iniciando, siguen vigentes
    // las reglas base para no bloquear toda la aplicación.
  }

  return null;
}

async function findForbiddenInObjectAsync(value, key = '') {
  if (SKIP_KEYS.has(String(key).toLowerCase())) return null;

  if (typeof value === 'string') {
    const hit = await findManagedForbiddenText(value);
    return hit ? { key, value, hit } : null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = await findForbiddenInObjectAsync(value[i], key);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      const found = await findForbiddenInObjectAsync(childValue, childKey);
      if (found) return found;
    }
  }

  return null;
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

async function blockForbiddenContent(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();

  // El administrador necesita poder escribir justamente los términos que
  // quiere agregar/quitar de la lista de moderación.
  if (String(req.originalUrl || '').startsWith('/api/admin/search-dictionary/forbidden')) return next();

  const found = await findForbiddenInObjectAsync(req.body);
  if (!found) return next();

  return res.status(400).json({
    message: 'Ese contenido incluye una palabra o expresión que no está permitida en Rosario Market. Corregilo para continuar.',
    code: 'CONTENT_NOT_ALLOWED',
  });
}
module.exports = {
  normalizePublicText,
  findForbiddenText,
  findForbiddenInObject,
  findManagedForbiddenText,
  findForbiddenInObjectAsync,
  blockForbiddenContent,
};
