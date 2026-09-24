const test = require('node:test');
const assert = require('node:assert/strict');
const { needsDeliveryReview, mayRequestDeliveryReview, canAdminCompleteDelivery } = require('../utils/orderLifecycle');

test('a shipment without confirmation needs review after 72 hours', () => {
  const order = { status: 'shipped', shippedAt: new Date('2026-09-01T00:00:00Z') };
  assert.equal(needsDeliveryReview(order, new Date('2026-09-03T23:59:59Z')), false);
  assert.equal(needsDeliveryReview(order, new Date('2026-09-04T00:00:00Z')), true);
});

test('a completed or returned order never needs delivery review', () => {
  for (const status of ['delivered', 'returned']) {
    assert.equal(needsDeliveryReview({ status, shippedAt: new Date('2026-01-01') }, new Date('2026-09-01')), false);
  }
});

test('legacy shipments use updatedAt, never the original purchase date', () => {
  const order = { status: 'shipped', date: new Date('2026-01-01'), updatedAt: new Date('2026-09-03') };
  assert.equal(needsDeliveryReview(order, new Date('2026-09-04')), false);
});

test('only the buyer or the order business can request review for shipped orders', () => {
  const order = { status: 'shipped', user: 'buyer', businessId: 'business' };
  assert.equal(mayRequestDeliveryReview(order, 'buyer', 'other'), true);
  assert.equal(mayRequestDeliveryReview(order, 'seller', 'business'), true);
  assert.equal(mayRequestDeliveryReview(order, 'stranger', 'other'), false);
  assert.equal(mayRequestDeliveryReview({ ...order, status: 'delivered' }, 'buyer', 'other'), false);
});

test('admin closure requires a shipped order and an explicit verification note', () => {
  assert.equal(canAdminCompleteDelivery({ status: 'shipped' }, 'El comprador confirmó la entrega por teléfono'), true);
  assert.equal(canAdminCompleteDelivery({ status: 'shipped' }, 'ok'), false);
  assert.equal(canAdminCompleteDelivery({ status: 'returned' }, 'El comprador confirmó la entrega por teléfono'), false);
});
