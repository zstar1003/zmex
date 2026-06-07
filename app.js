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
  mapMode: "density",
  mapZoom: 1.12,
  rankMatches: [],
  rankQuery: null,
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
  activeTitle: document.querySelector("#activeTitle"),
  activeSubtitle: document.querySelector("#activeSubtitle"),
  detailCard: document.querySelector("#detailCard"),
  schoolList: document.querySelector("#schoolList"),
  listCount: document.querySelector("#listCount"),
  loadMore: document.querySelector("#loadMore"),
  rankProvinceSelect: document.querySelector("#rankProvinceSelect"),
  rankTrackSelect: document.querySelector("#rankTrackSelect"),
  rankInput: document.querySelector("#rankInput"),
  rankSearchButton: document.querySelector("#rankSearchButton"),
  rankSummary: document.querySelector("#rankSummary"),
  rankResults: document.querySelector("#rankResults"),
  sourceText: document.querySelector("#sourceText"),
  resetMapView: document.querySelector("#resetMapView"),
  zoomInMap: document.querySelector("#zoomInMap"),
  zoomOutMap: document.querySelector("#zoomOutMap"),
  fullscreenMap: document.querySelector("#fullscreenMap"),
  mapStage: document.querySelector(".map-stage"),
};

const formatNumber = new Intl.NumberFormat("zh-CN");
const DEFAULT_MAP_ZOOM = 1.12;
const SCHOOL_POINT_LIMIT = 90;
const provinceRankPools = {
  北京市: 70000,
  天津市: 65000,
  河北省: 650000,
  山西省: 350000,
  内蒙古自治区: 220000,
  辽宁省: 260000,
  吉林省: 160000,
  黑龙江省: 180000,
  上海市: 70000,
  江苏省: 480000,
  浙江省: 390000,
  安徽省: 500000,
  福建省: 240000,
  江西省: 500000,
  山东省: 700000,
  河南省: 950000,
  湖北省: 450000,
  湖南省: 500000,
  广东省: 750000,
  广西壮族自治区: 400000,
  海南省: 70000,
  重庆市: 280000,
  四川省: 700000,
  贵州省: 450000,
  云南省: 420000,
  西藏自治区: 35000,
  陕西省: 300000,
  甘肃省: 240000,
  青海省: 60000,
  宁夏回族自治区: 70000,
  新疆维吾尔自治区: 220000,
};

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

