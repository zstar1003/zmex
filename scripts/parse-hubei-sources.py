import hashlib
import json
import re
import urllib.request
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "admissions" / "raw"
EXTRACTED_DIR = ROOT / "data" / "admissions" / "extracted"
REFERENCE_DIR = ROOT / "data" / "admissions" / "reference"

GROUP_SOURCES = {
    "history": {
        "id": "hubei-2025-undergraduate-history-group",
        "url": "http://img.yun.cnhubei.com/a/10001/202507/03988cebd5a307c88b5bbea85558a0a1.pdf?201907201994",
    },
    "physics": {
        "id": "hubei-2025-undergraduate-physics-group",
        "url": "http://img.yun.cnhubei.com/a/10001/202507/f95c7a539db06a7f655467cccecca4c3.pdf?201907201994",
    },
}

RANK_IMAGE_SOURCES = {
    "physics": "https://www.hbea.edu.cn/files/2025-06/021.jpg",
    "history": "https://www.hbea.edu.cn/files/2025-06/031.jpg",
}

PHYSICS_RANKS = {
    691: 25, 690: 30, 689: 34, 688: 37, 687: 42, 686: 50, 685: 60, 684: 72, 683: 85,
    682: 101, 681: 112, 680: 128, 679: 138, 678: 152, 677: 170, 676: 192, 675: 213,
    674: 245, 673: 272, 672: 302, 671: 334, 670: 373, 669: 413, 668: 447, 667: 484,
    666: 525, 665: 565, 664: 630, 663: 685, 662: 737, 661: 807, 660: 885, 659: 952,
    658: 1029, 657: 1105, 656: 1186, 655: 1274, 654: 1350, 653: 1446, 652: 1534,
    651: 1632, 650: 1730, 649: 1831, 648: 1921, 647: 2062, 646: 2178, 645: 2300,
    644: 2456, 643: 2602, 642: 2747, 641: 2890, 640: 3037, 639: 3202, 638: 3375,
    637: 3538, 636: 3744, 635: 3916, 634: 4125, 633: 4337, 632: 4535, 631: 4747,
    630: 4962, 629: 5179, 628: 5410, 627: 5619, 626: 5869, 625: 6109, 624: 6373,
    623: 6590, 622: 6845, 621: 7130, 620: 7436, 619: 7700, 618: 7990, 617: 8292,
    616: 8567, 615: 8880, 614: 9153, 613: 9448, 612: 9749, 611: 10072, 610: 10394,
    609: 10764, 608: 11107, 607: 11457, 606: 11838, 605: 12252, 604: 12636,
    603: 13014, 602: 13442, 601: 13848, 600: 14274, 599: 14688, 598: 15137,
    597: 15562, 596: 16067, 595: 16516, 594: 16966, 593: 17446, 592: 17921,
    591: 18418, 590: 18888, 589: 19378, 588: 19885, 587: 20410, 586: 20901,
    585: 21489, 584: 22070, 583: 22609, 582: 23168, 581: 23725, 580: 24295,
    579: 24832, 578: 25417, 577: 25989, 576: 26551, 575: 27123,
}

HISTORY_RANKS = {
    673: 17, 672: 19, 671: 22, 669: 27, 668: 30, 667: 34, 666: 38, 665: 42,
    664: 48, 663: 56, 662: 61, 661: 64, 660: 68, 659: 75, 658: 81, 657: 89,
    656: 94, 655: 102, 654: 114, 653: 125, 652: 135, 651: 151, 650: 159,
    649: 181, 648: 196, 647: 209, 646: 223, 645: 242, 644: 262, 643: 288,
    642: 306, 641: 338, 640: 363, 639: 389, 638: 416, 637: 442, 636: 467,
    635: 503, 634: 535, 633: 568, 632: 609, 631: 646, 630: 696, 629: 750,
    628: 797, 627: 845, 626: 905, 625: 959, 624: 1026, 623: 1089, 622: 1149,
    621: 1217, 620: 1275, 619: 1346, 618: 1409, 617: 1485, 616: 1552,
    615: 1644, 614: 1711, 613: 1786, 612: 1874, 611: 1961, 610: 2070,
    609: 2156, 608: 2251, 607: 2340, 606: 2441, 605: 2569, 604: 2690,
    603: 2796, 602: 2921, 601: 3040, 600: 3166, 599: 3324, 598: 3467,
    597: 3621, 596: 3769, 595: 3911, 594: 4070, 593: 4222, 592: 4379,
    591: 4516, 590: 4675, 589: 4835, 588: 5034, 587: 5213, 586: 5391,
    585: 5552, 584: 5746, 583: 5937, 582: 6142, 581: 6337, 580: 6531,
    579: 6717, 578: 6912, 577: 7128, 576: 7331, 575: 7551, 574: 7759,
    573: 7979, 572: 8210, 571: 8422, 570: 8641, 569: 8865, 568: 9108,
    567: 9317, 566: 9556, 565: 9820, 564: 10069, 563: 10316, 562: 10567,
    561: 10797, 560: 11025, 559: 11300, 558: 11565, 557: 11848, 556: 12119,
}


