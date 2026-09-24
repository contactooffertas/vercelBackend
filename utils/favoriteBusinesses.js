const PUBLIC_FIELDS = ['_id', 'name', 'city', 'logo', 'address', 'description', 'verified', 'blocked'];

function formatFavoriteBusinesses(businesses) {
  if (!Array.isArray(businesses)) return [];
  return businesses.filter(business => business && business._id).map(business =>
    Object.fromEntries(PUBLIC_FIELDS.filter(field => business[field] !== undefined).map(field => [field, business[field]]))
  );
}
module.exports = { formatFavoriteBusinesses };
