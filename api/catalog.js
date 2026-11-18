// GET /api/catalog -> the packs that are on sale right now, grouped by exam (the site's buy card is built from this).
const { publicCatalog } = require('./_lib/verify');
module.exports = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'GET only' }); }
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
  return res.status(200).json(publicCatalog());
};
