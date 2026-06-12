#!/usr/bin/env python3

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "admissions" / "raw"
OUTPUT_PATH = (
    ROOT / "data" / "admissions" / "reference" / "xinjiang-2024-score-ranks.json"
)
TRACKS = {
    "history": {
        "path": RAW_DIR / "xinjiang-2024-score-ranks-history.png",
        "sourceUrl": "https://p1.gk100.com/article/20240827/6c0ee40ae82e474f.png",
        "label": "文科",
    },
    "physics": {
        "path": RAW_DIR / "xinjiang-2024-score-ranks-physics.png",
        "sourceUrl": "https://p1.gk100.com/article/20240827/a8545e877648c609.png",
        "label": "理科",
    },
}


def file_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def grouped_positions(values):
    groups = []
    for value in values:
        value = int(value)
        if not groups or value > groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [round(sum(group) / len(group)) for group in groups]


def ocr_numeric_column(image, horizontal_lines, x1, x2, temp_dir, name):
    start = horizontal_lines[1] + 1
    end = horizontal_lines[-1]
    column = image[start:end, x1:x2].copy()
    for line in horizontal_lines[2:-1]:
        y = line - start
        column[max(0, y - 1) : min(column.shape[0], y + 2), :] = 255
    column[:, :2] = 255
    column[:, -2:] = 255
    column = cv2.resize(column, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)

    image_path = Path(temp_dir) / f"{name}.png"
    output_base = Path(temp_dir) / name
    cv2.imwrite(str(image_path), column)
    subprocess.run(
        [
            "tesseract",
            image_path.name,
            output_base.name,
            "-l",
            "eng",
            "--psm",
            "6",
            "-c",
            "tessedit_char_whitelist=0123456789",
        ],
        cwd=temp_dir,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return [
        int(line.strip())
        for line in output_base.with_suffix(".txt").read_text().splitlines()
        if line.strip()
    ]


def parse_track(track, config):
    image = cv2.imread(str(config["path"]), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise RuntimeError(f"Cannot read {config['path']}")

    dark = image < 100
    horizontal_lines = grouped_positions((dark.sum(axis=1) > image.shape[1] * 0.7).nonzero()[0])
    vertical_lines = grouped_positions((dark.sum(axis=0) > image.shape[0] * 0.7).nonzero()[0])
    if len(vertical_lines) < 4 or len(horizontal_lines) < 3:
        raise RuntimeError(f"Grid detection failed for {config['path']}")

    with tempfile.TemporaryDirectory() as temp_dir:
        columns = [
            ocr_numeric_column(
                image,
                horizontal_lines,
                vertical_lines[index] + 1,
                vertical_lines[index + 1],
                temp_dir,
                f"{track}-{index}",
            )
            for index in range(3)
        ]

    expected_rows = len(horizontal_lines) - 2
    if any(len(column) != expected_rows for column in columns):
        raise RuntimeError(
            f"{track} OCR row mismatch: expected {expected_rows}, "
            f"received {[len(column) for column in columns]}"
        )

    scores, counts, cumulative = columns
    for index, score in enumerate(scores):
        if index and score != scores[index - 1] - 1:
            raise RuntimeError(f"{track} score sequence breaks at {score}")
        previous = cumulative[index - 1] if index else 0
        if cumulative[index] - previous != counts[index]:
            raise RuntimeError(f"{track} cumulative count breaks at score {score}")

    return {
        "sourceUrl": config["sourceUrl"],
        "sourcePageUrl": "https://www.gk100.com/read_18958315.htm",
        "sha256": file_sha256(config["path"]),
        "label": config["label"],
        "rows": [
            {"score": score, "count": counts[index], "rank": cumulative[index]}
            for index, score in enumerate(scores)
        ],
    }


parsed_tracks = {
    track: parse_track(track, config) for track, config in TRACKS.items()
}
all_scores = sorted(
    {
        row["score"]
        for payload in parsed_tracks.values()
        for row in payload["rows"]
    },
    reverse=True,
)
rank_maps = {
    track: {row["score"]: row["rank"] for row in payload["rows"]}
    for track, payload in parsed_tracks.items()
}

payload = {
    "meta": {
        "schemaVersion": 1,
        "province": "新疆维吾尔自治区",
        "year": 2024,
        "method": "image-table-ocr-with-cumulative-recurrence-validation",
        "note": (
            "新疆教育考试院仅向考生本人提供成绩位次查询；本表来自公开转载的2024年"
            "文理科一分一段长图，OCR后逐分校验“本分人数+上一档累计=本档累计”。"
        ),
        "tracks": {
            track: {
                key: value
                for key, value in parsed.items()
                if key != "rows"
            }
            for track, parsed in parsed_tracks.items()
        },
    },
    "rows": [
        {
            "score": score,
            "physicsRank": rank_maps["physics"].get(score),
            "historyRank": rank_maps["history"].get(score),
        }
        for score in all_scores
    ],
}

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(
    f"Wrote {OUTPUT_PATH}: "
    f"{len(parsed_tracks['history']['rows'])} history rows, "
    f"{len(parsed_tracks['physics']['rows'])} physics rows."
)
