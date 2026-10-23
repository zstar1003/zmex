import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAdmissionIndex, rankAdvisorMatches } from "../rank-engine.js";

function school(id, overrides = {}) {
  return {
    id,
    name: `院校${id}`,
    province: "湖北省",
    tags: { is985: false, is211: false, doubleFirstClass: false },
    ...overrides,
  };
}

function record(schoolId, majorName, minScore, minRank, overrides = {}) {
  return {
    schoolId,
    majorName,
    minScore,
    minRank,
    province: "湖北省",
    track: "physics",
    year: 2025,
    batch: "本科普通批",
    dataType: "official",
    ...overrides,
  };
}

function query(schools, records, options = {}) {
  return rankAdvisorMatches(
    schools, "湖北省", 80000, "physics", buildAdmissionIndex({ records }), options,
  );
}

test("a school's third and later programs stay in global score order", () => {
  const results = query([school("a"), school("b")], [
    record("a", "专业一", 507, 80494),
    record("a", "专业二", 506, 81000),
    record("a", "专业三", 505, 82000),
    record("a", "专业四", 504, 83000),
    record("b", "专业一", 440, 137777),
  ]);
  assert.deepEqual(results.map((item) => item.lineScore), [507, 506, 505, 504, 440]);
  assert.equal(results.length, 5);
});

test("scores take priority over inconsistent source ranks; missing scores go last", () => {
  const results = query([school("a")], [
    record("a", "较低分", 493, 93246),
    record("a", "较高分", 494, 93255),
    record("a", "同分更好位次", 494, 93250),
    record("a", "缺失分数", null, 80000),
    record("a", "未提供分数", undefined, 81000),
    record("a", "非有限分数", Infinity, 82000),
    record("a", "位次不满足", 600, 79999),
  ]);
  assert.deepEqual(results.map((item) => item.major.name), [
    "同分更好位次", "较高分", "较低分", "缺失分数", "未提供分数", "非有限分数",
  ]);
});

test("ties remain deterministic across reordered input schools and records", () => {
  const schools = [school("a"), school("b", { recommendation: { score: 90 } })];
  const records = [
    record("a", "计算机", 500, 85000),
    record("a", "电气", 500, 85000),
    record("b", "机械", 500, 85000),
  ];
  const keys = (items) => items.map((item) => `${item.school.id}:${item.major.name}`);
  assert.deepEqual(keys(query(schools, records)), keys(query([...schools].reverse(), [...records].reverse())));
  assert.equal(query(schools, records)[0].school.id, "b");
});

test("deduplication keeps all unique programs and existing source selection", () => {
  const a = school("a");
  const results = query([a, a], [
    record("a", "专业一", 510, 80000, { year: 2024 }),
    record("a", "专业一", 499, 90000, { dataType: "aggregated" }),
    record("a", "专业一", 500, 89000),
    record("a", "专业二", 490, 95000),
    record("a", "专业三", 480, 100000),
  ]);
  assert.deepEqual(results.map((item) => item.lineScore), [500, 490, 480]);
  assert.equal(results[0].sourceYear, 2025);
  assert.equal(results[0].dataType, "official");
});

test("rank, track, and destination filters retain their original boundaries", () => {
  const results = query([school("a"), school("b", { province: "湖南省" })], [
    record("a", "恰好满足", 507, 80000),
    record("a", "位次不足", 508, 79999),
    record("a", "科类不符", 520, 90000, { track: "history" }),
    record("b", "所在地不符", 510, 82000),
  ], { targetProvinces: ["湖北省"] });
  assert.deepEqual(results.map((item) => item.major.name), ["恰好满足"]);
});

test("historical 2025 Hubei rank 80000 query keeps all 576 results descending across pages", () => {
  const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const data = readJson("../data/schools.json");
  const payload = readJson("../data/admissions/provinces/湖北省.json");
  // Keep the original bug reproduction stable while newer admission years are added.
  payload.records = payload.records.filter((record) => record.year === 2025);
  const catalog = readJson("../data/admissions/index.json");
  const results = rankAdvisorMatches(
    [...data.schools, ...(data.admissionSchools || [])],
    "湖北省", 80000, "physics", buildAdmissionIndex(payload, catalog),
    { targetProvinces: ["湖北省"] },
  );
  assert.equal(results.length, 576);
  assert.equal(results[0].lineScore, 507);
  assert.equal(results.at(-1).lineScore, 426);
  assert.equal(results.filter((item) => item.major.name.includes("电气")).length, 13);
  for (let index = 1; index < results.length; index += 1) {
    assert.ok(results[index - 1].lineScore >= results[index].lineScore, `score rose at result ${index + 1}`);
  }
  assert.equal(new Set(results.map((item) => `${item.school.id}::${item.major.name}`)).size, 576);
});
