#!/usr/bin/env python3
"""Parse reviewed university admission tables from saved HTML, without networking."""

import argparse
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/admissions/updates/hubei-2026-university-sources.json"


class AdmissionTables(HTMLParser):
    """Retain cell spans so merged batch and subject cells apply to each row."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.depth = 0
        self.rows = None
        self.cells = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.rows = []
        elif self.depth == 1 and tag == "tr":
            self.cells = []
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = {
                "text": [],
                "rowspan": int(attrs.get("rowspan", "1")),
                "colspan": int(attrs.get("colspan", "1")),
            }

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"].append(data)

    def handle_endtag(self, tag):
        if self.depth == 1 and tag in ("td", "th") and self.cell is not None:
            self.cell["text"] = re.sub(r"\s+", "", "".join(self.cell["text"]))
            self.cells.append(self.cell)
            self.cell = None
        elif self.depth == 1 and tag == "tr" and self.cells is not None:
            self.rows.append(self.cells)
            self.cells = None
        elif tag == "table":
            if self.depth == 1:
                self.tables.append(expand_spans(self.rows))
                self.rows = None
            self.depth -= 1


def expand_spans(rows):
    grid = {}
    for row_index, cells in enumerate(rows):
        column = 0
        for cell in cells:
            while (row_index, column) in grid:
                column += 1
            if cell["rowspan"] < 1 or cell["colspan"] < 1:
                raise ValueError("Unsupported non-positive table span")
            for r in range(row_index, row_index + cell["rowspan"]):
                for c in range(column, column + cell["colspan"]):
                    if (r, c) in grid:
                        raise ValueError("Overlapping table spans")
                    grid[r, c] = cell["text"]
            column += cell["colspan"]
    width = max((c for _, c in grid), default=-1) + 1
    return [[grid.get((r, c), "") for c in range(width)] for r in range(len(rows))]


def positive_integer(value, label):
    if not re.fullmatch(r"[0-9]+", value) or int(value) <= 0:
        raise ValueError(f"Invalid {label}: {value!r}")
    return int(value)


def parse_source(source):
    raw_bytes = (ROOT / source["rawPath"]).read_bytes()
    digest = hashlib.sha256(raw_bytes).hexdigest()
    if digest != source["sha256"]:
        raise ValueError(f"{source['id']}: source hash changed; review the new source before importing")
    html = raw_bytes.decode("utf-8")
    if source["title"] not in html:
        raise ValueError(f"{source['id']}: expected title/year not found")
    parser = AdmissionTables()
    parser.feed(html)
    columns = ["批次", "科类", "专业", "计划人数", "录取人数", "录取最高分", "录取最低分", "平均分", "省控线", "最低分分差", "最低分位次"]
    tables = [table for table in parser.tables if table and table[0] == columns]
    if len(tables) != 1:
        raise ValueError(f"{source['id']}: expected exactly one matching admission table")
    records = []
    identities = set()
    for row in tables[0][1:]:
        if len(row) != len(columns):
            raise ValueError(f"{source['id']}: incorrect column count")
        cells = dict(zip(columns, row))
        track = {"理/物理": "physics", "文/历史": "history"}.get(cells["科类"])
        major = cells["专业"]
        if not track or not major or cells["批次"] != "本科批":
            raise ValueError(f"{source['id']}: unsupported subject, batch or missing major")
        identity = (track, major)
        if identity in identities:
            raise ValueError(f"{source['id']}: duplicate major {identity}")
        identities.add(identity)
        records.append({
            "schoolName": source["schoolName"],
            "majorName": major,
            "minScore": positive_integer(cells["录取最低分"], "minimum score"),
            "minRank": positive_integer(cells["最低分位次"], "minimum rank"),
            "track": track,
            "planCount": positive_integer(cells["计划人数"], "plan count"),
            "batch": cells["批次"],
            "subjectRequirement": None,
            "sourcePage": source["pageUrl"],
            "sourceUrl": source["pageUrl"],
            "admissionType": "中外合作办学" if "中外合作办学" in major else "普通类",
        })
    if len(records) != source["expectedRecords"]:
        raise ValueError(f"{source['id']}: expected {source['expectedRecords']} rows, got {len(records)}")
    output = {
        "meta": {
            "year": source["year"],
            "sourceUrl": source["pageUrl"],
            "sourceSha256": digest,
            "publishedAt": source["publishedAt"],
            "recordCount": len(records),
            "rankMethod": "official-min-rank",
            "note": "最低位次直接取自学校同年实际专业录取表；未用其他年份分数段换算。",
        },
        "records": records,
    }
    target = ROOT / source["parsePath"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{source['id']}: {len(records)} records -> {target.relative_to(ROOT)}")


def main():
    args_parser = argparse.ArgumentParser(description=__doc__)
    args_parser.add_argument("--source", help="Parse only the specified reviewed source id")
    args = args_parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sources = [source for source in manifest["sources"] if source["status"] == "available"]
    if args.source:
        sources = [source for source in sources if source["id"] == args.source]
    if not sources:
        raise ValueError("No matching available source")
    for source in sources:
        parse_source(source)


if __name__ == "__main__":
    main()
