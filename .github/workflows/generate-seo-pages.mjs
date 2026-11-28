// generate-seo-pages.mjs  (v3)
//
// HOW TO USE (from the repo root, where index.html and meta.json are):
//     node generate-seo-pages.mjs
// It creates ./seo-pages. Copy EVERYTHING inside seo-pages/ into the repo root
// (replace existing files), then commit and push.
//
// WHAT'S NEW IN v3 (aimed at AdSense "low-value content"):
//   * Test pages: subject-wise table + sample questions WITH correct answer and
//     explanation (one per subject first), related-test links. Real text, no JS needed.
//   * Test pages with fewer than MIN_SAMPLES usable sample questions are set to
//     noindex and left out of sitemap.xml, so Google only sees your strong pages.
//   * Exam pages: data-driven facts, typical subject-wise split, FAQ, plus an optional
//     hand-written guide from exam-guides.json (see GUIDE FILE below).
//   * Homepage: short real introduction + live stats above the exam links.
//   * Diagnostics: prints which answer/explanation fields it found, so wrong or
//     missing answers are never published silently.
//
// GUIDE FILE (optional but strongly recommended): exam-guides.json, keyed by exam key
//   { "upsssc_pet": {
//       "intro": "2-3 paragraphs, separated by blank lines",
//       "pattern": ["100 questions, 100 marks", "..."],
//       "eligibility": ["..."], "syllabus": ["..."], "tips": ["..."],
//       "faqs": [{"q": "...", "a": "..."}] } }
//   Write only facts you have verified from the official notification.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://www.readymadequiz.co.in';
const BRAND = 'ReadyMadeQuiz';
const YEAR = new Date().getFullYear();
const SAMPLE_QUESTIONS = 6;      // sample questions per test page
const MIN_SAMPLES = 3;           // fewer usable samples than this -> noindex + not in sitemap
const EXTRA_URLS = ['/upsssc-pet/', '/ssc-chsl/', '/super-tet/', '/current-affairs',
                    '/about/', '/contact/', '/privacy-policy/', '/disclaimer/', '/terms/'];
const outRoot = join(__dirname, 'seo-pages');

const meta = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));
const rawTemplate = readFileSync(join(__dirname, 'index.html'), 'utf8');
const guides = existsSync(join(__dirname, 'exam-guides.json'))
  ? JSON.parse(readFileSync(join(__dirname, 'exam-guides.json'), 'utf8')) : {};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (k) => k.replace(/_/g, '-');
