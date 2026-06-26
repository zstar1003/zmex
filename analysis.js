const provinceCodes = {
  北京市: "11",
  天津市: "12",
  河北省: "13",
  山西省: "14",
  内蒙古自治区: "15",
  辽宁省: "21",
  吉林省: "22",
  黑龙江省: "23",
  上海市: "31",
  江苏省: "32",
  浙江省: "33",
  安徽省: "34",
  福建省: "35",
  江西省: "36",
  山东省: "37",
  河南省: "41",
  湖北省: "42",
  湖南省: "43",
  广东省: "44",
  广西壮族自治区: "45",
  海南省: "46",
  重庆市: "50",
  四川省: "51",
  贵州省: "52",
  云南省: "53",
  西藏自治区: "54",
  陕西省: "61",
  甘肃省: "62",
  青海省: "63",
  宁夏回族自治区: "64",
  新疆维吾尔自治区: "65",
};

const formatNumber = new Intl.NumberFormat("zh-CN");
const years = [2021, 2022, 2023, 2024, 2025];
const els = {
  form: document.querySelector("#analysisForm"),
  province: document.querySelector("#analysisProvince"),
  school: document.querySelector("#analysisSchool"),
  schoolList: document.querySelector("#analysisSchoolList"),
  major: document.querySelector("#analysisMajor"),
  track: document.querySelector("#analysisTrack"),
  title: document.querySelector("#analysisTitle"),
  count: document.querySelector("#analysisCount"),
  summary: document.querySelector("#analysisSummary"),
  sourceNote: document.querySelector("#analysisSourceNote"),
  rankChart: document.querySelector("#rankTrendChart"),
  planChart: document.querySelector("#planTrendChart"),
  tableBody: document.querySelector("#analysisTableBody"),
};

let schools = [];
let providerByName = new Map();
let rankChart = null;
let planChart = null;

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

function normalizeMajor(value) {
  return String(value || "")
    .trim()
    .replace(/[（(]/g, "")
    .replace(/[）)]/g, "")
    .replace(/\s+/g, "");
}

function normalizeGroupMajor(value) {
  return String(value || "")
    .trim()
    .replace(/[（(]([^）)]*?)[，,]含[^）)]*[）)]/g, "$1")
    .replace(/[（(]含[^）)]*[）)]/g, "")
    .replace(/[（(]/g, "")
    .replace(/[）)]/g, "")
    .replace(/\s+/g, "");
}

function providerSchools(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function resolveProviderSchool(input) {
  const normalized = normalizeName(input);
  if (providerByName.has(normalized)) return providerByName.get(normalized);
  const localSchool = schools.find((school) => normalizeName(school.name).includes(normalized));
  return localSchool ? providerByName.get(normalizeName(localSchool.name)) : null;
}

function trackLabel(track) {
  return {
    physics: "物理/理科",
    history: "历史/文科",
    general: "综合",
  }[track] || track || "-";
}

function setEmpty(message) {
  els.count.textContent = "0";
  els.summary.textContent = message;
  els.sourceNote.textContent = "当前条件下没有可展示的数据。";
  els.tableBody.innerHTML = "";
  rankChart?.clear();
  planChart?.clear();
}

function filterRecords(records, majorKeyword, track) {
  const keyword = normalizeMajor(majorKeyword);
  return records.filter((record) => {
    if (track && record.track !== track) return false;
    if (keyword && !normalizeMajor(record.majorName).includes(keyword)) return false;
    return true;
  });
}

function groupRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const key = normalizeGroupMajor(record.majorName) || normalizeMajor(record.majorName) || record.majorName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      name: items.sort((a, b) => b.year - a.year || a.minRank - b.minRank)[0].majorName,
      records: items.sort((a, b) => a.year - b.year || a.minRank - b.minRank),
      yearCount: new Set(items.map((item) => item.year)).size,
      bestRank: Math.min(...items.map((item) => item.minRank)),
    }))
    .sort((a, b) => b.yearCount - a.yearCount || a.bestRank - b.bestRank)
    .slice(0, 8);
}

