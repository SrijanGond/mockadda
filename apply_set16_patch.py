#!/usr/bin/env python3
"""
Patches index.html for UPSSSC PET Set 16.

Usage:  python apply_set16_patch.py path/to/index.html

- Makes a backup (index.html.bak) first.
- Every edit is anchored on a single line that must appear EXACTLY once;
  if any anchor is missing/duplicated the script stops and changes nothing.
"""
import sys, shutil

path = sys.argv[1] if len(sys.argv) > 1 else "index.html"
src = open(path, encoding="utf-8").read()

# ── 1. helpers (canonical subject names + passage/question splitter) ─────────
ANCHOR_HELPERS = "function capQuestionsPerSection(questions, examKey, testId){"
HELPERS = r'''// Official syllabus labels (EXAM_CONTENT, shown in the exam-pattern table) that differ from the
// subject tags used in the live question data. Used only to decide whether a section is really
// "coming soon" or already has live questions under a different name.
const OFFICIAL_SECTION_ALIASES_BY_EXAM = {
  upsssc_pet: {
    'Analysis of 2 Unread Hindi Passages': 'Analysis of Hindi Unread Passage (2 Passages)',
    'Graph Analysis & Interpretation': 'Data Interpretation',
    'Table Analysis & Interpretation': 'Data Interpretation',
  }
};
function canonicalSubject(examKey, name){
  let s = String(name || '').trim();
  const a = SUBJECT_ALIASES_BY_EXAM[examKey];
  if(a && a.hasOwnProperty(s)) s = a[s];
  const o = OFFICIAL_SECTION_ALIASES_BY_EXAM[examKey];
  if(o && o.hasOwnProperty(s)) s = o[s];
  return s;
}

// Passage-based questions are stored as "<passage>  Q: <question>". Splits them so the passage can be
// shown in its own box with the actual question underneath. Returns null for every other question,
// which then renders exactly as before.
function splitPassageQuestion(q){
  const t = q && q.q;
  if(typeof t !== 'string' || !/passage/i.test(q.subject || '')) return null;
  const m = t.match(/^([\s\S]*\S)\s+Q:\s*([\s\S]+)$/);
  if(!m) return null;
  return { passage: m[1].trim(), question: m[2].trim() };
}

'''

# ── 2. "coming soon" tabs: compare canonical names ───────────────────────────
OLD_LIVE = "const liveSubjects = new Set(sections.map(sec=>sec.subject));"
NEW_LIVE = "const liveSubjects = new Set(sections.map(sec=>canonicalSubject(S.activeExamKey, sec.subject)));"
OLD_HAS = "if(liveSubjects.has(off.name)) return;"
NEW_HAS = "if(liveSubjects.has(canonicalSubject(S.activeExamKey, off.name))) return;"

# ── 3. quiz screen: passage box + question ───────────────────────────────────
OLD_Q = "qTextInner.appendChild(el('div',{css:`font-size:15px;line-height:1.7;color:${CBT.text};`,text:q.q}));"
NEW_Q = r'''const pq = splitPassageQuestion(q);
  if(pq){
    qTextInner.appendChild(el('div',{css:`font-size:15px;line-height:1.9;color:${CBT.text};background:${CBT.gridBg};border:1px solid ${CBT.border};border-radius:10px;padding:12px 14px;margin-bottom:12px;`,text:pq.passage}));
    qTextInner.appendChild(el('div',{css:`font-size:15px;line-height:1.7;font-weight:600;color:${CBT.text};`,text:pq.question}));
  } else {
    qTextInner.appendChild(el('div',{css:`font-size:15px;line-height:1.7;color:${CBT.text};`,text:q.q}));
  }'''

edits = [
    (ANCHOR_HELPERS, HELPERS + ANCHOR_HELPERS),
    (OLD_LIVE, NEW_LIVE),
    (OLD_HAS, NEW_HAS),
    (OLD_Q, NEW_Q),
]

for old, _ in edits:
    n = src.count(old)
    if n != 1:
        sys.exit(f"STOP: expected exactly 1 match, found {n} for:\n  {old[:90]}...\nNo changes made.")

shutil.copyfile(path, path + ".bak")
for old, new in edits:
    src = src.replace(old, new, 1)
open(path, "w", encoding="utf-8").write(src)
print("Patched OK. Backup saved as", path + ".bak")
