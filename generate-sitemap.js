// generate-sitemap.js
// Run this before each deploy (or wire into package.json "build" script)
// so sitemap.xml always matches whatever exams exist in meta.json.
//
// Usage: node generate-sitemap.js
// Assumes meta.json and this script sit in the same folder, and writes
// sitemap.xml next to them.

const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://www.readymadequiz.co.in';
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));

const slug = s => String(s).replace(/_/g, '-');

const urls = [`  <url><loc>${DOMAIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`];

for (const [catKey, cat] of Object.entries(meta)) {
  for (const [examKey] of Object.entries(cat.exams)) {
    const loc = `${DOMAIN}/${slug(catKey)}/${slug(examKey)}`;
    urls.push(`  <url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml);
console.log(`sitemap.xml written with ${urls.length} URLs.`);
