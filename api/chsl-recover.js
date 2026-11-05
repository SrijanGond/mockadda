// POST /api/chsl-recover  {"contact": "phone or email used at checkout", "reference": "optional UPI transaction ID / UTR or pay_... id"}
// For buyers who paid but never saw the download button (closed tab, new phone, cleared browser).
// Students usually only have the UPI transaction ID, so the phone number or email they paid with is what proves the
// purchase; the transaction ID is optional and just narrows the search. Returns the same download details the buyer
// would have received straight after paying.
const { PRICE_PAISE, FORMAT, signatureFor, razorpay, checkPurchase, configured } = require('./_lib/verify');

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
      .filter((p) => p && FORMAT.order.test(String(p.order_id || '')) && (p.status === 'captured' || p.status === 'authorized') && p.amount >= PRICE_PAISE)
      .filter(matchContact).filter(matchRef)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 5);
    let pending = false;
    for (const p of candidates) {
      const check = await checkPurchase(p.order_id, p.id);
      if (check.state === 'ok') return res.status(200).json({ order_id: p.order_id, payment_id: p.id, signature: signatureFor(p.order_id, p.id) });
      if (check.state === 'pending') pending = true;
    }
    if (pending) return res.status(202).json({ error: 'Your payment is being confirmed. Please try again in a few minutes.' });
    return res.status(404).json(notFound);
  } catch (e) {
    return res.status(503).json({ error: 'We could not check this right now. Please try again in a minute.' });
  }
};
