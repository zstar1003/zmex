#!/usr/bin/env python3
"""Rebuild 2026 Hubei group lines and validated rank tables from reviewed sources.

Requires pdfplumber, opencv-python, numpy, and the tesseract executable.
Source URLs, hashes and four visually checked OCR corrections are in the manifest.
The older parse-hubei-sources.py retains its original 2025 behavior.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "data/admissions/updates/hubei-2026-group-sources.json"
COLUMN_EDGES = [153, 228, 302, 405, 417, 492, 566, 669, 681, 756, 830, 933]


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def checked_source(path, url, digest):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-fsSL", "--retry", "3", "--max-time", "30", url, "-o", str(path)], check=True)
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Source hash changed; review before importing: {path}")
    return path


def parse_groups(source):
    raw = checked_source(ROOT / source["rawPath"], source["downloadUrl"], source["sha256"])
    records, missing_scores, identities = [], [], set()
    with pdfplumber.open(raw) as pdf:
        page_count = len(pdf.pages)
        for page_number, page in enumerate(pdf.pages, 1):
            # The official PDF has slanted colored text over the table. Its
            # rotation matrix differs from horizontal black admission text.
            clean = page.filter(lambda obj: obj.get("object_type") != "char" or
                                (abs(obj["matrix"][1]) < .001 and abs(obj["matrix"][2]) < .001))
            if page_number == 1 and "2026" not in (clean.extract_text() or ""):
                raise ValueError("Wrong PDF year")
            tables = clean.extract_tables()
            if len(tables) != 1:
                # The last history PDF page is a continuation footnote only.
                if not tables and not re.search(r"[A-Z]\d{5}", clean.extract_text() or ""):
                    continue
                raise ValueError(f"Expected one table on {source['id']} page {page_number}")
            for row in tables[0]:
                cells = [re.sub(r"\s+", "", cell or "") for cell in row]
                if not re.fullmatch(r"[A-Z]\d{5}", cells[0]):
                    continue
                if len(cells) != 12 or not re.fullmatch(r".+第\d+组", cells[1]):
                    raise ValueError(f"Malformed group row: {cells}")
                if cells[0] in identities:
                    raise ValueError(f"Duplicate group: {cells[0]}")
                identities.add(cells[0])
                if not cells[3]:
                    missing_scores.append({"sourcePage": page_number, "sourceCells": cells})
                    continue
                if not re.fullmatch(r"\d{3}", cells[3]) or not 100 <= int(cells[3]) <= 750:
                    raise ValueError(f"Invalid admission score: {cells}")
                records.append({
                    "groupCode": cells[0], "groupName": cells[1],
                    "schoolName": re.sub(r"第\d+组$", "", cells[1]),
                    "subjectRequirement": cells[2], "minScore": int(cells[3]),
                    "track": source["track"], "sourcePage": page_number,
                    "remarks": cells[11], "sourceCells": cells,
                })
    write_json(ROOT / source["parsePath"], {
        "meta": {"province": "湖北省", "year": 2026, "track": source["track"],
                 "sourceUrl": source["downloadUrl"], "sourceSha256": source["sha256"],
                 "publishedAt": source["publishedAt"], "pageCount": page_count,
                 "recordCount": len(records), "missingScoreCount": len(missing_scores)},
        "missingScoreRows": missing_scores, "records": records,
    })
    print(f"{source['id']}: {len(records)} scored groups; {len(missing_scores)} blank scores excluded")


def grouped_positions(values):
    groups = []
    for value in values:
        if not groups or value > groups[-1][-1] + 1:
            groups.append([int(value)])
        else:
            groups[-1].append(int(value))
    return [round(sum(group) / len(group)) for group in groups]


def make_ocr_jobs(images, temp_dir):
    jobs = []
    for source in images:
        path = checked_source(ROOT / source["path"], source["sourceUrl"], source["sha256"])
        original = cv2.imread(str(path))
        if original is None or original.shape[:2] != (1527, 1080):
            raise ValueError(f"Unexpected image dimensions: {path}")
        gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
        # Red-channel luminance suppresses the red watermark while preserving
        # antialiased black digits. Thresholding the digits damaged 3/6/8/9.
        digits = original[:, :, 2]
        for block in range(3):
            edges = COLUMN_EDGES[block * 4:block * 4 + 4]
            stripe = gray[:, edges[0] + 1:edges[-1] - 1]
            positions = np.where((stripe < 210).sum(1) > stripe.shape[1] * .8)[0]
            lines = [y for y in grouped_positions(positions) if y > (200 if source["page"] == 1 else 100)]
            row_count = len(lines) - 2
            if row_count != source["blockRowCounts"][block]:
                raise ValueError(f"Grid detection changed for {path.name}, block {block}")
            canvas = np.full((row_count * 100, 960), 255, np.uint8)
            for row, (top, bottom) in enumerate(zip(lines[1:-1], lines[2:])):
                for column in range(3):
                    cell = digits[top + 3:bottom - 2, edges[column] + 3:edges[column + 1] - 2]
                    cell = cv2.resize(cell, None, fx=3, fy=3)
                    y, x = row * 100 + 10, column * 320 + 10
                    canvas[y:y + cell.shape[0], x:x + cell.shape[1]] = cell
            image_path = temp_dir / f"{source['track']}-{source['page']}-{block}.png"
            cv2.imwrite(str(image_path), canvas)
            jobs.append((source, block, image_path, row_count))
    return jobs


def ocr_block(job):
    source, block, image_path, row_count = job
    result = subprocess.run(["tesseract", str(image_path), "stdout", "--psm", "6", "tsv"],
                            check=True, capture_output=True)
    words = [[[], [], []] for _ in range(row_count)]
    for item in csv.DictReader(io.StringIO(result.stdout.decode()), delimiter="\t", quoting=csv.QUOTE_NONE):
        text = item.get("text", "").strip()
        if not text:
            continue
        row = int((int(item["top"]) + int(item["height"]) / 2) // 100)
        column = int((int(item["left"]) + int(item["width"]) / 2) // 320)
        if row < row_count and column < 3:
            words[row][column].append(text)
    rows = []
    for row_number, cells in enumerate(words):
        strings = ["".join(parts) for parts in cells]
        values = [int(text) if text.isdigit() else None for text in strings]
        rows.append(dict(zip(["score", "count", "cumulative"], values)) |
                    {"page": source["page"], "block": block, "row": row_number, "ocrText": strings})
    return source["track"], rows


def parse_ranks(config):
    tracks = {"physics": [], "history": []}
    with tempfile.TemporaryDirectory(prefix="hubei-2026-") as directory:
        # Resolve macOS /tmp aliases: Leptonica cannot reliably read their PNGs.
        jobs = make_ocr_jobs(config["images"], Path(directory).resolve())
        with ThreadPoolExecutor(max_workers=6) as executor:
            for track, rows in executor.map(ocr_block, jobs):
                tracks[track].extend(rows)
    for fix in config["reviewedOcrCorrections"]:
        row = next(row for row in tracks[fix["track"]] if
                   (row["page"], row["block"], row["row"]) == (fix["page"], fix["block"], fix["row"]))
        if row["score"] != fix["score"]:
            raise ValueError("Reviewed OCR correction no longer matches the source row")
        row[fix["field"]] = fix["value"]
    metadata = {}
    for track, rows in tracks.items():
        for index, row in enumerate(rows):
            if any(row[key] is None or row[key] < 0 for key in ("score", "count", "cumulative")):
                raise ValueError(f"Unresolved OCR at {track}: {row}")
            if index:
                previous = rows[index - 1]
                if row["score"] >= previous["score"] or row["cumulative"] - previous["cumulative"] != row["count"]:
                    raise ValueError(f"Score ordering or cumulative recurrence failed: {previous} -> {row}")
                if row["score"] < 670 and row["score"] != previous["score"] - 1:
                    raise ValueError(f"Unexpected score gap below 670: {previous} -> {row}")
        metadata[track] = {
            "minScore": min(row["score"] for row in rows), "maxScore": max(row["score"] for row in rows),
            "rowCount": len(rows), "recurrenceChecks": len(rows) - 1,
            "sources": [source for source in config["images"] if source["track"] == track],
        }
        print(f"{track}: {len(rows)} rank bands; every adjacent cumulative count validated")
    by_track = {track: {row["score"]: row for row in rows} for track, rows in tracks.items()}
    scores = sorted(set(by_track["physics"]) | set(by_track["history"]), reverse=True)
    output_rows = []
    for score in scores:
        row = {"score": score}
        for track in tracks:
            source = by_track[track].get(score)
            row[track + "Rank"] = source["cumulative"] if source else 0
            row[track + "Count"] = source["count"] if source else 0
            row[track + "SourcePage"] = source["page"] if source else None
        output_rows.append(row)
    write_json(ROOT / config["outputPath"], {
        "meta": {"province": "湖北省", "year": 2026, "authority": "湖北省教育厅招生办公室",
                 "pageUrl": config["pageUrl"], "publishedAt": config["publishedAt"],
                 "method": "official-score-cumulative",
                 "rankDefinition": "对应分数档次的官方累计人数，作为同分考生位次上限",
                 "note": "来自2026年官方原图，含政策性加分；高分稀疏档按原表保留，未补造缺失档位。",
                 "extraction": "红色通道去水印、逐格去边框、Tesseract识别；4格人工核图更正；逐档验证分数顺序和累计人数递推。",
                 "tracks": metadata, "reviewedOcrCorrections": config["reviewedOcrCorrections"]},
        "rows": output_rows,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["groups", "ranks"], help="Rebuild one output type")
    args = parser.parse_args()
    config = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if args.only != "ranks":
        for source in config["sources"]:
            parse_groups(source)
    if args.only != "groups":
        parse_ranks(config["rankTable"])


if __name__ == "__main__":
    main()
