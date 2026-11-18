// POST /api/create-order {"product":"<catalog key>"}  -> creates a Razorpay order for that pack or bundle (default chsl) and returns what the checkout window needs.
// Needs Vercel env vars: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (and optionally CHSL_PRICE_PAISE, default 9900).
const { getProduct, isLive, configured, testModeOn, testSignature, TEST_ORDER, TEST_PAYMENT } = require('./_lib/verify');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const key = body.product === undefined ? 'chsl' : String(body.product);
  const product = getProduct(key);
  if (!product) return res.status(400).json({ error: 'Unknown product' });
  if (testModeOn()) {   // TEST MODE: skip payment and go straight to the download page
    return res.status(200).json({ orderId: TEST_ORDER, testUrl: '/pack-thanks.html?order_id=' + TEST_ORDER + '&payment_id=' + TEST_PAYMENT + '&signature=' + testSignature() + '&product=' + key });
  }
  // Only packs that are switched on in the catalog can be bought (so no one can pay before a pack's file is uploaded)
  if (!isLive(product)) return res.status(503).json({ error: 'This pack is not open for sale yet' });
  if (!configured()) return res.status(500).json({ error: 'Payments are not configured' });
  try {
    const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'content-type': 'application/json' },
      // notes.product is checked again before every download, so only genuine CHSL pack orders can get the file
      body: JSON.stringify({ amount: product.price, currency: 'INR', receipt: key + '_' + Date.now(), notes: { product: product.note } }),
    });
    const order = await r.json().catch(() => ({}));
    if (!r.ok || !order.id) return res.status(502).json({ error: (order && order.error && order.error.description) || 'Could not create the order' });
    return res.status(200).json({ orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency });
  } catch (e) {
    return res.status(500).json({ error: 'order' });
  }
};
