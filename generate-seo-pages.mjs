// generate-seo-pages.mjs  (v2)
//
// HOW TO USE (from the repo root, where index.html and meta.json are):
//     node generate-seo-pages.mjs
// It creates a ./seo-pages folder. Copy EVERYTHING inside seo-pages/ into the repo
// root (replace existing files when asked), then commit and push. Nothing else to edit.
//
// WHY: the site is one index.html app, so crawlers otherwise see the same empty
// homepage HTML for every URL. This script writes:
//   1. One real HTML page per EXAM      e.g. /ssc/ssc-chsl
//   2. One real HTML page per MOCK TEST e.g. /ssc/ssc-chsl-mock-test-3
//      Each has a unique title/description, exactly ONE canonical, one set of og: tags,
//      a zoom-friendly viewport, real text and plain <a href> links. Test pages also
//      include sample questions read from <examKey>.json.
//   3. sitemap.xml  - rebuilt from meta.json (all exams + all tests)
//   4. index.html   - your homepage, unchanged except: zoom-friendly viewport and a
//                     crawlable list of links to every exam added after <div id="app">.
// Safe to re-run any time (it strips what it added before). Re-run after adding tests.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://www.readymadequiz.co.in';
const BRAND = 'ReadyMadeQuiz';
const YEAR = new Date().getFullYear();
const SAMPLE_QUESTIONS = 5;                     // sample questions shown on each test page
const EXTRA_URLS = ['/upsssc-pet/', '/current-affairs']; // other real pages to keep in the sitemap
const outRoot = join(__dirname, 'seo-pages');

const meta = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));
const rawTemplate = readFileSync(join(__dirname, 'index.html'), 'utf8');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (k) => k.replace(/_/g, '-');

// ---------- template: remove anything we (or the original file) put in <head> ----------
function prepareTemplate(t) {
  let h = t;
  h = h.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '');                    // old canonical
  h = h.replace(/<meta\s+property=["']og:(?:title|description|url|type)["'][^>]*>\s*/gi, '');
  h = h.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '');
  h = h.replace(/\n<nav id="seoNav"[\s\S]*?<\/nav>/g, '');                          // earlier nav
  h = h.replace(/<meta\s+name=["']viewport["'][^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>');      // allow zoom
  if (!/<title>[\s\S]*?<\/title>/.test(h)) throw new Error('index.html has no <title>');
  if (!/<div id="app">\s*<\/div>/.test(h)) throw new Error('index.html has no empty <div id="app"></div>');
  return h;
}
const template = prepareTemplate(rawTemplate);

// ---------- load data ----------
const exams = [];   // flat list
for (const [catKey, cat] of Object.entries(meta)) {
  for (const [examKey, exam] of Object.entries(cat.exams || {})) {
    const file = join(__dirname, `${examKey}.json`);
    const jsonTests = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).tests || []) : [];
    const metaTests = exam.tests || [];
    exams.push({
      catKey, examKey, exam,
      catName: cat.name || cat.title || catKey,
      catSlug: slugify(catKey), examSlug: slugify(examKey),
      jsonTests,
      testCount: Math.max(jsonTests.length, metaTests.length),
    });
  }
}

// ---------- shared HTML bits ----------
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

const crumbsLd = (items) => `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + url })),
})}</script>`;

