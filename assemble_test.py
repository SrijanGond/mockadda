#!/usr/bin/env python3
"""
Assembles ONE test from your Google Sheet's Published question pool,
respecting a fixed per-subject QUOTA and a fixed SECTION ORDER — instead
of just dumping every Published row tagged for that test into the JSON
in whatever order they happened to be added in.

v2 changes from the first version:
  - SEEDS FROM EXISTING QUESTIONS. If the test already has questions in
    the exam JSON (e.g. ssc_chsl_1 already has 25 live questions that
    were never in the Sheet), those are kept and counted toward the
    quota first. Only the remaining shortfall per subject is pulled
    from the CSV. Nothing existing is ever dropped.
  - SUBJECT ALIASES per quota entry. Different exams (or even different
    sets of the same exam) sometimes use slightly different subject
    labels for the same section — e.g. CHSL has both "English Language"
    and "English Comprehension" across its existing tests. Each quota
    bucket lists every raw subject name that should count toward it,
    and everything gets relabeled to one canonical name for consistency
    within that test.

Behaviour, per subject bucket, in the fixed order you define:
  1. Existing questions in the test whose subject matches one of the
     bucket's aliases are kept and canonicalized to the bucket's label.
  2. If still under quota, CSV rows for that test_id whose subject
     matches one of the aliases are added (skipping any whose question
     text is already present, and de-duplicating the CSV itself) until
     the quota is reached or the CSV is exhausted.
  3. SURPLUS existing questions beyond quota are still kept (never
     deleted) — reported, not dropped. SURPLUS CSV rows beyond quota are
     left unused in the Sheet (not deleted from the Sheet).
  4. SHORTFALL (still under quota after using everything available) is
     reported clearly, e.g. "English Language: 10/25 — need 15 more."

Same Hindi/English-skill-subject rule as everywhere else on the site:
subjects whose canonical name contains "english" or "hindi" never get a
q_hi/opts_hi/exp_hi field on newly-added questions.

Usage:
    python3 assemble_test.py <questions.csv> <exam-file.json> <test_id>

If <questions.csv> doesn't have any rows for <test_id>, that's fine —
the script just reports the existing-only status per section.
"""
import csv, json, sys
from collections import OrderedDict

LETTER_TO_IDX = {'A': 0, 'B': 1, 'C': 2, 'D': 3}

# Section order + quota per test pattern. Each bucket is
# (canonical_label, [raw subject names in the Sheet/JSON that count
# toward it, lowercase], target_count). Add more test_ids / exam
# patterns here as you confirm them for other exam categories.
QUOTAS = {
    'ssc_cgl_full_1': [
        ('General Intelligence & Reasoning', ['general intelligence & reasoning'], 25),
        ('General Awareness', ['general awareness'], 25),
        ('Quantitative Aptitude', ['quantitative aptitude'], 25),
        ('English Comprehension', ['english comprehension'], 25),
    ],
    'ssc_chsl_1': [
        ('General Intelligence', ['general intelligence', 'general intelligence & reasoning'], 25),
        ('General Awareness', ['general awareness'], 25),
        ('Quantitative Aptitude', ['quantitative aptitude'], 25),
        ('English Language', ['english language', 'english comprehension'], 25),
    ],
    'rrb_group_d_1': [
        ('General Science', ['general science', 'science'], 25),
        ('Mathematics', ['mathematics', 'quantitative aptitude', 'maths', 'math'], 25),
        ('General Intelligence & Reasoning', ['general intelligence & reasoning', 'general intelligence', 'reasoning'], 25),
        ('General Awareness & Current Affairs', ['general awareness & current affairs', 'general awareness', 'current affairs'], 25),
    ],
    'rrb_group_d_2': [
        ('General Science', ['general science', 'science'], 25),
        ('Mathematics', ['mathematics', 'quantitative aptitude', 'maths', 'math'], 25),
        ('General Intelligence & Reasoning', ['general intelligence & reasoning', 'general intelligence', 'reasoning'], 25),
        ('General Awareness & Current Affairs', ['general awareness & current affairs', 'general awareness', 'current affairs'], 25),
    ],
    'rrb_group_d_3': [
        ('General Science', ['general science', 'science'], 25),
        ('Mathematics', ['mathematics', 'quantitative aptitude', 'maths', 'math'], 25),
        ('General Intelligence & Reasoning', ['general intelligence & reasoning', 'general intelligence', 'reasoning'], 25),
        ('General Awareness & Current Affairs', ['general awareness & current affairs', 'general awareness', 'current affairs'], 25),
    ],
    'rrb_group_d_4': [
        ('General Science', ['general science', 'science'], 25),
        ('Mathematics', ['mathematics', 'quantitative aptitude', 'maths', 'math'], 25),
        ('General Intelligence & Reasoning', ['general intelligence & reasoning', 'general intelligence', 'reasoning'], 25),
        ('General Awareness & Current Affairs', ['general awareness & current affairs', 'general awareness', 'current affairs'], 25),
    ],
}

