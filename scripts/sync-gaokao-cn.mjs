import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admissionsDir = path.join(root, "data", "admissions");
const aggregateDir = path.join(admissionsDir, "aggregated");
const provinceDir = path.join(aggregateDir, "provinces");
const rawDir = path.join(admissionsDir, "raw");
const indexPath = path.join(aggregateDir, "index.json");
const schoolDataPath = path.join(root, "data", "schools.json");
const sourceManifestPath = path.join(admissionsDir, "sources.json");
const providerSchoolPath = path.join(rawDir, "gaokaocn-school-code.json");

const year = Number(
  process.argv.find((arg) => arg.startsWith("--year="))?.split("=")[1] || 2024
);
const requestedProvince =
  process.argv.find((arg) => arg.startsWith("--province="))?.split("=")[1] || "";
const refresh = process.argv.includes("--refresh");
const concurrency = Number(
  process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 24
);

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
  新疆维吾尔自治区: "65"
};

const trackByType = {
  "1": "physics",
  "2": "history",
  "3": "general",
  "2073": "physics",
  "2074": "history"
};

const rankMapPaths = {
  新疆维吾尔自治区:
    "data/admissions/reference/xinjiang-2024-score-ranks.json"
};

const rankEstimateConfigs = {
  西藏自治区: {
    method: "xizang-score-plan-exponential-v1",
    note:
      "西藏未公开一分一段表，且公开专业录取数据连续多年不提供位次。估算以2024年3.6万名考生、文理科招生计划和A/B类本科二批控制线为锚点，误差可能较大。",
    candidateCount: 36000,
    scale: 65,
    sources: [
      {
        label: "2024年西藏高考考生规模",
        url: "https://gaokao.eol.cn/xi_zang/dongtai/202406/t20240607_2615176.shtml",
        sha256: "4fbc1abe73f72047d5183f0f7447200ce7d69fc58ff1c53e8f0defe2a718bec4"
      },
      {
        label: "2024年西藏普通高校招生计划",
        url: "https://gaokao.eol.cn/xi_zang/dongtai/202406/t20240628_2620146.shtml",
        sha256: "c04044106d16b2a1c258497ddfcf209adbe905753f64b3f2d21383f4d98fbd58"
      },
      {
        label: "2024年西藏普通高校招生控制线",
        url: "https://m.bjnews.com.cn/detail/1719413541168847.html",
        sha256: "dc2c9cf0f676784dd229f7c164a8367886f75cdcd65f969760bafd68710d338f"
      }
    ],
    tracks: {
      history: {
        candidatePool: 14618,
        bachelorPlan: 5547,
        cutoffA: 301,
        cutoffB: 315
      },
      physics: {
        candidatePool: 21382,
        bachelorPlan: 9364,
        cutoffA: 265,
        cutoffB: 310
      }
    }
  }
};

const supportedAdmissionTypes = new Set(["普通类", "中外合作办学"]);
const restrictedBatchPattern = /提前|专项|定向|公安|军校|特殊类型/;
const restrictedMajorPattern =
  /预科|定向|西藏班|内地西藏班|内高班|民族班|飞行技术/;

const providerNameOverrides = {
  华北电力大学: ["华北电力大学（北京）", "华北电力大学（保定）"],
  华北科技学院: ["应急管理大学"],
  赤峰学院: ["赤峰大学"],
  湖州师范学院: ["湖州师范大学"],
  绍兴文理学院: ["绍兴大学"],
  皖南医学院: ["皖南医科大学"],
  安徽科技学院: ["安徽科技工程大学"],
  闽江学院: ["闽江大学"],
  淮阴工学院: ["淮安大学"],
  滨州医学院: ["山东第二医科大学"],
  湖南理工学院: ["湖南理工大学"],
  "北京师范大学-香港浸会大学联合国际学院": ["北师香港浸会大学"],
  重庆三峡学院: ["重庆三峡科技大学"],
  榆林学院: ["榆林大学"]
};

