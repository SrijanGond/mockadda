# Routing patch for index.html

Goal: give every exam a real, distinct, bookmarkable/crawlable URL like
`/ssc/ssc-cgl` or `/banking/sbi-po`, instead of everything living at `/`.

This does NOT require React Router or a framework — just the native
History API, which vanilla JS already supports.

---

## Step 1 — Add a slug map + URL helpers

Add this near the top of your `<script>` block, right after the `DATA`/`S`
state declarations:

```javascript
// ── URL ROUTING ──────────────────────────────────────────────────────────
function examUrl(catKey, examKey){
  return '/' + catKey.replace(/_/g,'-') + '/' + examKey.replace(/_/g,'-');
}
function parseUrlPath(){
  const parts = location.pathname.split('/').filter(Boolean);
  if(parts.length < 2) return null;
  const catSlug = parts[0], examSlug = parts[1];
  for(const [catKey, cat] of Object.entries(DATA)){
    if(catKey.replace(/_/g,'-') !== catSlug) continue;
    for(const [examKey, exam] of Object.entries(cat.exams)){
      if(examKey.replace(/_/g,'-') === examSlug){
        return { catKey, examKey, exam };
      }
    }
  }
  return null;
}
function navigateToExam(catKey, examKey, exam){
  const url = examUrl(catKey, examKey);
  if(location.pathname !== url) history.pushState({catKey,examKey}, '', url);
  document.title = exam.name + ' Free Mock Test | MockAdda';
  const metaDesc = document.querySelector('meta[name="description"]');
  if(metaDesc) metaDesc.setAttribute('content',
    'Practice free ' + exam.fullname + ' (' + exam.name + ') mock tests on MockAdda. Timed, exam-pattern questions with instant results.');
}
function navigateToHome(){
  if(location.pathname !== '/') history.pushState({}, '', '/');
  document.title = 'MockAdda – Free Online Mock Tests | SSC, Banking, Railways, Teaching';
  const metaDesc = document.querySelector('meta[name="description"]');
  if(metaDesc) metaDesc.setAttribute('content',
    'Practice free mock tests on MockAdda for SSC, Banking, Railways, Teaching and Civil Services exams.');
}
```

## Step 2 — Call `navigateToExam` wherever an exam is opened

In `examCard()`, find this line:

```javascript
card.addEventListener('click',()=>{S.activeCatKey=catKey;S.activeExamKey=examKey;S.activeExam=exam;go('tests');});
```

Replace with:

```javascript
card.addEventListener('click',()=>{S.activeCatKey=catKey;S.activeExamKey=examKey;S.activeExam=exam;navigateToExam(catKey,examKey,exam);go('tests');});
```

Do the same in `homeScreen()`'s tab-click handler (search for `S.activeCatKey=k;go('exams')`)
— call `navigateToHome()` isn't right there since it's a category, not exam; for
category-level tabs you can use a shallower URL like `/ssc` if you want, or skip —
exam-level pages matter far more for SEO than category pages.

## Step 3 — Handle back/forward buttons and direct URL loads

At the very bottom, in your `boot()` function, right after `DATA` loads and
before `render()`:

```javascript
window.addEventListener('popstate', ()=>{
  const match = parseUrlPath();
  if(match){ S.activeCatKey=match.catKey; S.activeExamKey=match.examKey; S.activeExam=match.exam; S.screen='tests'; }
  else { S.screen='home'; }
  render();
});
```

And in `boot()`, replace:
```javascript
S.screen='home';
render();
```
with:
```javascript
const match = parseUrlPath();
if(match){
  S.activeCatKey=match.catKey; S.activeExamKey=match.examKey; S.activeExam=match.exam;
  navigateToExam(match.catKey, match.examKey, match.exam);
  S.screen='tests';
} else {
  S.screen='home';
}
render();
```

## Step 4 — Also call navigateToHome() when going back to home

Wherever `go('home')` is called (Navbar logo click, footer links, back buttons),
also call `navigateToHome()` first, e.g.:

```javascript
logo.appendChild(...,{onClick:()=>{navigateToHome();go('home');}});
```

---

This alone makes `/ssc/ssc-cgl`, `/banking/sbi-po`, etc. real, shareable,
bookmarkable URLs with their own page title and meta description — the
minimum Google needs to index and rank each exam separately.
