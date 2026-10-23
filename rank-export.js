const trackLabels = {
  physics: "物理 / 理科 / 综合",
  history: "历史 / 文科",
  general: "综合",
};

export const exportDisclaimer = "结果仅供志愿初筛参考，不代表录取承诺。不同年份、批次及科类的分数不宜直接比较；估算位次并非官方录取位次，请以当年招生计划与考试院公布信息为准。";

const columns = [
  "序号", "学校", "专业 / 专业组", "院校省份", "城市", "最低分", "参考位次",
  "位次口径", "数据年份", "批次", "科类", "选科要求", "数据类型", "位次说明",
  "来源", "来源链接", "来源标识", "来源 SHA256", "院校代码", "专业代码", "计划人数",
];

function assertResults(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error("当前没有可导出的筛选结果。");
  }
}

function textValue(value) {
  return value == null ? "" : String(value);
}

function numericValue(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function trackLabel(track) {
  return trackLabels[track] || textValue(track) || "不限科类";
}

function dataTypeLabel(match) {
  if (match.isVerified === false || match.dataType === "estimated") return "估算数据";
  if (match.dataType === "aggregated") return "可追溯公开数据";
  if (match.dataType === "official" || match.isOfficial) return "官方数据";
  return "未注明";
}

function rankLabel(match) {
  if (match.isVerified === false || match.dataType === "estimated") return "估算位次";
  const prefix = match.dataType === "aggregated" ? "公开数据" : "官方";
  return `${prefix}${String(match.rankMethod || "").includes("cumulative") ? "同分位次上限" : "最低位次"}`;
}

function queryRows(context, count) {
  return [
    ["查询条件", "内容"],
    ["生源省份", textValue(context.province)],
    ["考生科类", trackLabel(context.track)],
    ["考生位次", numericValue(context.rank)],
    ["院校所在地", context.targetProvinces?.length ? context.targetProvinces.join("、") : "不限"],
    ["专业关键词", textValue(context.keyword) || "不限"],
    ["最终筛选条数", count],
    ["结果顺序", "与网页最终筛选列表一致，包含全部分页结果"],
    ["参考说明", exportDisclaimer],
  ];
}

function resultRows(matches, context) {
  return matches.map((match, index) => [
    index + 1,
    textValue(match.school?.name),
    textValue(match.major?.name),
    textValue(match.school?.province),
    textValue(match.school?.city),
    numericValue(match.lineScore),
    numericValue(match.requiredRank),
    rankLabel(match),
    numericValue(match.sourceYear),
    textValue(match.batch),
    trackLabel(match.track || context.track),
    textValue(match.subject),
    dataTypeLabel(match),
    textValue(match.rankNote),
    textValue(match.sourceLabel),
    textValue(match.sourceUrl),
    textValue(match.sourceId),
    textValue(match.sourceSha256),
    textValue(match.schoolCode),
    textValue(match.majorCode),
    numericValue(match.planCount),
  ]);
}

// XLSX is injected so this pure builder can be tested with the actual vendored module.
export function buildResultsWorkbook(matches, context = {}, XLSX) {
  assertResults(matches);
  const workbook = XLSX.utils.book_new();
  // aoa_to_sheet writes JavaScript strings as explicit string cells, including text
  // starting with '=' or '+'. Do not turn user/source strings into formula objects.
  const results = XLSX.utils.aoa_to_sheet([columns, ...resultRows(matches, context)]);
  results["!autofilter"] = { ref: results["!ref"] };
  results["!cols"] = [
    8, 26, 46, 18, 18, 10, 12, 25, 10, 24, 18, 30, 22, 45, 28, 60, 28, 68, 14, 14, 12,
  ].map((wch) => ({ wch }));
  const conditions = XLSX.utils.aoa_to_sheet(queryRows(context, matches.length));
  conditions["!cols"] = [{ wch: 20 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, results, "筛选结果");
  XLSX.utils.book_append_sheet(workbook, conditions, "查询条件");
  return workbook;
}

function exportFilename(context) {
  const province = textValue(context.province).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return `择木而栖-${province || "院校"}-${numericValue(context.rank) || "筛选"}-筛选结果.xlsx`;
}

export async function exportResultsExcel(matches, context = {}) {
  assertResults(matches);
  const XLSX = await import("./data/vendor/xlsx/xlsx.js");
  const workbook = buildResultsWorkbook(matches, context, XLSX);
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(context);
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Leave enough time for browsers to start consuming the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function escapeHtml(value) {
  return textValue(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function buildPrintDocument(matches, context = {}) {
  assertResults(matches);
  const conditions = queryRows(context, matches.length).slice(1, -1)
    .map(([label, value]) => `<span><b>${escapeHtml(label)}：</b>${escapeHtml(value)}</span>`).join("");
  const rows = matches.map((match, index) => `<tr data-export-row="${index + 1}">
    <td>${index + 1}</td>
    <td>${escapeHtml(match.school?.name)}</td>
    <td>${escapeHtml(match.major?.name)}</td>
    <td>${escapeHtml([match.school?.province, match.school?.city].filter(Boolean).join(" · "))}</td>
    <td>${escapeHtml(numericValue(match.lineScore))}</td>
    <td>${escapeHtml(numericValue(match.requiredRank))}<small>${escapeHtml(rankLabel(match))}</small></td>
    <td>${escapeHtml(numericValue(match.sourceYear))}<small>${escapeHtml(match.batch)}</small></td>
    <td>${escapeHtml(trackLabel(match.track || context.track))}<small>${escapeHtml(match.subject)}</small></td>
    <td>${escapeHtml(dataTypeLabel(match))}<small>${escapeHtml(match.rankNote)}</small></td>
    <td>${escapeHtml(match.sourceLabel)}<small>${escapeHtml(match.sourceUrl)}</small></td>
  </tr>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>择木而栖 · 筛选结果</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 24px; color: #17232b; font: 12px/1.5 "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 24px; }
  button { padding: 10px 18px; border: 0; border-radius: 6px; background: #184f49; color: white; cursor: pointer; font: inherit; }
  .conditions { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-bottom: 12px; }
  .notice { margin: 12px 0 18px; color: #4b5961; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cdd5d8; padding: 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #eef3f2; }
  small { display: block; margin-top: 3px; font-size: 0.9em; color: #4b5961; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  @media print { body { margin: 0; font-size: 8.5pt; } .toolbar { display: none; } th, td { padding: 4px; } }
</style></head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">打印 / 保存为 PDF</button><span>在打印窗口中选择“另存为 PDF”即可导出。共 ${matches.length} 条，包含全部分页结果。</span></div>
<h1>择木而栖 · 院校与专业筛选结果</h1>
<div class="conditions">${conditions}</div>
<p class="notice">${escapeHtml(exportDisclaimer)}</p>
<table><colgroup><col style="width:4%"><col style="width:11%"><col style="width:16%"><col style="width:8%"><col style="width:5%"><col style="width:10%"><col style="width:8%"><col style="width:10%"><col style="width:10%"><col style="width:18%"></colgroup>
<thead><tr><th>序号</th><th>学校</th><th>专业 / 专业组</th><th>所在地</th><th>最低分</th><th>参考位次</th><th>年份 / 批次</th><th>科类 / 选科</th><th>数据类型 / 说明</th><th>来源</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

export function printResults(matches, context = {}) {
  const html = buildPrintDocument(matches, context);
  // Keep this synchronous so browsers recognize the user's click and allow the tab.
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("打印窗口被浏览器拦截，请允许此网站打开弹窗后重试。");
  try {
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  } catch (error) {
    printWindow.close();
    throw new Error("无法打开打印预览，请重试。", { cause: error });
  }
}