function buildPlanTrend(records, planRecords) {
  return years.map((year) => {
    const yearRecords = records.filter((record) => record.year === year);
    const resultCountRecords = yearRecords.filter(
      (record) => record.countSource === "录取结果" && record.planCount,
    );
    if (yearRecords.length && resultCountRecords.length === yearRecords.length) {
      return {
        value: resultCountRecords.reduce((sum, record) => sum + record.planCount, 0),
        source: "录取结果",
        coverage: `${resultCountRecords.length}/${yearRecords.length}`,
      };
    }

    const yearPlanRecords = planRecords.filter((record) => record.year === year && record.planCount);
    if (yearPlanRecords.length) {
      return {
        value: yearPlanRecords.reduce((sum, record) => sum + record.planCount, 0),
        source: "招生计划",
        coverage: `${yearPlanRecords.length} 项`,
      };
    }

    return { value: null, source: "缺失", coverage: `${resultCountRecords.length}/${yearRecords.length}` };
  });
}

function renderCharts(groups, records, planRecords) {
  rankChart ||= echarts.init(els.rankChart);
  planChart ||= echarts.init(els.planChart);
  const palette = ["#9f3f42", "#c46a58", "#6f7d63", "#3f6f79", "#b08a3d", "#5e5b72", "#c58a8c", "#7f9b90"];
  const rankSeries = groups.map((group, index) => {
    const bestByYear = new Map();
    for (const record of group.records) {
      const previous = bestByYear.get(record.year);
      if (!previous || record.minRank < previous.minRank) bestByYear.set(record.year, record);
    }
    return {
      name: group.name,
      type: "line",
      smooth: true,
      symbolSize: 7,
      connectNulls: false,
      color: palette[index % palette.length],
      data: years.map((year) => bestByYear.get(year)?.minRank ?? null),
    };
  });
  const planTrend = buildPlanTrend(records, planRecords);

  rankChart.setOption({
    color: palette,
    tooltip: { trigger: "axis", valueFormatter: (value) => value ? `${formatNumber.format(value)} 名` : "-" },
    legend: { type: "scroll", bottom: 0, textStyle: { color: "#584447" } },
    grid: { left: 58, right: 20, top: 24, bottom: 62 },
    xAxis: { type: "category", data: years },
    yAxis: { type: "value", inverse: true, axisLabel: { formatter: (value) => formatNumber.format(value) } },
    series: rankSeries,
  });
  planChart.setOption({
    color: ["#b85658"],
    tooltip: {
      trigger: "axis",
      formatter: (items) => {
        const item = items[0];
        const data = item.data || {};
        if (!data.value) return `${item.axisValue}<br/>人数：缺失`;
        return `${item.axisValue}<br/>人数：${formatNumber.format(data.value)}<br/>来源：${data.source}<br/>覆盖：${data.coverage}`;
      },
    },
    grid: { left: 48, right: 18, top: 24, bottom: 36 },
    xAxis: { type: "category", data: years },
    yAxis: { type: "value" },
    series: [
      {
        name: "人数",
        type: "bar",
        barMaxWidth: 34,
        data: planTrend.map((item) => ({
          value: item.value,
          source: item.source,
          coverage: item.coverage,
          itemStyle: { opacity: item.source === "招生计划" ? 0.78 : 1 },
        })),
      },
    ],
  });
}

function countLabel(record) {
  if (!record.planCount) return "未公开";
  const source = record.countSource === "招生计划" ? "计划" : "录取";
  return `${formatNumber.format(record.planCount)} <span class="analysis-count-source">${source}</span>`;
}

