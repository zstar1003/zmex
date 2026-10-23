#!/usr/bin/env python3
"""Build the 2026 rank reference from the checked extraction of the official scan.

The source PDF has no text layer. Its 18 pages were OCRed after detecting the
table grid and removing the red watermark. Every score/count/cumulative row was
checked for continuity; OCR differences were checked against the original PDF
row images. The audit retains all five columns, page numbers and corrections.
This command verifies that audit against the exact source PDF and regenerates
the compact reference without requiring the original OCR tool installation.
"""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "admissions"
AUDIT_PATH = DATA_DIR / "extracted" / "hebei-2026-score-ranks-audit.json"
SOURCE_PATH = DATA_DIR / "raw" / "hebei-2026-score-ranks.pdf"
OUTPUT_PATH = DATA_DIR / "reference" / "hebei-2026-score-ranks.json"


def main():
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    source_hash = hashlib.sha256(SOURCE_PATH.read_bytes()).hexdigest()
    if source_hash != audit["meta"]["sourceSha256"]:
        raise ValueError("Official PDF changed; its extraction must be checked again")
    if audit["columns"] != [
        "score", "physicsCount", "physicsRank", "historyCount", "historyRank"
    ]:
        raise ValueError("Unexpected audit column order")
    rows = audit["rows"]
    if len(rows) != 562 or audit["meta"]["year"] != 2026:
        raise ValueError("Expected 562 score bands for 2026")

    previous_physics = previous_history = 0
    reference_rows = []
    by_score = {}
    for index, row in enumerate(rows):
        score, physics_count, physics_rank, history_count, history_rank = row["values"]
        expected_page = 1 if index < 30 else 2 + (index - 30) // 32
        if score != 701 - index or row["page"] != expected_page:
            raise ValueError(f"Score or original PDF page mismatch at {score}")
        if min(physics_count, physics_rank, history_count, history_rank) < 0:
            raise ValueError(f"Negative count at {score}")
        if physics_rank - previous_physics != physics_count:
            raise ValueError(f"Physics cumulative count mismatch at {score}")
        if history_rank - previous_history != history_count:
            raise ValueError(f"History cumulative count mismatch at {score}")
        previous_physics, previous_history = physics_rank, history_rank
        by_score[score] = row
        reference_rows.append({
            "score": score, "physicsRank": physics_rank, "historyRank": history_rank
        })

    for correction in audit["visualCorrections"]:
        row = by_score[correction["score"]]
        if row["values"] != correction["verified"] or row["page"] != correction["page"]:
            raise ValueError(f"Verified correction mismatch at {correction['score']}")

    # The scan publishes a combined top band for each subject (pages 1 and 2).
    # Keep the blank cells in the audit/reference rows unchanged; consumers can
    # explicitly use the published upper bound for scores inside that band.
    top_coded_bands = {
        "physics": {"minScore": 701, "rank": 34, "sourcePage": 1},
        "history": {"minScore": 671, "rank": 31, "sourcePage": 2},
    }
    for track, band in top_coded_bands.items():
        rank_column = 2 if track == "physics" else 4
        anchor = by_score[band["minScore"]]
        if anchor["values"][rank_column] != band["rank"] or anchor["page"] != band["sourcePage"]:
            raise ValueError(f"Published {track} top band no longer matches the audit")

    payload = {
        "meta": {**audit["meta"], "topCodedBands": top_coded_bands},
        "rows": reference_rows,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Verified {len(rows)} bands on 18 pages; all count differences match. "
          f"Cumulative totals: physics={previous_physics}, history={previous_history}.")


if __name__ == "__main__":
    main()