function initControls() {
  const { provinceStats, categories } = state.data;
  const provinceOptions = [...provinceStats].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  els.provinceSelect.insertAdjacentHTML(
    "beforeend",
    provinceOptions.map((province) => `<option value="${province.name}">${province.name}（${province.count}）</option>`).join(""),
  );
  els.rankProvinceSelect.innerHTML = provinceOptions.map((province) => `<option value="${province.name}">${province.name}</option>`).join("");
  els.rankProvinceSelect.value = "广东省";

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

  document.querySelectorAll("[data-map-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mapMode = button.dataset.mapMode;
      document.querySelectorAll("[data-map-mode]").forEach((item) => item.classList.toggle("active", item === button));
      renderMap();
      renderProvinceBars();
    });
  });

  els.rankSearchButton.addEventListener("click", runRankAdvisor);
  els.rankInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runRankAdvisor();
  });
  els.rankProvinceSelect.addEventListener("change", () => {
    if (els.rankInput.value) runRankAdvisor();
  });
  els.rankTrackSelect.addEventListener("change", () => {
    if (els.rankInput.value) runRankAdvisor();
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

  const title = state.filters.province || "全国视图";
  const pointMode = usesSchoolPoints() ? "学校点" : "城市聚合";
  els.activeTitle.textContent = title;
  els.activeSubtitle.textContent = `${formatNumber.format(summary.total)} 所本科院校 · ${formatNumber.format(summary.cityCount)} 个城市/地区 · ${pointMode}`;
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

function mapMetric(stat) {
  if (state.mapMode === "private") return stat.privateCount;
  if (state.mapMode === "elite") return stat.eliteCount;
  return stat.count;
}

function cityKeyOf(school) {
  return `${school.province}::${school.city}`;
}

function usesSchoolPoints() {
  return state.filtered.length <= SCHOOL_POINT_LIMIT || state.filters.query.length >= 2;
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

function colorScale(value, max) {
  if (!value) return "#dfeaf2";
  const t = Math.max(0, Math.min(1, value / Math.max(max, 1)));
  if (t < 0.34) return "#c7ddf4";
  if (t < 0.58) return "#8dbbec";
  if (t < 0.8) return "#4f90e4";
  return "#1f66d1";
}

function renderMap() {
  if (!state.chart) return;
  state.chart.dispatchAction({
    type: "hideTip",
  });
  state.chart.clear();

  const provinceStats = aggregateByProvince(state.filtered);
  const maxValue = Math.max(...provinceStats.map(mapMetric), 1);
  const statMap = new Map(provinceStats.map((stat) => [stat.name, stat]));
  const regions = state.data.provinceStats.map((province) => {
    const stat = statMap.get(province.name) || { count: 0, privateCount: 0, eliteCount: 0 };
    const value = mapMetric(stat);
    return {
      name: province.name,
      itemStyle: {
        areaColor: colorScale(value, maxValue),
      },
    };
  });

  const schoolPointMode = usesSchoolPoints();
  const cityGroups = aggregateByCity(state.filtered).filter((city) => city.coord);
  const maxCityValue = Math.max(...cityGroups.map(mapMetric), 1);
  const pointData = schoolPointMode
    ? state.filtered
        .filter((school) => school.coord)
        .map((school) => ({
          id: school.id,
          name: school.name,
          value: [...school.coord, school.tags.doubleFirstClass ? 3 : school.tags.is211 ? 2 : 1],
          school,
        }))
    : cityGroups.map((city) => ({
        id: city.key,
        name: city.name,
        value: [...city.coord, mapMetric(city), city.count],
        cityGroup: city,
      }));

  state.chart.setOption(
    {
      animation: false,
      hoverLayerThreshold: Number.POSITIVE_INFINITY,
      tooltip: {
        show: false,
        trigger: "item",
        renderMode: "richText",
        confine: true,
        transitionDuration: 0,
        showDelay: 80,
        borderWidth: 0,
        backgroundColor: "rgba(255,255,255,0.96)",
        padding: 12,
        textStyle: {
          color: "#182635",
          fontFamily: "Avenir Next, PingFang SC, Microsoft YaHei, sans-serif",
        },
        formatter(params) {
          if (params.data?.cityGroup) {
            const city = params.data.cityGroup;
            const topSchools = city.schools
              .slice(0, 5)
              .map((school) => school.name)
              .join("、");
            return `${city.province} · ${city.name}\n本科院校 ${city.count} 所\n重点标签 ${city.eliteCount} 所 · 民办 ${city.privateCount} 所\n${topSchools}`;
          }
          if (params.data?.school) {
            const school = params.data.school;
            const tags = getTagLabels(school)
              .slice(0, 4)
              .map(([label]) => label)
              .join(" / ");
            return `${school.name}\n${school.province} · ${school.city}\n${school.department}\n${tags}`;
          }
          const stat = statMap.get(params.name);
          if (!stat) return `${params.name}\n本科院校 0 所`;
          return `${params.name}\n本科院校 ${stat.count} 所\n重点标签 ${stat.eliteCount} 所\n民办 ${stat.privateCount} 所`;
        },
      },
      geo: {
        map: "china",
        roam: true,
        zoom: state.mapZoom,
        scaleLimit: {
          min: 0.75,
          max: 4.2,
        },
        top: 62,
        bottom: 34,
        left: 26,
        right: 26,
        selectedMode: false,
        itemStyle: {
          borderColor: "#b8ccd9",
          borderWidth: 0.8,
          areaColor: "#dfeaf2",
        },
        emphasis: {
          label: {
            show: false,
            color: "#18314a",
            fontSize: 12,
            fontWeight: 800,
          },
          itemStyle: {
            areaColor: "#f7d58b",
            borderColor: "#db9e2c",
          },
        },
        regions,
      },
      series: [
        {
          name: schoolPointMode ? "本科院校" : "城市聚合",
          type: "scatter",
          coordinateSystem: "geo",
          data: pointData,
          symbolSize(value, params) {
            if (params.data.cityGroup) {
              const metric = mapMetric(params.data.cityGroup);
              return Math.max(9, Math.min(32, 7 + Math.sqrt(Math.max(metric, 1)) * 3.2));
            }
            const school = params.data.school;
            if (school.tags.is985) return 10;
            if (school.tags.is211 || school.tags.doubleFirstClass) return 8;
            return 5.4;
          },
          label: {
            show: !schoolPointMode,
            formatter(params) {
              const city = params.data.cityGroup;
              if (!city) return "";
              return city.count >= 6 ? String(city.count) : "";
            },
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 900,
          },
          itemStyle: {
            color(params) {
              if (params.data.cityGroup) {
                const city = params.data.cityGroup;
                if (city.key === state.selectedCityKey) return "#e96d43";
                if (state.mapMode === "elite" && city.eliteCount) return "#f0b64a";
                if (state.mapMode === "private" && city.privateCount) return "#2f8f75";
                return colorScale(mapMetric(city), maxCityValue);
              }
              const school = params.data.school;
              if (school.tags.is985) return "#e96d43";
              if (school.tags.doubleFirstClass) return "#f0b64a";
              if (school.nature === "民办") return "#2f8f75";
              return "#1f66d1";
            },
            borderColor: "#ffffff",
            borderWidth: schoolPointMode ? 1.1 : 1.8,
          },
          emphasis: {
            scale: schoolPointMode ? 1.5 : 1.18,
            label: {
              show: !schoolPointMode,
              formatter(params) {
                const city = params.data.cityGroup;
                return city ? `${city.name} ${city.count}` : "";
              },
              color: "#182635",
              fontSize: 12,
              fontWeight: 900,
              backgroundColor: "rgba(255,255,255,0.92)",
              borderRadius: 4,
              padding: [2, 5],
              position: "top",
            },
            itemStyle: {
              borderColor: "#182635",
              borderWidth: 1.6,
            },
          },
          progressive: 600,
          progressiveThreshold: 900,
        },
      ],
    },
    {
      notMerge: true,
      lazyUpdate: true,
    },
  );
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
      selectSchool(row.dataset.schoolId, true);
    });
  });

  els.loadMore.classList.toggle("visible", state.filtered.length > state.visibleRows);
}

