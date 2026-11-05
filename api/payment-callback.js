// POST /api/payment-callback  <- Razorpay sends the customer's browser here after the payment window closes.
// This works even when the customer paid inside a UPI app and the original page was closed or reloaded.
// Success: razorpay_payment_id, razorpay_order_id, razorpay_signature. Failure: error fields.
const { FORMAT, signatureFor, safeEqual, configured } = require('./_lib/verify');

function go(res, location) {
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(303).end();
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return go(res, '/');
  let body = req.body || {};
  if (typeof body === 'string') body = Object.fromEntries(new URLSearchParams(body));
  const orderId = String(body.razorpay_order_id || ''), paymentId = String(body.razorpay_payment_id || ''), signature = String(body.razorpay_signature || '');
  if (!configured() || !FORMAT.order.test(orderId) || !FORMAT.payment.test(paymentId) || !FORMAT.signature.test(signature)) {
    return go(res, '/pack-thanks.html?status=failed');
  }
  if (!safeEqual(signatureFor(orderId, paymentId), signature)) return go(res, '/pack-thanks.html?status=failed');
  return go(res, '/pack-thanks.html?order_id=' + encodeURIComponent(orderId) + '&payment_id=' + encodeURIComponent(paymentId) + '&signature=' + encodeURIComponent(signature));
};
