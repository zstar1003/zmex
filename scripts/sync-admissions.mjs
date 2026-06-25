import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admissionsDir = path.join(root, "data", "admissions");
const rawDir = path.join(admissionsDir, "raw");
const provinceDir = path.join(admissionsDir, "provinces");
const sourcesPath = path.join(admissionsDir, "sources.json");
const aggregatedIndexPath = path.join(admissionsDir, "aggregated", "index.json");
const indexPath = path.join(admissionsDir, "index.json");
const coveragePath = path.join(admissionsDir, "coverage.json");
const schoolDataPath = path.join(root, "data", "schools.json");

const requestedProvince = process.argv.find((arg) => arg.startsWith("--province="))?.split("=")[1] || "";
const refresh = process.argv.includes("--refresh");

await mkdir(rawDir, { recursive: true });
await mkdir(provinceDir, { recursive: true });

const sourceManifest = await Bun.file(sourcesPath).json();
const schoolData = await Bun.file(schoolDataPath).json();
const aggregatedIndex = (await Bun.file(aggregatedIndexPath).exists())
  ? await Bun.file(aggregatedIndexPath).json()
  : { provinces: [] };
const aggregatedEntryByProvince = new Map(
  (aggregatedIndex.provinces || []).map((entry) => [entry.province, entry])
);

function normalizeSchoolName(value) {
  return String(value || "")
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

const schoolAliases = new Map(
  Object.entries({
    "华北电力大学(北京)": "华北电力大学",
    "华北电力大学(保定)": "华北电力大学",
    "中国石油大学(北京)克拉玛依校区": "中国石油大学（北京）",
    东北大学秦皇岛分校: "东北大学",
    "合肥工业大学(宣城校区)": "合肥工业大学",
    "大连理工大学(盘锦校区)": "大连理工大学",
    北京大学医学部: "北京大学",
    山东大学威海分校: "山东大学",
    "西南大学(荣昌校区)": "西南大学",
    "电子科技大学(沙河校区)": "电子科技大学",
    "北京交通大学(威海校区)": "北京交通大学",
    复旦大学医学院: "复旦大学",
    "中国人民大学(苏州校区)": "中国人民大学",
    "北京师范大学(珠海校区)": "北京师范大学",
    "哈尔滨工业大学(威海)": "哈尔滨工业大学",
    "哈尔滨工业大学(深圳)": "哈尔滨工业大学",
    上海交通大学医学院: "上海交通大学",
    浙江大学医学院: "浙江大学",
    西藏农牧学院: "西藏农牧大学",
    北师香港浸会大学: "北京师范大学-香港浸会大学联合国际学院",
    天津外国语大学滨海外事学: "天津外国语大学滨海外事学院",
    广东外语外贸大学南国商学: "广东外语外贸大学南国商学院",
    遵义医科大学医学与科技学: "遵义医科大学医学与科技学院",
    海南比勒费尔德应用科学大: "海南比勒费尔德应用科学大学"
  }).map(([alias, canonical]) => [normalizeSchoolName(alias), canonical])
);

const schoolsByName = new Map(
  [...schoolData.schools, ...(schoolData.admissionSchools || [])].map((school) => [
    normalizeSchoolName(school.name),
    school
  ])
);

function resolveSchool(admissionName) {
  const normalized = normalizeSchoolName(admissionName);
  const canonicalName = schoolAliases.get(normalized);
  return schoolsByName.get(normalizeSchoolName(canonicalName || admissionName));
}

function asCode(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value).replace(/\.0$/, "").trim().padStart(3, "0");
}

function asPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function zhejiangSourceRecords(source, province, rows) {
  return rows.slice(1).flatMap((row) => {
    const schoolName = String(row[1] || "").trim();
    const school = resolveSchool(schoolName);
    const minRank = asPositiveNumber(row[6]);
    const minScore = asPositiveNumber(row[5]);
    const majorName = String(row[3] || "").trim();
    if (!school || !majorName || !minRank) return [];

    const schoolCode = asCode(row[0]);
    const majorCode = asCode(row[2]);
    return [
      {
        id: `${source.id}:${schoolCode}:${majorCode}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: "general",
        schoolId: school.id,
        schoolCode,
        schoolName,
        canonicalSchoolName: school.name,
        majorCode,
        majorName,
        planCount: asPositiveNumber(row[4]),
        minScore,
        minRank,
        subjectRequirement: null
      }
    ];
  });
}

function shandongSourceRecords(source, province, rows) {
  const headerIndex = rows.findIndex(
    (row) => row.includes("专业代号及名称") && row.includes("院校代号及名称")
  );
  if (headerIndex < 0) throw new Error(`${source.id} is missing the expected headers`);

  const header = rows[headerIndex];
  const levelIndex = header.indexOf("层次");
  const majorIndex = header.indexOf("专业代号及名称");
  const schoolIndex = header.indexOf("院校代号及名称");
  const planIndex = header.indexOf("投档计划数");
  const rankIndex = header.indexOf("最低位次");

  return rows.slice(headerIndex + 1).flatMap((row) => {
    if (levelIndex >= 0 && String(row[levelIndex] || "").trim() !== "本科") return [];

    const rawSchool = String(row[schoolIndex] || "").trim();
    const rawMajor = String(row[majorIndex] || "").trim();
    const schoolCode = rawSchool.slice(0, 4);
    const schoolName = rawSchool.slice(4).trim();
    const majorCode = rawMajor.slice(0, 2);
    const majorName = rawMajor.slice(2).trim();
    const school = resolveSchool(schoolName);
    const minRank = asPositiveNumber(row[rankIndex]);
    if (!school || !majorName || !minRank) return [];

    return [
      {
        id: `${source.id}:${schoolCode}:${majorCode}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: "general",
        schoolId: school.id,
        schoolCode,
        schoolName,
        canonicalSchoolName: school.name,
        majorCode,
        majorName,
        planCount: asPositiveNumber(row[planIndex]),
        minScore: null,
        minRank,
        subjectRequirement: null
      }
    ];
  });
}

async function hebeiSourceRecords(source, province, rows) {
  const rankMapPayload = await Bun.file(path.join(root, source.rankMapPath)).json();
  const rankByScore = new Map(
    rankMapPayload.rows.map((entry) => [
      entry.score,
      source.track === "physics" ? entry.physicsRank : entry.historyRank
    ])
  );

  return rows.slice(5).flatMap((row) => {
    const rawSchoolName = String(row[1] || "").trim();
    const schoolName = rawSchoolName
      .replace(/\[[^\]]+\]\s*$/, "")
      .replace(/\([^()]*(?:市|县|区)\)\s*$/, "")
      .trim();
    const school = resolveSchool(schoolName);
    const majorName = String(row[3] || "").trim();
    const minScore = asPositiveNumber(row[4]);
    const minRank = rankByScore.get(minScore);
    if (!school || !majorName || !minScore || !minRank) return [];

    return [
      {
        id: `${source.id}:${asCode(row[0])}:${asCode(row[2])}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: source.track,
        schoolId: school.id,
        schoolCode: asCode(row[0]),
        schoolName,
        canonicalSchoolName: school.name,
        majorCode: asCode(row[2]),
        majorName,
        planCount: null,
        minScore,
        minRank,
        rankMethod: "official-score-cumulative",
        rankNote: "由河北省教育考试院最低分和官方成绩统计表累计人数对应，为同分考生位次上限。",
        subjectRequirement: source.track === "physics" ? "物理科目组合" : "历史科目组合"
      }
    ];
  });
}

async function liaoningSourceRecords(source, province, rows) {
  const rankMapPayload = await Bun.file(path.join(root, source.rankMapPath)).json();
  const rankByScore = new Map(
    rankMapPayload.rows.map((entry) => [
      entry.score,
      source.track === "physics" ? entry.physicsRank : entry.historyRank
    ])
  );

  return rows.slice(5).flatMap((row) => {
    const schoolName = String(row[1] || "").trim();
    const school = resolveSchool(schoolName);
    const majorName = String(row[3] || "").trim();
    const minScore = asPositiveNumber(row[4]);
    const minRank = rankByScore.get(minScore);
    if (!school || !majorName || !minScore || !minRank) return [];

    return [
      {
        id: `${source.id}:${String(row[0] || "").trim()}:${String(row[2] || "").trim()}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: source.track,
        schoolId: school.id,
        schoolCode: String(row[0] || "").trim(),
        schoolName,
        canonicalSchoolName: school.name,
        majorCode: String(row[2] || "").trim(),
        majorName,
        planCount: null,
        minScore,
        minRank,
        rankMethod: "official-score-cumulative",
        rankNote: "由辽宁招生考试之窗专业投档最低分和官方成绩统计表累计人数对应，为同分考生位次上限。",
        subjectRequirement: source.track === "physics" ? "物理学科类" : "历史学科类"
      }
    ];
  });
}