def download(url, target):
    if target.exists():
        return target.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    target.write_bytes(data)
    return data


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def clean_number(value):
    digits = re.sub(r"\D", "", value or "")
    return int(digits) if digits else None


def parse_group_line(line):
    tokens = line.split()
    if len(tokens) < 5 or not re.fullmatch(r"[A-Z]\d{5}", tokens[0]):
        return None
    score_index = next(
        (
            index
            for index, token in enumerate(tokens[2:], start=2)
            if re.fullmatch(r"\d{3}", token) and 100 <= int(token) <= 750
        ),
        None,
    )
    if score_index is None:
        return None

    group_tokens = []
    group_end = None
    for index, token in enumerate(tokens[1:score_index], start=1):
        group_tokens.append(token)
        if "组" in token:
            group_end = index
            break
    if group_end is None:
        return None

    subject_tokens = tokens[group_end + 1 : score_index]
    valid_subjects = {
        "不限",
        "化",
        "政",
        "地",
        "生",
        "化和生",
        "化或生",
        "政和地",
        "化和地",
        "生和地",
        "政或地",
        "生或地",
    }
    subject = next((token for token in reversed(subject_tokens) if token in valid_subjects), None)
    if not subject:
        subject = subject_tokens[-1] if subject_tokens else ""

    return {
        "groupCode": tokens[0],
        "groupName": "".join(group_tokens),
        "schoolName": re.sub(r"第\d+组$", "", "".join(group_tokens)),
        "subjectRequirement": subject,
        "minScore": int(tokens[score_index]),
        "volunteerNo": clean_number(tokens[-1]),
    }


def parse_group_pdf(path, track):
    records = []
    with pdfplumber.open(path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            for line in text.splitlines():
                line = " ".join(line.split())
                record = parse_group_line(line)
                if not record:
                    continue
                record.update(
                    {
                        "track": track,
                        "sourcePage": page_index,
                        "sourceLine": line,
                    }
                )
                records.append(
                    record
                )
    return records


def write_group_extracts():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    for track, source in GROUP_SOURCES.items():
        raw_path = RAW_DIR / f"{source['id']}.pdf"
        data = download(source["url"], raw_path)
        records = parse_group_pdf(raw_path, track)
        out_path = EXTRACTED_DIR / f"{source['id']}.json"
        out_path.write_text(
            json.dumps(
                {
                    "meta": {
                        "province": "湖北省",
                        "year": 2025,
                        "track": track,
                        "sourceUrl": source["url"],
                        "sourceSha256": sha256(data),
                        "recordCount": len(records),
                    },
                    "records": records,
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {len(records)} Hubei {track} group lines to {out_path.relative_to(ROOT)}")


def write_rank_reference():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    rank_sources = {}
    for track, url in RANK_IMAGE_SOURCES.items():
        raw_path = RAW_DIR / f"hubei-2025-score-ranks-{track}.jpg"
        data = download(url, raw_path)
        rank_sources[track] = {
            "sourceUrl": url,
            "sha256": sha256(data),
            "path": str(raw_path.relative_to(ROOT)),
        }

    scores = sorted(set(PHYSICS_RANKS) | set(HISTORY_RANKS), reverse=True)
    rows = [
        {
            "score": score,
            "physicsRank": PHYSICS_RANKS.get(score, 0),
            "historyRank": HISTORY_RANKS.get(score, 0),
        }
        for score in scores
    ]
    out_path = REFERENCE_DIR / "hubei-2025-score-ranks.json"
    out_path.write_text(
        json.dumps(
            {
                "meta": {
                    "province": "湖北省",
                    "year": 2025,
                    "authority": "湖北省教育考试院",
                    "pageUrl": "https://www.hbea.edu.cn/html/2025-06/15292.html",
                    "rankDefinition": "对应分数档次的官方累计人数，作为同分考生位次上限",
                    "extraction": "湖北省教育考试院一分一段图片高分段人工转录；仅用于补充官方院校专业组高位投档线。",
                    "tracks": {
                        "physics": {
                            "minScore": min(PHYSICS_RANKS),
                            "maxScore": max(PHYSICS_RANKS),
                            **rank_sources["physics"],
                        },
                        "history": {
                            "minScore": min(HISTORY_RANKS),
                            "maxScore": max(HISTORY_RANKS),
                            **rank_sources["history"],
                        },
                    },
                },
                "rows": rows,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} Hubei rank rows to {out_path.relative_to(ROOT)}")


write_group_extracts()
write_rank_reference()
