import {
  admissionCoverageForProvince,
  buildAdmissionIndex,
  rankAdvisorMatches,
} from "./rank-engine.js";

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
const dataCacheVersion = "20260626-2025-admissions-2";
const pageSize = 50;

let schools = [];
let admissionCatalog = null;
let admissionIndex = buildAdmissionIndex();
const admissionPayloads = new Map();
let querySerial = 0;
const resultState = {
  matches: [],
  page: 1,
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
  if (!province || !Number.isFinite(rank) || rank < 1) return null;
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
  resultState.matches = [];
  resultState.page = 1;
  pagination.hidden = true;
  results.innerHTML = "";
}

function resultCardHtml({ school, major, requiredRank, lineScore, sourceYear, sourceLabel, subject, batch, isVerified, rankMethod, dataType }) {
  const rankLabel = !isVerified
    ? "估算位次"
    : dataType === "aggregated"
      ? rankMethod === "aggregated-score-cumulative"
        ? "公开数据同分位次上限"
        : "公开数据最低位次"
      : rankMethod === "official-score-cumulative"
        ? "官方同分位次上限"
        : "官方最低位次";
  return `
    <article class="program-card rank-page-card">
      <span class="program-school">${school.name}</span>
      <strong>${major.name}</strong>
      <span>${school.province} · ${school.city}</span>
      <div class="program-rank-line">
        <b>${rankLabel} ${formatNumber.format(requiredRank)} 名</b>
        <em>${sourceYear ? `${sourceYear}${lineScore ? ` · ${lineScore}分` : ""} · ${sourceLabel}` : `${sourceLabel} · 位次参考`}<br/>${batch || subject}</em>
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
  const usesCumulativeRank = coverage?.sources?.some(
    (source) => String(source.rankMethod || "").includes("cumulative"),
  );
  resultTitle.textContent = `${province}第 ${formatNumber.format(rank)} 名`;
  resultCount.textContent = String(matches.length);
  const sourceParts = [];
  if (coverage?.officialRecordCount) {
    sourceParts.push(`${formatNumber.format(coverage.officialRecordCount)} 条考试院官方记录`);
  }
  if (coverage?.aggregatedRecordCount) {
    sourceParts.push(`${formatNumber.format(coverage.aggregatedRecordCount)} 条可追溯公开记录`);
  }
  if (coverage?.estimatedRecordCount) {
    sourceParts.push(
      `${formatNumber.format(coverage.estimatedRecordCount)} 条公开最低分换算的估算记录`,
    );
  }
  const sortBasis = coverage?.estimatedRecordCount
    ? "估算位次"
    : usesCumulativeRank
      ? "同分位次上限或最低位次"
      : "最低位次";
  const targetProvinceText = targetProvinces.size
    ? `，院校所在地限定为${formatTargetProvinceSelection(targetProvinces)}`
    : "";
  const latestReferenceText = coverage?.latestOfficialReference
    ? `；另已找到${coverage.latestOfficialReference.year}年${coverage.latestOfficialReference.granularity}投档线，暂不混入专业粒度排序`
    : "";
  summary.textContent = matches.length
    ? `已读取 ${sourceParts.join("及")}，结果按${sortBasis}排序${targetProvinceText}${latestReferenceText}。`
    : coverage?.recordCount
      ? `现有可追溯数据中暂未匹配到符合当前排名${targetProvinces.size ? "和院校所在地" : ""}的专业${latestReferenceText}。`
      : "该省专业录取数据仍在检索，暂不使用未经核实的估算值。";

  resultState.matches = matches;
  resultState.page = 1;
  renderCurrentPage();
}

async function loadProvinceAdmissions(province) {
  const entry = admissionCatalog?.provinces?.find((item) => item.province === province);
  if (!entry?.dataUrl) {
    admissionIndex = buildAdmissionIndex(null, admissionCatalog);
    return;
  }
  if (!admissionPayloads.has(province)) {
    admissionPayloads.set(province, await fetchJson(entry.dataUrl));
  }
  admissionIndex = buildAdmissionIndex(admissionPayloads.get(province), admissionCatalog);
}

async function runRankQuery({ showInvalid = true } = {}) {
  const query = readRankQuery();
  if (!query) {
    if (!showInvalid) return;
    resultTitle.textContent = "排名无效";
    resultCount.textContent = "0";
    summary.textContent = "请输入大于 0 的全省排名。";
    resetResultState();
    return;
  }

  const serial = ++querySerial;
  const { province, rank, track } = query;
  summary.textContent = "正在读取该省专业录取数据…";
  try {
    await loadProvinceAdmissions(province);
    if (serial !== querySerial) return;
    renderResults(province, rank, track, selectedTargetProvinces());
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
