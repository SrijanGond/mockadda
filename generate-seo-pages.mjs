// generate-seo-pages.mjs
//
// WHY THIS EXISTS:
// MockAdda is a single index.html SPA. Every URL (e.g. /ssc/ssc-cgl) is served
// the exact same file by vercel.json's catch-all rewrite, and the real page
// title/description only get set by JavaScript AFTER the page loads. That
// means the very first HTML Google (and anything else that doesn't run JS)
// sees is identical for every single exam page — which is why Google mostly
// only indexes the homepage.
//
// This script generates one small, real HTML file per exam (e.g.
// /ssc/ssc-cgl/index.html) that is a copy of the main app, but with a unique
// <title>, <meta description>, canonical link, and a short visible summary
// baked directly into the HTML. The JavaScript app inside is untouched, so
// once it loads it works exactly as it does today — this only fixes what
// crawlers and link-previews see before JS runs.
//
// HOW TO RUN (from the repo root):
//   node generate-seo-pages.mjs
//
// It creates a "seo-pages" folder. Copy/drag its contents into the repo
// root (so e.g. seo-pages/ssc/ssc-cgl/index.html becomes ssc/ssc-cgl/index.html
// at the repo root), commit, and push. Vercel will pick it up automatically.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const template = readFileSync(join(__dirname, 'index.html'), 'utf8');
const meta = JSON.parse(readFileSync(join(__dirname, 'meta.json'), 'utf8'));

const SITE = 'https://www.readymadequiz.co.in';
const outRoot = join(__dirname, 'seo-pages');

function slugify(key) {
  return key.replace(/_/g, '-');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let count = 0;

for (const [catKey, cat] of Object.entries(meta)) {
  for (const [examKey, exam] of Object.entries(cat.exams)) {
    const catSlug = slugify(catKey);
    const examSlug = slugify(examKey);
    const urlPath = `/${catSlug}/${examSlug}`;
    const canonical = `${SITE}${urlPath}`;

    const title = `${exam.name} Free Mock Test | MockAdda`;
    const description = `Practice free ${exam.fullname} (${exam.name}) mock tests on MockAdda. Timed, exam-pattern questions with instant results.`;

    const testCount = (exam.tests || []).length;
    const seoSnapshot = `<div id="seoSnapshot" style="max-width:640px;margin:32px auto;padding:0 20px;font-family:'DM Sans',sans-serif;color:#0f172a;">
  <h1 style="font-size:24px;margin-bottom:8px;">${escapeHtml(exam.name)} Free Mock Test</h1>
  <p style="font-size:15px;line-height:1.6;color:#334155;">
    Practice ${escapeHtml(exam.fullname)} (${escapeHtml(exam.name)}) with ${testCount} free,
    timed, exam-pattern mock test${testCount === 1 ? '' : 's'} on MockAdda. Get instant results
    and detailed review after every attempt. Available in Hindi and English.
  </p>
</div>`;

    let html = template;

    // 1) Unique <title>
    html = html.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(title)}</title>`
    );

    // 2) Unique meta description
    html = html.replace(
      /<meta name="description" content=".*?"\/>/,
      `<meta name="description" content="${escapeHtml(description)}"/>`
    );

    // 3) Canonical link + Open Graph tags, inserted right before </head>
    const headExtras = `<link rel="canonical" href="${canonical}"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:type" content="website"/>
</head>`;
    html = html.replace('</head>', headExtras);

    // 4) Visible summary baked into the initial HTML (inside #app so it
    //    shows immediately, then gets replaced once the app's own JS renders)
    html = html.replace(
      '<div id="app"></div>',
      `<div id="app">${seoSnapshot}</div>`
    );

    const outDir = join(outRoot, catSlug, examSlug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), html, 'utf8');
    count++;
    console.log(`Generated ${urlPath}/index.html`);
  }
}

console.log(`\nDone. Generated ${count} SEO landing pages inside ./seo-pages`);
console.log('Copy the contents of seo-pages/ into your repo root, commit, and push.');
