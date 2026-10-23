import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAdmissionIndex, rankAdvisorMatches } from "../rank-engine.js";
import { filterMajorMatches } from "../rank-results.js";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const manifest = read("data/admissions/sources.json");
const catalog = read("data/admissions/index.json");
const expectedCounts = { 河北省: 26341, 辽宁省: 14946, 浙江省: 23554, 山东省: 23747, 湖北省: 4693 };
const payloads = new Map(Object.keys(expectedCounts).map((province) => [
  province, read(`data/admissions/provinces/${province}.json`),
]));

test("2026 update retains five verified provincial datasets with original source hashes and years", () => {
  for (const [province, count] of Object.entries(expectedCounts)) {
    const payload = payloads.get(province);
    const records = payload.records.filter((record) => record.year === 2026);
    assert.equal(records.length, count, province);
    assert.ok(payload.records.some((record) => record.year === 2025), `${province}: historical fallback retained`);
    const registered = manifest.provinces.find((entry) => entry.province === province);
    for (const source of payload.sources.filter((source) => source.year === 2026)) {
      const config = registered.sources.find((entry) => entry.id === source.id);
      const bytes = readFileSync(new URL(`../data/admissions/raw/${source.id}.${config.format}`, import.meta.url));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.id);
      assert.equal(records.filter((record) => record.sourceId === source.id).length, source.importedRecords);
      if (config.rankMapPath) assert.equal(read(config.rankMapPath).meta.year, 2026, source.id);
    }
    assert.ok(records.every((record) => record.dataType === "official" && record.minRank > 0 && record.province === province));
  }
});

test("Hubei 2026 rank 80000 includes current groups, retains named majors and stays sorted", () => {
  const schoolData = read("data/schools.json");
  const matches = rankAdvisorMatches(
    [...schoolData.schools, ...(schoolData.admissionSchools || [])], "湖北省", 80000, "physics",
    buildAdmissionIndex(payloads.get("湖北省"), catalog), { targetProvinces: ["湖北省"] },
  );
  assert.ok(matches.some((match) => match.sourceYear === 2026 && match.major.name.includes("院校专业组")));
  assert.ok(matches.some((match) => match.sourceYear === 2025));
  assert.ok(matches.every((match) => match.requiredRank >= 80000));
  for (let index = 1; index < matches.length; index += 1) {
    assert.ok(matches[index - 1].lineScore >= matches[index].lineScore, `score rose at ${index}`);
  }
  const electrical = filterMajorMatches(matches, "电气");
  assert.equal(electrical.length, 13);
  assert.ok(electrical.every((match) => match.major.name.includes("电气")));
});

test("Hubei cumulative ranks match university-reported ranks and exclude unmapped or restricted groups", () => {
  const payload = payloads.get("湖北省");
  const table = read("data/admissions/reference/hubei-2026-score-ranks.json");
  const ranks = new Map(table.rows.map((row) => [row.score, row]));
  assert.equal(ranks.get(529).physicsRank, 79534);
  assert.equal(ranks.get(528).physicsRank, 80377);
  const university = payload.records.filter((record) => record.sourceId === "ncwu-2026-hubei-major");
  assert.equal(university.length, 14);
  for (const record of university) assert.equal(record.minRank, ranks.get(record.minScore).physicsRank);
  const groups = payload.records.filter((record) => record.sourceId.startsWith("hubei-2026-"));
  assert.ok(!groups.some((record) => record.id.endsWith(":A00305") && record.track === "history"));
  assert.ok(groups.every((record) => !/专项|民族班|预科|定向/.test(record.subjectRequirement)));
  for (const track of ["physics", "history"]) {
    const rows = table.rows.filter((row) => row[`${track}Rank`] > 0);
    for (let index = 1; index < rows.length; index += 1) {
      assert.equal(rows[index][`${track}Rank`], rows[index - 1][`${track}Rank`] + rows[index][`${track}Count`]);
    }
  }
});

test("Hebei highest-band records survive query mapping with their specific rank explanation", () => {
  const schoolData = read("data/schools.json");
  const matches = rankAdvisorMatches(
    [...schoolData.schools, ...(schoolData.admissionSchools || [])], "河北省", 1, "history",
    buildAdmissionIndex(payloads.get("河北省"), catalog),
  );
  for (const [school, score] of [["北京大学", 673], ["清华大学", 684]]) {
    const match = matches.find((item) => item.school.name === school && item.lineScore === score && item.sourceYear === 2026);
    assert.ok(match, school);
    assert.equal(match.requiredRank, 31);
    assert.match(match.rankNote, /合并档/);
  }
});

test("Shandong missing scores remain absent in source data and the generated major index", () => {
  const records = payloads.get("山东省").records.filter((record) => record.year === 2026);
  assert.ok(records.every((record) => record.minScore === null));
  const majorIndex = read("data/admissions/major-index.json");
  const lines = Object.values(majorIndex.schools).flat().filter((line) => line.p === "山东省" && line.y === 2026);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => line.s === null));
});
