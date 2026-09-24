const test = require('node:test');
const assert = require('node:assert/strict');
const { redactPublicRatings } = require('../utils/publicRatings');

test('business ratings and legacy vote totals do not leave public catalog endpoints', () => {
  const payload = { businesses: [{ name: 'Tienda', rating: 2, totalRatings: 1, ratingSum: 2 }], products: [{ business: { rating: 1, totalRatings: 3 } }] };
  assert.deepEqual(redactPublicRatings(payload), { businesses: [{ name: 'Tienda' }], products: [{ business: {} }] });
  assert.equal(payload.businesses[0].rating, 2);
});
