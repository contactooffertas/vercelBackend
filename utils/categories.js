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
  const raw = String(value || '').trim().toLowerCase();
  return LEGACY_CATEGORY_ALIASES[raw] || raw;
}

function isValidCategory(value) {
  return MARKET_CATEGORIES.includes(normalizeCategory(value));
}

module.exports = { MARKET_CATEGORIES, LEGACY_CATEGORY_ALIASES, normalizeCategory, isValidCategory };
