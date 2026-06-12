import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAdmissionIndex,
  rankAdvisorMatches
} from "../rank-engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = await Bun.file(path.join(root, "data", "admissions", "index.json")).json();
const schoolData = await Bun.file(path.join(root, "data", "schools.json")).json();
const allSchools = [...schoolData.schools, ...(schoolData.admissionSchools || [])];
const errors = [];
let verifiedRecords = 0;
let officialRecords = 0;
let aggregatedRecords = 0;
let estimatedRecords = 0;

function check(condition, message) {
  if (!condition) errors.push(message);
}

check(index.provinces.length === 31, `expected 31 province entries, received ${index.provinces.length}`);

for (const province of index.provinces) {
  if (!province.dataUrl) {
    check(!province.fallbackAllowed, `${province.province} enables fallback before source audit is complete`);
    continue;
  }

  const payload = await Bun.file(path.join(root, province.dataUrl.replace("./", ""))).json();
  const sourceById = new Map(payload.sources.map((source) => [source.id, source]));
  const sourceIds = new Set(sourceById.keys());
  const sourceFilesById = new Map(
    payload.sources.map((source) => [
      source.id,
      new Map(
        (source.files || []).map((file) => [String(file.providerSchoolId), file])
      )
    ])
  );
  const recordIds = new Set();
  check(payload.records.length === province.recordCount, `${province.province} record count mismatch`);
  check(
    payload.records.filter((record) => record.dataType === "official").length ===
      province.officialRecordCount,
    `${province.province} official record count mismatch`
  );
  check(
    payload.records.filter((record) => record.dataType === "aggregated").length ===
      province.aggregatedRecordCount,
    `${province.province} aggregated record count mismatch`
  );
  check(
    payload.records.filter((record) => record.dataType === "estimated").length ===
      province.estimatedRecordCount,
    `${province.province} estimated record count mismatch`
  );

  for (const record of payload.records) {
    check(!recordIds.has(record.id), `${province.province} duplicate record id: ${record.id}`);
    recordIds.add(record.id);
    check(sourceIds.has(record.sourceId), `${record.id} references an unknown source`);
    check(
      ["official", "aggregated", "estimated"].includes(record.dataType),
      `${record.id} has an invalid data type`
    );
    check(Number.isFinite(record.minRank) && record.minRank > 0, `${record.id} has an invalid rank`);
    check(["general", "physics", "history"].includes(record.track), `${record.id} has an invalid track`);
    if (record.rankMethod === "official-score-cumulative") {
      check(Number.isFinite(record.minScore), `${record.id} is missing its official minimum score`);
      check(Boolean(record.rankNote), `${record.id} is missing its cumulative-rank note`);
    }
    if (record.dataType === "aggregated") {
      const source = sourceById.get(record.sourceId);
      const sourceFile = sourceFilesById
        .get(record.sourceId)
        ?.get(String(record.providerSchoolId));
      check(
        ["aggregated-min-rank", "aggregated-score-cumulative"].includes(record.rankMethod),
        `${record.id} has an invalid aggregate rank method`
      );
      check(/^https:\/\//.test(sourceFile?.sourceUrl || ""), `${record.id} is missing its source URL`);
      check(/^[a-f0-9]{64}$/.test(sourceFile?.sha256 || ""), `${record.id} is missing its source hash`);
      if (record.rankMethod === "aggregated-score-cumulative") {
        const rankTrack = source?.rankMap?.tracks?.[record.track];
        check(Number.isFinite(record.minScore), `${record.id} is missing its public minimum score`);
        check(
          /^https:\/\//.test(rankTrack?.sourceUrl || ""),
          `${record.id} is missing its rank-table URL`
        );
        check(
          /^[a-f0-9]{64}$/.test(rankTrack?.sha256 || ""),
          `${record.id} is missing its rank-table hash`
        );
      }
    }
    if (record.dataType === "estimated") {
      const source = sourceById.get(record.sourceId);
      const sourceFile = sourceFilesById
        .get(record.sourceId)
        ?.get(String(record.providerSchoolId));
      check(record.rankMethod === "estimated-from-score", `${record.id} has an invalid estimate method`);
      check(Number.isFinite(record.minScore), `${record.id} is missing its public minimum score`);
      check(Boolean(source?.rankEstimate?.method), `${record.id} is missing its estimate model`);
      check(/^https:\/\//.test(sourceFile?.sourceUrl || ""), `${record.id} is missing its source URL`);
      check(/^[a-f0-9]{64}$/.test(sourceFile?.sha256 || ""), `${record.id} is missing its source hash`);
      check(
        Array.isArray(source?.rankEstimate?.sources) &&
          source.rankEstimate.sources.length > 0 &&
          source.rankEstimate.sources.every(
            (source) =>
              /^https:\/\//.test(source.url || "") &&
              /^[a-f0-9]{64}$/.test(source.sha256 || "")
          ),
        `${record.id} is missing its estimate evidence`
      );
    }
  }
  verifiedRecords += payload.records.length;
  officialRecords += payload.records.filter((record) => record.dataType === "official").length;
  aggregatedRecords += payload.records.filter((record) => record.dataType === "aggregated").length;
  estimatedRecords += payload.records.filter((record) => record.dataType === "estimated").length;
}

const rankMap = await Bun.file(
  path.join(root, "data", "admissions", "reference", "hebei-2025-score-ranks.json")
).json();
for (const key of ["physicsRank", "historyRank"]) {
  for (let indexPosition = 1; indexPosition < rankMap.rows.length; indexPosition += 1) {
    check(
      rankMap.rows[indexPosition][key] >= rankMap.rows[indexPosition - 1][key],
      `Hebei ${key} is not monotonic at score ${rankMap.rows[indexPosition].score}`
    );
  }
}

const liaoningRankMap = await Bun.file(
  path.join(root, "data", "admissions", "reference", "liaoning-2025-score-ranks.json")
).json();
for (const key of ["physicsRank", "historyRank"]) {
  const trackRows = liaoningRankMap.rows.filter((row) => row[key] > 0);
  for (let indexPosition = 1; indexPosition < trackRows.length; indexPosition += 1) {
    check(
      trackRows[indexPosition][key] >= trackRows[indexPosition - 1][key],
      `Liaoning ${key} is not monotonic at score ${trackRows[indexPosition].score}`
    );
  }
}

const chongqingRankMap = await Bun.file(
  path.join(root, "data", "admissions", "reference", "chongqing-2025-score-ranks.json")
).json();
for (const key of ["physicsRank", "historyRank"]) {
  const trackRows = chongqingRankMap.rows.filter((row) => row[key] > 0);
  for (let indexPosition = 1; indexPosition < trackRows.length; indexPosition += 1) {
    check(
      trackRows[indexPosition][key] >= trackRows[indexPosition - 1][key],
      `Chongqing ${key} is not monotonic at score ${trackRows[indexPosition].score}`
    );
  }
}

const zhejiangEntry = index.provinces.find((province) => province.province === "浙江省");
const zhejiangPayload = await Bun.file(path.join(root, zhejiangEntry.dataUrl.replace("./", ""))).json();
const zhejiangMatches = rankAdvisorMatches(
  allSchools,
  "浙江省",
  8000,
  "physics",
  buildAdmissionIndex(zhejiangPayload, index)
);
check(
  zhejiangMatches.every((item) => item.isOfficial),
  "Zhejiang query returned a non-official result"
);
check(
  zhejiangMatches.some((item) => item.school.name === "西安电子科技大学"),
  "Zhejiang rank 8000 query does not include Xidian University"
);

const liaoningEntry = index.provinces.find((province) => province.province === "辽宁省");
const liaoningPayload = await Bun.file(path.join(root, liaoningEntry.dataUrl.replace("./", ""))).json();
const liaoningMatches = rankAdvisorMatches(
  allSchools,
  "辽宁省",
  5000,
  "physics",
  buildAdmissionIndex(liaoningPayload, index)
);
check(
  liaoningMatches.every((item) => item.isOfficial),
  "Liaoning query returned a non-official result"
);
check(
  liaoningPayload.records.some((record) => record.schoolName === "国防科技大学"),
  "Liaoning data does not include National University of Defense Technology"
);

const chongqingEntry = index.provinces.find((province) => province.province === "重庆市");
const chongqingPayload = await Bun.file(path.join(root, chongqingEntry.dataUrl.replace("./", ""))).json();
check(
  chongqingPayload.records.some((record) => record.canonicalSchoolName === "西安电子科技大学"),
  "Chongqing data does not include Xidian University"
);

const beijingEntry = index.provinces.find((province) => province.province === "北京市");
if (beijingEntry?.dataUrl) {
  const beijingPayload = await Bun.file(path.join(root, beijingEntry.dataUrl.replace("./", ""))).json();
  const beijingIds = new Set(beijingPayload.records.map((record) => record.id));
  check(beijingIds.size === beijingPayload.records.length, "Beijing aggregate records contain duplicate IDs");
  check(
    beijingPayload.records.every((record) => record.dataType === "aggregated"),
    "Beijing pilot contains a non-aggregated record"
  );
}

check(verifiedRecords === index.meta.recordCount, "global record count mismatch");
check(officialRecords === index.meta.officialRecordCount, "global official record count mismatch");
check(aggregatedRecords === index.meta.aggregatedRecordCount, "global aggregate record count mismatch");
check(estimatedRecords === index.meta.estimatedRecordCount, "global estimate record count mismatch");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Verified ${officialRecords} official, ${aggregatedRecords} aggregated, and ` +
    `${estimatedRecords} estimated program lines ` +
    `across ${index.meta.provinceCount} provinces.`
);