# Duration is in MINUTES (the site does test.duration * 60 to get the
# countdown in seconds) — NOT seconds. Getting this wrong doesn't error,
# it just makes the timer look broken (e.g. a "duration": 3600 default
# meant as a safe fallback actually reads as 3600 *minutes*, 60 hours).
# Fill this in for every test_id in QUOTAS so a brand-new test never falls
# back to a guessed value silently.
TEST_META = {
    'ssc_cgl_full_1': {'duration': 60, 'correctMarks': 2, 'negativeMarks': 0.5},
    'ssc_chsl_1': {'duration': 60, 'correctMarks': 2, 'negativeMarks': 0.5},
    'rrb_group_d_1': {'duration': 90, 'correctMarks': 1, 'negativeMarks': 0.33},
    'rrb_group_d_2': {'duration': 90, 'correctMarks': 1, 'negativeMarks': 0.33},
    'rrb_group_d_3': {'duration': 90, 'correctMarks': 1, 'negativeMarks': 0.33},
    'rrb_group_d_4': {'duration': 90, 'correctMarks': 1, 'negativeMarks': 0.33},
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
    # Question-level chart/diagram image (DI bar charts, 2-graph, pie, etc).
    img = (row.get('img') or '').strip()
    if img:
        q['img'] = img
    # Per-option images (e.g. non-verbal reasoning "which figure completes
    # the series" questions where each option is a shape, not text).
    opt_imgs = [
        (row.get('opt_a_img') or '').strip(),
        (row.get('opt_b_img') or '').strip(),
        (row.get('opt_c_img') or '').strip(),
        (row.get('opt_d_img') or '').strip(),
    ]
    if any(opt_imgs):
        q['opts_img'] = opt_imgs
    return q

def main():
    if len(sys.argv) != 4:
        print("Usage: python3 assemble_test.py <questions.csv> <exam-file.json> <test_id>")
        sys.exit(1)
    csv_path, json_path, test_id = sys.argv[1], sys.argv[2], sys.argv[3]

    if test_id not in QUOTAS:
        print(f"No quota defined yet for '{test_id}'. Add it to QUOTAS in this script "
              f"(canonical label, [raw subject aliases], count).")
        sys.exit(1)
    buckets = QUOTAS[test_id]  # list of (label, aliases, target)

    # ---- existing questions already in the exam JSON for this test ----
    data = json.load(open(json_path, encoding='utf-8'))
    tests_by_id = {t['id']: t for t in data.get('tests', [])}
    existing = tests_by_id[test_id]['questions'] if test_id in tests_by_id else []
    existing_texts = {q.get('q', '').strip().lower() for q in existing}

    # ---- CSV rows for this test, Published, de-duplicated by text ----
    rows = list(csv.DictReader(open(csv_path, encoding='utf-8')))
    rows = [r for r in rows if (r.get('status') or '').strip() == 'Published'
            and (r.get('set_assigned') or '').strip() == test_id]
    seen, deduped = set(), []
    csv_dupes_skipped = 0
    for r in rows:
        key = (r.get('en') or '').strip().lower()
        if key in seen:
            csv_dupes_skipped += 1
            continue
        seen.add(key)
        deduped.append(r)

    by_subject_csv = {}
    for r in deduped:
        by_subject_csv.setdefault((r.get('subject') or '').strip().lower(), []).append(r)

    matched_aliases = set()
    assembled = []
    print(f"Assembling {test_id}  (deduplicated {csv_dupes_skipped} repeat rows from the Sheet)\n")

    for label, aliases, target in buckets:
        alias_set = {a.lower() for a in aliases}
        matched_aliases |= alias_set

        # 1. keep existing questions matching this bucket, canonicalize label
        existing_match = [q for q in existing if (q.get('subject') or '').strip().lower() in alias_set]
        for q in existing_match:
            q['subject'] = label
        used = list(existing_match)

        # 2. top up from CSV if still under quota, skipping anything already present
        if len(used) < target:
            candidates = []
            for alias in alias_set:
                candidates.extend(by_subject_csv.get(alias, []))
            for r in candidates:
                if len(used) >= target:
                    break
                text_key = (r.get('en') or '').strip().lower()
                if text_key in existing_texts:
                    continue
                q = csv_row_to_question(r)
                q['subject'] = label
                used.append(q)
                existing_texts.add(text_key)

        assembled.extend(used)

        if len(used) < target:
            print(f"  {label:35s} {len(used)}/{target}  -- SHORT by {target-len(used)}, "
                  f"write {target-len(used)} more in the Sheet and re-run")
        else:
            surplus_existing = max(0, len(existing_match) - target) if len(existing_match) > target else 0
            print(f"  {label:35s} {len(used)}/{target}  -- OK"
                  + (f"  ({len(used)-target} extra kept)" if len(used) > target else ""))

    unmatched_subjects = {s for s in by_subject_csv if s not in matched_aliases}
    if unmatched_subjects:
        print(f"\n  Note: CSV has rows tagged for subjects not in this test's quota "
              f"({', '.join(unmatched_subjects)}) — ignored for this test.")

    print(f"\nTotal assembled: {len(assembled)} / {sum(t for _, _, t in buckets)}")

    if test_id in tests_by_id:
        tests_by_id[test_id]['questions'] = assembled
    else:
        meta = TEST_META.get(test_id)
        if not meta:
            print(f"\n  *** WARNING: no TEST_META entry for '{test_id}' — using a 60-minute "
                  f"placeholder duration and a 0.5 negative-marking default. VERIFY these are "
                  f"correct for this exam before uploading, and add a TEST_META entry so this "
                  f"warning doesn't show up again. ***")
            meta = {'duration': 60, 'correctMarks': 1, 'negativeMarks': 0.5}
        data['tests'].append({
            'id': test_id, 'title': test_id,
            'duration': meta['duration'], 'correctMarks': meta['correctMarks'],
            'negativeMarks': meta['negativeMarks'], 'questions': assembled
        })
    json.dump(data, open(json_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"\nWrote {json_path} — {test_id} now has exactly this assembled question set.")

if __name__ == '__main__':
    main()
