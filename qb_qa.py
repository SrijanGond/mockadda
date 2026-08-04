#!/usr/bin/env python3
"""
qb_qa.py — Question Bank QA Checker for MockAdda / readymadequiz.co.in

Runs every check we've done manually against the master question bank CSV
export, and prints a compact report. Works no matter how large the sheet
gets — it never needs to be pasted anywhere, and the output is a short
summary (KBs), not the raw data.

USAGE
-----
    # Basic run against a CSV export (File > Download > CSV from the sheet):
    python3 qb_qa.py path/to/export.csv

    # Restrict to one exam and/or one set:
    python3 qb_qa.py path/to/export.csv --exam ssc_cgl
    python3 qb_qa.py path/to/export.csv --exam ssc_cgl --set ssc_cgl_3

    # Only show Published rows (default) or include Draft too:
    python3 qb_qa.py path/to/export.csv --include-draft

    # Write the full report to a file instead of just printing it:
    python3 qb_qa.py path/to/export.csv --out report.txt

    # Pull directly from Google Sheets instead of a CSV export (see the
    # PULLING DIRECTLY FROM GOOGLE SHEETS section below for one-time setup):
    python3 qb_qa.py --sheet-id <SHEET_ID> --creds service_account.json


PULLING DIRECTLY FROM GOOGLE SHEETS (recommended once the sheet gets big)
---------------------------------------------------------------------------
Uploading a CSV export works fine today, but as the sheet grows it gets
slower to export/upload by hand. To skip that step entirely:

  1. pip install gspread google-auth
  2. In Google Cloud Console: create a Service Account, enable the Sheets
     API, and download its JSON key (service_account.json).
  3. Share your Google Sheet with the service account's email address
     (found inside the JSON key file, looks like
     xxxx@xxxx.iam.gserviceaccount.com) — Viewer access is enough.
  4. Run: python3 qb_qa.py --sheet-id <the-id-from-the-sheet-url> \
                            --creds service_account.json

This reads the sheet directly — no export/upload step, and no size limit
beyond what Sheets itself can hold (Sheets starts struggling with
performance well before 2GB; if the bank ever gets that big, migrating
to a real database like Postgres/SQLite is the right next step, and this
same script's checks can be pointed at a DB query instead of a DataFrame
with minimal changes).


WHAT IT CHECKS
--------------
  1. Duplicate IDs
  2. Duplicate questions within the SAME test/set (same paper, worst case)
  3. Duplicate answer options within a single question (invalidates it)
  4. Leaked AI-generator scratch text / unresolved placeholders
  5. Missing Hindi translation, broken down by subject (flags only the
     subjects that should be bilingual — English-only subjects are excluded
     automatically)
  6. Missing/very short explanations (exp_en)
  7. Answer-key (A/B/C/D) skew
  8. Subject quota vs. the configured target (default 25/subject for
     ssc_cgl and ssc_chsl — edit SECTION_QUOTA below if this changes)
  9. Per-set/per-subject counts after removing exact duplicates, so you can
     see the REAL usable count vs. the raw row count

Edit the CONFIG block below if your schema, quota, or exam list changes.
"""

import argparse
import re
import sys
from collections import Counter

import pandas as pd

# ── CONFIG ────────────────────────────────────────────────────────────────
# Exams/subjects that follow a fixed per-subject quota. Extend this dict as
# more exams adopt a fixed pattern (mirrors SECTION_CAPPED_EXAMS in index.html).
SECTION_QUOTA = {
    "ssc_cgl": 25,
    "ssc_chsl": 25,
    "upsssc_pet": 30,
}

# Subjects that are legitimately English-only (missing Hindi is expected,
# not a bug) — extend if more English-only subjects are added.
ENGLISH_ONLY_SUBJECTS = {"English Comprehension", "English Language"}

# Markers that indicate leaked AI-generator scratch text or unresolved content.
LEAK_MARKERS = [
    "placeholder", "TODO", "TBD", "FIXME", "AMBIGUOUS", "clean version",
    "restating", "verify:", "replaced by", "let's use", "let me",
]

TEXT_COLS = ["en", "hi", "opt_a_en", "opt_b_en", "opt_c_en", "opt_d_en",
             "exp_en", "exp_hi"]
OPT_COLS_EN = ["opt_a_en", "opt_b_en", "opt_c_en", "opt_d_en"]


# ── LOADING ───────────────────────────────────────────────────────────────
def load_from_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)


