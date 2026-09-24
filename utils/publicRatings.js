const HIDDEN_FIELDS = new Set(['rating', 'ratingSum', 'totalRatings', 'myRating', 'buyerRating', 'buyerRatingSum', 'buyerTotalRatings']);

function redactPublicRatings(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value, (key, entry) => HIDDEN_FIELDS.has(key) ? undefined : entry));
}

function hidePublicRatings(req, res, next) {
  if (req.method !== 'GET') return next();
  const sendJson = res.json.bind(res);
  res.json = payload => sendJson(redactPublicRatings(payload));
  next();
}

module.exports = { redactPublicRatings, hidePublicRatings };
