import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
const provinces = ["湖北省", "湖南省"];
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

// Run a copy of the real CLI against a tiny isolated project. No production data
// or network is used, and assertions do not depend on the current national totals.
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zmex-official-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(path.join(projectRoot, "scripts/sync-admissions.mjs"), path.join(root, "scripts/sync-admissions.mjs"));
  symlinkSync(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  writeFileSync(path.join(root, "no-network.mjs"), 'globalThis.fetch = async () => { throw new Error("Unexpected network request in fixture"); };\n');
  const admissions = path.join(root, "data/admissions");
  const stage = path.join(root, "staging");
  writeJson(path.join(root, "data/schools.json"), { schools: [{ id: "school-1", name: "测试大学" }] });
  const entries = provinces.map((province, index) => {
    const id = `fixture-${index}`;
    const raw = `<html>Official admissions ${index}</html>`;
    const source = {
      id, year: 2026, status: "available", format: "html", parseFormat: "json",
      parser: "normalized-major-lines", parsePath: `data/admissions/extracted/${id}.json`,
      downloadUrl: `https://example.invalid/${id}`, batch: "普通本科批", granularity: "专业"
    };
    mkdirSync(path.join(admissions, "raw"), { recursive: true });
    writeFileSync(path.join(admissions, `raw/${id}.html`), raw);
    writeJson(path.join(root, source.parsePath), {
      meta: { year: 2026, sourceSha256: createHash("sha256").update(raw).digest("hex") },
      records: [{ schoolName: "测试大学", majorName: "电气工程及其自动化", track: "physics", minScore: 550, minRank: 80000 }]
    });
    const previous = {
      sources: [{ id: `old-${index}`, province, year: 2025 }],
      records: [{ id: `old-${index}`, sourceId: `old-${index}`, province, year: 2025, dataType: "official", schoolId: "school-1", schoolName: "测试大学", majorName: "旧专业", minRank: 85000, minScore: 540, track: "physics" }]
    };
    writeJson(path.join(admissions, `provinces/${province}.json`), previous);
    return { province, authority: "测试考试院", status: "available", sources: [source] };
  });
  const manifest = { policy: {}, provinces: entries };
  writeJson(path.join(admissions, "sources.json"), manifest);
  writeJson(path.join(admissions, "index.json"), {
    provinces: provinces.map((province, index) => ({
      province, dataUrl: `./data/admissions/provinces/${province}.json`,
      sources: [{ id: `old-${index}`, province, year: 2025, sourceRows: 1 }],
    }))
  });
  writeJson(path.join(admissions, "aggregated/index.json"), { provinces: [] });
  function run(args = []) {
    return spawnSync("bun", ["--preload", path.join(root, "no-network.mjs"), path.join(root, "scripts/sync-admissions.mjs"), ...args], {
      cwd: root, encoding: "utf8", timeout: 10000
    });
  }
  function updateParsed(update, index = 0) {
    const file = path.join(root, entries[index].sources[0].parsePath);
    const parsed = json(file);
    update(parsed);
    writeJson(file, parsed);
  }
  return { root, admissions, stage, manifest, run, updateParsed };
}

function success(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("official sync stages output and preserves the other province during a selective refresh", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  const originalIndex = readFileSync(path.join(f.admissions, "index.json"), "utf8");
  const originalA = readFileSync(path.join(f.admissions, `provinces/${provinces[0]}.json`), "utf8");
  success(f.run([`--output-dir=${f.stage}`, `--province=${provinces[0]}`]));
  const result = json(path.join(f.stage, "index.json"));
  assert.equal(result.meta.recordCount, 2);
  assert.equal(result.meta.provinceCount, 2);
  assert.equal(json(path.join(f.stage, `provinces/${provinces[0]}.json`)).records[0].year, 2026);
  assert.equal(json(path.join(f.stage, `provinces/${provinces[1]}.json`)).records[0].year, 2025);
  assert.equal(result.provinces.find((entry) => entry.province === provinces[1]).sources[0].sourceRows, 1);
  assert.equal(readFileSync(path.join(f.admissions, "index.json"), "utf8"), originalIndex);
  assert.equal(readFileSync(path.join(f.admissions, `provinces/${provinces[0]}.json`), "utf8"), originalA);
});

test("successive provincial refreshes preserve earlier updates in the same staging directory", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  success(f.run([`--output-dir=${f.stage}`, `--province=${provinces[0]}`]));
  success(f.run([`--output-dir=${f.stage}`, `--province=${provinces[1]}`]));
  for (const province of provinces) {
    assert.equal(json(path.join(f.stage, `provinces/${province}.json`)).records[0].year, 2026);
  }
});

test("empty output-dir is rejected instead of writing into the production directory", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  const before = readFileSync(path.join(f.admissions, "index.json"), "utf8");
  const result = f.run(["--output-dir="]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(f.admissions, "index.json"), "utf8"), before);
});