function renderTable(groups) {
  const rows = groups
    .flatMap((group) => group.records.map((record) => ({ ...record, displayMajor: group.name })))
    .sort((a, b) => b.year - a.year || a.minRank - b.minRank)
    .slice(0, 160);
  els.tableBody.innerHTML = rows
    .map(
      (record) => `
        <tr>
          <td>${record.year}</td>
          <td>${record.majorName}</td>
          <td>${trackLabel(record.track)}</td>
          <td>${formatNumber.format(record.minRank)}</td>
          <td>${record.minScore || "-"}</td>
          <td>${countLabel(record)}</td>
          <td>${record.batch || "-"}</td>
        </tr>
      `,
    )
    .join("");
}

async function runQuery() {
  const province = els.province.value;
  const providerSchool = resolveProviderSchool(els.school.value);
  if (!providerSchool) {
    els.title.textContent = "未找到学校";
    setEmpty("当前学校没有匹配到可查询的公开历史源。");
    return;
  }
  const provinceCode = provinceCodes[province];
  els.title.textContent = `${els.school.value || providerSchool.name} · ${province}`;
  els.summary.textContent = "正在读取近 5 年公开记录…";
  els.count.textContent = "0";

  const response = await fetch(`/api/gaokao-history?schoolId=${providerSchool.school_id}&provinceCode=${provinceCode}`);
  if (!response.ok) {
    setEmpty("历史数据接口读取失败。");
    return;
  }
  const payload = await response.json();
  const records = filterRecords(payload.records || [], els.major.value, els.track.value);
  const planRecords = filterRecords(payload.planRecords || [], els.major.value, els.track.value);
  const groups = groupRecords(records);
  const scoreYears = payload.sources
    .filter((source) => source.kind === "score" && source.status === 200)
    .map((source) => source.year);
  const planYears = payload.sources
    .filter((source) => source.kind === "plan" && source.status === 200)
    .map((source) => source.year);
  const incompleteYears = payload.sources
    .filter(
      (source) =>
        source.kind === "score" &&
        source.status === 200 &&
        source.importedRecordCount &&
        source.resultCountKnown < source.importedRecordCount,
    )
    .map((source) => source.year);
  els.sourceNote.textContent = scoreYears.length
    ? `最低位次命中 ${scoreYears.join("、")} 年；人数优先用录取结果，${planYears.join("、")} 年可用招生计划回填。${incompleteYears.length ? ` ${incompleteYears.join("、")} 年录取人数源不完整，已避免按残缺人数汇总。` : ""}`
    : "近 5 年暂未命中公开源。";
  const totalRows = records.length;
  els.count.textContent = String(totalRows);
  if (!groups.length) {
    setEmpty("当前条件下没有可展示的最低位次记录。");
    return;
  }
  els.summary.textContent = `展示 ${groups.length} 个专业方向、${formatNumber.format(totalRows)} 条记录；折线越靠上，录取位次越靠前。`;
  renderCharts(groups, records, planRecords);
  renderTable(groups);
}

async function init() {
  const [schoolPayload, providerPayload] = await Promise.all([
    fetch("./data/schools.json").then((response) => response.json()),
    fetch("./data/admissions/raw/gaokaocn-school-code.json").then((response) => response.json()),
  ]);
  schools = [...(schoolPayload.schools || []), ...(schoolPayload.admissionSchools || [])].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
  providerByName = new Map(providerSchools(providerPayload).map((school) => [normalizeName(school.name), school]));
  els.province.innerHTML = Object.keys(provinceCodes)
    .map((province) => `<option value="${province}">${province}</option>`)
    .join("");
  els.province.value = "浙江省";
  els.schoolList.innerHTML = schools
    .slice(0, 1800)
    .map((school) => `<option value="${school.name}"></option>`)
    .join("");
  els.school.value = "浙江大学";
  els.major.value = "";
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runQuery();
  });
  window.addEventListener("resize", () => {
    rankChart?.resize();
    planChart?.resize();
  });
}

init();
