#!/usr/bin/env python3
"""
Assembles ONE test from your Google Sheet's Published question pool,
respecting a fixed per-subject QUOTA and a fixed SECTION ORDER — instead
of just dumping every Published row tagged for that test into the JSON
in whatever order they happened to be added in.

Why this is needed: "grouped by subject" (what the earlier converter did)
is not the same as "each section has exactly the right number of
questions." A test can be perfectly grouped by subject and still be
wrong — e.g. 30 Reasoning / 26 Quant / 10 GA / 10 English instead of the
real SSC CGL Tier 1 pattern of 25 / 25 / 25 / 25. This script fixes that:
it pulls exactly `quota` questions per subject (in the order they were
added in the Sheet), in the exact section order you specify, and leaves
any surplus questions untouched in the Sheet rather than discarding them.

DEFAULT QUOTA (SSC CGL Tier 1, 100 questions) — edit QUOTAS below to add
patterns for other exams (Banking, Teaching, Railways, etc.) once you
tell me theirs:
    General Intelligence & Reasoning : 25
    General Awareness                : 25
    Quantitative Aptitude            : 25
    English Comprehension            : 25

Behaviour:
  - Reads every Published row from the CSV whose set_assigned matches the
    test_id you pass in.
  - Groups them by subject, preserving the order they appear in the
    Sheet (i.e. the order you added them).
  - Takes up to `quota` questions from each subject's group, in that
    fixed subject order, to build the test.
  - SURPLUS: if a subject has more Published rows than its quota, the
    extra ones are left out of this test entirely (not deleted from the
    Sheet — they simply aren't used here) and listed in the summary, so
    you can either leave them for a future set or change their
    set_assigned in the Sheet.
  - SHORTFALL: if a subject has fewer rows than its quota, the test is
    filled with whatever is available and the shortfall is printed
    clearly, e.g. "General Awareness: 10/25 — need 15 more."
  - NEVER deletes existing questions in the exam JSON for a test that
    ISN'T being assembled — only the one test_id you pass in is touched.
  - Same Hindi/English-skill-subject rule as everywhere else on the
    site: subjects whose name contains "english" or "hindi" never get a
    q_hi/opts_hi/exp_hi field.

Usage:
    python3 assemble_test.py <questions.csv> <exam-file.json> <test_id>

Example:
    python3 assemble_test.py questions.csv ssc_cgl.json ssc_cgl_full_1
"""
import csv, json, sys
from collections import OrderedDict

LETTER_TO_IDX = {'A': 0, 'B': 1, 'C': 2, 'D': 3}

# Section order + quota per subject, per test pattern. Add more test_ids /
# exam patterns here as you confirm them for other exam categories.
QUOTAS = {
    'ssc_cgl_full_1': OrderedDict([
        ('General Intelligence & Reasoning', 25),
        ('General Awareness', 25),
        ('Quantitative Aptitude', 25),
        ('English Comprehension', 25),
    ]),
}

def is_language_skill_subject(subject):
    s = (subject or '').lower()
    return 'english' in s or 'hindi' in s

def csv_row_to_question(row):
    subject = (row.get('subject') or '').strip()
    q = {
        'q': (row.get('en') or '').strip(),
        'opts': [
            (row.get('opt_a_en') or '').strip(),
            (row.get('opt_b_en') or '').strip(),
            (row.get('opt_c_en') or '').strip(),
            (row.get('opt_d_en') or '').strip(),
        ],
        'ans': LETTER_TO_IDX.get((row.get('ans') or '').strip().upper(), 0),
        'subject': subject,
    }
    if not is_language_skill_subject(subject):
        q_hi = (row.get('hi') or '').strip()
        if q_hi:
            q['q_hi'] = q_hi
        opts_hi = [
            (row.get('opt_a_hi') or '').strip(),
            (row.get('opt_b_hi') or '').strip(),
            (row.get('opt_c_hi') or '').strip(),
            (row.get('opt_d_hi') or '').strip(),
        ]
        if all(opts_hi):
            q['opts_hi'] = opts_hi
    exp_en = (row.get('exp_en') or '').strip()
    if exp_en:
        q['exp_en'] = exp_en
    if not is_language_skill_subject(subject):
        exp_hi = (row.get('exp_hi') or '').strip()
        if exp_hi:
            q['exp_hi'] = exp_hi
    return q

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 assemble_test.py <questions.csv> <exam-file.json> <test_id>")
        sys.exit(1)
    csv_path, json_path, test_id = sys.argv[1], sys.argv[2], sys.argv[3]

    if test_id not in QUOTAS:
        print(f"No quota defined yet for '{test_id}'. Add it to QUOTAS in this script "
              f"(subject name -> question count, in the order sections should appear).")
        sys.exit(1)
    quota = QUOTAS[test_id]

    rows = list(csv.DictReader(open(csv_path, encoding='utf-8')))
    rows = [r for r in rows if (r.get('status') or '').strip() == 'Published'
            and (r.get('set_assigned') or '').strip() == test_id]

    # De-duplicate by question text (protects against the same row being
    # Published more than once in the Sheet).
    seen, deduped = set(), []
    dupes_skipped = 0
    for r in rows:
        key = (r.get('en') or '').strip().lower()
        if key in seen:
            dupes_skipped += 1
            continue
        seen.add(key)
        deduped.append(r)

    by_subject = OrderedDict()
    for r in deduped:
        by_subject.setdefault((r.get('subject') or '').strip(), []).append(r)

    assembled = []
    print(f"Assembling {test_id}  (deduplicated {dupes_skipped} repeat rows from the Sheet)\n")
    for subject, target in quota.items():
        available = by_subject.get(subject, [])
        used = available[:target]
        surplus = available[target:]
        assembled.extend(csv_row_to_question(r) for r in used)
        if len(used) < target:
            print(f"  {subject:35s} {len(used)}/{target}  -- SHORT by {target-len(used)}, "
                  f"write {target-len(used)} more and re-run")
        elif surplus:
            print(f"  {subject:35s} {len(used)}/{target}  -- OK, {len(surplus)} extra left "
                  f"unused in the Sheet for this test (not deleted)")
        else:
            print(f"  {subject:35s} {len(used)}/{target}  -- exact fit")

    extra_subjects = set(by_subject) - set(quota)
    if extra_subjects:
        print(f"\n  Note: found rows tagged for subjects not in this test's quota "
              f"({', '.join(extra_subjects)}) — ignored for this test.")

    print(f"\nTotal assembled: {len(assembled)} / {sum(quota.values())}")

    data = json.load(open(json_path, encoding='utf-8'))
    tests_by_id = {t['id']: t for t in data.get('tests', [])}
    if test_id in tests_by_id:
        tests_by_id[test_id]['questions'] = assembled
    else:
        data['tests'].append({
            'id': test_id, 'title': test_id, 'duration': 3600,
            'correctMarks': 1, 'negativeMarks': 0, 'questions': assembled
        })
    json.dump(data, open(json_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"\nWrote {json_path} — {test_id} now has exactly this assembled question set.")

if __name__ == '__main__':
    main()
