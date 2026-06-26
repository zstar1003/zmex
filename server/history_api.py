#!/usr/bin/env python3
import json
import os
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


LISTEN_HOST = os.environ.get("HISTORY_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("HISTORY_LISTEN_PORT", "18182"))
YEARS = [2021, 2022, 2023, 2024, 2025]
TRACK_BY_TYPE = {
    "1": "physics",
    "2": "history",
    "3": "general",
    "2073": "physics",
    "2074": "history",
}
USER_AGENT = "Mozilla/5.0 (compatible; ZemuErqi-History/1.0)"

cache = {}


def positive_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return int(number) if number.is_integer() else number


def normalize_name(value):
    return re.sub(r"\s+", "", str(value or "").strip().replace("（", "(").replace("）", ")"))


def flatten_provider_records(payload):
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    records = []
    for group in data.values():
        if isinstance(group, dict) and isinstance(group.get("item"), list):
            records.extend(group["item"])
    return records


def fetch_provider_rows(endpoint, school_id, year, province_code):
    source_url = (
        f"https://static-data.gaokao.cn/www/2.0/{endpoint}/"
        f"{school_id}/{year}/{province_code}.json"
    )
    request = urllib.request.Request(source_url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return {"sourceUrl": source_url, "status": 200, "rows": flatten_provider_records(payload)}
    except urllib.error.HTTPError as error:
        return {"sourceUrl": source_url, "status": error.code, "rows": []}


def create_plan_lookup(plan_rows):
    by_exact = {}
    normalized_plans = []
    for item in plan_rows:
        track = TRACK_BY_TYPE.get(str(item.get("type")), "general")
        major_name = str(item.get("spname") or item.get("sp_name") or "").strip()
        plan_count = positive_number(item.get("num"))
        if not major_name or not plan_count:
            continue
        entry = {
            "track": track,
            "normalized": normalize_name(major_name),
            "planCount": plan_count,
        }
        by_exact.setdefault(f"{track}:{entry['normalized']}", []).append(entry)
        normalized_plans.append(entry)
    return {"byExact": by_exact, "normalizedPlans": normalized_plans}


def find_plan_count(plan_lookup, track, major_name):
    normalized = normalize_name(major_name)
    exact = plan_lookup["byExact"].get(f"{track}:{normalized}", [])
    if len(exact) == 1:
        return exact[0]["planCount"]

    prefix_matches = [
        entry
        for entry in plan_lookup["normalizedPlans"]
        if entry["track"] == track and entry["normalized"].startswith(f"{normalized}(")
    ]
    return prefix_matches[0]["planCount"] if len(prefix_matches) == 1 else None


def build_year_payload(school_id, province_code, year):
    score_source, plan_source = (
        fetch_provider_rows("schoolspecialscore", school_id, year, province_code),
        fetch_provider_rows("schoolspecialplan", school_id, year, province_code),
    )
    sources = [
        {
            "year": year,
            "kind": "score",
            "sourceUrl": score_source["sourceUrl"],
            "status": score_source["status"],
            "rawRecordCount": len(score_source["rows"]),
        },
        {
            "year": year,
            "kind": "plan",
            "sourceUrl": plan_source["sourceUrl"],
            "status": plan_source["status"],
            "rawRecordCount": len(plan_source["rows"]),
        },
    ]

    plan_records = []
    for item in plan_source["rows"]:
        track = TRACK_BY_TYPE.get(str(item.get("type")), "general")
        major_name = str(item.get("spname") or item.get("sp_name") or "").strip()
        plan_count = positive_number(item.get("num"))
        if not major_name or not plan_count:
            continue
        plan_records.append(
            {
                "year": year,
                "track": track,
                "majorName": major_name,
                "planCount": plan_count,
                "countSource": "招生计划",
                "batch": str(item.get("local_batch_name") or item.get("batch") or "").strip(),
                "subjectRequirement": str(item.get("sp_info") or item.get("sg_info") or "").strip(),
                "admissionType": str(item.get("zslx_name") or "").strip(),
                "specialGroup": str(item.get("special_group") or "").strip(),
                "sourceUrl": plan_source["sourceUrl"],
            }
        )

    plan_lookup = create_plan_lookup(plan_source["rows"])
    records = []
    imported_record_count = 0
    result_count_known = 0
    plan_matched_count = 0
    for item in score_source["rows"]:
        track = TRACK_BY_TYPE.get(str(item.get("type")), "general")
        major_name = str(item.get("spname") or item.get("sp_name") or "").strip()
        min_score = positive_number(item.get("min"))
        min_rank = positive_number(item.get("min_section"))
        if not major_name or not min_rank:
            continue
        imported_record_count += 1
        result_plan_count = positive_number(item.get("lq_num"))
        matched_plan_count = None if result_plan_count else find_plan_count(plan_lookup, track, major_name)
        if result_plan_count:
            result_count_known += 1
        if matched_plan_count:
            plan_matched_count += 1
        records.append(
            {
                "year": year,
                "track": track,
                "majorName": major_name,
                "minScore": min_score,
                "minRank": min_rank,
                "planCount": result_plan_count or matched_plan_count,
                "countSource": "录取结果" if result_plan_count else "招生计划" if matched_plan_count else None,
                "batch": str(item.get("local_batch_name") or item.get("batch") or "").strip(),
                "subjectRequirement": str(item.get("sp_info") or item.get("sg_info") or "").strip(),
                "admissionType": str(item.get("zslx_name") or "").strip(),
                "specialGroup": str(item.get("special_group") or "").strip(),
                "sourceUrl": score_source["sourceUrl"],
            }
        )

    sources[0]["importedRecordCount"] = imported_record_count
    sources[0]["resultCountKnown"] = result_count_known
    sources[0]["planMatchedCount"] = plan_matched_count
    return {"sources": sources, "records": records, "planRecords": plan_records}


def history_payload(school_id, province_code):
    cache_key = f"{school_id}:{province_code}"
    if cache_key in cache:
        return cache[cache_key]

    sources = []
    records = []
    plan_records = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        for item in executor.map(lambda year: build_year_payload(school_id, province_code, year), YEARS):
            sources.extend(item["sources"])
            records.extend(item["records"])
            plan_records.extend(item["planRecords"])

    payload = {
        "schoolId": school_id,
        "provinceCode": province_code,
        "years": YEARS,
        "sources": sorted(sources, key=lambda item: (item["year"], item["kind"])),
        "planRecords": sorted(
            plan_records,
            key=lambda item: (
                item["year"],
                item["track"],
                -item["planCount"],
                item["majorName"],
            ),
        ),
        "records": sorted(
            records,
            key=lambda item: (
                item["year"],
                item["track"],
                item["minRank"],
                item["majorName"],
            ),
        ),
    }
    cache[cache_key] = payload
    return payload


class HistoryHandler(BaseHTTPRequestHandler):
    server_version = "ZmexHistoryAPI/1.0"

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/api/gaokao-history":
            self.send_error(404)
            return
        query = parse_qs(url.query)
        school_id = query.get("schoolId", [""])[0]
        province_code = query.get("provinceCode", [""])[0]
        if not school_id.isdigit() or not province_code.isdigit():
            self.send_json({"error": "invalid query"}, status=400)
            return
        self.send_json(history_payload(school_id, province_code))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), HistoryHandler).serve_forever()
