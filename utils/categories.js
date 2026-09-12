// utils/categories.js
// Categorías oficiales de Rosario Market: deben coincidir con el navbar.
const MARKET_CATEGORIES = [
  'electronica',
  'ropa-moda',
  'hogar',
  'deportes',
  'alimentos',
  'salud-belleza',
  'automotriz',
  'juguetes',
  'libros',
  'mascotas',
];

const LEGACY_CATEGORY_ALIASES = {
  tecnologia: 'electronica',
  ropa: 'ropa-moda',
  belleza: 'salud-belleza',
  automotor: 'automotriz',
};

function normalizeCategory(value) {
  const raw = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  const aliases = {
    ...LEGACY_CATEGORY_ALIASES,
    electronica: 'electronica',
    'ropa-y-moda': 'ropa-moda',
    hogar: 'hogar',
    deportes: 'deportes',
    alimentos: 'alimentos',
    'salud-y-belleza': 'salud-belleza',
    automotriz: 'automotriz',
    juguetes: 'juguetes',
    libros: 'libros',
    mascotas: 'mascotas',
  };

  return aliases[raw] || raw;
}

function isValidCategory(value) {
  return MARKET_CATEGORIES.includes(normalizeCategory(value));
}

function categoryQueryValues(value) {
  const normalized = normalizeCategory(value);
  const values = new Set([normalized]);

  for (const [legacy, current] of Object.entries(LEGACY_CATEGORY_ALIASES)) {
    if (current === normalized) values.add(legacy);
  }

  const labelAliases = {
    electronica: ['Electrónica', 'electronica'],
    'ropa-moda': ['Ropa y Moda', 'ropa y moda', 'ropa'],
    hogar: ['Hogar', 'hogar'],
    deportes: ['Deportes', 'deportes'],
    alimentos: ['Alimentos', 'alimentos'],
    'salud-belleza': ['Salud y Belleza', 'salud y belleza', 'belleza'],
    automotriz: ['Automotriz', 'automotriz', 'automotor'],
    juguetes: ['Juguetes', 'juguetes'],
    libros: ['Libros', 'libros'],
    mascotas: ['Mascotas', 'mascotas'],
  };

  (labelAliases[normalized] || []).forEach((item) => values.add(item));
  return [...values];
}

module.exports = { MARKET_CATEGORIES, LEGACY_CATEGORY_ALIASES, normalizeCategory, isValidCategory, categoryQueryValues };
