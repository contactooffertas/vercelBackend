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

module.exports = { MARKET_CATEGORIES, LEGACY_CATEGORY_ALIASES, normalizeCategory, isValidCategory };
