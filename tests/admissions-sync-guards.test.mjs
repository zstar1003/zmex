import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompleteRefresh,
  assertNoYearDowngrade,
  assertSourceRecordYears,
  isSameYearCache,
  parseSyncYear,
  sameYearReference
} from "../scripts/admissions-sync-guards.mjs";

const province = "湖北省";
const complete = {
  meta: { year: 2025, indexEntry: { source: { year: 2025, failedFileCount: 0 } } },
  records: [{ year: 2025 }, { year: 2025 }]
};

test("sync requires an explicit valid year instead of silently importing 2024", () => {
  for (const args of [[], ["--year="], ["--year=foo"], ["--year=2025.5"], ["--year=1999"], ["--year=2027"]]) {
    assert.throws(() => parseSyncYear(args, 2026), /明确指定有效年份/);
  }
  assert.equal(parseSyncYear(["--year=2025"], 2026), 2025);
});

test("cached provinces are reused only for the same year and complete records", () => {
  assert.equal(isSameYearCache(complete, 2025), true);
  assert.equal(isSameYearCache(complete, 2026), false);
  assert.equal(isSameYearCache({ ...complete, records: [{ year: 2024 }] }, 2025), false);
  assert.equal(isSameYearCache({ ...complete, records: [] }, 2025), false);
  assert.equal(isSameYearCache({ ...complete, meta: { ...complete.meta, failedRequests: [{}] } }, 2025), false);
  assert.equal(isSameYearCache(null, 2025), false);
});

test("a refresh cannot downgrade a newer dataset even if its metadata is stale", () => {
  assert.throws(() => assertNoYearDowngrade(complete, 2024, province), /拒绝/);
  assert.throws(() => assertNoYearDowngrade({ ...complete, records: [{ year: 2026 }] }, 2025, province), /2026/);
  assert.doesNotThrow(() => assertNoYearDowngrade(complete, 2025, province));
  assert.doesNotThrow(() => assertNoYearDowngrade(null, 2025, province));
});

test("missing or failed responses cannot replace published data, even with a drop override", () => {
  assert.throws(() => assertCompleteRefresh({ province, records: [], failed: [] }), /没有可用/);
  assert.throws(() => assertCompleteRefresh({ province, records: complete.records, failed: [{ error: "timeout" }], allowRecordDrop: true }), /timeout/);
});

test("a loss of more than 20 percent of records needs an explicit override", () => {
  const refresh = { province, records: Array(79).fill({}), failed: [], previousCount: 100 };
  assert.throws(() => assertCompleteRefresh(refresh), /--allow-record-drop/);
  assert.doesNotThrow(() => assertCompleteRefresh({ ...refresh, allowRecordDrop: true }));
  assert.doesNotThrow(() => assertCompleteRefresh({ ...refresh, records: Array(80).fill({}) }));
});

test("score mappings and estimates never reuse another year's reference", () => {
  const mapping = { meta: { year: 2024 }, rows: [] };
  const estimate = { year: 2024, candidateCount: 36000 };
  assert.equal(sameYearReference(mapping, 2025), null);
  assert.equal(sameYearReference(estimate, 2025), null);
  assert.equal(sameYearReference(mapping, 2024), mapping);
  assert.equal(sameYearReference(estimate, 2024), estimate);
  assert.equal(sameYearReference(null, 2025), null);
});

test("provider files with a mismatched year are rejected instead of relabelled", () => {
  assert.throws(() => assertSourceRecordYears([{ year: "2024" }], 2025), /源记录包含 2024/);
  assert.doesNotThrow(() => assertSourceRecordYears([{ year: "2025" }, {}], 2025));
});
