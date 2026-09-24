function needsDeliveryReview(order, now = new Date()) {
  if (order.status !== 'shipped') return false;
  const shippedAt = order.shippedAt || order.updatedAt;
  const timestamp = shippedAt && new Date(shippedAt).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= 72 * 60 * 60 * 1000;
}

function mayRequestDeliveryReview(order, userId, businessId) {
  if (order.status !== 'shipped') return false;
  return String(order.user) === String(userId) ||
    Boolean(order.businessId && businessId && String(order.businessId) === String(businessId));
}
function canAdminCompleteDelivery(order, note) {
  return order.status === 'shipped' && typeof note === 'string' && note.trim().length >= 10;
}
module.exports = { needsDeliveryReview, mayRequestDeliveryReview, canAdminCompleteDelivery };