const paras = (s) => String(s || '').split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p.trim())}</p>`).join('');

// ---------- template ----------
function prepareTemplate(t) {
  let h = t;
  h = h.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '');
  h = h.replace(/<meta\s+property=["']og:(?:title|description|url|type)["'][^>]*>\s*/gi, '');
  h = h.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '');
  h = h.replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, '');
  h = h.replace(/\n<nav id="seoNav"[\s\S]*?<\/nav>/g, '');
  h = h.replace(/\n<div id="seoHome"[\s\S]*?<\/div><!--\/seoHome-->/g, '');
  h = h.replace(/<meta\s+name=["']viewport["'][^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>');   // allow zoom
  if (!/<title>[\s\S]*?<\/title>/.test(h)) throw new Error('index.html has no <title>');
  if (!/<div id="app">\s*<\/div>/.test(h)) throw new Error('index.html has no empty <div id="app"></div>');
  return h;
}
const template = prepareTemplate(rawTemplate);

// ---------- answers / explanations ----------
const ANS_FIELDS = ['ans', 'answer', 'correct', 'correctAnswer', 'a'];
function detectBase(qs) {                       // numeric answers: 0-based if any answer is 0, else 1-based
  const nums = qs.map((q) => ANS_FIELDS.map((f) => q[f]).find((v) => v !== undefined && v !== null && v !== ''))
                 .filter((v) => typeof v === 'number');
  return nums.length && !nums.includes(0) ? 1 : 0;
}
function answerIndex(q, base) {
  const raw = ANS_FIELDS.map((f) => q[f]).find((v) => v !== undefined && v !== null && v !== '');
  const opts = q.opts || [];
  if (raw === undefined) return -1;
  let i = -1;
  if (typeof raw === 'number') i = raw - base;
  else {
    const s = String(raw).trim();
    if (/^[A-Da-d]$/.test(s)) i = s.toUpperCase().charCodeAt(0) - 65;
    else if (/^[1-4]$/.test(s)) i = Number(s) - 1;
    else i = opts.findIndex((o) => String(o).trim() === s);
  }
  return i >= 0 && i < opts.length ? i : -1;
}
const LEAK = /\b(wait|hmm|let me|let's re|actually,|re-?check|recalculat|oops|correction:)\b/i;
function cleanExp(q) {                          // drop empty, very long or "AI thinking out loud" explanations
  const e = String(q.exp ?? q.exp_en ?? q.explanation ?? '').trim();
  return !e || e.length > 500 || LEAK.test(e) ? '' : e;
}

// ---------- load data ----------
const exams = [];
const warnings = [];
for (const [catKey, cat] of Object.entries(meta)) {
  for (const [examKey, exam] of Object.entries(cat.exams || {})) {
    const file = join(__dirname, `${examKey}.json`);
    const jsonTests = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).tests || []) : [];
    const metaTests = exam.tests || [];
    const x = { catKey, examKey, exam, jsonTests,
      catName: cat.name || cat.title || catKey, catSlug: slugify(catKey), examSlug: slugify(examKey),
      testCount: Math.max(jsonTests.length, metaTests.length) };
    // diagnostics on the first test that has questions
    const first = jsonTests.find((t) => (t.questions || []).length);
    if (first) {
      const q0 = first.questions[0];
      const af = ANS_FIELDS.find((f) => q0[f] !== undefined);
      if (!af) warnings.push(`${examKey}: no answer field (${ANS_FIELDS.join('/')}) found. Keys: ${Object.keys(q0).join(', ')}`);
      else console.log(`${examKey}: answer field "${af}" (${typeof q0[af]}), base ${detectBase(first.questions)}`);
    }
    exams.push(x);
  }
}
const examByKey = Object.fromEntries(exams.map((x) => [x.examKey, x]));

// ---------- shared HTML ----------
const examPath = (x) => `/${x.catSlug}/${x.examSlug}`;
const testPath = (x, n) => `/${x.catSlug}/${x.examSlug}-mock-test-${n}`;

const navHtml = `<nav id="seoNav" aria-label="Exams" style="max-width:640px;margin:24px auto;padding:0 20px;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.9;color:#334155;">
<h2 style="font-size:16px;margin:0 0 8px;">Free mock tests by exam</h2>
${[...new Set(exams.map((x) => x.catKey))].map((ck) => {
  const list = exams.filter((x) => x.catKey === ck);
  return `<p style="margin:0 0 6px;"><strong>${esc(list[0].catName)}:</strong> ${
    list.map((x) => `<a href="${examPath(x)}">${esc(x.exam.name)}</a>`).join(' · ')}</p>`;
}).join('\n')}
</nav>`;

const wrap = (inner) => `<div id="seoSnapshot" style="max-width:640px;margin:32px auto;padding:0 20px;font-family:'DM Sans',sans-serif;color:#0f172a;line-height:1.6;">${inner}</div>`;
const H2 = 'style="font-size:18px;margin:20px 0 8px;"';

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const crumbsLd = (items) => ld({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + url })),
});

function render({ title, description, path, body, crumbs, noindex = false }) {
  const canonical = SITE + path;
  const extras = `<link rel="canonical" href="${canonical}"/>
