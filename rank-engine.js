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

const modeledSchoolBaseOverrides = {
  清华大学: 96.8,
  北京大学: 96.7,
  上海交通大学: 95.8,
  复旦大学: 95.6,
  浙江大学: 95.4,
  中国科学技术大学: 95.3,
  南京大学: 94.8,
  中国人民大学: 94.5,
  北京航空航天大学: 94.3,
  哈尔滨工业大学: 94.1,
  西安交通大学: 93.8,
  同济大学: 93.4,
  东南大学: 93.2,
  北京理工大学: 93,
  华中科技大学: 92.9,
  武汉大学: 92.8,
  中山大学: 92.6,
  南开大学: 92.5,
  天津大学: 92.2,
  厦门大学: 92,
  北京师范大学: 91.9,
  电子科技大学: 90.8,
  西北工业大学: 90.6,
  华南理工大学: 90.4,
  四川大学: 90.2,
  山东大学: 90,
  中南大学: 89.9,
  湖南大学: 89.6,
  重庆大学: 89.4,
  吉林大学: 89.2,
  大连理工大学: 89,
  东北大学: 88.7,
  兰州大学: 88.2,
  西安电子科技大学: 86.2,
  北京邮电大学: 87.2,
  南京航空航天大学: 86.6,
  南京理工大学: 86.2,
  哈尔滨工程大学: 85.8,
  西南财经大学: 85.5,
  上海财经大学: 86.8,
  中央财经大学: 86.5,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

export function buildAdmissionIndex(payload = null, coverage = null) {
  const recordsBySchoolProvince = new Map();
  const sourcesById = new Map((payload?.sources || []).map((source) => [source.id, source]));
  const sourceFilesById = new Map(
    (payload?.sources || []).map((source) => [
      source.id,
      new Map(
        (source.files || []).map((file) => [
          String(file.providerSchoolId),
          file,
        ]),
      ),
    ]),
  );
  const coverageByProvince = new Map((coverage?.provinces || []).map((entry) => [entry.province, entry]));

  for (const record of payload?.records || []) {
    const key = `${record.schoolId}::${record.province}`;
    if (!recordsBySchoolProvince.has(key)) recordsBySchoolProvince.set(key, []);
    recordsBySchoolProvince.get(key).push(record);
  }

  return {
    recordsBySchoolProvince,
    sourcesById,
    sourceFilesById,
    coverageByProvince,
  };
}

export function admissionCoverageForProvince(admissionIndex, province) {
  return admissionIndex?.coverageByProvince?.get(province) || null;
}

export function verifiedLinesForSchool(school, province = "", track = "", admissionIndex = null) {
  if (!school || !province || !admissionIndex) return [];
  const records = admissionIndex.recordsBySchoolProvince.get(`${school.id}::${province}`) || [];
  const latestByMajor = new Map();

  for (const record of records) {
    if (track && record.track !== "general" && record.track !== track) continue;
    const previous = latestByMajor.get(record.majorName);
    const typePriority = { official: 3, aggregated: 2, estimated: 1 };
    const recordPriority = typePriority[record.dataType] || 0;
    const previousPriority = typePriority[previous?.dataType] || 0;
    if (
      !previous ||
      record.year > previous.year ||
      (record.year === previous.year && recordPriority > previousPriority) ||
      (record.year === previous.year &&
        recordPriority === previousPriority &&
        record.minRank > previous.minRank)
    ) {
      latestByMajor.set(record.majorName, record);
    }
  }

  return [...latestByMajor.values()]
    .map((record) => {
      const source = admissionIndex.sourcesById.get(record.sourceId);
      const sourceFile = admissionIndex.sourceFilesById
        ?.get(record.sourceId)
        ?.get(String(record.providerSchoolId || record.schoolCode || ""));
      const rankNote = {
        "official-score-cumulative": "由官方最低分与一分一段表对应，为同分考生位次上限。",
        "aggregated-min-rank": "公开专业录取数据中的最低位次。",
        "aggregated-score-cumulative": "由公开最低分与同年一分一段表对应，为同分考生位次上限。",
        "estimated-from-score": source?.rankEstimate?.note || "由公开最低分估算，误差可能较大。",
      }[record.rankMethod] || record.rankNote || "";
      return {
        name: record.majorName,
        minScore: record.minScore,
        minRank: record.minRank,
        subject: record.subjectRequirement || "选科要求见招生计划",
        province: record.province,
        track: record.track,
        year: record.year,
        batch: record.batch,
        schoolCode: record.schoolCode,
        majorCode: record.majorCode,
        planCount: record.planCount,
        rankMethod: record.rankMethod || "official-min-rank",
        rankNote,
        dataType: record.dataType || "official",
        sourceLabel:
          source?.authority ||
          (record.dataType === "aggregated" ? "公开招生数据平台" : "省级教育考试机构"),
        sourceUrl: record.sourceUrl || sourceFile?.sourceUrl || source?.pageUrl || "",
        sourceSha256: record.sourceSha256 || sourceFile?.sha256 || source?.sha256 || "",
        sourceId: record.sourceId,
      };
    })
    .sort((a, b) => a.minRank - b.minRank || a.name.localeCompare(b.name, "zh-CN"));
}

function scoreToEstimatedRank(province, score, track) {
  const pool = provinceRankPools[province] || 400000;
  const trackAdjustment = track === "history" ? -2.5 : 0;
  const root = clamp((98 + trackAdjustment - score) / 65, 0.012, 0.99);
  return Math.max(1, Math.round(root * root * pool));
}

function stableSchoolOffset(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return (hash / 997 - 0.5) * 0.8;
}

function modeledSchoolBaseScore(school) {
  if (modeledSchoolBaseOverrides[school.name]) return modeledSchoolBaseOverrides[school.name];

  let score = 62;
  if (school.tags.is985) score = 88.5;
  else if (school.tags.is211) score = 83.6;
  else if (school.tags.doubleFirstClass) score = 80.2;
  else if (school.nature === "公办") score = 72.5;

  if (school.adminLevel === "中央部委") score += 1;
  if (["医药", "财经", "政法", "语言"].includes(school.category)) score += 0.9;
  if (school.category === "理工") score += 0.5;
  if (school.tags.vocationalUndergrad) score -= 3;
  if (school.nature === "民办") score -= 4;
  if (/学院$/.test(school.name)) score -= 0.8;

  return clamp(score + stableSchoolOffset(school.name), 52, 92);
}

function modeledScoreCap(school) {
  if (["清华大学", "北京大学"].includes(school.name)) return 97.8;
  if (modeledSchoolBaseOverrides[school.name] >= 94) return 97;
  if (school.tags.is985) return 95.2;
  if (school.tags.is211) return 91.6;
  if (school.tags.doubleFirstClass) return 90;
  return school.nature === "公办" ? 86.5 : 80.5;
}

function majorDemandModifier(major, index) {
  const name = major.name || "";
  const gradeBoost = {
    "A+": 3.6,
    A: 2.3,
    "B+": 1,
    B: 0,
    "B-": -0.8,
  }[major.grade] || 0;
  const orderBoost = [2.4, 1.5, 0.7, 0, -0.8, -1.5, -2, -2.4][index] || -2.6;
  let demand = gradeBoost + orderBoost;

  if (/计算机|人工智能|软件工程|网络空间|信息安全|数据科学/.test(name)) demand += 3.3;
  if (/电子信息|通信|微电子|集成电路|电子科学|自动化|电气|光电|机器人/.test(name)) demand += 2.8;
  if (/临床医学|口腔医学/.test(name)) demand += 3.8;
  if (/法学|金融|会计|经济/.test(name)) demand += 2.1;
  if (/航空|航天|数学|统计|物理|建筑学/.test(name)) demand += 1.4;
  if (/中外合作|护理|旅游|社会工作|行政管理|土木|材料|农业资源|植物保护|林学/.test(name)) demand -= 3.2;

  return demand;
}

function programCandidatesForSchool(school, province, track, admissionIndex) {
  const verifiedLines = verifiedLinesForSchool(school, province, track, admissionIndex);
  if (verifiedLines.length) {
    return verifiedLines.map((line) => ({
      school,
      major: { name: line.name, grade: line.subject },
      requiredRank: line.minRank,
      lineScore: line.minScore,
      sourceYear: line.year,
      sourceLabel: line.sourceLabel,
      sourceUrl: line.sourceUrl,
      sourceId: line.sourceId,
      schoolCode: line.schoolCode,
      majorCode: line.majorCode,
      batch: line.batch,
      planCount: line.planCount,
      track: line.track,
      rankMethod: line.rankMethod,
      rankNote: line.rankNote,
      subject: line.subject,
      dataType: line.dataType,
      sourceSha256: line.sourceSha256,
      isOfficial: line.dataType === "official",
      isVerified: line.dataType !== "estimated",
    }));
  }

  const coverage = admissionCoverageForProvince(admissionIndex, province);
  if (!coverage?.fallbackAllowed) return [];

  const localPlanAdjustment = school.province === province ? -2.5 : 0;
  const baseScore = modeledSchoolBaseScore(school);
  const scoreCap = modeledScoreCap(school);
  return (school.majorRankings || []).map((major, index) => {
    const adjustedScore = clamp(baseScore + localPlanAdjustment + majorDemandModifier(major, index) * 0.38, 30, scoreCap);
    return {
      school,
      major,
      adjustedScore,
      requiredRank: scoreToEstimatedRank(province, adjustedScore, track),
      lineScore: null,
      sourceYear: null,
      sourceLabel: "估算模型",
      subject: track === "history" ? "历史/文科" : "物理/理科/综合",
      isVerified: false,
    };
  });
}

function limitSchoolRepetition(items, limit) {
  const selected = [];
  const used = new Set();
  const schoolCounts = new Map();

  for (const item of items) {
    const key = `${item.school.id}::${item.major.name}`;
    const count = schoolCounts.get(item.school.id) || 0;
    if (count >= 2) continue;
    selected.push(item);
    used.add(key);
    schoolCounts.set(item.school.id, count + 1);
    if (selected.length >= limit) return selected;
  }

  for (const item of items) {
    const key = `${item.school.id}::${item.major.name}`;
    if (used.has(key)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function rankAdvisorMatches(schools, province, rank, track, admissionIndex = null, options = {}) {
  const targetProvinces = new Set(options.targetProvinces || []);
  const matches = schools
    .filter((school) => !targetProvinces.size || targetProvinces.has(school.province))
    .flatMap((school) => programCandidatesForSchool(school, province, track, admissionIndex))
    .filter((item) => item.requiredRank >= rank)
    .sort(
      (a, b) =>
        a.requiredRank - b.requiredRank ||
        compareSchools(a.school, b.school) ||
        a.major.name.localeCompare(b.major.name, "zh-CN"),
    );

  return limitSchoolRepetition(matches, 320);
}
