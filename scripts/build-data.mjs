import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rowsPath = path.join(root, "data/raw/moe-colleges-2025.rows.json");
const cityGeoPath = path.join(root, "data/raw/latlng.json");
const supplementalSchoolsPath = path.join(root, "data/admissions/supplemental-schools.json");
const outPath = path.join(root, "data/schools.json");

const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
const cityTree = JSON.parse(fs.readFileSync(cityGeoPath, "utf8"));
const supplementalSchools = JSON.parse(fs.readFileSync(supplementalSchoolsPath, "utf8"));

const provinceCenters = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(root, "data/china.json"), "utf8")).features.map((feature) => [
    feature.properties.name,
    feature.properties.center,
  ]),
);

const school985 = new Set([
  "北京大学",
  "中国人民大学",
  "清华大学",
  "北京航空航天大学",
  "北京理工大学",
  "中国农业大学",
  "北京师范大学",
  "中央民族大学",
  "南开大学",
  "天津大学",
  "大连理工大学",
  "东北大学",
  "吉林大学",
  "哈尔滨工业大学",
  "复旦大学",
  "同济大学",
  "上海交通大学",
  "华东师范大学",
  "南京大学",
  "东南大学",
  "浙江大学",
  "中国科学技术大学",
  "厦门大学",
  "山东大学",
  "中国海洋大学",
  "武汉大学",
  "华中科技大学",
  "湖南大学",
  "中南大学",
  "中山大学",
  "华南理工大学",
  "四川大学",
  "电子科技大学",
  "重庆大学",
  "西安交通大学",
  "西北工业大学",
  "西北农林科技大学",
  "兰州大学",
]);

const school211Extra = new Set([
  "北京工业大学",
  "北京交通大学",
  "北京科技大学",
  "北京化工大学",
  "北京邮电大学",
  "北京林业大学",
  "北京中医药大学",
  "北京外国语大学",
  "中国传媒大学",
  "中央财经大学",
  "对外经济贸易大学",
  "北京体育大学",
  "中央音乐学院",
  "中国政法大学",
  "华北电力大学",
  "中国矿业大学（北京）",
  "中国石油大学（北京）",
  "中国地质大学（北京）",
  "天津医科大学",
  "河北工业大学",
  "太原理工大学",
  "内蒙古大学",
  "辽宁大学",
  "大连海事大学",
  "延边大学",
  "东北师范大学",
  "哈尔滨工程大学",
  "东北农业大学",
  "东北林业大学",
  "华东理工大学",
  "东华大学",
  "上海外国语大学",
  "上海财经大学",
  "上海大学",
  "苏州大学",
  "南京航空航天大学",
  "南京理工大学",
  "中国矿业大学",
  "河海大学",
  "江南大学",
  "南京农业大学",
  "中国药科大学",
  "南京师范大学",
  "安徽大学",
  "合肥工业大学",
  "福州大学",
  "南昌大学",
  "中国石油大学（华东）",
  "郑州大学",
  "武汉理工大学",
  "华中农业大学",
  "华中师范大学",
  "中南财经政法大学",
  "中国地质大学（武汉）",
  "湖南师范大学",
  "暨南大学",
  "华南师范大学",
  "广西大学",
  "海南大学",
  "西南大学",
  "西南交通大学",
  "四川农业大学",
  "西南财经大学",
  "贵州大学",
  "云南大学",
  "西藏大学",
  "西北大学",
  "西安电子科技大学",
  "长安大学",
  "陕西师范大学",
  "青海大学",
  "宁夏大学",
  "新疆大学",
  "石河子大学",
]);