<meta name="description" content="${esc(description)}"/>
${noindex ? '<meta name="robots" content="noindex,follow"/>\n' : ''}<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:type" content="website"/>
${crumbsLd(crumbs)}
</head>`;
  return template
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace('</head>', () => extras)
    .replace(/<div id="app">\s*<\/div>/, () => `<div id="app">${wrap(body)}</div>\n${navHtml}`);
}

function write(path, html) {
  const dir = join(outRoot, ...path.split('/').filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
}

// ---------- test facts ----------
function testInfo(x, n) {
  const t = x.jsonTests[n - 1], mt = (x.exam.tests || [])[n - 1];
  const src = t || mt;
  if (!src) return null;
  const q = t ? (t.questions?.length || mt?.questionCount) : mt.questionCount;
  const cm = src.correctMarks ?? mt?.correctMarks;
  return { title: src.title, q, duration: src.duration ?? mt?.duration, diff: src.difficulty ?? mt?.difficulty,
           neg: src.negativeMarks ?? mt?.negativeMarks, marks: q && cm ? q * cm : 0, full: t };
}

function subjectCounts(qs) {
  const c = {};
  for (const q of qs || []) c[q.subject || 'General'] = (c[q.subject || 'General'] || 0) + 1;
  return c;
}

function pickSamples(t) {                       // one question per subject first, only with a resolved answer
  const qs = t.questions || [];
  const base = detectBase(qs);
  const good = qs
    .filter((q) => q.q && !q.img && (q.opts || []).length >= 2 && !(q.opts || []).some((o) => /^figure/i.test(o)))
    .map((q) => ({ q, ai: answerIndex(q, base) }))
    .filter((x) => x.ai >= 0);
  const groups = {};
  for (const g of good) (groups[g.q.subject || 'General'] ||= []).push(g);
  const lists = Object.values(groups), out = [];
  for (let r = 0; out.length < SAMPLE_QUESTIONS && lists.some((l) => l[r]); r++)
    for (const l of lists) if (l[r] && out.length < SAMPLE_QUESTIONS) out.push(l[r]);
  return out;
}

function sampleHtml(samples) {
  return samples.map(({ q, ai }) => {
    const exp = cleanExp(q);
    return `<li style="margin-bottom:14px;"><p style="margin:0 0 4px;"><strong>${esc(q.q)}</strong></p>