function render({ title, description, path, body, crumbs }) {
  const canonical = SITE + path;
  const extras = `<link rel="canonical" href="${canonical}"/>
<meta name="description" content="${esc(description)}"/>
<meta property="og:title" content="${esc(title)}"/>
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

// ---------- page bodies ----------
// Facts about test n: prefer the full JSON file, fall back to meta.json
function testInfo(x, n) {
  const t = x.jsonTests[n - 1], mt = (x.exam.tests || [])[n - 1];
  const src = t || mt;
  if (!src) return null;
  const q = t ? (t.questions?.length ?? mt?.questionCount) : mt.questionCount;
  const cm = src.correctMarks ?? mt?.correctMarks;
  return { title: src.title, q, duration: src.duration ?? mt?.duration, diff: src.difficulty ?? mt?.difficulty,
           neg: src.negativeMarks ?? mt?.negativeMarks, marks: q && cm ? q * cm : 0, full: t };
}

function examBody(x) {
  const { exam, testCount } = x;
  const list = Array.from({ length: testCount }, (_, i) => {
    const info = testInfo(x, i + 1);
    const extra = info ? ` <span style="color:#64748b;">(${info.q ?? ''} questions, ${info.duration ?? ''} min${info.diff ? ', ' + esc(info.diff) : ''})</span>` : '';
    return `<li><a href="${testPath(x, i + 1)}">${esc(exam.name)} Mock Test ${i + 1}</a>${extra}</li>`;
  }).join('\n');
  return `<p style="font-size:13px;"><a href="/">${BRAND}</a> › ${esc(x.catName)} › ${esc(exam.name)}</p>
<h1 style="font-size:24px;margin-bottom:8px;">${esc(exam.name)} Free Mock Tests</h1>
<p>Practice ${esc(exam.fullname || exam.name)} (${esc(exam.name)}) with ${testCount} free, timed, exam-pattern mock test${testCount === 1 ? '' : 's'}.
Every attempt gives instant results and a detailed review. Questions are available in Hindi and English.</p>
<h2 style="font-size:18px;">${esc(exam.name)} mock test series</h2>
<ul>${list}</ul>`;
}

function sectionTable(t) {
  const counts = {};
  for (const q of t.questions || []) counts[q.subject || 'General'] = (counts[q.subject || 'General'] || 0) + 1;
  return Object.entries(counts).map(([s, c]) => `<tr><td style="padding:4px 12px 4px 0;">${esc(s)}</td><td>${c} questions</td></tr>`).join('');
}

function sampleQs(t) {
  const qs = (t.questions || [])
    .filter((q) => !q.img && !(q.opts || []).some((o) => /^figure/i.test(o)))   // skip figure/image questions
    .slice(0, SAMPLE_QUESTIONS);
  return qs.map((q, i) => `<li style="margin-bottom:12px;"><p style="margin:0 0 4px;"><strong>${esc(q.q)}</strong></p>
${q.q_hi ? `<p lang="hi" style="margin:0 0 4px;">${esc(q.q_hi)}</p>` : ''}
<ol type="A" style="margin:0 0 0 18px;">${(q.opts || []).map((o) => `<li>${esc(o)}</li>`).join('')}</ol></li>`).join('\n');
}

function testBody(x, n) {
  const { exam } = x;
  const info = testInfo(x, n);
  const prev = n > 1 ? `<a href="${testPath(x, n - 1)}">← Mock Test ${n - 1}</a>` : '';
  const next = n < x.testCount ? `<a href="${testPath(x, n + 1)}">Mock Test ${n + 1} →</a>` : '';
  let facts = '', samples = '';
  if (info) {
    const bits = [`${info.q || ''} questions`, info.marks ? `${info.marks} marks` : '', info.duration ? `${info.duration} minutes` : '',
      info.diff ? `${esc(info.diff)} level` : '', info.neg ? `${info.neg} negative marking per wrong answer` : ''].filter(Boolean);
    facts = `<p>${esc(info.title || `${exam.name} Mock Test ${n}`)}: ${bits.join(' · ')}.</p>`;
    if (info.full) {
      facts += `\n<table style="font-size:14px;margin-bottom:12px;">${sectionTable(info.full)}</table>`;
      samples = `<h2 style="font-size:18px;">Sample questions from this test</h2><ol>${sampleQs(info.full)}</ol>`;
    }
  }
  return `<p style="font-size:13px;"><a href="/">${BRAND}</a> › <a href="${examPath(x)}">${esc(exam.name)}</a> › Mock Test ${n}</p>
<h1 style="font-size:24px;margin-bottom:8px;">${esc(exam.name)} Mock Test ${n} – Free Online Test</h1>
${facts}
<p>Take this ${esc(exam.name)} mock test free in Hindi or English and get instant results with a detailed review.</p>
${samples}
<p>${prev} ${prev && next ? '·' : ''} ${next}</p>
<p><a href="${examPath(x)}">All ${esc(exam.name)} mock tests</a></p>`;
}

// ---------- generate ----------
const sitemapUrls = ['/'];
let pages = 0;

for (const x of exams) {
  const { exam } = x;
  const path = examPath(x);
  write(path, render({
    title: `${exam.name} Free Mock Test ${YEAR} (Hindi & English) | ${BRAND}`,
    description: `Practice free ${exam.fullname || exam.name} (${exam.name}) mock tests: ${x.testCount} timed, exam-pattern sets with instant results, in Hindi and English.`,
    path, body: examBody(x),
    crumbs: [['Home', '/'], [exam.name, path]],
  }));
  sitemapUrls.push(path); pages++;

  for (let n = 1; n <= x.testCount; n++) {
    const p = testPath(x, n);
    write(p, render({
      title: `${exam.name} Mock Test ${n} (Hindi & English) – Free | ${BRAND}`,
      description: `Free ${exam.name} mock test ${n}: full-length, timed practice test in Hindi and English with instant result and review.`,
      path: p, body: testBody(x, n),
      crumbs: [['Home', '/'], [exam.name, path], [`Mock Test ${n}`, p]],
    }));
    sitemapUrls.push(p); pages++;
  }
  console.log(`${path}  +${x.testCount} test pages`);
}

// sitemap (no changefreq/priority: Google ignores them; no fake lastmod)
const all = [...new Set([...sitemapUrls, ...EXTRA_URLS])];
writeFileSync(join(outRoot, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    all.map((u) => `  <url><loc>${SITE}${u === '/' ? '/' : u}</loc></url>`).join('\n')}\n</urlset>\n`, 'utf8');
// homepage: original index.html + zoom-friendly viewport + crawlable exam links
const home = rawTemplate
  .replace(/\n<nav id="seoNav"[\s\S]*?<\/nav>/g, '')
  .replace(/<meta\s+name=["']viewport["'][^>]*>/i, () => '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>')
  .replace(/<div id="app">\s*<\/div>/, (m) => `${m}\n${navHtml}`);
writeFileSync(join(outRoot, 'index.html'), home, 'utf8');

console.log(`\nDone: ${pages} pages + sitemap.xml + index.html in ./seo-pages`);
console.log('NEXT: copy everything inside seo-pages/ into the repo root, commit and push.');
