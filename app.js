import { ThreeChinaMap } from "./three-map.js";
import { verifiedLinesForSchool } from "./rank-engine.js";

const state = {
  data: null,
  chart: null,
  filters: {
    query: "",
    province: "",
    natures: new Set(),
    tags: new Set(),
    categories: new Set(),
  },
  filtered: [],
  selectedId: null,
  selectedCityKey: null,
  visibleRows: 160,
  detailContext: null,
  selectedMajorName: "",
  detailDismissed: false,
};

const els = {
  searchInput: document.querySelector("#searchInput"),
  provinceSelect: document.querySelector("#provinceSelect"),
  natureChecks: document.querySelector("#natureChecks"),
  tagChecks: document.querySelector("#tagChecks"),
  categoryChips: document.querySelector("#categoryChips"),
  resetFilters: document.querySelector("#resetFilters"),
  schoolCount: document.querySelector("#schoolCount"),
  provinceCount: document.querySelector("#provinceCount"),
  cityCount: document.querySelector("#cityCount"),
  publicCount: document.querySelector("#publicCount"),
  privateCount: document.querySelector("#privateCount"),
  mapChart: document.querySelector("#mapChart"),
  detailCard: document.querySelector("#detailCard"),
  schoolList: document.querySelector("#schoolList"),
  listCount: document.querySelector("#listCount"),
  loadMore: document.querySelector("#loadMore"),
  sourceText: document.querySelector("#sourceText"),
  resetMapView: document.querySelector("#resetMapView"),
  zoomInMap: document.querySelector("#zoomInMap"),
  zoomOutMap: document.querySelector("#zoomOutMap"),
  fullscreenMap: document.querySelector("#fullscreenMap"),
  mapStage: document.querySelector(".map-stage"),
};

const formatNumber = new Intl.NumberFormat("zh-CN");

function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function getTagLabels(school) {
  const labels = [];
  if (school.tags.doubleFirstClass) labels.push(["双一流", "hot"]);
  if (school.tags.is985) labels.push(["985", "blue"]);
  if (school.tags.is211) labels.push(["211", "blue"]);
  if (school.tags.vocationalUndergrad) labels.push(["职业本科", "green"]);
  labels.push([school.nature, school.nature === "民办" ? "" : "green"]);
  labels.push([school.category, ""]);
  return labels;
}

function sameMajorName(a, b) {
  if (!a || !b) return false;
  return String(a).trim() === String(b).trim();
}

function initControls() {
  const { provinceStats, categories } = state.data;
  const provinceOptions = [...provinceStats].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  els.provinceSelect.insertAdjacentHTML(
    "beforeend",
    provinceOptions.map((province) => `<option value="${province.name}">${province.name}（${province.count}）</option>`).join(""),
  );
  els.categoryChips.innerHTML = categories
    .map((category) => `<button class="chip" type="button" data-category="${category}">${category}</button>`)
    .join("");

  els.searchInput.addEventListener(
    "input",
    debounce((event) => {
      state.filters.query = event.target.value.trim();
      state.visibleRows = 160;
      applyFilters();
    }),
  );

  els.provinceSelect.addEventListener("change", (event) => {
    state.filters.province = event.target.value;
    state.visibleRows = 160;
    applyFilters();
  });

  els.natureChecks.addEventListener("change", (event) => {
    if (event.target.matches("input")) {
      updateSetFromCheckbox(state.filters.natures, event.target);
      state.visibleRows = 160;
      applyFilters();
    }
  });

  els.tagChecks.addEventListener("change", (event) => {
    if (event.target.matches("input")) {
      updateSetFromCheckbox(state.filters.tags, event.target);
      state.visibleRows = 160;
      applyFilters();
    }
  });

  els.categoryChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const category = chip.dataset.category;
    if (state.filters.categories.has(category)) state.filters.categories.delete(category);
    else state.filters.categories.add(category);
    chip.classList.toggle("active", state.filters.categories.has(category));
    state.visibleRows = 160;
    applyFilters();
  });

  els.resetFilters.addEventListener("click", resetFilters);
  els.loadMore.addEventListener("click", () => {
    state.visibleRows += 160;
    renderList();
  });

  els.resetMapView.addEventListener("click", resetMapView);
  els.zoomInMap.addEventListener("click", () => zoomMap(1.2));
  els.zoomOutMap.addEventListener("click", () => zoomMap(0.82));
  els.fullscreenMap.addEventListener("click", toggleMapFullscreen);
}

function updateSetFromCheckbox(set, checkbox) {
  if (checkbox.checked) set.add(checkbox.value);
  else set.delete(checkbox.value);
}

