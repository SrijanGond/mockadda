// POST /api/chsl-recover
//   {"contact": "phone or email used at checkout", "reference": "optional UPI transaction ID / UTR or pay_... id", "exam": "super_tet"}
//     -> finds ALL of this buyer's purchases for that exam (packs and bundles): { purchases: [{product, order_id, payment_id, signature}] }
//   {"contact": ..., "product": "chsl"}   (older form) -> finds one purchase of that product: { order_id, payment_id, signature }
// For buyers who paid but never saw the download button (closed tab, new phone, cleared browser).
// Students usually only have the UPI transaction ID, so the phone number or email they paid with is what proves the
// purchase; the transaction ID is optional and just narrows the search.
const { PRODUCTS, getProduct, FORMAT, signatureFor, razorpay, checkPurchase, classifyPurchase, configured } = require('./_lib/verify');

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const clean = (s) => String(s || '').trim().replace(/\s+/g, '').toLowerCase();
const SEARCH_DAYS = 60, PAGE = 100, MAX_PAGES = 5;

function contactMatcher(contact) {
  const c = String(contact || '').trim();
  if (c.includes('@')) { const e = c.toLowerCase(); return (p) => String(p.email || '').toLowerCase() === e; }
  const d = last10(c);
  if (d.length !== 10) return null;
  return (p) => last10(p.contact) === d;
}
function referenceMatcher(ref) {
  const r = clean(ref);
  if (!r) return () => true;
  return (p) => {
    const a = p.acquirer_data || {};
    return [p.id, a.rrn, a.upi_transaction_id, a.bank_transaction_id].some((v) => v && clean(v) === r);
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST' }); }
  if (!configured()) return res.status(500).json({ error: 'Not configured yet' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const contact = String(body.contact || '').trim().slice(0, 120);
  const reference = String(body.reference || body.payment_id || '').trim().slice(0, 80);

  const examKey = body.exam ? String(body.exam) : null;
  const examProducts = examKey ? Object.keys(PRODUCTS).filter((k) => PRODUCTS[k].exam === examKey) : null;
  if (examKey && !examProducts.length) return res.status(400).json({ error: 'Unknown exam' });
  const productKey = body.product === undefined ? 'chsl' : String(body.product);
  const product = examKey ? null : getProduct(productKey);
  if (!examKey && !product) return res.status(400).json({ error: 'Unknown product' });
  const minPrice = examKey ? Math.min(...examProducts.map((k) => PRODUCTS[k].price)) : product.price;

  const matchContact = contactMatcher(contact);
  if (!matchContact) return res.status(400).json({ error: 'Please enter the 10-digit phone number or the email address you used when paying.' });
  const matchRef = referenceMatcher(reference);
  const notFound = { error: 'We could not find a matching payment. Check the phone number or email you paid with, or add your UPI transaction ID.' };
  try {
    let candidates = [];
    if (FORMAT.payment.test(reference)) {
      candidates = [await razorpay('/payments/' + reference)];
    } else {
      const to = Math.floor(Date.now() / 1000), from = to - SEARCH_DAYS * 86400;
      for (let page = 0; page < MAX_PAGES; page++) {
        const list = await razorpay('/payments?count=' + PAGE + '&skip=' + (page * PAGE) + '&from=' + from + '&to=' + to);
        const items = (list && list.items) || [];
        candidates = candidates.concat(items);
        if (items.length < PAGE) break;
      }
    }
    candidates = candidates
      .filter((p) => p && FORMAT.order.test(String(p.order_id || '')) && (p.status === 'captured' || p.status === 'authorized') && p.amount >= minPrice)
      .filter(matchContact).filter(matchRef)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    let pending = false;
    if (!examKey) {   // older form: one product
      for (const p of candidates.slice(0, 5)) {
        const check = await checkPurchase(p.order_id, p.id, productKey);
        if (check.state === 'ok') return res.status(200).json({ order_id: p.order_id, payment_id: p.id, signature: signatureFor(p.order_id, p.id) });
        if (check.state === 'pending') pending = true;
      }
    } else {          // every purchase this buyer made for the exam
      const found = {};
      for (const p of candidates.slice(0, 8)) {
        const c = await classifyPurchase(p.order_id, p.id);
        if (c.state === 'invalid' || c.product.exam !== examKey) continue;
        if (c.state === 'pending') { pending = true; continue; }
        if (!found[c.key]) found[c.key] = { product: c.key, order_id: p.order_id, payment_id: p.id, signature: signatureFor(p.order_id, p.id) };
      }
      const purchases = Object.keys(found).map((k) => found[k]);
      if (purchases.length) return res.status(200).json({ purchases, order_id: purchases[0].order_id, payment_id: purchases[0].payment_id, signature: purchases[0].signature });
    }
    if (pending) return res.status(202).json({ error: 'Your payment is being confirmed. Please try again in a few minutes.' });
    return res.status(404).json(notFound);
  } catch (e) {
    return res.status(503).json({ error: 'We could not check this right now. Please try again in a minute.' });
  }
};