function renderSelectedDetail() {
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
      <h2>选择地图点或列表院校</h2>
      <p>当前显示 ${formatNumber.format(state.filtered.length)} 所本科院校。</p>
    `;
    return;
  }

  const tags = getTagLabels(school)
    .map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`)
    .join("");
  const majors = (school.majorRankings || [])
    .map(
      (major) => `
        <div class="major-row">
          <span>${major.name}</span>
          <strong>${major.grade}</strong>
          <em>约第 ${major.estimatedRank} 名</em>
        </div>
      `,
    )
    .join("");
  els.detailCard.className = "detail-card";
  els.detailCard.innerHTML = `
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
    <div class="detail-actions">
      <button class="primary-action" id="filterCityDetail">${school.city}</button>
      <button class="ghost-action" id="filterProvinceDetail">${school.province}</button>
    </div>
  `;
  document.querySelector("#filterCityDetail").addEventListener("click", () => {
    state.selectedCityKey = cityKeyOf(school);
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
    <span class="detail-kicker">${city.province}</span>
    <h2>${city.name} · ${city.count} 所本科</h2>
    <p>公办 ${city.publicCount} 所 · 民办 ${city.privateCount} 所 · 重点标签 ${city.eliteCount} 所<br/>${topCategories || "暂无类型统计"}</p>
    <div class="city-school-list">${topSchools}</div>
    <div class="detail-actions">
      <button class="primary-action" id="filterCityProvince">${city.province}</button>
      <button class="ghost-action" id="clearCitySelection">返回全国</button>
    </div>
  `;

  els.detailCard.querySelectorAll("[data-city-school-id]").forEach((button) => {
    button.addEventListener("click", () => selectSchool(button.dataset.citySchoolId, true));
  });
  document.querySelector("#filterCityProvince").addEventListener("click", () => {
    state.filters.province = city.province;
    els.provinceSelect.value = city.province;
    state.visibleRows = 160;
    applyFilters();
  });
  document.querySelector("#clearCitySelection").addEventListener("click", () => {
    state.selectedCityKey = null;
    state.selectedId = null;
    renderMap();
    renderSelectedDetail();
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rankTargetScore(province, rank, track) {
  const pool = provinceRankPools[province] || 400000;
  const percentile = clamp(rank / pool, 0.0001, 0.98);
  const trackAdjustment = track === "history" ? -2.5 : 0;
  return clamp(98 - Math.sqrt(percentile) * 65 + trackAdjustment, 36, 98);
}

function rankBandFromDiff(diff) {
  if (diff >= 4 && diff <= 13) return "冲";
  if (diff >= -6 && diff < 4) return "稳";
  if (diff >= -18 && diff < -6) return "保";
  return "";
}

function rankAdvisorMatches(province, rank, track) {
  const target = rankTargetScore(province, rank, track);
  const matches = state.data.schools
    .map((school) => {
      const localPlanAdjustment = school.province === province ? -2.5 : 0;
      const adjustedScore = (school.admission?.estimateScore || school.recommendation?.score || 50) + localPlanAdjustment;
      const diff = adjustedScore - target;
      const band = rankBandFromDiff(diff);
      return {
        school,
        band,
        diff,
        target,
        adjustedScore,
      };
    })
    .filter((item) => item.band)
    .sort((a, b) => {
      const bandOrder = { 冲: 0, 稳: 1, 保: 2 };
      return (
        bandOrder[a.band] - bandOrder[b.band] ||
        Math.abs(a.diff) - Math.abs(b.diff) ||
        compareSchools(a.school, b.school)
      );
    });

  return ["冲", "稳", "保"].flatMap((band) => matches.filter((item) => item.band === band).slice(0, 8));
}

function runRankAdvisor() {
  const province = els.rankProvinceSelect.value;
  const track = els.rankTrackSelect.value;
  const rank = Number(els.rankInput.value);

  if (!province || !Number.isFinite(rank) || rank < 1) {
    state.rankMatches = [];
    state.rankQuery = null;
    els.rankSummary.textContent = "请输入有效的全省排名，例如 52000。";
    els.rankResults.innerHTML = "";
    return;
  }

  const target = rankTargetScore(province, rank, track);
  state.rankQuery = { province, rank, track, target };
  state.rankMatches = rankAdvisorMatches(province, rank, track);
  renderRankResults();
}

function renderRankResults() {
  if (!state.rankQuery) {
    els.rankSummary.textContent = "输入高考省排名后，按冲 / 稳 / 保给出大致院校。";
    els.rankResults.innerHTML = "";
    return;
  }

  const { province, rank, target } = state.rankQuery;
  els.rankSummary.textContent = `${province} 第 ${formatNumber.format(rank)} 名，模型目标分约 ${target.toFixed(1)}。结果仅用于初筛。`;

  if (!state.rankMatches.length) {
    els.rankResults.innerHTML = `<div class="empty-note">暂未匹配到候选院校，请调整排名或省份。</div>`;
    return;
  }

  els.rankResults.innerHTML = ["冲", "稳", "保"]
    .map((band) => {
      const items = state.rankMatches.filter((item) => item.band === band);
      if (!items.length) return "";
      return `
        <div class="rank-band">
          <h3>${band}</h3>
          ${items
            .map(
              ({ school, diff }) => `
                <button type="button" data-rank-school-id="${school.id}">
                  <strong>${school.name}</strong>
                  <span>${school.province} · ${school.city} · ${school.recommendation?.score || "-"}分 · ${diff > 0 ? "+" : ""}${diff.toFixed(1)}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      `;
    })
    .join("");

  els.rankResults.querySelectorAll("[data-rank-school-id]").forEach((button) => {
    button.addEventListener("click", () => selectSchool(button.dataset.rankSchoolId, true));
  });
}

function selectCity(cityKey) {
  state.selectedCityKey = cityKey;
  state.selectedId = null;
  renderMap();
  renderSelectedDetail();
}

function selectSchool(id, centerMap = false) {
  state.selectedId = id;
  const school = state.data.schools.find((item) => item.id === id);
  state.selectedCityKey = school ? cityKeyOf(school) : null;
  renderSelectedDetail();
  renderList();
  if (centerMap && school?.coord && usesSchoolPoints()) {
    state.chart.dispatchAction({
      type: "showTip",
      seriesIndex: 0,
      dataIndex: state.filtered.findIndex((item) => item.id === id),
    });
  }
}

function resetMapView() {
  state.mapZoom = DEFAULT_MAP_ZOOM;
  state.chart.setOption(
    {
      geo: {
        zoom: state.mapZoom,
        center: null,
      },
    },
    {
      lazyUpdate: true,
    },
  );
}

function zoomMap(factor) {
  state.mapZoom = Math.max(0.75, Math.min(4.2, Number((state.mapZoom * factor).toFixed(2))));
  state.chart.setOption(
    {
      geo: {
        zoom: state.mapZoom,
      },
    },
    {
      lazyUpdate: true,
    },
  );
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
  echarts.registerMap("china", china);
  state.chart = echarts.init(els.mapChart, null, { renderer: "canvas", useDirtyRect: true });

  state.chart.on("click", (params) => {
    if (params.data?.cityGroup) {
      selectCity(params.data.cityGroup.key);
      return;
    }
    if (params.data?.school) {
      selectSchool(params.data.school.id);
      return;
    }
    if (params.name && state.data.provinceStats.some((province) => province.name === params.name)) {
      state.filters.province = params.name;
      els.provinceSelect.value = params.name;
      state.visibleRows = 160;
      applyFilters();
    }
  });

  initControls();
  applyFilters();
  window.addEventListener("resize", debounce(() => state.chart.resize(), 100));
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