const rejections = [
  ["extraction year mismatch", (f) => f.updateParsed((parsed) => { parsed.meta.year = 2025; }), /year mismatch/],
  ["extraction hash mismatch", (f) => f.updateParsed((parsed) => { parsed.meta.sourceSha256 = "incorrect"; }), /does not match/],
  ["empty extraction", (f) => f.updateParsed((parsed) => { parsed.records = []; }), /no valid records/],
  ["invalid normalized record", (f) => f.updateParsed((parsed) => { parsed.records[0].minRank = 0; }), /invalid university record/],
  ["record year mismatch", (f) => f.updateParsed((parsed) => { parsed.records[0].year = 2025; }), /year|invalid university record/],
  ["record province mismatch", (f) => f.updateParsed((parsed) => { parsed.records[0].province = "广东省"; }), /province|invalid university record/],
  ["rank map year mismatch", (f) => {
    const source = f.manifest.provinces[0].sources[0];
    source.rankMapPath = "data/admissions/reference/ranks.json";
    writeJson(path.join(f.root, source.rankMapPath), { meta: { year: 2025 }, rows: [] });
    writeJson(path.join(f.admissions, "sources.json"), f.manifest);
  }, /rank table year mismatch/]
];

for (const [name, modify, expected] of rejections) {
  test(`official sync rejects ${name} without replacing existing output`, { skip: !hasBun }, (t) => {
    const f = fixture(t);
    modify(f);
    const sentinel = { unchanged: true };
    writeJson(path.join(f.stage, "index.json"), sentinel);
    const result = f.run([`--output-dir=${f.stage}`]);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expected);
    assert.deepEqual(json(path.join(f.stage, "index.json")), sentinel);
  });
}

function configureHebei(f, { year = 2026, track = "history", includeTopBands = true } = {}) {
  const entry = f.manifest.provinces[0];
  entry.province = "河北省";
  const source = entry.sources[0];
  Object.assign(source, { year, track, parser: "hebei-major-scores", rankMapPath: "data/admissions/reference/hebei-ranks.json" });
  const topCodedBands = {
    physics: { minScore: 701, rank: 34, sourcePage: 1 },
    history: { minScore: 671, rank: 31, sourcePage: 2 }
  };
  const rankMap = {
    meta: { year, ...(includeTopBands ? { topCodedBands } : {}) },
    rows: [
      { score: 701, physicsRank: 34, historyRank: 0 },
      { score: 700, physicsRank: 36, historyRank: 0 },
      { score: 684, physicsRank: 364, historyRank: 0 },
      { score: 673, physicsRank: 989, historyRank: 0 },
      { score: 671, physicsRank: 1164, historyRank: 31 },
      { score: 670, physicsRank: 1262, historyRank: 36 }
    ]
  };
  writeJson(path.join(f.root, source.rankMapPath), rankMap);
  writeJson(path.join(f.admissions, "sources.json"), f.manifest);
  f.updateParsed((parsed) => {
    parsed.meta.year = year;
    const scores = track === "history" ? [684, 673, 671, 670] : [703, 701, 700];
    parsed.records = [...Array.from({ length: 5 }, () => []), ...scores.map((score, index) => ["01", "测试大学", String(index + 1), `专业${index + 1}`, score])];
  });
  return { rankMap, source };
}

test("Hebei history scores above the published top band retain the official cumulative upper bound", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  configureHebei(f);
  success(f.run([`--output-dir=${f.stage}`]));
  const records = json(path.join(f.stage, "provinces/河北省.json")).records;
  assert.deepEqual(records.map((r) => [r.minScore, r.minRank]), [[684, 31], [673, 31], [671, 31], [670, 36]]);
  assert.ok(records.slice(0, 3).every((r) => /671 分及以上.*累计 31 人.*未公布逐分位次/.test(r.rankNote)));
  assert.doesNotMatch(records[3].rankNote, /合并档/);
});

test("Hebei physics uses its own top band instead of the history threshold", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  configureHebei(f, { track: "physics" });
  success(f.run([`--output-dir=${f.stage}`]));
  const records = json(path.join(f.stage, "provinces/河北省.json")).records;
  assert.deepEqual(records.map((r) => [r.minScore, r.minRank]), [[703, 34], [701, 34], [700, 36]]);
  assert.match(records[0].rankNote, /701 分及以上.*累计 34 人/);
  assert.doesNotMatch(records[2].rankNote, /合并档/);
});

test("Hebei does not invent a top-band mapping for another year without metadata", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  configureHebei(f, { year: 2025, includeTopBands: false });
  success(f.run([`--output-dir=${f.stage}`]));
  const records = json(path.join(f.stage, "provinces/河北省.json")).records;
  assert.deepEqual(records.map((r) => [r.minScore, r.minRank]), [[671, 31], [670, 36]]);
  assert.ok(records.every((r) => !r.rankNote.includes("合并档")));
});

test("Hebei refuses a newer year's top-band reference for older admissions", { skip: !hasBun }, (t) => {
  const f = fixture(t);
  const { source, rankMap } = configureHebei(f, { year: 2025 });
  rankMap.meta.year = 2026;
  writeJson(path.join(f.root, source.rankMapPath), rankMap);
  const sentinel = { unchanged: true };
  writeJson(path.join(f.stage, "index.json"), sentinel);
  const result = f.run([`--output-dir=${f.stage}`]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rank table year mismatch/);
  assert.deepEqual(json(path.join(f.stage, "index.json")), sentinel);
});
