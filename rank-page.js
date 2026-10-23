import {
  admissionCoverageForProvince,
  buildAdmissionIndex,
  rankAdvisorMatches,
} from "./rank-engine.js?v=20261024-2";
import { filterMajorMatches } from "./rank-results.js?v=20261024-1";
import { exportResultsExcel, printResults } from "./rank-export.js?v=20261024-1";

const formatNumber = new Intl.NumberFormat("zh-CN");
const form = document.querySelector("#rankForm");
const provinceSelect = document.querySelector("#rankProvinceSelect");
const trackSelect = document.querySelector("#rankTrackSelect");
const rankInput = document.querySelector("#rankInput");
const targetProvinceToggle = document.querySelector("#targetProvinceToggle");
const targetProvincePanel = document.querySelector("#targetProvincePanel");
const targetProvinceList = document.querySelector("#targetProvinceList");
const targetProvinceClear = document.querySelector("#targetProvinceClear");
const summary = document.querySelector("#rankSummary");
const results = document.querySelector("#rankResults");
const pagination = document.querySelector("#rankPagination");
const firstPageButton = document.querySelector("#rankFirstPage");
const prevPageButton = document.querySelector("#rankPrevPage");
const pageStatus = document.querySelector("#rankPageStatus");
const nextPageButton = document.querySelector("#rankNextPage");
const lastPageButton = document.querySelector("#rankLastPage");
const resultTitle = document.querySelector("#rankResultTitle");
const resultCount = document.querySelector("#rankResultCount");
const majorKeywordInput = document.querySelector("#rankMajorKeyword");
const clearKeywordButton = document.querySelector("#rankClearKeyword");
const filterStatus = document.querySelector("#rankFilterStatus");
const emptyResult = document.querySelector("#rankEmpty");
const exportExcelButton = document.querySelector("#rankExportExcel");
const exportPdfButton = document.querySelector("#rankExportPdf");
const exportStatus = document.querySelector("#rankExportStatus");
const dataCacheVersion = "20261024-admissions-2026";
const pageSize = 50;

let schools = [];
let admissionCatalog = null;
let admissionIndex = buildAdmissionIndex();
const admissionPayloads = new Map();
let querySerial = 0;
const resultState = {
  allMatches: [],
  matches: [],
  page: 1,
  query: null,
  exporting: false,
};

function dataUrl(path) {
  const url = new URL(path, window.location.href);
  url.searchParams.set("v", dataCacheVersion);
  return url;
}

