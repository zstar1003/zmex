import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "../data/vendor/xlsx/xlsx.js";
import {
  buildPrintDocument,
  buildResultsWorkbook,
  exportResultsExcel,
  printResults,
} from "../rank-export.js";

const context = {
  province: "安徽省",
  track: "physics",
  rank: 80000,
  targetProvinces: ["江苏省", "浙江省"],
  keyword: "电气",
};

function match(index = 0, overrides = {}) {
  return {
    school: { name: `学校${index}`, province: "江苏省", city: "南京市" },
    major: { name: `电气工程${index}` },
    lineScore: 507 - index / 10,
    requiredRank: 80000 + index,
    sourceYear: 2025,
    batch: "本科批",
    track: "physics",
    subject: "物理、化学",
    isVerified: true,
    dataType: "aggregated",
    rankMethod: "aggregated-score-cumulative",
    rankNote: "由公开最低分与同年一分一段表对应，为同分考生位次上限。",
    sourceLabel: "公开招生数据平台",
    sourceUrl: "https://example.com/source?a=1&b=2",
    sourceId: "test-source",
    sourceSha256: "0123456789abcdef",
    schoolCode: "00123",
    majorCode: "0007",
    planCount: 0,
    ...overrides,
  };
}

test("a real XLSX round trip preserves all 576 ordered results, numeric values, codes and query metadata", () => {
  const matches = Array.from({ length: 576 }, (_, index) => match(index));
  const workbook = buildResultsWorkbook(matches, context, XLSX);
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  assert.deepEqual([...new Uint8Array(bytes).slice(0, 2)], [0x50, 0x4b]);
  const restored = XLSX.read(bytes, { type: "array" });
  assert.deepEqual(restored.SheetNames, ["筛选结果", "查询条件"]);
  const rows = XLSX.utils.sheet_to_json(restored.Sheets["筛选结果"]);
  assert.equal(rows.length, 576);
  assert.deepEqual(rows.map((row) => row["学校"]), matches.map((item) => item.school.name));
  assert.equal(rows[575]["参考位次"], 80575);
  assert.equal(rows[0]["最低分"], 507);
  assert.equal(rows[0]["院校代码"], "00123");
  assert.equal(rows[0]["计划人数"], 0);
  assert.equal(rows[0]["来源链接"], matches[0].sourceUrl);
  assert.equal(rows[0]["位次口径"], "公开数据同分位次上限");
  assert.equal(rows[0]["来源 SHA256"], "0123456789abcdef");
  const conditions = Object.fromEntries(XLSX.utils.sheet_to_json(restored.Sheets["查询条件"], { header: 1 }).slice(1));
  assert.equal(conditions["考生位次"], 80000);
  assert.equal(conditions["最终筛选条数"], 576);
  assert.equal(conditions["专业关键词"], "电气");
  assert.equal(conditions["院校所在地"], "江苏省、浙江省");
});

test("formula-looking strings stay literal through XLSX serialization", () => {
  const items = [match(0, {
    school: { name: '=HYPERLINK("https://example.com","学校")' },
    major: { name: "+SUM(1,2)" },
    sourceLabel: "@SUM(1,2)",
  })];
  const workbook = buildResultsWorkbook(items, { ...context, keyword: "=1+1" }, XLSX);
  const restored = XLSX.read(XLSX.write(workbook, { type: "array", bookType: "xlsx" }), { type: "array" });
  const sheet = restored.Sheets["筛选结果"];
  assert.equal(sheet.B2.v, items[0].school.name);
  assert.equal(sheet.C2.v, items[0].major.name);
  assert.equal(sheet.B2.t, "s");
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.C2.f, undefined);
  assert.equal(restored.Sheets["查询条件"].B6.v, "=1+1");
  for (const sheetName of restored.SheetNames) {
    for (const [address, cell] of Object.entries(restored.Sheets[sheetName])) {
      if (!address.startsWith("!")) assert.equal(cell.f, undefined);
    }
  }
});

test("estimated rows are explicitly identified and missing scores are blank", () => {
  const items = [match(0, {
    isVerified: false,
    dataType: "estimated",
    lineScore: null,
    sourceYear: null,
    rankMethod: "estimated-from-score",
  })];
  const sheet = buildResultsWorkbook(items, context, XLSX).Sheets["筛选结果"];
  const [row] = XLSX.utils.sheet_to_json(sheet);
  assert.equal(row["数据类型"], "估算数据");
  assert.equal(row["位次口径"], "估算位次");
  assert.equal(row["最低分"], "");
  assert.equal(row["数据年份"], "");
  const html = buildPrintDocument(items, context);
  assert.match(html, /估算数据/);
  assert.match(html, /估算位次/);
  assert.match(html, /估算位次并非官方录取位次/);
});

test("print HTML includes every result and escapes source and query strings", () => {
  const hostile = '<img src=x onerror="alert(1)">&\'电气';
  const items = Array.from({ length: 576 }, (_, index) => match(index));
  items[0].major.name = hostile;
  items[0].sourceUrl = '</small><script>alert("source")</script>';
  const html = buildPrintDocument(items, { ...context, keyword: hostile, targetProvinces: [hostile] });
  assert.equal((html.match(/<tr data-export-row=/g) || []).length, 576);
  assert.match(html, /学校575/);
  assert.match(html, /电气工程575/);
  assert.ok(html.indexOf("学校1</td>") < html.indexOf("学校575</td>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;电气"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt;"));
  assert.match(html, /display: table-header-group/);
  assert.match(html, /A4 landscape/);
  assert.match(html, /打印 \/ 保存为 PDF/);
});

test("empty result exports fail without opening a window or loading a download", async () => {
  assert.throws(() => buildResultsWorkbook([], context, XLSX), /没有可导出/);
  assert.throws(() => buildPrintDocument([], context), /没有可导出/);
  assert.throws(() => printResults([], context), /没有可导出/);
  await assert.rejects(exportResultsExcel([], context), /没有可导出/);
});

test("print reports popup blocking and writes a complete document when allowed", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { open: () => null };
    assert.throws(() => printResults([match()], context), /被浏览器拦截/);
    let written = "";
    const popup = {
      opener: {},
      document: { open() {}, write(html) { written = html; }, close() {} },
      focus() {},
      close() {},
    };
    globalThis.window = { open: () => popup };
    printResults([match()], context);
    assert.equal(popup.opener, null);
    assert.ok(written.startsWith("<!doctype html>"));
    assert.match(written, /学校0/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
