import { rankAdvisorMatches } from "./rank-engine.js";

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

function renderResults(province, rank, track) {
  const matches = rankAdvisorMatches(schools, province, rank, track);
  resultTitle.textContent = `${province}第 ${formatNumber.format(rank)} 名`;
  resultCount.textContent = String(matches.length);
  summary.textContent = matches.length
    ? "以下专业按参考位次由高到低排列，点击可返回首页查看院校与专业详情。"
    : "暂未匹配到相对稳妥的专业，请调整排名或科类。";

  results.innerHTML = matches
    .map(({ school, major, requiredRank, lineScore, sourceYear, sourceLabel, subject, isVerified }) => {
      const href = new URL("./index.html", window.location.href);
      href.searchParams.set("school", school.id);
      href.searchParams.set("major", major.name);
      href.searchParams.set("province", province);
      href.searchParams.set("track", track);
      return `
        <a class="program-card rank-page-card ${isVerified ? "verified" : ""}" href="${href.pathname}${href.search}">
          <span class="program-school">${school.name}</span>
          <strong>${major.name}</strong>
          <span>${school.province} · ${school.city}</span>
          <div class="program-rank-line">
            <b>约需前 ${formatNumber.format(requiredRank)} 名</b>
            <em>${sourceYear ? `${sourceYear} · ${lineScore}分 · ${subject}` : `${sourceLabel} · 位次参考`}</em>
          </div>
        </a>
      `;
    })
    .join("");
}

form.addEventListener("submit", (event) => {
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
  renderResults(province, rank, track);
});

async function init() {
  const data = await fetch("./data/schools.json").then((response) => response.json());
  schools = data.schools;
  const provinces = [...data.provinceStats].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  provinceSelect.innerHTML = provinces.map((province) => `<option value="${province.name}">${province.name}</option>`).join("");
  provinceSelect.value = "浙江省";
}

init().catch((error) => {
  console.error(error);
  resultTitle.textContent = "数据加载失败";
  summary.textContent = error.message;
});