${q.q_hi ? `<p lang="hi" style="margin:0 0 4px;">${esc(q.q_hi)}</p>` : ''}
<ol type="A" style="margin:0 0 4px 18px;">${q.opts.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
<p style="margin:0;font-size:14px;"><strong>Answer:</strong> ${'ABCDEFGH'[ai]}. ${esc(q.opts[ai])}${exp ? `<br><strong>Explanation:</strong> ${esc(exp)}` : ''}</p></li>`;
  }).join('\n');
}

// ---------- page bodies ----------
function faqHtml(items) {
  return items.length ? `<h2 ${H2}>Frequently asked questions</h2>${items.map((f) =>
    `<h3 style="font-size:15px;margin:12px 0 2px;">${esc(f.q)}</h3><p style="margin:0;">${esc(f.a)}</p>`).join('')}` : '';
}
const list = (arr) => `<ul>${arr.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;

function examBody(x) {
  const { exam, testCount, jsonTests } = x;
  const g = guides[x.examKey] || {};
  const infos = Array.from({ length: testCount }, (_, i) => testInfo(x, i + 1));
  const qCounts = infos.map((i) => i?.q).filter(Boolean);
  const durs = [...new Set(infos.map((i) => i?.duration).filter(Boolean))];
  const negs = [...new Set(infos.map((i) => i?.neg).filter((v) => v !== undefined && v !== null))];
  const totalQ = qCounts.reduce((a, b) => a + b, 0);

  const items = infos.map((info, i) => {
    const extra = info ? ` <span style="color:#64748b;">(${info.q ?? ''} questions, ${info.duration ?? ''} min${info.diff ? ', ' + esc(info.diff) : ''})</span>` : '';
    return `<li><a href="${testPath(x, i + 1)}">${esc(exam.name)} Mock Test ${i + 1}</a>${extra}</li>`;
  }).join('\n');

  // typical subject split, averaged over tests that have full data
  const agg = {}; let withData = 0;
  for (const t of jsonTests) if ((t.questions || []).length) {
    withData++; for (const [s, c] of Object.entries(subjectCounts(t.questions))) agg[s] = (agg[s] || 0) + c;
  }
  const split = withData ? `<h2 ${H2}>Typical subject-wise questions in a ${esc(exam.name)} mock test</h2>
<table style="font-size:14px;margin-bottom:8px;">${Object.entries(agg).map(([s, c]) =>
  `<tr><td style="padding:3px 16px 3px 0;">${esc(s)}</td><td>about ${Math.round(c / withData)} questions</td></tr>`).join('')}</table>` : '';

  const faqs = [
    { q: `Are the ${exam.name} mock tests free?`, a: `Yes. All ${testCount} ${exam.name} mock tests on ${BRAND} are free to attempt in your browser, in Hindi or English, with instant results and a review of every question.` },
    qCounts.length && { q: `How many questions are in each ${exam.name} mock test?`,
      a: Math.min(...qCounts) === Math.max(...qCounts) ? `Each test has ${qCounts[0]} questions.` : `Sets have between ${Math.min(...qCounts)} and ${Math.max(...qCounts)} questions; the exact number is shown next to each test above.` },
    durs.length && { q: `How much time do I get?`, a: durs.length === 1 ? `Each test is timed at ${durs[0]} minutes.` : `Tests are timed between ${Math.min(...durs)} and ${Math.max(...durs)} minutes; the time is shown next to each test.` },
    negs.length === 1 && negs[0] > 0 && { q: `Is there negative marking?`, a: `Yes, ${negs[0]} mark is deducted for each wrong answer in these tests.` },
    ...(g.faqs || []),
  ].filter(Boolean);

  return `<p style="font-size:13px;"><a href="/">${BRAND}</a> › ${esc(x.catName)} › ${esc(exam.name)}</p>
<h1 style="font-size:24px;margin-bottom:8px;">${esc(exam.name)} Free Mock Tests</h1>
${g.intro ? paras(g.intro) : ''}
<p>Practice ${esc(exam.fullname || exam.name)} (${esc(exam.name)}) with ${testCount} free, timed mock test${testCount === 1 ? '' : 's'}${totalQ ? ` containing ${totalQ.toLocaleString('en-IN')} questions in total` : ''}.
Every attempt gives instant results and a detailed review. Questions are available in Hindi and English.</p>
${g.pattern ? `<h2 ${H2}>${esc(exam.name)} exam pattern</h2>${list(g.pattern)}` : ''}
${g.eligibility ? `<h2 ${H2}>Eligibility</h2>${list(g.eligibility)}` : ''}
${g.syllabus ? `<h2 ${H2}>Syllabus</h2>${list(g.syllabus)}` : ''}
${split}
<h2 ${H2}>${esc(exam.name)} mock test series</h2>
<ul>${items}</ul>
${g.tips ? `<h2 ${H2}>Preparation tips</h2>${list(g.tips)}` : ''}
${faqHtml(faqs)}`;
}

function testBody(x, n, samples) {
  const { exam } = x;
  const info = testInfo(x, n);
  const prev = n > 1 ? `<a href="${testPath(x, n - 1)}">← Mock Test ${n - 1}</a>` : '';
  const next = n < x.testCount ? `<a href="${testPath(x, n + 1)}">Mock Test ${n + 1} →</a>` : '';
  let facts = '', split = '';
  if (info) {
    const bits = [`${info.q || ''} questions`, info.marks ? `${info.marks} marks` : '', info.duration ? `${info.duration} minutes` : '',
      info.diff ? `${esc(info.diff)} level` : '', info.neg ? `${info.neg} negative marking per wrong answer` : ''].filter(Boolean);
    facts = `<p>${esc(info.title || `${exam.name} Mock Test ${n}`)}: ${bits.join(' · ')}.</p>`;
    if (info.full) {
      const rows = Object.entries(subjectCounts(info.full.questions)).map(([s, c]) =>
        `<tr><td style="padding:3px 16px 3px 0;">${esc(s)}</td><td>${c} questions</td></tr>`).join('');
      if (rows) split = `<h2 ${H2}>What this test covers</h2><table style="font-size:14px;margin-bottom:8px;">${rows}</table>`;
    }
  }
  const others = [];                             // a few neighbouring tests, for internal linking
  for (let k = Math.max(1, n - 2); k <= Math.min(x.testCount, n + 2); k++) if (k !== n) others.push(k);
  return `<p style="font-size:13px;"><a href="/">${BRAND}</a> › <a href="${examPath(x)}">${esc(exam.name)}</a> › Mock Test ${n}</p>
<h1 style="font-size:24px;margin-bottom:8px;">${esc(exam.name)} Mock Test ${n} – Free Online Test</h1>
${facts}
<p>Take this ${esc(exam.name)} mock test free in Hindi or English. Attempt it under timed conditions, then use the review to see the correct answer and explanation for every question you missed.</p>
${split}
${samples.length ? `<h2 ${H2}>Sample questions from this test (with answers)</h2><ol>${sampleHtml(samples)}</ol>` : ''}
<p>${prev} ${prev && next ? '·' : ''} ${next}</p>
<p>More ${esc(exam.name)} practice: ${others.map((k) => `<a href="${testPath(x, k)}">Mock Test ${k}</a>`).join(' · ')}${others.length ? ' · ' : ''}<a href="${examPath(x)}">All ${esc(exam.name)} mock tests</a></p>`;
}

// ---------- generate ----------
const sitemapUrls = ['/'];
let pages = 0, noindexed = 0, totalTests = 0, totalQuestions = 0;

for (const x of exams) {
  const { exam } = x;
  const path = examPath(x);
  write(path, render({
    title: `${exam.name} Free Mock Test ${YEAR} (Hindi & English) | ${BRAND}`,
    description: `Practice free ${exam.fullname || exam.name} (${exam.name}) mock tests: ${x.testCount} timed, exam-pattern sets with instant results, in Hindi and English.`,
    path, body: examBody(x), crumbs: [['Home', '/'], [exam.name, path]],
  }));
  sitemapUrls.push(path); pages++;

  for (let n = 1; n <= x.testCount; n++) {
    const info = testInfo(x, n);
    totalTests++; totalQuestions += info?.q || 0;
    const samples = info?.full ? pickSamples(info.full) : [];
    const noindex = samples.length < MIN_SAMPLES;
    const p = testPath(x, n);
    write(p, render({
      title: `${exam.name} Mock Test ${n} (Hindi & English) – Free | ${BRAND}`,
      description: `Free ${exam.name} mock test ${n}: ${info?.q ? info.q + '-question, ' : ''}timed practice test in Hindi and English with instant result, answers and explanations.`,
      path: p, body: testBody(x, n, samples),
      crumbs: [['Home', '/'], [exam.name, path], [`Mock Test ${n}`, p]], noindex,
    }));
    if (noindex) noindexed++; else sitemapUrls.push(p);
    pages++;
  }
  console.log(`${path}  +${x.testCount} test pages`);
}

// sitemap
const all = [...new Set([...sitemapUrls, ...EXTRA_URLS])];
writeFileSync(join(outRoot, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    all.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`, 'utf8');

// homepage: original + zoom-friendly viewport + real intro + crawlable exam links
const popular = ['upsssc_pet', 'ssc_chsl', 'super_tet'].map((k) => examByKey[k]).filter(Boolean);
const homeIntro = `<div id="seoHome" style="max-width:640px;margin:24px auto;padding:0 20px;font-family:'DM Sans',sans-serif;color:#0f172a;line-height:1.6;">
<h2 style="font-size:18px;margin:0 0 8px;">About ${BRAND}</h2>
<p>${BRAND} is a free practice platform for Indian competitive exam aspirants. It offers ${totalTests} full-length mock tests across ${exams.length} exams${totalQuestions ? ` with ${totalQuestions.toLocaleString('en-IN')} questions` : ''}, in Hindi and English.</p>
<p>Each test is timed in the exam pattern. After you submit you get your score, the correct answer for every question and a review you can use to find weak topics.</p>
${popular.length ? `<p>Popular right now: ${popular.map((x) => `<a href="${examPath(x)}">${esc(x.exam.name)} mock tests</a>`).join(' · ')}.</p>` : ''}
</div><!--/seoHome-->`;
const home = rawTemplate
  .replace(/\n<nav id="seoNav"[\s\S]*?<\/nav>/g, '')
  .replace(/\n<div id="seoHome"[\s\S]*?<\/div><!--\/seoHome-->/g, '')
  .replace(/<meta\s+name=["']viewport["'][^>]*>/i, () => '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>')
  .replace(/<div id="app">\s*<\/div>/, (m) => `${m}\n${homeIntro}\n${navHtml}`);
writeFileSync(join(outRoot, 'index.html'), home, 'utf8');

console.log(`\nDone: ${pages} pages (${noindexed} test pages set to noindex, ${all.length} URLs in sitemap.xml)`);
if (warnings.length) console.log('\nWARNINGS:\n - ' + warnings.join('\n - '));
console.log('NEXT: copy everything inside seo-pages/ into the repo root, commit and push.');