await mkdir(provinceDir, { recursive: true });
await mkdir(rawDir, { recursive: true });

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[·\s]+/g, "");
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sha256(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function loadRankContext(province) {
  const relativePath = rankMapPaths[province];
  if (!relativePath) return null;
  const payload = await Bun.file(path.join(root, relativePath)).json();
  const byTrack = {
    physics: new Map(),
    history: new Map()
  };
  for (const row of payload.rows || []) {
    if (positiveNumber(row.physicsRank)) {
      byTrack.physics.set(Number(row.score), Number(row.physicsRank));
    }
    if (positiveNumber(row.historyRank)) {
      byTrack.history.set(Number(row.score), Number(row.historyRank));
    }
  }
  return {
    relativePath,
    meta: payload.meta,
    byTrack
  };
}

function estimateRankFromScore(province, track, minScore, majorName) {
  const config = rankEstimateConfigs[province];
  const trackConfig = config?.tracks?.[track];
  if (!config || !trackConfig || !minScore) return null;

  const category = /(?:B类|汉族)/.test(majorName)
    ? "B"
    : /(?:A类|少数民族)/.test(majorName)
      ? "A"
      : "A-assumed";
  const cutoff = category === "B" ? trackConfig.cutoffB : trackConfig.cutoffA;
  const cutoffRank = Math.min(
    trackConfig.candidatePool,
    Math.round(trackConfig.bachelorPlan * 1.15)
  );
  const estimatedRank = Math.round(
    1 + (cutoffRank - 1) * Math.exp(-(minScore - cutoff) / config.scale)
  );
  return {
    rank: Math.max(1, Math.min(trackConfig.candidatePool, estimatedRank)),
    category,
    cutoff,
    cutoffRank,
    method: config.method,
    note: config.note,
    sources: config.sources
  };
}

async function fetchBytes(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ZemuErqi-Admissions/1.0)",
          referer: "https://www.gaokao.cn/"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await Bun.sleep(300 * attempt);
    }
  }
  throw lastError;
}