async function chongqingSourceRecords(source, province, rows) {
  const rankMapPayload = await Bun.file(path.join(root, source.rankMapPath)).json();
  const rankByScore = new Map(
    rankMapPayload.rows.map((entry) => [
      entry.score,
      source.track === "physics" ? entry.physicsRank : entry.historyRank
    ])
  );

  return rows.flatMap((row) => {
    const rawSchoolName = String(row.schoolName || "").trim();
    const schoolName = rawSchoolName
      .replace(/\((?:中外合作|民族班|预科班|地方专项|非西藏生定藏就业)\)/g, "")
      .replace(/\((?:中外合|民族|预科)[^)]*$/g, "")
      .replace(/\((?:珠海校区|威海校区|盘锦校区|苏州校区)\)/g, "")
      .replace(/\(马来西亚分校\)$/g, "")
      .trim();
    const school = resolveSchool(schoolName);
    const minScore = asPositiveNumber(row.minScore);
    const minRank = rankByScore.get(minScore);
    if (!school || !row.majorName || !minScore || !minRank) return [];

    return [
      {
        id: `${source.id}:${row.schoolCode}:${row.majorCode}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: source.track,
        schoolId: school.id,
        schoolCode: row.schoolCode,
        schoolName: rawSchoolName,
        canonicalSchoolName: school.name,
        majorCode: row.majorCode,
        majorName: row.majorName,
        planCount: null,
        minScore,
        minRank,
        rankMethod: "official-score-cumulative",
        rankNote: "由重庆市教育考试院专业投档最低分和官方一分段表累计人数对应，为同分考生位次上限；最高分合并档沿用官方合并位次上限。",
        subjectRequirement: source.track === "physics" ? "物理类" : "历史类",
        sourcePage: row.sourcePage
      }
    ];
  });
}

async function hubeiGroupSourceRecords(source, province, rows) {
  const rankMapPayload = await Bun.file(path.join(root, source.rankMapPath)).json();
  const rankByScore = new Map(
    rankMapPayload.rows.map((entry) => [
      entry.score,
      source.track === "physics" ? entry.physicsRank : entry.historyRank
    ])
  );

  return rows.flatMap((row) => {
    const groupCode = String(row.groupCode || "").trim();
    const groupName = String(row.groupName || "").trim();
    const rawSchoolName = String(row.schoolName || "").trim();
    const school = resolveSchool(rawSchoolName);
    const minScore = asPositiveNumber(row.minScore);
    const minRank = rankByScore.get(minScore);
    if (!school || !groupCode || !groupName || !minScore || !minRank) return [];

    return [
      {
        id: `${source.id}:${groupCode}`,
        sourceId: source.id,
        dataType: "official",
        province,
        year: source.year,
        batch: source.batch,
        track: source.track,
        schoolId: school.id,
        schoolCode: groupCode.slice(0, 4),
        schoolName: rawSchoolName,
        canonicalSchoolName: school.name,
        majorCode: groupCode.slice(4),
        majorName: `${groupName}（院校专业组）`,
        planCount: null,
        minScore,
        minRank,
        rankMethod: "official-score-cumulative",
        rankNote:
          "由湖北省教育考试院院校专业组投档最低分和官方一分一段表累计人数对应，为同分考生位次上限。",
        subjectRequirement: row.subjectRequirement || "选科要求见招生计划",
        sourcePage: row.sourcePage || null
      }
    ];
  });
}

async function sourceRecords(source, province, rows) {
  if (source.parser === "zhejiang-major-lines") {
    return zhejiangSourceRecords(source, province, rows);
  }
  if (source.parser === "shandong-major-lines") {
    return shandongSourceRecords(source, province, rows);
  }
  if (source.parser === "hebei-major-scores") {
    return hebeiSourceRecords(source, province, rows);
  }
  if (source.parser === "liaoning-major-scores") {
    return liaoningSourceRecords(source, province, rows);
  }
  if (source.parser === "chongqing-major-scores") {
    return chongqingSourceRecords(source, province, rows);
  }
  if (source.parser === "hubei-group-scores") {
    return hubeiGroupSourceRecords(source, province, rows);
  }
  throw new Error(`Unsupported admission parser: ${source.parser}`);
}

function sourceDataRowCount(source, rows) {
  if (source.parser === "zhejiang-major-lines") {
    return rows.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== "")).length;
  }
  if (source.parser === "shandong-major-lines") {
    const headerIndex = rows.findIndex(
      (row) => row.includes("专业代号及名称") && row.includes("院校代号及名称")
    );
    return headerIndex < 0
      ? 0
      : rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== null && cell !== "")).length;
  }
  if (source.parser === "hebei-major-scores") {
    return rows.slice(5).filter((row) => row.some((cell) => cell !== null && cell !== "")).length;
  }
  if (source.parser === "liaoning-major-scores") {
    return rows.slice(5).filter((row) => row.some((cell) => cell !== null && cell !== "")).length;
  }
  if (source.parser === "chongqing-major-scores") {
    return rows.length;
  }
  if (source.parser === "hubei-group-scores") {
    return rows.length;
  }
  return 0;
}

async function downloadSource(source) {
  const target = path.join(rawDir, `${source.id}.${source.format}`);
  if (!refresh && (await Bun.file(target).exists())) return target;

  const response = await fetch(source.downloadUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ZemuErqi-Admissions/1.0)"
    }
  });
  if (!response.ok) throw new Error(`${source.id} download failed: HTTP ${response.status}`);
  await Bun.write(target, await response.arrayBuffer());
  return target;
}

async function downloadRankTable(source) {
  if (!source.rankTableDownloadUrl || !source.rankTableId) return null;
  const target = path.join(rawDir, `${source.rankTableId}.${source.rankTableFormat || "pdf"}`);
  if (!refresh && (await Bun.file(target).exists())) return target;

  const response = await fetch(source.rankTableDownloadUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ZemuErqi-Admissions/1.0)"
    }
  });
  if (!response.ok) throw new Error(`${source.rankTableId} download failed: HTTP ${response.status}`);
  await Bun.write(target, await response.arrayBuffer());
  return target;
}

const normalizedSources = [];
const records = [];

for (const provinceEntry of sourceManifest.provinces) {
  if (requestedProvince && provinceEntry.province !== requestedProvince) continue;
  for (const source of provinceEntry.sources || []) {
    if (source.status !== "available") continue;
    const rawPath = await downloadSource(source);
    const rankTablePath = await downloadRankTable(source);
    const rawBytes = await Bun.file(rawPath).arrayBuffer();
    const parsePath = source.parsePath ? path.join(root, source.parsePath) : rawPath;
    if (!(await Bun.file(parsePath).exists())) {
      throw new Error(`${source.id} parse file is missing: ${parsePath}`);
    }
    const parseBytes = await Bun.file(parsePath).arrayBuffer();
    const rankTableBytes = rankTablePath ? await Bun.file(rankTablePath).arrayBuffer() : null;
    const sha256 = createHash("sha256").update(Buffer.from(rawBytes)).digest("hex");
    const parseSha256 = createHash("sha256").update(Buffer.from(parseBytes)).digest("hex");
    let rows;
    if (source.parseFormat === "json") {
      rows = (await Bun.file(parsePath).json()).records;
    } else {
      const workbook = XLSX.read(parseBytes, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, {
        header: 1,
        raw: true,
        defval: null
      });
    }
    const imported = await sourceRecords(source, provinceEntry.province, rows);
    const sourceRows = sourceDataRowCount(source, rows);
    const rankMapBytes = source.rankMapPath
      ? await Bun.file(path.join(root, source.rankMapPath)).arrayBuffer()
      : null;
    records.push(...imported);
    normalizedSources.push({
      id: source.id,
      province: provinceEntry.province,
      authority: provinceEntry.authority,
      year: source.year,
      batch: source.batch,
      granularity: source.granularity,
      pageUrl: source.pageUrl,
      downloadUrl: source.downloadUrl,
      sha256,
      parseSha256: source.parsePath ? parseSha256 : null,
      parseNote: source.parseNote || null,
      rankMethod: source.rankMethod || "official-min-rank",
      rankTablePageUrl: source.rankTablePageUrl || null,
      rankTableDownloadUrl: source.rankTableDownloadUrl || null,
      rankTableSha256: rankTableBytes
        ? createHash("sha256").update(Buffer.from(rankTableBytes)).digest("hex")
        : null,
      rankMapSha256: rankMapBytes
        ? createHash("sha256").update(Buffer.from(rankMapBytes)).digest("hex")
        : null,
      sourceRows,
      importedRecords: imported.length,
      skippedRows: Math.max(0, sourceRows - imported.length),
      importedSchools: new Set(imported.map((record) => record.schoolId)).size
    });
  }
}

for (const aggregatedEntry of aggregatedIndex.provinces || []) {
  if (requestedProvince && aggregatedEntry.province !== requestedProvince) continue;
  const dataPath = path.join(root, aggregatedEntry.dataUrl.replace(/^\.\//, ""));
  if (!(await Bun.file(dataPath).exists())) {
    throw new Error(`Aggregated admission file is missing: ${dataPath}`);
  }
  const payload = await Bun.file(dataPath).json();
  const imported = (payload.records || []).filter(
    (record) =>
      record.province === aggregatedEntry.province &&
      ["aggregated", "estimated"].includes(record.dataType) &&
      Number.isFinite(record.minRank) &&
      record.minRank > 0
  );
  records.push(...imported);
  normalizedSources.push({
    ...aggregatedEntry.source,
    dataType: "aggregated",
    sourceRows: imported.length,
    importedRecords: imported.length,
    skippedRows: Math.max(0, (payload.meta?.recordCount || imported.length) - imported.length),
    importedSchools: new Set(imported.map((record) => record.schoolId)).size,
    generatedAt: payload.meta?.generatedAt || null,
    files: (payload.sources?.[0]?.files || payload.meta?.files || []).map((file) => ({
      providerSchoolId: String(file.providerSchoolId),
      providerSchoolName: file.providerSchoolName,
      sourceUrl: file.sourceUrl,
      sha256: file.sha256,
      rawRecordCount: file.rawRecordCount,
      importedRecordCount: file.importedRecordCount
    }))
  });
}

records.sort(
  (a, b) =>
    b.year - a.year ||
    a.province.localeCompare(b.province, "zh-CN") ||
    a.schoolName.localeCompare(b.schoolName, "zh-CN") ||
    a.minRank - b.minRank
);

const generatedAt = new Date().toISOString();

const coverage = {
  generatedAt,
  policy: sourceManifest.policy,
  provinces: sourceManifest.provinces.map((provinceEntry) => {
    const provinceRecords = records.filter((record) => record.province === provinceEntry.province);
    const officialRecords = provinceRecords.filter((record) => record.dataType === "official");
    const aggregatedRecords = provinceRecords.filter((record) => record.dataType === "aggregated");
    const estimatedRecords = provinceRecords.filter((record) => record.dataType === "estimated");
    const provinceSources = normalizedSources.filter((source) => source.province === provinceEntry.province);
    const aggregatedEntry = aggregatedEntryByProvince.get(provinceEntry.province);
    return {
      province: provinceEntry.province,
      authority: provinceEntry.authority,
      authorityUrl: provinceEntry.authorityUrl,
      status: officialRecords.length
        ? "official-data"
        : aggregatedRecords.length
          ? "aggregated-data"
          : estimatedRecords.length
            ? "estimated-data"
          : provinceEntry.status,
      recordCount: provinceRecords.length,
      schoolCount: new Set(provinceRecords.map((record) => record.schoolId)).size,
      officialRecordCount: officialRecords.length,
      officialSchoolCount: new Set(officialRecords.map((record) => record.schoolId)).size,
      aggregatedRecordCount: aggregatedRecords.length,
      aggregatedSchoolCount: new Set(aggregatedRecords.map((record) => record.schoolId)).size,
      estimatedRecordCount: estimatedRecords.length,
      estimatedSchoolCount: new Set(estimatedRecords.map((record) => record.schoolId)).size,
      fallbackAllowed: (provinceEntry.sources || []).some((source) => source.fallbackAllowed),
      dataUrl: provinceRecords.length
        ? officialRecords.length || !aggregatedEntry
          ? `./data/admissions/provinces/${provinceEntry.province}.json`
          : aggregatedEntry.dataUrl
        : null,
      sources: provinceSources
    };
  })
};

for (const provinceEntry of coverage.provinces) {
  if (!provinceEntry.dataUrl) continue;
  const finalProvincePath = path.join(provinceDir, `${provinceEntry.province}.json`);
  const aggregatedEntry = aggregatedEntryByProvince.get(provinceEntry.province);
  if (aggregatedEntry && provinceEntry.officialRecordCount === 0) {
    await rm(finalProvincePath, { force: true });
    continue;
  }
  const provinceRecords = records.filter((record) => record.province === provinceEntry.province);
  await Bun.write(
    finalProvincePath,
    `${JSON.stringify({
      meta: {
        schemaVersion: 1,
        generatedAt,
        province: provinceEntry.province,
        authority: provinceEntry.authority,
        recordCount: provinceRecords.length,
        schoolCount: provinceEntry.schoolCount,
        officialRecordCount: provinceEntry.officialRecordCount,
        officialSchoolCount: provinceEntry.officialSchoolCount,
        aggregatedRecordCount: provinceEntry.aggregatedRecordCount,
        aggregatedSchoolCount: provinceEntry.aggregatedSchoolCount,
        estimatedRecordCount: provinceEntry.estimatedRecordCount,
        estimatedSchoolCount: provinceEntry.estimatedSchoolCount
      },
      sources: provinceEntry.sources,
      records: provinceRecords
    })}\n`
  );
}

const indexPayload = {
  meta: {
    schemaVersion: 1,
    generatedAt,
    recordCount: records.length,
    schoolCount: new Set(records.map((record) => record.schoolId)).size,
    provinceCount: new Set(records.map((record) => record.province)).size,
    officialRecordCount: records.filter((record) => record.dataType === "official").length,
    officialSchoolCount: new Set(
      records.filter((record) => record.dataType === "official").map((record) => record.schoolId)
    ).size,
    officialProvinceCount: new Set(
      records.filter((record) => record.dataType === "official").map((record) => record.province)
    ).size,
    aggregatedRecordCount: records.filter((record) => record.dataType === "aggregated").length,
    aggregatedSchoolCount: new Set(
      records.filter((record) => record.dataType === "aggregated").map((record) => record.schoolId)
    ).size,
    aggregatedProvinceCount: new Set(
      records.filter((record) => record.dataType === "aggregated").map((record) => record.province)
    ).size,
    estimatedRecordCount: records.filter((record) => record.dataType === "estimated").length,
    estimatedSchoolCount: new Set(
      records.filter((record) => record.dataType === "estimated").map((record) => record.schoolId)
    ).size,
    estimatedProvinceCount: new Set(
      records.filter((record) => record.dataType === "estimated").map((record) => record.province)
    ).size
  },
  policy: sourceManifest.policy,
  provinces: coverage.provinces
};

await Bun.write(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`);
await Bun.write(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);

console.log(
  `Imported ${indexPayload.meta.officialRecordCount} official and ` +
    `${indexPayload.meta.aggregatedRecordCount} aggregated and ` +
    `${indexPayload.meta.estimatedRecordCount} estimated program lines across ` +
    `${indexPayload.meta.provinceCount} province(s).`
);
