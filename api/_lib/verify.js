// Shared helpers for the pack payment endpoints (the underscore folder is not exposed as a URL).
const crypto = require('crypto');

const paise = (env, dflt) => parseInt(process.env[env] || String(dflt), 10);
const always = () => true;
const flag = (env) => () => process.env[env] === 'on';

// =====================================================================================================
//  PACK CATALOG - the single list the whole site is built from (the buy card reads it from /api/catalog).
//  kind 'pack'   = one downloadable PDF. Its encrypted file is listed in chsl-download.js (PACK_FILES).
//  kind 'bundle' = sells several packs together ('includes').
//  live()        = whether it can be bought right now (a pack stays hidden until its flag is set to 'on' in Vercel).
//  To add a pack: 1) add an entry here  2) add one line in chsl-download.js  3) upload api/_pack/<file>.enc
//                 4) set its flag (e.g. SUPERTET2_LIVE=on) in Vercel and redeploy.
// =====================================================================================================
const PRODUCTS = {
  chsl: {
    exam: 'ssc_chsl', kind: 'pack', note: 'chsl_pack', price: paise('CHSL_PRICE_PAISE', 9900), live: always,
    title: 'Pack 1 — Tests 1–5', name: 'SSC CHSL Tier 1 Test Pack',
    desc: '5 full-length SSC CHSL Tier 1 papers (100 questions each), English and Hindi, with answer key and explanations',
    fileName: 'ReadyMadeQuiz_SSC_CHSL_Tier1_Test_Pack_5_Tests.pdf',
  },
  supertet: {
    exam: 'super_tet', kind: 'pack', note: 'supertet_pack', price: paise('SUPERTET_PRICE_PAISE', 9900), live: flag('SUPERTET_LIVE'),
    title: 'Pack 1 — Tests 1–5', name: 'UP Super TET Test Pack 1',
    desc: '5 full-length UP Super TET papers (120 questions each), English and Hindi, with answer key and explanations',
    fileName: 'ReadyMadeQuiz_UP_Super_TET_Test_Pack.pdf',
  },
  supertet2: {
    exam: 'super_tet', kind: 'pack', note: 'supertet2_pack', price: paise('SUPERTET2_PRICE_PAISE', 9900), live: flag('SUPERTET2_LIVE'),
    title: 'Pack 2 — Tests 6–10', name: 'UP Super TET Test Pack 2',
    desc: '5 more full-length UP Super TET papers (Tests 6–10), English and Hindi, with answer key and explanations',
    fileName: 'ReadyMadeQuiz_UP_Super_TET_Test_Pack_2.pdf',
  },
  supertet_all: {
    exam: 'super_tet', kind: 'bundle', includes: ['supertet', 'supertet2'], note: 'supertet_all', price: paise('SUPERTET_ALL_PRICE_PAISE', 14900), live: flag('SUPERTET_ALL_LIVE'),
    title: 'All tests — Packs 1 + 2 (Tests 1–10)', name: 'UP Super TET Complete Pack (Tests 1–10)',
    desc: 'Both packs together at a lower price',
  },
};
const PRICE_PAISE = PRODUCTS.chsl.price;   // kept for older code
function getProduct(key) { return Object.prototype.hasOwnProperty.call(PRODUCTS, key) ? PRODUCTS[key] : null; }
function isLive(p) { return !!p && p.live() && (p.kind !== 'bundle' || p.includes.every((k) => isLive(PRODUCTS[k]))); }

// What the site may show: only things that are live, grouped by exam. 'all' lets the thank-you page expand a bundle.
function publicCatalog() {
  const view = (key, p) => ({ key, kind: p.kind, note: p.note, exam: p.exam, title: p.title, name: p.name, desc: p.desc, price: p.price, includes: p.includes || null });
  const exams = {}, all = {};
  Object.keys(PRODUCTS).forEach((k) => { all[k] = view(k, PRODUCTS[k]); });
  ['bundle', 'pack'].forEach((kind) => Object.keys(PRODUCTS).forEach((k) => {
    const p = PRODUCTS[k];
    if (p.kind === kind && isLive(p)) (exams[p.exam] = exams[p.exam] || []).push(view(k, p));
  }));
  return { exams, all };
}

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
// Asks Razorpay whether this payment is a genuine, full-price purchase that entitles the buyer to the given pack:
// either the pack itself or a bundle that includes it. Returns { state: 'ok' | 'pending' | 'invalid', ... }.
async function checkPurchase(orderId, paymentId, productKey = 'chsl') {
  const target = getProduct(productKey);
  if (!target) return { state: 'invalid' };
  const accepted = Object.keys(PRODUCTS).map((k) => PRODUCTS[k]).filter((p) => p === target || (p.kind === 'bundle' && p.includes.includes(productKey)));
  const [payment, order] = await Promise.all([razorpay('/payments/' + paymentId), razorpay('/orders/' + orderId)]);
  const note = order && order.notes && order.notes.product;
  const hit = accepted.find((p) => p.note === note);
  if (payment.order_id !== orderId || !hit || !(payment.amount >= hit.price)) return { state: 'invalid', payment, order };
  if (payment.status !== 'captured') return { state: 'pending', payment, order };
  return { state: 'ok', payment, order, matched: hit };
}
// Works out WHICH product an order was for (used when a buyer recovers their purchases).
async function classifyPurchase(orderId, paymentId) {
  const [payment, order] = await Promise.all([razorpay('/payments/' + paymentId), razorpay('/orders/' + orderId)]);
  const note = order && order.notes && order.notes.product;
  const key = Object.keys(PRODUCTS).find((k) => PRODUCTS[k].note === note);
  if (payment.order_id !== orderId || !key || !(payment.amount >= PRODUCTS[key].price)) return { state: 'invalid' };
  return { state: payment.status === 'captured' ? 'ok' : 'pending', key, product: PRODUCTS[key], payment, order };
}

// ---- TEST MODE: set PACK_TEST_MODE=on in Vercel to download without paying (for testing only).
// Remove the variable (or set it to off) before launch. The test link only works while the flag is on.
const TEST_ORDER = 'order_TESTMODE', TEST_PAYMENT = 'pay_TESTMODE';
function testModeOn() { return process.env.PACK_TEST_MODE === 'on'; }
function testSignature() { return crypto.createHmac('sha256', process.env.PACK_KEY || 'x').update('test|' + TEST_ORDER + '|' + TEST_PAYMENT).digest('hex'); }
function isTestPurchase(orderId, paymentId, signature) { return testModeOn() && orderId === TEST_ORDER && paymentId === TEST_PAYMENT && safeEqual(testSignature(), signature); }

function configured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
module.exports = { PRODUCTS, getProduct, isLive, publicCatalog, PRICE_PAISE, FORMAT, signatureFor, safeEqual, razorpay, checkPurchase, classifyPurchase, configured, testModeOn, testSignature, isTestPurchase, TEST_ORDER, TEST_PAYMENT };
