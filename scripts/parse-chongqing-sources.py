#!/usr/bin/env python3
import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "admissions" / "raw"
EXTRACTED_DIR = ROOT / "data" / "admissions" / "extracted"
REFERENCE_DIR = ROOT / "data" / "admissions" / "reference"

TRACKS = {
    "history": {
        "pdf": RAW_DIR / "chongqing-2025-undergraduate-history.pdf",
        "rankHtml": RAW_DIR / "chongqing-2025-score-ranks-history.html",
        "sourceUrl": "https://www.cqksy.cn/uploadFile/infopub/202507/1947199599647662080.pdf",
        "rankUrl": "https://www.cqksy.cn/uploadFile/infopub/2025/pg/yfd/wk.htm",
    },
    "physics": {
        "pdf": RAW_DIR / "chongqing-2025-undergraduate-physics.pdf",
        "rankHtml": RAW_DIR / "chongqing-2025-score-ranks-physics.html",
        "sourceUrl": "https://www.cqksy.cn/uploadFile/infopub/202507/1947199748985856000.pdf",
        "rankUrl": "https://www.cqksy.cn/uploadFile/infopub/2025/pg/yfd/lk.htm",
    },
}


def sorted_text(chars):
    return "".join(
        char["text"]
        for char in sorted(chars, key=lambda item: (round(item["top"], 1), item["x0"]))
    ).strip()


def extract_programs(path):
    records = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            tables = page.find_tables()
            if not tables:
                raise ValueError(f"{path.name}: page {page_number} has no table")

            for row_number, row in enumerate(tables[0].rows[2:], start=2):
                cells = [cell for cell in row.cells if cell]
                top = min(cell[1] for cell in cells)
                bottom = max(cell[3] for cell in cells)
                chars = [
                    char
                    for char in page.chars
                    if char["size"] < 20
                    and char["top"] >= top - 0.2
                    and char["bottom"] <= bottom + 0.2
                ]

                school_code = sorted_text(
                    [char for char in chars if 37 <= char["x0"] and char["x1"] <= 68.6]
                )
                major_code_chars = [
                    char
                    for char in chars
                    if 190 <= char["x0"]
                    and char["x1"] <= 236.3
                    and re.fullmatch(r"[A-Z0-9]", char["text"])
                ]
                major_code_char_ids = {id(char) for char in major_code_chars}
                school_name = sorted_text(
                    [
                        char
                        for char in chars
                        if 68.4 <= char["x0"]
                        and char["x1"] <= 236.3
                        and id(char) not in major_code_char_ids
                    ]
                )
                major_code = sorted_text(major_code_chars)
                major_name = sorted_text(
                    [char for char in chars if 236 <= char["x0"] and char["x1"] <= 396]
                )
                score_text = sorted_text(
                    [char for char in chars if 395.5 <= char["x0"] and char["x1"] <= 433.7]
                )
                score_digits = "".join(re.findall(r"\d", score_text))

                if not (
                    re.fullmatch(r"[A-Z0-9]{4}", school_code)
                    and re.fullmatch(r"[A-Z0-9]{3}", major_code)
                    and len(score_digits) == 3
                    and school_name
                    and major_name
                ):
                    raise ValueError(
                        f"{path.name}: malformed row at page {page_number}, row {row_number}"
                    )

                records.append(
                    {
                        "schoolCode": school_code,
                        "schoolName": school_name,
                        "majorCode": major_code,
                        "majorName": major_name,
                        "minScore": int(score_digits),
                        "sourcePage": page_number,
                    }
                )
    return records


class RankTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.current_row = None
        self.current_cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.current_row = []
        elif tag == "td" and self.current_row is not None:
            self.current_cell = []

    def handle_data(self, data):
        if self.current_cell is not None:
            self.current_cell.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.current_cell is not None:
            self.current_row.append("".join(self.current_cell).strip())
            self.current_cell = None
        elif tag == "tr" and self.current_row is not None:
            if self.current_row:
                self.rows.append(self.current_row)
            self.current_row = None


def extract_ranks(path):
    parser = RankTableParser()
    parser.feed(path.read_text(encoding="utf-8"))
    if not parser.rows or len(parser.rows[0]) != 2:
        raise ValueError(f"{path.name}: top combined score band is missing")

    top_band_score = int(re.search(r"\d+", parser.rows[0][0]).group())
    top_band_rank = int(parser.rows[0][1])
    rows = [{"score": top_band_score, "count": top_band_rank, "cumulative": top_band_rank}]
    previous_cumulative = top_band_rank
    previous_score = top_band_score

    for raw_row in parser.rows[1:]:
        if len(raw_row) != 3:
            raise ValueError(f"{path.name}: malformed score row {raw_row}")
        score, count, cumulative = map(int, raw_row)
        if score >= previous_score:
            raise ValueError(f"{path.name}: score order breaks at {score}")
        if cumulative - previous_cumulative != count:
            raise ValueError(f"{path.name}: cumulative count breaks at {score}")
        rows.append({"score": score, "count": count, "cumulative": cumulative})
        previous_score = score
        previous_cumulative = cumulative

    return {
        "topBandMinScore": top_band_score,
        "topBandRank": top_band_rank,
        "rows": rows,
    }


EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
REFERENCE_DIR.mkdir(parents=True, exist_ok=True)

programs = {}
ranks = {}
for track, config in TRACKS.items():
    programs[track] = extract_programs(config["pdf"])
    ranks[track] = extract_ranks(config["rankHtml"])
    output_path = EXTRACTED_DIR / f"chongqing-2025-undergraduate-{track}.json"
    output_path.write_text(
        json.dumps(
            {
                "meta": {
                    "province": "重庆市",
                    "year": 2025,
                    "track": track,
                    "sourceUrl": config["sourceUrl"],
                    "extraction": "按官方PDF表格行坐标提取，逐行校验院校代码、专业代码和最低分格式",
                    "recordCount": len(programs[track]),
                },
                "records": programs[track],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

score_rows = []
for score in range(750, 179, -1):
    row = {"score": score}
    for track in ("physics", "history"):
        track_rank = ranks[track]
        exact_ranks = {
            item["score"]: item["cumulative"] for item in track_rank["rows"]
        }
        rank = (
            track_rank["topBandRank"]
            if score >= track_rank["topBandMinScore"]
            else exact_ranks.get(score, 0)
        )
        row[f"{track}Rank"] = rank
    score_rows.append(row)

rank_output = REFERENCE_DIR / "chongqing-2025-score-ranks.json"
rank_output.write_text(
    json.dumps(
        {
            "meta": {
                "province": "重庆市",
                "year": 2025,
                "authority": "重庆市教育考试院",
                "pageUrl": "https://www.cqksy.cn/uploadFile/infopub/2025/pg/yfd/fdb.htm",
                "physicsSourceUrl": TRACKS["physics"]["rankUrl"],
                "historySourceUrl": TRACKS["history"]["rankUrl"],
                "rankDefinition": "对应分数档次的官方累计人数，作为同分考生位次上限",
                "topBandNote": (
                    f"物理类{ranks['physics']['topBandMinScore']}分及以上合并为"
                    f"{ranks['physics']['topBandRank']}名以内；"
                    f"历史类{ranks['history']['topBandMinScore']}分及以上合并为"
                    f"{ranks['history']['topBandRank']}名以内。"
                ),
                "extraction": "直接解析重庆市教育考试院官方HTML表格，并校验逐分人数与累计人数递推关系",
            },
            "rows": score_rows,
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)

print(
    "Wrote Chongqing sources with "
    f"{len(programs['history'])} history and {len(programs['physics'])} physics program lines."
)