async function fetchJson(path) {
  const response = await fetch(dataUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status}`);
  return response.json();
}

function selectedTargetProvinces() {
  return new Set(
    [...targetProvinceList.querySelectorAll('input[type="checkbox"]:checked')].map(
      (checkbox) => checkbox.value,
    ),
  );
}

function formatTargetProvinceSelection(targetProvinces) {
  const selected = [...targetProvinces];
  if (!selected.length) return "不限院校省份";
  if (selected.length === 1) return selected[0];
  return `${selected[0]}等 ${selected.length} 地`;
}

function updateTargetProvinceToggle() {
  const targetProvinces = selectedTargetProvinces();
  targetProvinceToggle.textContent = formatTargetProvinceSelection(targetProvinces);
}

function closeTargetProvincePanel() {
  targetProvincePanel.hidden = true;
  targetProvinceToggle.setAttribute("aria-expanded", "false");
}

function readRankQuery() {
  const province = provinceSelect.value;
  const track = trackSelect.value;
  const rank = Number(rankInput.value);
  if (!province || !Number.isSafeInteger(rank) || rank < 1) return null;
  return { province, track, rank };
}

function renderTargetProvinceOptions() {
  const provinceNames = [...new Set(schools.map((school) => school.province).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  targetProvinceList.innerHTML = provinceNames
    .map(
      (province) => `
        <label>
          <input type="checkbox" value="${province}" />
          <span>${province}</span>
        </label>
      `,
    )
    .join("");
  updateTargetProvinceToggle();
}

function resetResultState() {
  resultState.allMatches = [];
  resultState.matches = [];
  resultState.page = 1;
  resultState.query = null;
  pagination.hidden = true;
  results.innerHTML = "";
  emptyResult.hidden = true;
  majorKeywordInput.disabled = true;
  clearKeywordButton.disabled = true;
  filterStatus.textContent = "查询后，可在全部结果中按专业名称模糊筛选。";
  exportStatus.textContent = "";
  updateExportButtons();
}

function updateExportButtons() {
  const disabled = !resultState.query || !resultState.matches.length || resultState.exporting;
  exportExcelButton.disabled = disabled;
  exportPdfButton.disabled = disabled;
}

function applyMajorFilter() {
  resultState.matches = filterMajorMatches(resultState.allMatches, majorKeywordInput.value);
  resultState.page = 1;
  resultCount.textContent = String(resultState.matches.length);
  clearKeywordButton.disabled = !majorKeywordInput.value;
  filterStatus.textContent = `原查询 ${formatNumber.format(resultState.allMatches.length)} 条，当前筛选 ${formatNumber.format(resultState.matches.length)} 条。`;
  emptyResult.hidden = !resultState.allMatches.length || !!resultState.matches.length;
  exportStatus.textContent = "";
  updateExportButtons();
  renderCurrentPage();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function resultCardHtml({ school, major, requiredRank, lineScore, sourceYear, sourceLabel, subject, batch, isVerified, rankMethod, rankNote, dataType }) {
  const rankLabel = !isVerified
    ? "估算位次"
    : dataType === "aggregated"
      ? rankMethod === "aggregated-score-cumulative"
        ? "公开数据同分位次上限"
        : "公开数据最低位次"
      : rankMethod === "official-score-cumulative"
        ? rankNote?.includes("合并档") ? "官方合并档位次上限" : "官方同分位次上限"
        : "官方最低位次";
  return `
    <article class="program-card rank-page-card">
      <span class="program-school">${escapeHtml(school.name)}</span>
      <strong>${escapeHtml(major.name)}</strong>
      <span>${escapeHtml(school.province)} · ${escapeHtml(school.city)}</span>
      <div class="program-rank-line">
        <b title="${escapeHtml(rankNote)}">${rankLabel} ${formatNumber.format(requiredRank)} 名</b>
        <em>${sourceYear ? `${sourceYear}${lineScore ? ` · ${lineScore}分` : ""} · ${escapeHtml(sourceLabel)}` : `${escapeHtml(sourceLabel)} · 位次参考`}<br/>${escapeHtml([batch, subject].filter(Boolean).join(" · "))}</em>
      </div>
    </article>
  `;
}

function renderCurrentPage() {
  const total = resultState.matches.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  resultState.page = Math.max(1, Math.min(resultState.page, totalPages));
  const startIndex = (resultState.page - 1) * pageSize;
  const pageItems = resultState.matches.slice(startIndex, startIndex + pageSize);
  results.innerHTML = pageItems.map(resultCardHtml).join("");

  pagination.hidden = total <= pageSize;
  if (total <= pageSize) return;

  const endIndex = startIndex + pageItems.length;
  pageStatus.textContent = `第 ${formatNumber.format(resultState.page)} / ${formatNumber.format(totalPages)} 页 · ${formatNumber.format(startIndex + 1)}-${formatNumber.format(endIndex)} / ${formatNumber.format(total)}`;
  firstPageButton.disabled = resultState.page === 1;
  prevPageButton.disabled = resultState.page === 1;
  nextPageButton.disabled = resultState.page === totalPages;
  lastPageButton.disabled = resultState.page === totalPages;
}

function setResultPage(page) {
  resultState.page = page;
  renderCurrentPage();
}

function renderResults(province, rank, track, targetProvinces = new Set()) {
  const matches = rankAdvisorMatches(schools, province, rank, track, admissionIndex, {
    targetProvinces: [...targetProvinces],
  });
  const coverage = admissionCoverageForProvince(admissionIndex, province);
  const referenceYears = [...new Set((coverage?.sources || []).map((source) => source.year).filter(Boolean))]
    .sort((a, b) => b - a);
  const referenceYearText = referenceYears.length
    ? `数据覆盖 ${referenceYears.join("、")} 年，同一专业优先使用已收录的最新年份；未更新的记录保留原年份。`
    : "";
  resultTitle.textContent = `${province}第 ${formatNumber.format(rank)} 名`;
  resultCount.textContent = String(matches.length);
  const sourceParts = [];
  if (coverage?.officialRecordCount) {
    sourceParts.push(`${formatNumber.format(coverage.officialRecordCount)} 条官方录取记录`);
  }
  if (coverage?.aggregatedRecordCount) {
    sourceParts.push(`${formatNumber.format(coverage.aggregatedRecordCount)} 条可追溯公开记录`);
  }
  if (coverage?.estimatedRecordCount) {
    sourceParts.push(
      `${formatNumber.format(coverage.estimatedRecordCount)} 条公开最低分换算的估算记录`,
    );
  }
  const targetProvinceText = targetProvinces.size
    ? `，院校所在地限定为${formatTargetProvinceSelection(targetProvinces)}`
    : "";
  const latestReferenceText = coverage?.latestOfficialReference
    ? `；另已找到${coverage.latestOfficialReference.year}年${coverage.latestOfficialReference.granularity}投档线，暂不混入专业粒度排序`
    : "";
  const groupNote = (coverage?.sources || []).some((source) => source.granularity?.includes("院校专业组"))
    ? "专业组行不含组内专业明细，专业关键词只匹配已提供的名称。"
    : "";
  summary.textContent = matches.length
    ? `${referenceYearText}已读取 ${sourceParts.join("及")}，结果按最低分从高到低排序，同分按位次从小到大，缺失分数的记录排在最后${targetProvinceText}${latestReferenceText}。${groupNote}`
    : coverage?.recordCount
      ? `现有可追溯数据中暂未匹配到符合当前排名${targetProvinces.size ? "和院校所在地" : ""}的专业${latestReferenceText}。`
      : "该省专业录取数据仍在检索，暂不使用未经核实的估算值。";

  resultState.allMatches = matches;
  resultState.query = { province, rank, track, targetProvinces: [...targetProvinces] };
  majorKeywordInput.disabled = false;
  applyMajorFilter();
}

async function loadProvinceAdmissions(province) {
  const entry = admissionCatalog?.provinces?.find((item) => item.province === province);
  if (!entry?.dataUrl) {
    return buildAdmissionIndex(null, admissionCatalog);
  }
  if (!admissionPayloads.has(province)) {
    admissionPayloads.set(province, await fetchJson(entry.dataUrl));
  }
  return buildAdmissionIndex(admissionPayloads.get(province), admissionCatalog);
}

async function runRankQuery({ showInvalid = true } = {}) {
  const serial = ++querySerial;
  const query = readRankQuery();
  if (!query) {
    resetResultState();
    resultCount.textContent = "0";
    if (!showInvalid) {
      resultTitle.textContent = "等待输入排名";
      summary.textContent = "选择省份、科类并输入全省排名。";
      return;
    }
    resultTitle.textContent = "排名无效";
    resultCount.textContent = "0";
    summary.textContent = "请输入大于 0 的整数全省排名。";
    return;
  }

  const { province, rank, track } = query;
  const targetProvinces = selectedTargetProvinces();
  resetResultState();
  resultTitle.textContent = "正在查询…";
  resultCount.textContent = "0";
  summary.textContent = "正在读取该省专业录取数据…";
  try {
    const loadedIndex = await loadProvinceAdmissions(province);
    if (serial !== querySerial) return;
    admissionIndex = loadedIndex;
    renderResults(province, rank, track, targetProvinces);
  } catch (error) {
    if (serial !== querySerial) return;
    console.error(error);
    resultTitle.textContent = "录取数据读取失败";
    resultCount.textContent = "0";
    summary.textContent = "数据文件读取失败，本次不返回估算结果，请稍后重试。";
    resetResultState();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runRankQuery();
});

majorKeywordInput.addEventListener("input", applyMajorFilter);
clearKeywordButton.addEventListener("click", () => {
  majorKeywordInput.value = "";
  applyMajorFilter();
  majorKeywordInput.focus();
});

async function exportCurrentResults(format) {
  if (!resultState.query || !resultState.matches.length || resultState.exporting) return;
  const matches = resultState.matches;
  const context = { ...resultState.query, keyword: majorKeywordInput.value.trim() };
  const serial = querySerial;
  resultState.exporting = true;
  updateExportButtons();
  exportStatus.textContent = format === "excel" ? "正在生成 Excel…" : "正在打开打印窗口…";
  try {
    if (format === "excel") await exportResultsExcel(matches, context);
    else printResults(matches, context);
    if (serial === querySerial && matches === resultState.matches) {
      exportStatus.textContent = format === "excel"
        ? `已导出 ${formatNumber.format(matches.length)} 条结果。`
        : "已打开打印页面，可选择“另存为 PDF”。";
    }
  } catch (error) {
    if (serial === querySerial && matches === resultState.matches) exportStatus.textContent = `导出失败：${error.message}`;
  } finally {
    resultState.exporting = false;
    updateExportButtons();
  }
}

exportExcelButton.addEventListener("click", () => exportCurrentResults("excel"));
exportPdfButton.addEventListener("click", () => exportCurrentResults("pdf"));

async function init() {
  const [data, catalog] = await Promise.all([
    fetchJson("./data/schools.json"),
    fetchJson("./data/admissions/index.json"),
  ]);
  schools = [...data.schools, ...(data.admissionSchools || [])];
  admissionCatalog = catalog;
  admissionIndex = buildAdmissionIndex(null, admissionCatalog);
  const provinces = [...data.provinceStats].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  provinceSelect.innerHTML = provinces.map((province) => `<option value="${province.name}">${province.name}</option>`).join("");
  provinceSelect.value = "浙江省";
  renderTargetProvinceOptions();
}

targetProvinceToggle.addEventListener("click", () => {
  const isOpen = !targetProvincePanel.hidden;
  targetProvincePanel.hidden = isOpen;
  targetProvinceToggle.setAttribute("aria-expanded", String(!isOpen));
});

targetProvinceList.addEventListener("change", () => {
  updateTargetProvinceToggle();
  runRankQuery({ showInvalid: false });
});

targetProvinceClear.addEventListener("click", () => {
  for (const checkbox of targetProvinceList.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = false;
  }
  updateTargetProvinceToggle();
  runRankQuery({ showInvalid: false });
});

firstPageButton.addEventListener("click", () => setResultPage(1));

prevPageButton.addEventListener("click", () => setResultPage(resultState.page - 1));

nextPageButton.addEventListener("click", () => setResultPage(resultState.page + 1));

lastPageButton.addEventListener("click", () =>
  setResultPage(Math.ceil(resultState.matches.length / pageSize)),
);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".rank-target-province-field")) closeTargetProvincePanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTargetProvincePanel();
});

init().catch((error) => {
  console.error(error);
  resultTitle.textContent = "数据加载失败";
  summary.textContent = error.message;
  resetResultState();
});