async function loadProviderSchools() {
  if (!refresh && (await Bun.file(providerSchoolPath).exists())) {
    return Bun.file(providerSchoolPath).json();
  }
  const url =
    "https://static-data.gaokao.cn/www/2.0/school/school_code.json?a=www.gaokao.cn";
  const bytes = await fetchBytes(url);
  if (!bytes) throw new Error("掌上高考院校代码表不存在");
  await Bun.write(providerSchoolPath, bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function buildSchoolRequests(schoolData, providerPayload) {
  const providerByName = new Map();
  for (const providerSchool of Object.values(providerPayload.data || {})) {
    const key = normalizeName(providerSchool.name);
    if (!providerByName.has(key)) providerByName.set(key, []);
    providerByName.get(key).push(providerSchool);
  }

  const candidatesByProviderId = new Map();
  for (const school of schoolData.schools) {
    const exactMatches = providerByName.get(normalizeName(school.name)) || [];
    const overrideMatches = (providerNameOverrides[school.name] || []).flatMap(
      (name) => providerByName.get(normalizeName(name)) || []
    );
    const candidateMatches = [
      ...exactMatches.map((match) => ({ match, priority: 2, matchType: "exact" })),
      ...overrideMatches.map((match) => ({ match, priority: 1, matchType: "override" }))
    ];
    const bestMatchByProviderId = new Map();
    for (const candidate of candidateMatches) {
      const providerSchoolId = String(candidate.match.school_id);
      const previous = bestMatchByProviderId.get(providerSchoolId);
      if (!previous || candidate.priority > previous.priority) {
        bestMatchByProviderId.set(providerSchoolId, candidate);
      }
    }
    for (const candidate of bestMatchByProviderId.values()) {
      const providerSchoolId = String(candidate.match.school_id);
      if (!candidatesByProviderId.has(providerSchoolId)) {
        candidatesByProviderId.set(providerSchoolId, []);
      }
      candidatesByProviderId.get(providerSchoolId).push({
        school,
        providerSchoolId,
        providerSchoolName: candidate.match.name,
        priority: candidate.priority,
        matchType: candidate.matchType
      });
    }
  }

  const requests = [];
  const collisions = [];
  for (const candidates of candidatesByProviderId.values()) {
    candidates.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.school.name.localeCompare(b.school.name, "zh-CN") ||
        String(a.school.id).localeCompare(String(b.school.id))
    );
    const selected = candidates[0];
    requests.push({
      school: selected.school,
      providerSchoolId: selected.providerSchoolId,
      providerSchoolName: selected.providerSchoolName,
      matchType: selected.matchType
    });
    if (candidates.length > 1) {
      collisions.push({
        providerSchoolId: selected.providerSchoolId,
        providerSchoolName: selected.providerSchoolName,
        selectedSchoolId: selected.school.id,
        selectedSchoolName: selected.school.name,
        rejectedSchools: candidates.slice(1).map((candidate) => ({
          schoolId: candidate.school.id,
          schoolName: candidate.school.name,
          matchType: candidate.matchType
        }))
      });
    }
  }

  requests.sort(
    (a, b) =>
      String(a.providerSchoolId).localeCompare(String(b.providerSchoolId), "zh-CN", {
        numeric: true
      }) || a.school.name.localeCompare(b.school.name, "zh-CN")
  );
  const matchedSchoolIds = new Set(requests.map((request) => request.school.id));
  const unmatched = schoolData.schools
    .filter((school) => !matchedSchoolIds.has(school.id))
    .map((school) => school.name);
  return { requests, unmatched, collisions };
}

function flattenProviderRecords(payload) {
  const deduplicated = new Map();
  for (const group of Object.values(payload.data || {})) {
    for (const item of group.item || []) {
      const key = [
        item.school_id,
        item.province,
        item.type,
        item.batch,
        item.zslx_name,
        item.special_group,
        item.special_id,
        item.spe_id,
        item.spname,
        item.min,
        item.min_section
      ].join("::");
      deduplicated.set(key, item);
    }
  }
  return [...deduplicated.values()];
}

function normalizeProviderRecord(
  item,
  school,
  province,
  sourceId,
  rankContext
) {
  const track = trackByType[String(item.type)];
  const minScore = positiveNumber(item.min);
  const reportedMinRank = positiveNumber(item.min_section);
  const mappedMinRank = minScore ? rankContext?.byTrack?.[track]?.get(minScore) : null;
  const majorName = String(item.spname || item.sp_name || "").trim();
  const estimated = estimateRankFromScore(province, track, minScore, majorName);
  const minRank = reportedMinRank || mappedMinRank || estimated?.rank || null;
  const level = String(item.level1_name || "");
  const admissionType = String(item.zslx_name || "").trim();
  const batch = String(item.local_batch_name || "本科批");
  if (
    !track ||
    !minRank ||
    !majorName ||
    !level.startsWith("本科") ||
    !supportedAdmissionTypes.has(admissionType) ||
    restrictedBatchPattern.test(batch) ||
    restrictedMajorPattern.test(majorName)
  ) {
    return null;
  }

  const rankMethod = reportedMinRank
    ? "aggregated-min-rank"
    : mappedMinRank
      ? "aggregated-score-cumulative"
      : "estimated-from-score";
  const dataType = estimated && !reportedMinRank && !mappedMinRank
    ? "estimated"
    : "aggregated";
  const programIdentity = createHash("sha1")
    .update(
      JSON.stringify([
        item.type,
        item.batch,
        item.local_batch_name,
        item.special_group,
        item.special_id,
        item.spe_id,
        majorName,
        item.sp_info,
        item.sg_info,
        item.min,
        item.min_section
      ])
    )
    .digest("hex")
    .slice(0, 16);
  return {
    id: `${sourceId}:${item.school_id}:${programIdentity}`,
    sourceId,
    dataType,
    province,
    year,
    batch,
    track,
    schoolId: school.id,
    schoolCode: String(item.school_id),
    schoolName: school.name,
    canonicalSchoolName: school.name,
    majorCode: String(item.special_id || item.spe_id || ""),
    majorName,
    planCount: positiveNumber(item.lq_num),
    minScore,
    minRank,
    rankMethod,
    subjectRequirement: String(item.sp_info || item.sg_info || "").trim() || null,
    admissionType,
    providerSchoolId: String(item.school_id),
    providerSpecialId: String(item.special_id || ""),
    providerSpecialGroup: String(item.special_group || ""),
    rankEstimateCategory: dataType === "estimated" ? estimated.category : null,
    rankEstimateCutoff: dataType === "estimated" ? estimated.cutoff : null,
    rankEstimateCutoffRank: dataType === "estimated" ? estimated.cutoffRank : null
  };
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const schoolData = await Bun.file(schoolDataPath).json();
const sourceManifest = await Bun.file(sourceManifestPath).json();
const providerPayload = await loadProviderSchools();
const providerSchoolSha256 = sha256(await Bun.file(providerSchoolPath).arrayBuffer());
const {
  requests: schoolRequests,
  unmatched: unmatchedSchools,
  collisions: schoolMappingCollisions
} = buildSchoolRequests(schoolData, providerPayload);

const selectedProvinces = sourceManifest.provinces.filter((entry) => {
  if (requestedProvince) return entry.province === requestedProvince;
  return entry.status === "pending";
});

const provinceEntries = [];
for (const provinceEntry of selectedProvinces) {
  const province = provinceEntry.province;
  const provinceCode = provinceCodes[province];
  if (!provinceCode) throw new Error(`缺少省份代码: ${province}`);
  const outputPath = path.join(provinceDir, `${province}.json`);
  if (!refresh && (await Bun.file(outputPath).exists())) {
    const existing = await Bun.file(outputPath).json();
    provinceEntries.push(existing.meta.indexEntry);
    console.log(`Skipped ${province}: ${existing.records.length} cached records.`);
    continue;
  }

  const rankContext = await loadRankContext(province);
  const rankEstimateConfig = rankEstimateConfigs[province] || null;
  let completed = 0;
  const fetched = await mapConcurrent(schoolRequests, concurrency, async (request) => {
    const sourceUrl =
      `https://static-data.gaokao.cn/www/2.0/schoolspecialscore/` +
      `${request.providerSchoolId}/${year}/${provinceCode}.json`;
    try {
      const bytes = await fetchBytes(sourceUrl);
      completed += 1;
      if (completed % 200 === 0 || completed === schoolRequests.length) {
        console.log(`${province}: ${completed}/${schoolRequests.length}`);
      }
      if (!bytes) return { status: "not-found", request, sourceUrl };
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const rawRecords = flattenProviderRecords(payload);
      const sourceId = `gaokaocn-${year}-${provinceCode}`;
      const fileSha256 = sha256(bytes);
      const records = rawRecords
        .map((item) =>
          normalizeProviderRecord(
            item,
            request.school,
            province,
            sourceId,
            rankContext
          )
        )
        .filter(Boolean);
      return {
        status: "available",
        request,
        sourceUrl,
        sha256: fileSha256,
        rawRecordCount: rawRecords.length,
        importedRecordCount: records.length,
        records
      };
    } catch (error) {
      completed += 1;
      return {
        status: "failed",
        request,
        sourceUrl,
        error: error.message
      };
    }
  });

  const available = fetched.filter((entry) => entry.status === "available");
  const failed = fetched.filter((entry) => entry.status === "failed");
  const records = available.flatMap((entry) => entry.records);
  records.sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName, "zh-CN") ||
      a.track.localeCompare(b.track) ||
      a.minRank - b.minRank ||
      a.majorName.localeCompare(b.majorName, "zh-CN")
  );
  const sourceId = `gaokaocn-${year}-${provinceCode}`;
  const indexEntry = {
    province,
    source: {
      id: sourceId,
      province,
      authority: "掌上高考",
      year,
      batch: "普通类本科",
      granularity: "专业",
      pageUrl: "https://www.gaokao.cn/",
      downloadUrlTemplate:
        `https://static-data.gaokao.cn/www/2.0/schoolspecialscore/` +
        `{school_id}/${year}/${provinceCode}.json`,
      rankMethod: rankEstimateConfig
        ? "estimated-from-score"
        : rankContext
          ? "aggregated-min-rank-or-score-cumulative"
          : "aggregated-min-rank",
      dataType: "aggregated",
      rankMap: rankContext
        ? {
            path: rankContext.relativePath,
            method: rankContext.meta.method,
            note: rankContext.meta.note,
            tracks: rankContext.meta.tracks
          }
        : null,
      rankEstimate: rankEstimateConfig
        ? {
            method: rankEstimateConfig.method,
            note: rankEstimateConfig.note,
            candidateCount: rankEstimateConfig.candidateCount,
            tracks: rankEstimateConfig.tracks,
            sources: rankEstimateConfig.sources
          }
        : null,
      schoolCodeUrl:
        "https://static-data.gaokao.cn/www/2.0/school/school_code.json?a=www.gaokao.cn",
      schoolCodeSha256: providerSchoolSha256,
      requestCount: schoolRequests.length,
      availableFileCount: available.length,
      notFoundFileCount: fetched.filter((entry) => entry.status === "not-found").length,
      failedFileCount: failed.length,
      importedRecords: records.length,
      importedSchools: new Set(records.map((record) => record.schoolId)).size
    },
    dataUrl: `./data/admissions/aggregated/provinces/${province}.json`
  };
  const files = available.map((entry) => ({
    schoolId: entry.request.school.id,
    schoolName: entry.request.school.name,
    providerSchoolId: entry.request.providerSchoolId,
    providerSchoolName: entry.request.providerSchoolName,
    sourceUrl: entry.sourceUrl,
    sha256: entry.sha256,
    rawRecordCount: entry.rawRecordCount,
    importedRecordCount: entry.importedRecordCount
  }));

  const payload = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      province,
      provinceCode,
      provider: "掌上高考",
      year,
      recordCount: records.length,
      schoolCount: indexEntry.source.importedSchools,
      unmatchedSchools,
      schoolMappingCollisions,
      rankMap: rankContext
        ? {
            path: rankContext.relativePath,
            method: rankContext.meta.method,
            note: rankContext.meta.note,
            tracks: rankContext.meta.tracks
          }
        : null,
      rankEstimate: rankEstimateConfig
        ? {
            method: rankEstimateConfig.method,
            note: rankEstimateConfig.note,
            candidateCount: rankEstimateConfig.candidateCount,
            tracks: rankEstimateConfig.tracks,
            sources: rankEstimateConfig.sources
          }
        : null,
      failedRequests: failed.map((entry) => ({
        schoolId: entry.request.school.id,
        schoolName: entry.request.school.name,
        providerSchoolId: entry.request.providerSchoolId,
        sourceUrl: entry.sourceUrl,
        error: entry.error
      })),
      indexEntry
    },
    sources: [
      {
        ...indexEntry.source,
        files
      }
    ],
    records
  };
  await Bun.write(outputPath, `${JSON.stringify(payload)}\n`);
  provinceEntries.push(indexEntry);
  console.log(
    `${province}: imported ${records.length} program lines for ` +
      `${indexEntry.source.importedSchools} schools; ${failed.length} failed requests.`
  );
}

let existingEntries = [];
if (await Bun.file(indexPath).exists()) {
  existingEntries = (await Bun.file(indexPath).json()).provinces || [];
}
const mergedEntries = new Map(existingEntries.map((entry) => [entry.province, entry]));
for (const entry of provinceEntries) mergedEntries.set(entry.province, entry);
await Bun.write(
  indexPath,
  `${JSON.stringify(
    {
      meta: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        provider: "掌上高考",
        year,
        schoolCodeSha256: providerSchoolSha256,
        unmatchedSchoolCount: unmatchedSchools.length,
        unmatchedSchools,
        schoolMappingCollisionCount: schoolMappingCollisions.length,
        schoolMappingCollisions
      },
      provinces: [...mergedEntries.values()].sort((a, b) =>
        a.province.localeCompare(b.province, "zh-CN")
      )
    },
    null,
    2
  )}\n`
);

console.log(`Updated ${indexPath} with ${mergedEntries.size} province entries.`);
