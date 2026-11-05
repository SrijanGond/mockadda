// Shared helpers for the CHSL pack payment endpoints (the underscore folder is not exposed as a URL).
const crypto = require('crypto');
const PRICE_PAISE = parseInt(process.env.CHSL_PRICE_PAISE || '9900', 10);

const FORMAT = {
  order: /^order_[A-Za-z0-9]+$/,
  payment: /^pay_[A-Za-z0-9]+$/,
  signature: /^[a-f0-9]{64}$/,
};

function signatureFor(orderId, paymentId) {
  return crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex');
}
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
async function razorpay(pathname) {
  const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1' + pathname, { headers: { Authorization: 'Basic ' + auth } });
  if (!r.ok) throw new Error('razorpay ' + r.status);
  return r.json();
}
// Asks Razorpay whether this payment is a genuine, full-price CHSL pack purchase.
// Returns { state: 'ok' | 'pending' | 'invalid', payment, order }. Throws if Razorpay cannot be reached.
async function checkPurchase(orderId, paymentId) {
  const [payment, order] = await Promise.all([razorpay('/payments/' + paymentId), razorpay('/orders/' + orderId)]);
  const product = order && order.notes && order.notes.product;
  if (payment.order_id !== orderId || product !== 'chsl_pack' || !(payment.amount >= PRICE_PAISE)) return { state: 'invalid', payment, order };
  if (payment.status !== 'captured') return { state: 'pending', payment, order };
  return { state: 'ok', payment, order };
}
function configured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
module.exports = { PRICE_PAISE, FORMAT, signatureFor, safeEqual, razorpay, checkPurchase, configured };
