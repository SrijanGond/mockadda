// GET /api/chsl-download?order_id=...&payment_id=...&signature=...&product=chsl|supertet  (product defaults to chsl)
// Serves the pack PDF only after the payment is proven genuine:
//   1. the Razorpay signature matches (HMAC-SHA256 of "order_id|payment_id" with your key secret),
//   2. Razorpay confirms the payment is captured, belongs to this order, and is for the requested pack at full price.
// Each pack PDF is stored encrypted in api/_pack/ (pack.enc = CHSL, supertet.enc = Super TET; not a public folder), so it cannot be fetched or read directly.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { FORMAT, signatureFor, safeEqual, checkPurchase, configured, isTestPurchase, getProduct } = require('./_lib/verify');

// Literal paths on purpose: Vercel includes exactly these files in the function.
const PACK_FILES = {
  chsl: () => fs.readFileSync(path.join(__dirname, '_pack', 'pack.enc')),
  supertet: () => fs.readFileSync(path.join(__dirname, '_pack', 'supertet.enc')),
  supertet2: () => fs.readFileSync(path.join(__dirname, '_pack', 'supertet2.enc')),
  // New pack? Add a line here with a literal path, e.g.  supertet3: () => fs.readFileSync(path.join(__dirname, '_pack', 'supertet3.enc')),
};

function page(res, status, title, message) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(status).send(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><body style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 20px;line-height:1.6">' +
    '<h2>' + title + '</h2><p>' + message + '</p><p><a href="/pack-thanks.html">Recover my download</a> · <a href="/">Back to ReadyMadeQuiz</a></p></body>'
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }
  const q = req.query || {};
  const productKey = q.product === undefined ? 'chsl' : String(q.product);
  const product = getProduct(productKey);
  if (!product || product.kind !== 'pack' || !PACK_FILES[productKey]) return page(res, 400, 'Invalid download link', 'This link is incomplete. Please use the download button shown after your payment.');
  const orderId = String(q.order_id || ''), paymentId = String(q.payment_id || ''), signature = String(q.signature || '');
  const testOk = isTestPurchase(orderId, paymentId, signature);   // true only while PACK_TEST_MODE=on
  if (!testOk && !configured()) return page(res, 500, 'Not available', 'Downloads are not configured yet. Please email us with your payment ID.');
  if (!FORMAT.order.test(orderId) || !FORMAT.payment.test(paymentId) || !FORMAT.signature.test(signature)) {
    return page(res, 400, 'Invalid download link', 'This link is incomplete. Please use the download button shown after your payment.');
  }
  if (!testOk && !safeEqual(signatureFor(orderId, paymentId), signature)) {
    return page(res, 403, 'Invalid download link', 'We could not verify this payment. If you have paid, please email us with your payment ID.');
  }
  try {
    const check = testOk ? { state: 'ok' } : await checkPurchase(orderId, paymentId, productKey);
    if (check.state === 'invalid') return page(res, 403, 'Invalid download link', 'This payment is not for this pack.');
    if (check.state === 'pending') return page(res, 202, 'Payment being confirmed', 'Your payment has been received and is being confirmed. Please refresh this page in a minute.');
  } catch (e) {
    return page(res, 503, 'Please try again', 'We could not confirm your payment right now. Please try again in a minute.');
  }
  // The pack is stored encrypted (AES-256-GCM) so it can sit safely in a public repo.
  // PACK_KEY (64 hex characters) is kept only in Vercel's environment variables.
  let file;
  try {
    const packKey = process.env.PACK_KEY || '';
    if (!/^[a-f0-9]{64}$/i.test(packKey)) throw new Error('no key');
    const blob = PACK_FILES[productKey]();
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(packKey, 'hex'), blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    file = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  } catch (e) { return page(res, 500, 'File not available', 'We could not prepare the download. Please email us with your payment ID.'); }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + product.fileName + '"');
  res.setHeader('Content-Length', String(file.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? undefined : file);
};
