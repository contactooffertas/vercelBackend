const test = require('node:test');
const assert = require('node:assert/strict');
const { formatFavoriteBusinesses } = require('../utils/favoriteBusinesses');

test('returns saved businesses in order and skips deleted references', () => {
  const stored = [
    { _id: 'shop-1', name: 'Tienda A', city: 'Rosario', logo: '/a.png', blocked: false, owner: 'private-user' },
    null,
    { _id: 'shop-2', name: 'Tienda B', city: 'Rosario', blocked: true },
  ];
  assert.deepEqual(formatFavoriteBusinesses(stored), [
    { _id: 'shop-1', name: 'Tienda A', city: 'Rosario', logo: '/a.png', blocked: false },
    { _id: 'shop-2', name: 'Tienda B', city: 'Rosario', blocked: true },
  ]);
});

test('an account without saved businesses receives an empty list', () => {
  assert.deepEqual(formatFavoriteBusinesses(undefined), []);
});
