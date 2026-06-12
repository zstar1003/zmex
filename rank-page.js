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
const summary = document.querySelector("#rankSummary");
const results = document.querySelector("#rankResults");
const resultTitle = document.querySelector("#rankResultTitle");
const resultCount = document.querySelector("#rankResultCount");

let schools = [];
let admissionCatalog = null;
let admissionIndex = buildAdmissionIndex();
const admissionPayloads = new Map();

function renderResults(province, rank, track) {
  const matches = rankAdvisorMatches(schools, province, rank, track, admissionIndex);
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
  summary.textContent = matches.length
    ? `已读取 ${sourceParts.join("及")}，结果按${sortBasis}排序。`
    : coverage?.recordCount
      ? "现有可追溯数据中暂未匹配到符合当前排名的专业。"
      : "该省专业录取数据仍在检索，暂不使用未经核实的估算值。";

  results.innerHTML = matches
    .map(({ school, major, requiredRank, lineScore, sourceYear, sourceLabel, subject, batch, isVerified, rankMethod, dataType }) => {
      const href = new URL("./index.html", window.location.href);
      href.searchParams.set("school", school.id);
      href.searchParams.set("major", major.name);
      href.searchParams.set("province", province);
      href.searchParams.set("track", track);
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
        <a class="program-card rank-page-card" href="${href.pathname}${href.search}">
          <span class="program-school">${school.name}</span>
          <strong>${major.name}</strong>
          <span>${school.province} · ${school.city}</span>
          <div class="program-rank-line">
            <b>${rankLabel} ${formatNumber.format(requiredRank)} 名</b>
            <em>${sourceYear ? `${sourceYear}${lineScore ? ` · ${lineScore}分` : ""} · ${sourceLabel}` : `${sourceLabel} · 位次参考`}<br/>${batch || subject}</em>
          </div>
        </a>
      `;
    })
    .join("");
}

async function loadProvinceAdmissions(province) {
  const entry = admissionCatalog?.provinces?.find((item) => item.province === province);
  if (!entry?.dataUrl) {
    admissionIndex = buildAdmissionIndex(null, admissionCatalog);
    return;
  }
  if (!admissionPayloads.has(province)) {
    admissionPayloads.set(province, await fetch(entry.dataUrl).then((response) => response.json()));
  }
  admissionIndex = buildAdmissionIndex(admissionPayloads.get(province), admissionCatalog);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const province = provinceSelect.value;
  const track = trackSelect.value;
  const rank = Number(rankInput.value);
  if (!province || !Number.isFinite(rank) || rank < 1) {
    resultTitle.textContent = "排名无效";
    resultCount.textContent = "0";
    summary.textContent = "请输入大于 0 的全省排名。";
    results.innerHTML = "";
    return;
  }
  summary.textContent = "正在读取该省专业录取数据…";
  try {
    await loadProvinceAdmissions(province);
    renderResults(province, rank, track);
  } catch (error) {
    console.error(error);
    resultTitle.textContent = "录取数据读取失败";
    resultCount.textContent = "0";
    summary.textContent = "数据文件读取失败，本次不返回估算结果，请稍后重试。";
    results.innerHTML = "";
  }
});

async function init() {
  const [data, catalog] = await Promise.all([
    fetch("./data/schools.json").then((response) => response.json()),
    fetch("./data/admissions/index.json").then((response) => response.json()),
  ]);
  schools = [...data.schools, ...(data.admissionSchools || [])];
  admissionCatalog = catalog;
  admissionIndex = buildAdmissionIndex(null, admissionCatalog);
  const provinces = [...data.provinceStats].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  provinceSelect.innerHTML = provinces.map((province) => `<option value="${province.name}">${province.name}</option>`).join("");
  provinceSelect.value = "浙江省";
}

init().catch((error) => {
  console.error(error);
  resultTitle.textContent = "数据加载失败";
  summary.textContent = error.message;
});
