// GET /api/chsl-download?order_id=...&payment_id=...&signature=...
// Serves the CHSL pack ZIP only after the payment is proven genuine:
//   1. the Razorpay signature matches (HMAC-SHA256 of "order_id|payment_id" with your key secret),
//   2. Razorpay confirms the payment is captured, belongs to this order, and is for the CHSL pack at full price.
// The ZIP is stored encrypted in api/_pack/pack.enc (not a public folder), so it cannot be fetched or read directly.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRICE_PAISE = parseInt(process.env.CHSL_PRICE_PAISE || '9900', 10);
const FILE_NAME = 'ReadyMadeQuiz_SSC_CHSL_Tier1_Test_Pack_5_Tests.zip';

function page(res, status, title, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(status).send(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><body style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 20px;line-height:1.6">' +
    '<h2>' + title + '</h2><p>' + message + '</p><p><a href="/">Back to ReadyMadeQuiz</a></p></body>'
  );
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

async function razorpay(pathname, keyId, keySecret) {
  const r = await fetch('https://api.razorpay.com/v1' + pathname, {
    headers: { Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64') },
  });
  if (!r.ok) throw new Error('razorpay ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return page(res, 500, 'Not available', 'Downloads are not configured yet. Please email us with your payment ID.');

  const q = req.query || {};
  const orderId = String(q.order_id || ''), paymentId = String(q.payment_id || ''), signature = String(q.signature || '');
  if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^[a-f0-9]{64}$/.test(signature)) {
    return page(res, 400, 'Invalid download link', 'This link is incomplete. Please use the download button shown after your payment.');
  }
  const expected = crypto.createHmac('sha256', keySecret).update(orderId + '|' + paymentId).digest('hex');
  if (!safeEqual(expected, signature)) {
    return page(res, 403, 'Invalid download link', 'We could not verify this payment. If you have paid, please email us with your payment ID.');
  }
  try {
    const [payment, order] = await Promise.all([
      razorpay('/payments/' + paymentId, keyId, keySecret),
      razorpay('/orders/' + orderId, keyId, keySecret),
    ]);
    const product = order && order.notes && order.notes.product;
    if (payment.order_id !== orderId || product !== 'chsl_pack' || !(payment.amount >= PRICE_PAISE)) {
      return page(res, 403, 'Invalid download link', 'This payment is not for the CHSL pack.');
    }
    if (payment.status !== 'captured') {
      return page(res, 202, 'Payment being confirmed', 'Your payment has been received and is being confirmed. Please refresh this page in a minute.');
    }
  } catch (e) {
    return page(res, 503, 'Please try again', 'We could not confirm your payment right now. Please try again in a minute.');
  }
  // The pack is stored encrypted (AES-256-GCM) so it can sit safely in a public repo.
  // PACK_KEY (64 hex characters) is kept only in Vercel's environment variables.
  let file;
  try {
    const packKey = process.env.PACK_KEY || '';
    if (!/^[a-f0-9]{64}$/i.test(packKey)) throw new Error('no key');
    const blob = fs.readFileSync(path.join(__dirname, '_pack', 'pack.enc'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(packKey, 'hex'), blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    file = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  } catch (e) { return page(res, 500, 'File not available', 'We could not prepare the download. Please email us with your payment ID.'); }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + FILE_NAME + '"');
  res.setHeader('Content-Length', String(file.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? undefined : file);
};
