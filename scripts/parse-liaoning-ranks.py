#!/usr/bin/env python3
import json
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "admissions" / "raw"
OUTPUT_PATH = ROOT / "data" / "admissions" / "reference" / "liaoning-2025-score-ranks.json"

TRACKS = {
    "physics": {
        "path": RAW_DIR / "liaoning-2025-score-ranks-physics.pdf",
        "pageUrl": "https://jyt.ln.gov.cn/jyt/jyzx/jyyw/2025062418040445891/index.shtml",
        "sourceUrl": "https://www.lnzsks.com/lnzkbfiles/2025/2025gk1f1d0624wl001.pdf",
    },
    "history": {
        "path": RAW_DIR / "liaoning-2025-score-ranks-history.pdf",
        "pageUrl": "https://jyt.ln.gov.cn/jyt/jyzx/jyyw/2025062418040445891/index.shtml",
        "sourceUrl": "https://www.lnzsks.com/lnzkbfiles/2025/2025gk1f1d0624ls002.pdf",
    },
}

# The PDF repeats four score/count/cumulative groups on each line. Filtering to
# the embedded Arial font removes the diagonal official watermark characters.
GROUP_BASES = (42, 175, 308, 441)
SUB_COLUMNS = ((0, 33), (33, 72), (72, 117))


def digits_in_range(chars, left, right):
    text = "".join(
        char["text"]
        for char in sorted(chars, key=lambda item: item["x0"])
        if left <= char["x0"] < right
    )
    digits = "".join(char for char in text if char.isdigit())
    return int(digits) if digits else None


def parse_rank_pdf(path):
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            chars = [
                char
                for char in page.chars
                if char["fontname"].endswith("ArialMT") and 9.8 < char["size"] < 10.1
            ]
            for top in sorted({round(char["top"], 1) for char in chars}):
                if top < 90:
                    continue
                line = [char for char in chars if round(char["top"], 1) == top]
                for base in GROUP_BASES:
                    values = [
                        digits_in_range(line, base + left, base + right)
                        for left, right in SUB_COLUMNS
                    ]
                    if all(value is not None for value in values):
                        rows.append(
                            {
                                "score": values[0],
                                "count": values[1],
                                "cumulative": values[2],
                            }
                        )

    rows.sort(key=lambda row: row["score"], reverse=True)
    previous_cumulative = 0
    previous_score = None
    for row in rows:
        if previous_score is not None and row["score"] >= previous_score:
            raise ValueError(f"{path.name}: score order breaks at {row['score']}")
        if row["cumulative"] - previous_cumulative != row["count"]:
            raise ValueError(f"{path.name}: cumulative count breaks at {row['score']}")
        previous_score = row["score"]
        previous_cumulative = row["cumulative"]
    return rows


parsed = {track: parse_rank_pdf(config["path"]) for track, config in TRACKS.items()}
scores = sorted(
    {row["score"] for rows in parsed.values() for row in rows},
    reverse=True,
)
rank_maps = {
    track: {row["score"]: row["cumulative"] for row in rows}
    for track, rows in parsed.items()
}

payload = {
    "meta": {
        "province": "辽宁省",
        "year": 2025,
        "authority": "辽宁招生考试之窗",
        "pageUrl": TRACKS["physics"]["pageUrl"],
        "physicsSourceUrl": TRACKS["physics"]["sourceUrl"],
        "historySourceUrl": TRACKS["history"]["sourceUrl"],
        "rankDefinition": "对应分数档次的官方累计人数，作为同分考生位次上限",
        "extraction": "按PDF内嵌表格坐标提取，并逐档校验人数差分与累计人数完全一致",
        "physicsScoreBands": len(parsed["physics"]),
        "historyScoreBands": len(parsed["history"]),
    },
    "rows": [
        {
            "score": score,
            "physicsRank": rank_maps["physics"].get(score, 0),
            "historyRank": rank_maps["history"].get(score, 0),
        }
        for score in scores
    ],
}

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(
    f"Wrote {OUTPUT_PATH} with "
    f"{len(parsed['physics'])} physics and {len(parsed['history'])} history score bands."
)