const doubleFirstClassExtra = new Set([
  "北京协和医学院",
  "首都师范大学",
  "外交学院",
  "中国人民公安大学",
  "中国音乐学院",
  "中央美术学院",
  "中央戏剧学院",
  "中国科学院大学",
  "天津工业大学",
  "天津中医药大学",
  "山西大学",
  "上海海洋大学",
  "上海中医药大学",
  "上海体育大学",
  "上海音乐学院",
  "上海科技大学",
  "南京邮电大学",
  "南京林业大学",
  "南京信息工程大学",
  "南京中医药大学",
  "南京医科大学",
  "中国美术学院",
  "宁波大学",
  "河南大学",
  "湘潭大学",
  "广州医科大学",
  "广州中医药大学",
  "华南农业大学",
  "南方科技大学",
  "成都理工大学",
  "西南石油大学",
  "成都中医药大学",
]);

const centralDepartments = new Set([
  "教育部",
  "工业和信息化部",
  "国家民委",
  "国家卫生健康委员会",
  "公安部",
  "司法部",
  "交通运输部（中国民用航空局）",
  "应急管理部",
  "中华全国总工会",
  "中华妇女联合会",
  "共青团中央",
  "外交部",
  "中国科学院",
  "中国社会科学院",
  "国家体育总局",
  "民政部",
  "中国地震局",
  "新疆生产建设兵团",
]);

const categoryRules = [
  ["医药", /医科|医学院|医学|中医药|药科|卫生|协和/],
  ["师范", /师范|教育|学前/],
  ["财经", /财经|财政|经济|金融|工商|商学院|商业|审计|对外经济贸易/],
  ["政法", /政法|警察|公安|司法|外交|国际关系|消防/],
  ["艺术", /艺术|音乐|美术|戏剧|电影|舞蹈|戏曲|传媒|服装|设计/],
  ["体育", /体育/],
  ["民族", /民族/],
  ["语言", /外国语|语言|翻译/],
  ["农林", /农业|农林|林业|农学院|牧|草业/],
  ["理工", /理工|工业|科技|交通|航空|航天|石油|矿业|地质|电力|电子|邮电|建筑|工程|水利|海事|信息|轻工|纺织|职业技术大学/],
];

const majorTemplates = {
  综合: ["计算机科学与技术", "汉语言文学", "法学", "经济学", "数学与应用数学", "工商管理"],
  理工: ["计算机科学与技术", "电子信息工程", "软件工程", "自动化", "机械工程", "土木工程"],
  医药: ["临床医学", "口腔医学", "药学", "中医学", "护理学", "医学影像学"],
  师范: ["汉语言文学", "数学与应用数学", "英语", "教育学", "学前教育", "物理学"],
  财经: ["金融学", "会计学", "经济学", "财务管理", "国际经济与贸易", "工商管理"],
  政法: ["法学", "公安学", "政治学与行政学", "社会工作", "侦查学", "行政管理"],
  艺术: ["视觉传达设计", "音乐表演", "美术学", "戏剧影视文学", "动画", "舞蹈表演"],
  体育: ["体育教育", "运动训练", "社会体育指导与管理", "运动康复", "武术与民族传统体育"],
  民族: ["民族学", "汉语言文学", "社会学", "法学", "旅游管理", "经济学"],
  语言: ["英语", "翻译", "商务英语", "汉语国际教育", "日语", "俄语"],
  农林: ["农学", "林学", "园艺", "动物医学", "植物保护", "农业资源与环境"],
};

