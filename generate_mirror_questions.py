#!/usr/bin/env python3
"""
generate_mirror_questions.py — Non-verbal reasoning: Mirror Image generator

WHY THIS APPROACH
------------------
Instead of asking an AI image model to "draw a mirror image question" (which
can produce an image that LOOKS plausible but doesn't actually match a real
mirror transformation — meaning the "correct answer" would just be a guess),
this script does it the other way round:

  1. Generate a random asymmetric figure as raw coordinates (not a picture)
  2. Apply the ACTUAL mathematical mirror transformation to those coordinates
  3. Render both the original and every transformed version as SVG

Because the image and the transformation come from the same numbers, the
answer key is guaranteed correct — there's no step where the "answer" is a
separate guess about what the image shows.

OUTPUT
------
For each generated question:
  - 1 question image (the original figure)
  - 4 option images (1 correct mirror image + 3 deliberate distractors)
  - A row in questions.csv matching your Google Sheet's column schema,
    with status=Draft so you review before publishing

Distractor types (the same "wrong answer" patterns real exams use):
  - Vertical flip instead of horizontal (tests mirror-axis confusion)
  - 180° rotation (looks similar to a flip at a glance, but isn't one)
  - Unchanged original (the "did nothing" trap)

USAGE
-----
    python3 generate_mirror_questions.py --count 10 --set upsssc_pet_5 --start-id 5000
"""
import argparse
import csv
import random
import os

CANVAS = 200
MARGIN = 20

def random_figure(seed):
    """Generates an asymmetric figure as a list of line segments + one marker
    dot, so the correct mirror position is visually checkable, not just
    'looks flipped'."""
    rng = random.Random(seed)
    n_points = rng.randint(4, 6)
    points = []
    for _ in range(n_points):
        x = rng.randint(MARGIN, CANVAS - MARGIN)
        y = rng.randint(MARGIN, CANVAS - MARGIN)
        points.append((x, y))
    # asymmetry marker — a filled circle away from the figure's centroid
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    marker = (
        min(CANVAS - MARGIN, max(MARGIN, int(cx + rng.choice([-1,1]) * rng.randint(30,50)))),
        min(CANVAS - MARGIN, max(MARGIN, int(cy + rng.choice([-1,1]) * rng.randint(30,50)))),
    )
    return {"points": points, "marker": marker}

def transform(fig, kind):
    def tx(p):
        x, y = p
        if kind == "horizontal_flip":
            return (CANVAS - x, y)
        if kind == "vertical_flip":
            return (x, CANVAS - y)
        if kind == "rotate_180":
            return (CANVAS - x, CANVAS - y)
        return (x, y)  # identity / unchanged
    return {"points": [tx(p) for p in fig["points"]], "marker": tx(fig["marker"])}

def render_svg(fig, stroke="#0f172a"):
    pts = fig["points"]
    path_d = "M " + " L ".join(f"{x},{y}" for x, y in pts)
    mx, my = fig["marker"]
    return (
        f'<svg viewBox="0 0 {CANVAS} {CANVAS}" xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="{CANVAS}" height="{CANVAS}" fill="#ffffff"/>'
        f'<path d="{path_d}" fill="none" stroke="{stroke}" stroke-width="4" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="{mx}" cy="{my}" r="7" fill="#dc2626"/>'
        f'</svg>'
    )

def build_question(qid, out_dir):
    fig = random_figure(qid)
    correct = transform(fig, "horizontal_flip")
    distractors = [
        transform(fig, "vertical_flip"),
        transform(fig, "rotate_180"),
        transform(fig, "identity"),
    ]
    options = [correct] + distractors
    rng = random.Random(qid + 9999)
    rng.shuffle(options)
    correct_index = options.index(correct)  # position after shuffle (identity works since dicts compare by value... see note below)

    # write question figure
    q_path = os.path.join(out_dir, f"mirror_{qid:04d}_q.svg")
    with open(q_path, "w") as f:
        f.write(render_svg(fig))

    opt_paths = []
    for i, opt in enumerate(options):
        letter = "abcd"[i]
        p = os.path.join(out_dir, f"mirror_{qid:04d}_opt_{letter}.svg")
        with open(p, "w") as f:
            f.write(render_svg(opt))
        opt_paths.append(p)

    return {
        "q_path": q_path,
        "opt_paths": opt_paths,
        "correct_index": correct_index,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--set", default="upsssc_pet_5")
    ap.add_argument("--exam-tags", default="upsssc_pet")
    ap.add_argument("--subject", default="Reasoning & Mathematics")
    ap.add_argument("--start-id", type=int, default=9000)
    ap.add_argument("--img-base-url", default="/question-images/nonverbal")
    ap.add_argument("--out-dir", default="images")
    ap.add_argument("--csv-out", default="questions.csv")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    ANS_LETTERS = "ABCD"

    rows = []
    for i in range(args.count):
        qid = args.start_id + i
        q = build_question(qid, args.out_dir)
        ans_letter = ANS_LETTERS[q["correct_index"]]
        row = {
            "id": qid,
            "exam_tags": args.exam_tags,
            "subject": args.subject,
            "topic": "Mirror Image",
            "difficulty": "Medium",
            "en": "A figure is given on the left. Select the option that shows its correct mirror image when a mirror is placed vertically on the right side (line MN).",
            "hi": "बाईं ओर एक आकृति दी गई है। यदि दाईं ओर रेखा MN पर दर्पण रखा जाए, तो उसका सही दर्पण प्रतिबिंब दिखाने वाला विकल्प चुनें।",
            "opt_a_en": "Figure (A)", "opt_a_hi": "आकृति (A)",
            "opt_b_en": "Figure (B)", "opt_b_hi": "आकृति (B)",
            "opt_c_en": "Figure (C)", "opt_c_hi": "आकृति (C)",
            "opt_d_en": "Figure (D)", "opt_d_hi": "आकृति (D)",
            "ans": ans_letter,
            "exp_en": "A mirror placed on the right reverses the figure left-to-right (horizontal flip) — every point's horizontal position is mirrored while its vertical position stays the same. Only one option matches this exact transformation of the original figure and its marker dot.",
            "exp_hi": "दाईं ओर रखा गया दर्पण आकृति को बाएं-दाएं उलट देता है — हर बिंदु की क्षैतिज स्थिति दर्पित होती है जबकि ऊर्ध्वाधर स्थिति वही रहती है। केवल एक विकल्प मूल आकृति और उसके चिह्न बिंदु के इस सटीक रूपांतरण से मेल खाता है।",
            "set_assigned": args.set,
            "status": "Draft",
            "img": f"{args.img_base_url}/{os.path.basename(q['q_path'])}",
            "opt_a_img": f"{args.img_base_url}/{os.path.basename(q['opt_paths'][0])}",
            "opt_b_img": f"{args.img_base_url}/{os.path.basename(q['opt_paths'][1])}",
            "opt_c_img": f"{args.img_base_url}/{os.path.basename(q['opt_paths'][2])}",
            "opt_d_img": f"{args.img_base_url}/{os.path.basename(q['opt_paths'][3])}",
        }
        rows.append(row)

    fieldnames = list(rows[0].keys())
    with open(args.csv_out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} questions -> {args.csv_out}, images in {args.out_dir}/")

if __name__ == "__main__":
    main()