function resetFilters() {
  state.filters.query = "";
  state.filters.province = "";
  state.filters.natures.clear();
  state.filters.tags.clear();
  state.filters.categories.clear();
  state.selectedCityKey = null;
  state.selectedMajorName = "";
  state.detailDismissed = false;
  state.visibleRows = 160;

  els.searchInput.value = "";
  els.provinceSelect.value = "";
  document.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  document.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
  applyFilters();
}

function applyFilters() {
  const { query, province, natures, tags, categories } = state.filters;
  const normalizedQuery = query.toLowerCase();

  state.filtered = state.data.schools
    .filter((school) => {
      if (province && school.province !== province) return false;
      if (natures.size && !natures.has(school.nature)) return false;
      if (categories.size && !categories.has(school.category)) return false;
      for (const tag of tags) {
        if (!school.tags[tag]) return false;
      }
      if (normalizedQuery) {
        const haystack = `${school.name} ${school.province} ${school.city} ${school.department} ${school.category}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    })
    .sort(compareSchools);

  if (state.selectedId && !state.filtered.some((school) => school.id === state.selectedId)) {
    state.selectedId = null;
  }
  if (state.selectedCityKey && !aggregateByCity(state.filtered).some((city) => city.key === state.selectedCityKey)) {
    state.selectedCityKey = null;
  }

  renderStats();
  renderMap();
  renderList();
  renderSelectedDetail();
}

function summarizeSchools(schools) {
  const provinceSet = new Set();
  const citySet = new Set();
  let publicCount = 0;
  let privateCount = 0;
  for (const school of schools) {
    provinceSet.add(school.province);
    citySet.add(`${school.province}/${school.city}`);
    if (school.nature === "民办") privateCount += 1;
    else publicCount += 1;
  }
  return {
    total: schools.length,
    provinceCount: provinceSet.size,
    cityCount: citySet.size,
    publicCount,
    privateCount,
  };
}

function renderStats() {
  const summary = summarizeSchools(state.filtered);
  els.schoolCount.textContent = formatNumber.format(summary.total);
  els.provinceCount.textContent = formatNumber.format(summary.provinceCount);
  els.cityCount.textContent = formatNumber.format(summary.cityCount);
  els.publicCount.textContent = formatNumber.format(summary.publicCount);
  els.privateCount.textContent = formatNumber.format(summary.privateCount);

  els.sourceText.textContent = `数据来源：${state.data.meta.sourceName}（截至 ${state.data.meta.sourceDate}）；推荐/专业/位次为估算模型`;
}

function aggregateByProvince(schools) {
  return Object.values(
    schools.reduce((acc, school) => {
      acc[school.province] ||= {
        name: school.province,
        count: 0,
        privateCount: 0,
        eliteCount: 0,
      };
      acc[school.province].count += 1;
      if (school.nature === "民办") acc[school.province].privateCount += 1;
      if (school.tags.doubleFirstClass || school.tags.is985 || school.tags.is211) acc[school.province].eliteCount += 1;
      return acc;
    }, {}),
  );
}

function cityKeyOf(school) {
  return `${school.province}::${school.city}`;
}

function schoolPriority(school) {
  if (school.recommendation?.score) return school.recommendation.score;
  if (school.tags.is985) return 5;
  if (school.tags.is211) return 4;
  if (school.tags.doubleFirstClass) return 3;
  if (school.nature === "公办") return 2;
  return 1;
}

function compareSchools(a, b) {
  return (
    (b.recommendation?.score || 0) - (a.recommendation?.score || 0) ||
    Number(b.tags.is985) - Number(a.tags.is985) ||
    Number(b.tags.is211) - Number(a.tags.is211) ||
    Number(b.tags.doubleFirstClass) - Number(a.tags.doubleFirstClass) ||
    a.name.localeCompare(b.name, "zh-CN")
  );
}

function aggregateByCity(schools) {
  return Object.values(
    schools.reduce((acc, school) => {
      const key = cityKeyOf(school);
      acc[key] ||= {
        key,
        name: school.city,
        province: school.province,
        coord: school.cityCenter || school.coord,
        count: 0,
        publicCount: 0,
        privateCount: 0,
        eliteCount: 0,
        doubleFirstClassCount: 0,
        categories: {},
        schools: [],
      };
      const city = acc[key];
      city.count += 1;
      city.schools.push(school);
      city.categories[school.category] = (city.categories[school.category] || 0) + 1;
      if (school.nature === "民办") city.privateCount += 1;
      else city.publicCount += 1;
      if (school.tags.doubleFirstClass || school.tags.is985 || school.tags.is211) city.eliteCount += 1;
      if (school.tags.doubleFirstClass) city.doubleFirstClassCount += 1;
      return acc;
    }, {}),
  )
    .map((city) => ({
      ...city,
      schools: city.schools.sort((a, b) => schoolPriority(b) - schoolPriority(a) || a.name.localeCompare(b.name, "zh-CN")),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

function renderMap() {
  if (!state.chart) return;
  state.chart.update({
    provinceStats: aggregateByProvince(state.filtered),
    activeProvince: state.filters.province,
  });
}

function renderList() {
  const visible = state.filtered.slice(0, state.visibleRows);
  els.listCount.textContent = formatNumber.format(state.filtered.length);
  els.schoolList.innerHTML = visible
    .map((school) => {
      const tags = getTagLabels(school)
        .slice(0, 4)
        .map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`)
        .join("");
      return `
        <article class="school-row ${school.id === state.selectedId ? "active" : ""}" data-school-id="${school.id}">
          <div class="school-row-top">
            <strong>${school.name}</strong>
            <span class="recommend-score">${school.recommendation?.score || "-"}分</span>
          </div>
          <div class="school-row-meta">
            <span>${school.province}</span>
            <span>${school.city}</span>
            <span>${school.department}</span>
            <span>${school.recommendation?.band || "推荐参考"}</span>
          </div>
          <div class="tag-row">${tags}</div>
        </article>
      `;
    })
    .join("");

  els.schoolList.querySelectorAll(".school-row").forEach((row) => {
    row.addEventListener("click", () => {
      selectSchool(row.dataset.schoolId);
    });
  });

  els.loadMore.classList.toggle("visible", state.filtered.length > state.visibleRows);
}