const schoolMajorOverrides = {
  北京大学: ["数学与应用数学", "物理学", "临床医学", "法学", "经济学", "计算机科学与技术"],
  清华大学: ["计算机科学与技术", "人工智能", "自动化", "建筑学", "电子信息工程", "机械工程"],
  中国人民大学: ["法学", "经济学", "金融学", "新闻学", "工商管理", "社会学"],
  北京航空航天大学: ["航空航天工程", "计算机科学与技术", "软件工程", "自动化", "飞行器设计与工程"],
  北京理工大学: ["兵器类", "车辆工程", "信息对抗技术", "自动化", "计算机科学与技术"],
  北京师范大学: ["教育学", "心理学", "汉语言文学", "数学与应用数学", "历史学"],
  复旦大学: ["临床医学", "新闻学", "经济学", "数学与应用数学", "法学", "哲学"],
  上海交通大学: ["船舶与海洋工程", "机械工程", "临床医学", "计算机科学与技术", "电子信息工程"],
  同济大学: ["土木工程", "建筑学", "城乡规划", "车辆工程", "交通工程"],
  浙江大学: ["计算机科学与技术", "人工智能", "农业工程", "临床医学", "控制科学与工程"],
  南京大学: ["天文学", "地质学", "物理学", "计算机科学与技术", "汉语言文学"],
  中国科学技术大学: ["物理学", "数学与应用数学", "计算机科学与技术", "化学", "核工程与核技术"],
  哈尔滨工业大学: ["航天工程", "机器人工程", "计算机科学与技术", "机械工程", "焊接技术与工程"],
  西安交通大学: ["电气工程及其自动化", "能源与动力工程", "机械工程", "人工智能", "临床医学"],
  华中科技大学: ["机械工程", "光电信息科学与工程", "临床医学", "计算机科学与技术", "电气工程及其自动化"],
  武汉大学: ["测绘工程", "法学", "水利水电工程", "图书馆学", "计算机科学与技术"],
  中山大学: ["临床医学", "工商管理", "生态学", "哲学", "数学与应用数学"],
  四川大学: ["口腔医学", "临床医学", "高分子材料与工程", "汉语言文学", "软件工程"],
  电子科技大学: ["电子科学与技术", "通信工程", "计算机科学与技术", "集成电路设计与集成系统", "软件工程"],
  西安电子科技大学: [
    "电子信息类(集成电路)",
    "电子信息类(通信)",
    "计算机类(智能)",
    "计算机类",
    "电子信息类(电子工程)",
    "计算机类(网络安全)",
    "自动化类(智能制造及智能测控)",
    "数学类(数学、统计与信息、计算机科学深度融合培养)",
  ],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function recommendationScore({ school, category, is985, is211, isDoubleFirstClass, nature, adminLevel }) {
  let score = 48;
  if (is985) score += 35;
  else if (is211) score += 24;
  else if (isDoubleFirstClass) score += 18;

  if (adminLevel === "中央部委") score += 6;
  if (nature === "公办") score += 5;
  if (nature === "民办") score -= 8;
  if (/职业|技术大学/.test(school.name)) score -= 4;
  if (["医药", "财经", "政法", "艺术", "语言", "体育"].includes(category)) score += 2;
  if (/学院$/.test(school.name)) score -= 2;
  if (/大学$/.test(school.name)) score += 2;

  return Math.round(clamp(score, 32, 99));
}

function recommendationBand(score) {
  if (score >= 92) return "顶尖冲刺";
  if (score >= 82) return "重点优选";
  if (score >= 70) return "区域强校";
  if (score >= 58) return "稳妥本科";
  return "保底参考";
}

function majorGrade(rank) {
  if (rank <= 15) return "A+";
  if (rank <= 45) return "A";
  if (rank <= 90) return "B+";
  if (rank <= 150) return "B";
  return "B-";
}

function majorRankingsForSchool(school, category, score) {
  const majors = schoolMajorOverrides[school.name] || majorTemplates[category] || majorTemplates.综合;
  const categoryBoost = school.name.includes(category === "理工" ? "科技" : category) ? 8 : 0;
  const visibleMajorCount = schoolMajorOverrides[school.name] ? 8 : 6;
  return majors.slice(0, visibleMajorCount).map((major, index) => {
    const estimatedRank = Math.max(1, Math.round((100 - score) * 2.2 + index * 11 - categoryBoost));
    return {
      name: major,
      estimatedRank,
      grade: majorGrade(estimatedRank),
      basis: schoolMajorOverrides[school.name] ? "重点高校学科倾向" : `${category}类院校常见优势专业`,
    };
  });
}

function cleanName(name) {
  return String(name || "").trim();
}

function stripRegionSuffix(name) {
  return cleanName(name).replace(
    /(市|地区|盟|自治州|藏族自治州|蒙古自治州|回族自治州|哈萨克自治州|土家族苗族自治州|苗族侗族自治州|布依族苗族自治州|壮族苗族自治州|黎族自治县|彝族自治州|白族自治州|傣族景颇族自治州|哈尼族彝族自治州|朝鲜族自治州|柯尔克孜自治州)$/,
    "",
  );
}

function makeGeoIndex(rootNode) {
  const index = new Map();

  function add(name, lng, lat) {
    if (!name || lng === undefined || lat === undefined) return;
    const point = [Number(lng), Number(lat)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;

    const exact = cleanName(name);
    const short = stripRegionSuffix(exact);
    if (!index.has(exact)) index.set(exact, point);
    if (short && !index.has(short)) index.set(short, point);
    if (["北京", "上海", "天津", "重庆"].includes(exact)) index.set(`${exact}市`, point);
  }

  function visit(node) {
    add(node.name, node.lng, node.lat);
    for (const child of node.children || []) visit(child);
  }

  visit(rootNode);
  return index;
}

function schoolCategory(name) {
  const matched = categoryRules.find(([, rule]) => rule.test(name));
  return matched ? matched[0] : "综合";
}

function deterministicJitter(index, total) {
  if (total <= 1) return [0, 0];
  const goldenAngle = 2.399963229728653;
  const ring = Math.sqrt(index + 1);
  const angle = (index + 1) * goldenAngle;
  const radius = Math.min(0.28, 0.018 * ring + 0.012);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

let currentProvince = "";
const rawSchools = [];

for (const row of rows) {
  const first = cleanName(row[0]);
  const provinceMatch = first.match(/^(.+?)(?:（|\()(\d+)所(?:）|\))$/);
  if (provinceMatch) {
    currentProvince = provinceMatch[1];
    continue;
  }

  if (typeof row[0] !== "number") continue;
  if (!cleanName(row[5]).includes("本科")) continue;

  rawSchools.push({
    sourceIndex: row[0],
    name: cleanName(row[1]),
    code: cleanName(row[2]),
    department: cleanName(row[3]),
    city: cleanName(row[4]),
    level: cleanName(row[5]),
    note: cleanName(row[6]),
    province: currentProvince,
  });
}

const cityGeo = makeGeoIndex(cityTree);
const cityBuckets = new Map();
for (const school of rawSchools) {
  const key = `${school.province}::${school.city}`;
  if (!cityBuckets.has(key)) cityBuckets.set(key, []);
  cityBuckets.get(key).push(school);
}

const missingCoordinates = new Set();
const schools = rawSchools.map((school) => {
  const cityPoint =
    cityGeo.get(school.city) || cityGeo.get(stripRegionSuffix(school.city)) || provinceCenters[school.province];
  const cityKey = `${school.province}::${school.city}`;
  const cityList = cityBuckets.get(cityKey) || [];
  const cityIndex = cityList.indexOf(school);
  const [dx, dy] = deterministicJitter(cityIndex, cityList.length);
  const is985 = school985.has(school.name);
  const is211 = is985 || school211Extra.has(school.name);
  const isDoubleFirstClass = is211 || doubleFirstClassExtra.has(school.name);
  const nature = school.note.includes("民办") ? "民办" : "公办";
  const adminLevel = nature === "民办" ? "民办" : centralDepartments.has(school.department) ? "中央部委" : "地方";
  const category = schoolCategory(school.name);
  const score = recommendationScore({
    school,
    category,
    is985,
    is211,
    isDoubleFirstClass,
    nature,
    adminLevel,
  });

  if (!cityPoint) missingCoordinates.add(`${school.province}/${school.city}`);

  return {
    id: String(school.code || school.sourceIndex),
    sourceIndex: school.sourceIndex,
    name: school.name,
    code: school.code,
    province: school.province,
    city: school.city,
    department: school.department,
    level: school.level,
    note: school.note || "",
    nature,
    adminLevel,
    category,
    recommendation: {
      score,
      band: recommendationBand(score),
      reason: [
        is985 ? "985" : is211 ? "211" : isDoubleFirstClass ? "双一流" : "",
        adminLevel === "中央部委" ? "中央部委" : "",
        nature,
        category,
      ].filter(Boolean),
    },
    admission: {
      estimateScore: score,
      estimateType: "rank-percentile-model",
    },
    majorRankings: majorRankingsForSchool(school, category, score),
    tags: {
      is985,
      is211,
      doubleFirstClass: isDoubleFirstClass,
      vocationalUndergrad: /职业|技术大学/.test(school.name),
    },
    coord: cityPoint ? [Number((cityPoint[0] + dx).toFixed(6)), Number((cityPoint[1] + dy).toFixed(6))] : null,
    cityCenter: cityPoint || null,
    coordinatePrecision: cityPoint ? "city-center-jittered" : "missing",
  };
});

const provinceStats = Object.values(
  schools.reduce((acc, school) => {
    acc[school.province] ||= {
      name: school.province,
      count: 0,
      publicCount: 0,
      privateCount: 0,
      eliteCount: 0,
      doubleFirstClassCount: 0,
      cities: new Set(),
      categories: {},
    };
    const stat = acc[school.province];
    stat.count += 1;
    stat.cities.add(school.city);
    if (school.nature === "民办") stat.privateCount += 1;
    else stat.publicCount += 1;
    if (school.tags.is985 || school.tags.is211) stat.eliteCount += 1;
    if (school.tags.doubleFirstClass) stat.doubleFirstClassCount += 1;
    stat.categories[school.category] = (stat.categories[school.category] || 0) + 1;
    return acc;
  }, {}),
)
  .map((stat) => ({ ...stat, cityCount: stat.cities.size, cities: undefined }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));

const cityStats = Object.values(
  schools.reduce((acc, school) => {
    const key = `${school.province}::${school.city}`;
    acc[key] ||= {
      name: school.city,
      province: school.province,
      count: 0,
      privateCount: 0,
      publicCount: 0,
      doubleFirstClassCount: 0,
      coord: school.cityCenter,
    };
    acc[key].count += 1;
    if (school.nature === "民办") acc[key].privateCount += 1;
    else acc[key].publicCount += 1;
    if (school.tags.doubleFirstClass) acc[key].doubleFirstClassCount += 1;
    return acc;
  }, {}),
).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));

const payload = {
  meta: {
    title: "择木而栖",
    sourceName: "教育部《全国普通高等学校名单》",
    sourceUrl: "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/t20250627_1195683.html",
    sourceDate: "2025-06-20",
    publishedDate: "2025-06-27",
    scope: "普通本科院校，不含港澳台地区高等学校及军事院校",
    totalUndergraduateSchools: schools.length,
    recommendationSource:
      "院校推荐、专业优势和位次匹配为本项目估算模型，依据学校层次、主管部门、办学性质、院校类型和名称学科倾向生成；不替代各省一分一段表、招生计划和投档线。",
    majorRankingReference:
      "参考软科中国大学专业排名的学校-学科-专业三层次评价思路，当前静态站不内置完整商业排名明细。",
    doubleFirstClassSource:
      "教育部、财政部、国家发展改革委 2022 年第二轮“双一流”建设高校及建设学科名单",
    coordinateSource: "公开中国城市中心点经纬度数据，点位按城市中心做轻微离散化",
    generatedAt: new Date().toISOString(),
    missingCoordinates: [...missingCoordinates],
  },
  schools,
  admissionSchools: supplementalSchools.schools,
  provinceStats,
  cityStats,
  categories: ["综合", ...categoryRules.map(([category]) => category)].filter((value, index, array) => array.indexOf(value) === index),
};

fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Wrote ${schools.length} undergraduate schools to ${path.relative(root, outPath)}`);
console.log(`Province stats: ${provinceStats.length}; city stats: ${cityStats.length}`);
if (missingCoordinates.size) {
  console.warn(`Missing coordinates: ${[...missingCoordinates].join(", ")}`);
}
