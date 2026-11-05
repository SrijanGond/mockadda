// POST /api/chsl-recover  {"payment_id": "pay_...", "contact": "email or phone used at checkout"}
// For buyers who paid but never saw the download button (closed tab, changed phone, cleared browser).
// The payment is looked up at Razorpay and must match the email or phone given. Returns the same download details
// the buyer would have received straight after paying.
const { FORMAT, signatureFor, checkPurchase, configured } = require('./_lib/verify');

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST' }); }
  if (!configured()) return res.status(500).json({ error: 'Not configured yet' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const paymentId = String(body.payment_id || '').trim();
  const contact = String(body.contact || '').trim().slice(0, 120);
  if (!FORMAT.payment.test(paymentId) || contact.length < 5) return res.status(400).json({ error: 'Please enter your payment ID and the email or phone number you used.' });
  try {
    const { razorpay } = require('./_lib/verify');
    const payment = await razorpay('/payments/' + paymentId);
    const orderId = payment && payment.order_id;
    if (!orderId || !FORMAT.order.test(orderId)) return res.status(404).json({ error: 'We could not match this payment.' });
    const email = String(payment.email || '').toLowerCase();
    const phone = last10(payment.contact);
    const matches = (email && contact.toLowerCase() === email) || (phone.length === 10 && last10(contact) === phone && last10(contact).length === 10);
    if (!matches) return res.status(404).json({ error: 'We could not match this payment.' });
    const check = await checkPurchase(orderId, paymentId);
    if (check.state === 'invalid') return res.status(404).json({ error: 'We could not match this payment.' });
    if (check.state === 'pending') return res.status(202).json({ error: 'Your payment is being confirmed. Please try again in a few minutes.' });
    return res.status(200).json({ order_id: orderId, payment_id: paymentId, signature: signatureFor(orderId, paymentId) });
  } catch (e) {
    return res.status(503).json({ error: 'We could not check this right now. Please try again in a minute.' });
  }
};