function renderSelectedDetail() {
  if (!state.selectedId && !state.selectedCityKey && state.detailDismissed) {
    els.detailCard.className = "detail-card hidden";
    els.detailCard.innerHTML = "";
    return;
  }

  if (!state.selectedId && state.selectedCityKey) {
    const city = aggregateByCity(state.filtered).find((item) => item.key === state.selectedCityKey);
    if (city) {
      renderCityDetail(city);
      return;
    }
  }

  const school = state.data.schools.find((item) => item.id === state.selectedId);
  if (!school) {
    els.detailCard.className = "detail-card empty";
    els.detailCard.innerHTML = `
      <span class="detail-kicker">院校详情</span>
      <h2>从右侧列表选择院校</h2>
      <p>当前显示 ${formatNumber.format(state.filtered.length)} 所本科院校，点击省份可筛选地区。</p>
    `;
    return;
  }

  const tags = getTagLabels(school)
    .map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`)
    .join("");
  const selectedMajorName = state.selectedMajorName;
  const majors = (school.majorRankings || [])
    .map(
      (major) => `
        <div class="major-row ${sameMajorName(major.name, selectedMajorName) ? "selected" : ""}">
          <span>${major.name}</span>
          <strong>${major.grade}</strong>
          <em>约第 ${major.estimatedRank} 名</em>
        </div>
      `,
    )
    .join("");
  const verifiedLines = verifiedLinesForSchool(school, state.detailContext?.province, state.detailContext?.track);
  const admissionLines = verifiedLines.length
    ? `
      <div class="program-lines">
        <div class="major-head">
          <strong>${verifiedLines[0].year} ${verifiedLines[0].province}专业投档</strong>
          <span>投档</span>
        </div>
        ${verifiedLines
          .slice(0, 12)
          .map(
            (line) => `
              <div class="line-row ${sameMajorName(line.name, selectedMajorName) ? "selected" : ""}">
                <span>${line.name}</span>
                <strong>${formatNumber.format(line.minRank)}名</strong>
                <em>${line.minScore}分 · ${line.subject}</em>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";
  els.detailCard.className = "detail-card";
  els.detailCard.innerHTML = `
    <button class="detail-close" type="button" aria-label="关闭院校详情">×</button>
    <span class="detail-kicker">${school.province} · ${school.city}</span>
    <h2>${school.name}</h2>
    <p>推荐分：${school.recommendation?.score || "-"} · ${school.recommendation?.band || "推荐参考"}<br/>主管部门：${school.department}<br/>办学层次：${school.level}${school.note ? ` · ${school.note}` : ""}</p>
    <div class="tag-row">${tags}</div>
    <div class="major-ranking">
      <div class="major-head">
        <strong>专业排名参考</strong>
        <span>估算</span>
      </div>
      ${majors}
    </div>
    ${admissionLines}
    <div class="detail-actions">
      <button class="primary-action" id="filterCityDetail">${school.city}</button>
      <button class="ghost-action" id="filterProvinceDetail">${school.province}</button>
    </div>
  `;
  els.detailCard.querySelector(".detail-close").addEventListener("click", closeDetailCard);
  document.querySelector("#filterCityDetail").addEventListener("click", () => {
    state.selectedCityKey = cityKeyOf(school);
    state.detailDismissed = false;
    renderMap();
    renderSelectedDetail();
  });
  document.querySelector("#filterProvinceDetail").addEventListener("click", () => {
    state.filters.province = school.province;
    els.provinceSelect.value = school.province;
    state.selectedCityKey = null;
    state.visibleRows = 160;
    applyFilters();
  });
}

function renderCityDetail(city) {
  const topCategories = Object.entries(city.categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
  const topSchools = city.schools
    .slice(0, 10)
    .map(
      (school) => `
        <button type="button" data-city-school-id="${school.id}">
          ${school.name}${school.tags.is985 ? " · 985" : school.tags.is211 ? " · 211" : school.tags.doubleFirstClass ? " · 双一流" : ""} · ${school.recommendation?.score || "-"}分
        </button>
      `,
    )
    .join("");

  els.detailCard.className = "detail-card";
  els.detailCard.innerHTML = `
    <button class="detail-close" type="button" aria-label="关闭城市详情">×</button>
    <span class="detail-kicker">${city.province}</span>
    <h2>${city.name} · ${city.count} 所本科</h2>
    <p>公办 ${city.publicCount} 所 · 民办 ${city.privateCount} 所 · 重点标签 ${city.eliteCount} 所<br/>${topCategories || "暂无类型统计"}</p>
    <div class="city-school-list">${topSchools}</div>
    <div class="detail-actions">
      <button class="primary-action" id="filterCityProvince">${city.province}</button>
      <button class="ghost-action" id="clearCitySelection">返回全国</button>
    </div>
  `;

  els.detailCard.querySelector(".detail-close").addEventListener("click", closeDetailCard);
  els.detailCard.querySelectorAll("[data-city-school-id]").forEach((button) => {
    button.addEventListener("click", () => selectSchool(button.dataset.citySchoolId));
  });
  document.querySelector("#filterCityProvince").addEventListener("click", () => {
    state.filters.province = city.province;
    els.provinceSelect.value = city.province;
    state.visibleRows = 160;
    applyFilters();
  });
  document.querySelector("#clearCitySelection").addEventListener("click", () => {
    closeDetailCard();
  });
}

function closeDetailCard() {
  state.selectedCityKey = null;
  state.selectedId = null;
  state.selectedMajorName = "";
  state.detailDismissed = true;
  renderMap();
  renderList();
  renderSelectedDetail();
}

function selectSchool(id, majorName = "") {
  state.selectedId = id;
  state.selectedMajorName = majorName;
  state.detailDismissed = false;
  const school = state.data.schools.find((item) => item.id === id);
  state.selectedCityKey = school ? cityKeyOf(school) : null;
  renderSelectedDetail();
  renderList();
}

function resetMapView() {
  state.chart?.resetView();
}

function zoomMap(factor) {
  state.chart?.zoomBy(factor);
}

function toggleMapFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  els.mapStage.requestFullscreen?.();
}

async function init() {
  const [data, china] = await Promise.all([fetch("./data/schools.json").then((res) => res.json()), fetch("./data/china.json").then((res) => res.json())]);
  state.data = data;
  state.filtered = data.schools;
  state.chart = new ThreeChinaMap(els.mapChart, china, {
    onProvinceClick(name) {
      if (!state.data.provinceStats.some((province) => province.name === name)) return;
      state.filters.province = name;
      els.provinceSelect.value = name;
      state.visibleRows = 160;
      applyFilters();
    },
  });

  initControls();
  const params = new URLSearchParams(window.location.search);
  const linkedSchool = params.get("school");
  const linkedMajor = params.get("major") || "";
  if (linkedSchool) {
    const school = state.data.schools.find((item) => item.id === linkedSchool);
    if (school) {
      state.filters.query = school.name;
      els.searchInput.value = school.name;
      state.detailContext = {
        province: params.get("province") || "",
        track: params.get("track") || "",
      };
    }
  }
  applyFilters();
  if (linkedSchool && state.filtered.some((school) => school.id === linkedSchool)) {
    selectSchool(linkedSchool, linkedMajor);
  }
  window.addEventListener("resize", debounce(() => state.chart?.resize(), 100));
  document.addEventListener("fullscreenchange", () => {
    window.setTimeout(() => state.chart?.resize(), 80);
  });
}

init().catch((error) => {
  console.error(error);
  els.detailCard.className = "detail-card";
  els.detailCard.innerHTML = `
    <span class="detail-kicker">加载失败</span>
    <h2>数据没有加载成功</h2>
    <p>${error.message}</p>
  `;
});