def load_from_sheets(sheet_id: str, creds_path: str) -> pd.DataFrame:
    """Pull the sheet directly via the Sheets API — no export/upload needed."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        sys.exit(
            "Missing packages. Run: pip install gspread google-auth"
        )
    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = Credentials.from_service_account_file(creds_path, scopes=scopes)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(sheet_id).sheet1
    records = sheet.get_all_records()
    return pd.DataFrame(records)


# ── CHECKS ────────────────────────────────────────────────────────────────
def check_duplicate_ids(df):
    dup = df[df["id"].duplicated(keep=False)]
    return dup[["id"]].drop_duplicates() if not dup.empty else None


def check_duplicate_questions_in_set(pub):
    grp = pub.groupby(["set_assigned", "en"]).size().reset_index(name="count")
    grp = grp[grp["count"] > 1].sort_values(
        ["set_assigned", "count"], ascending=[True, False]
    )
    return grp if not grp.empty else None


def check_duplicate_options(df):
    def has_dupe(row):
        opts = [str(row[c]).strip() for c in OPT_COLS_EN]
        return len(set(opts)) < 4

    flagged = df[df.apply(has_dupe, axis=1)]
    return flagged[["id", "set_assigned"] + OPT_COLS_EN] if not flagged.empty else None


def check_leaked_text(df):
    mask = pd.Series(False, index=df.index)
    for col in ["en", "exp_en", "exp_hi"]:
        if col not in df.columns:
            continue
        for marker in LEAK_MARKERS:
            mask |= df[col].astype(str).str.contains(marker, case=False, na=False)
    flagged = df[mask]
    return flagged[["id", "set_assigned", "en"]] if not flagged.empty else None


def check_missing_hindi(pub):
    missing = pub[pub["hi"].isna() | (pub["hi"].astype(str).str.strip() == "")]
    missing = missing[~missing["subject"].isin(ENGLISH_ONLY_SUBJECTS)]
    return missing[["id", "set_assigned", "subject", "en"]] if not missing.empty else None


def check_missing_explanations(pub, min_len=15):
    def is_bad(v):
        return pd.isna(v) or len(str(v).strip()) < min_len

    missing = pub[pub["exp_en"].apply(is_bad)]
    return missing[["id", "set_assigned", "exp_en"]] if not missing.empty else None


def check_answer_skew(pub):
    return pub["ans"].value_counts()


def check_quota(pub, quota_map):
    rows = []
    for exam, quota in quota_map.items():
        exam_rows = pub[pub["exam_tags"] == exam]
        if exam_rows.empty:
            continue
        ct = exam_rows.groupby(["set_assigned", "subject"]).size()
        for (set_id, subject), count in ct.items():
            if count != quota:
                rows.append((set_id, subject, count, quota))
    return rows


def real_counts_after_dedup(pub):
    """Per-set/subject counts after removing exact duplicate questions —
    the REAL usable count, vs. the raw (possibly inflated) row count."""
    deduped = pub.drop_duplicates(subset=["set_assigned", "en"], keep="first")
    return deduped.groupby(["set_assigned", "subject"]).size()


# ── REPORT ────────────────────────────────────────────────────────────────
def build_report(df, args):
    if args.exam:
        df = df[df["exam_tags"] == args.exam]
    if args.set:
        df = df[df["set_assigned"] == args.set]

    pub = df if args.include_draft else df[df["status"] == "Published"]

    lines = []

    def section(title):
        lines.append("")
        lines.append(f"=== {title} ===")

    lines.append(f"Question Bank QA Report — {len(df)} rows scanned "
                 f"({len(pub)} counted as {'all statuses' if args.include_draft else 'Published'})")

    section("1. Duplicate IDs")
    r = check_duplicate_ids(df)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("2. Duplicate questions within the same set (same paper)")
    r = check_duplicate_questions_in_set(pub)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("3. Duplicate answer options within a question")
    r = check_duplicate_options(df)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("4. Leaked generator text / unresolved placeholders")
    r = check_leaked_text(df)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("5. Missing Hindi translation (excludes English-only subjects)")
    r = check_missing_hindi(pub)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("6. Missing/very short explanations (exp_en)")
    r = check_missing_explanations(pub)
    lines.append(r.to_string(index=False) if r is not None else "None found.")

    section("7. Answer-key (A/B/C/D) distribution")
    lines.append(check_answer_skew(pub).to_string())

    section("8. Subject quota check")
    quota_issues = check_quota(pub, SECTION_QUOTA)
    if quota_issues:
        for set_id, subject, count, quota in quota_issues:
            lines.append(f"{set_id} / {subject}: {count} (expected {quota})")
    else:
        lines.append("All checked sets/subjects match quota.")

    section("9. Real usable counts after removing exact duplicates")
    lines.append(real_counts_after_dedup(pub).to_string())

    return "\n".join(lines)


# ── MAIN ──────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="QA the master question bank.")
    parser.add_argument("csv_path", nargs="?", help="Path to a CSV export of the sheet.")
    parser.add_argument("--sheet-id", help="Google Sheet ID (use instead of csv_path).")
    parser.add_argument("--creds", help="Path to service_account.json (with --sheet-id).")
    parser.add_argument("--exam", help="Restrict to one exam_tags value, e.g. ssc_cgl.")
    parser.add_argument("--set", help="Restrict to one set_assigned value, e.g. ssc_cgl_3.")
    parser.add_argument("--include-draft", action="store_true",
                        help="Include Draft rows, not just Published.")
    parser.add_argument("--out", help="Write report to this file instead of stdout.")
    args = parser.parse_args()

    if args.sheet_id:
        if not args.creds:
            sys.exit("--sheet-id requires --creds (see script docstring for setup).")
        df = load_from_sheets(args.sheet_id, args.creds)
    elif args.csv_path:
        df = load_from_csv(args.csv_path)
    else:
        sys.exit("Provide either a csv_path or --sheet-id (see --help).")

    report = build_report(df, args)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"Report written to {args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()
