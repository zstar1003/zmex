import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const schoolDataPath = path.join(root, "data", "schools.json");
const outPath = path.join(root, "data", "admissions", "major-index.json");
const provinceDirs = [
  path.join(root, "data", "admissions", "provinces"),
  path.join(root, "data", "admissions", "aggregated", "provinces"),
];

const actualDataTypes = new Set(["official", "aggregated"]);
const dataTypePriority = { official: 2, aggregated: 1 };

function normalizeMajorText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[（）()·\s-]/g, "");
}

async function jsonFiles(dir) {
  try {
    const entries = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir, absolute: true }));
    return entries.sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    return [];
  }
}

function betterLine(next, previous) {
  if (!previous) return true;
  if (next.y !== previous.y) return next.y > previous.y;
  const nextPriority = dataTypePriority[next.d] || 0;
  const previousPriority = dataTypePriority[previous.d] || 0;
  if (nextPriority !== previousPriority) return nextPriority > previousPriority;
  return next.r < previous.r;
}

const schoolData = await Bun.file(schoolDataPath).json();
const knownSchoolIds = new Set(
  [...(schoolData.schools || []), ...(schoolData.admissionSchools || [])].map((school) => String(school.id)),
);

const linesByKey = new Map();
const provinces = new Set();
const sourceAuthorities = new Set();
const counts = {
  inputRecords: 0,
  actualRecords: 0,
  skippedEstimatedRecords: 0,
  skippedInvalidRecords: 0,
};

for (const dir of provinceDirs) {
  for (const filePath of await jsonFiles(dir)) {
    const payload = await Bun.file(filePath).json();
    const sourcesById = new Map((payload.sources || []).map((source) => [source.id, source]));

    for (const record of payload.records || []) {
      counts.inputRecords += 1;
      if (!actualDataTypes.has(record.dataType)) {
        if (record.dataType === "estimated") counts.skippedEstimatedRecords += 1;
        continue;
      }

      const schoolId = String(record.schoolId || "");
      const majorName = String(record.majorName || "").trim();
      const majorKey = normalizeMajorText(majorName);
      const minRank = Number(record.minRank);
      const year = Number(record.year);
      if (!knownSchoolIds.has(schoolId) || !majorName || !majorKey || !Number.isFinite(minRank) || !Number.isFinite(year)) {
        counts.skippedInvalidRecords += 1;
        continue;
      }

      const source = sourcesById.get(record.sourceId) || {};
      const line = {
        schoolId,
        n: majorName,
        k: majorKey,
        p: record.province,
        y: year,
        t: record.track || "general",
        r: minRank,
        s: Number.isFinite(Number(record.minScore)) ? Number(record.minScore) : null,
        b: record.batch || "",
        q: record.subjectRequirement || "",
        d: record.dataType,
        m: record.rankMethod || "official-min-rank",
        l: source.authority || (record.dataType === "official" ? "省级教育考试机构" : "公开招生数据平台"),
        u: record.sourceUrl || source.pageUrl || "",
      };

      const key = `${line.schoolId}::${line.k}`;
      if (betterLine(line, linesByKey.get(key))) linesByKey.set(key, line);
      provinces.add(line.p);
      sourceAuthorities.add(line.l);
      counts.actualRecords += 1;
    }
  }
}

const schools = {};
for (const line of linesByKey.values()) {
  schools[line.schoolId] ||= [];
  schools[line.schoolId].push(line);
}

Object.values(schools).forEach((lines) => {
  lines.sort(
    (a, b) =>
      a.n.localeCompare(b.n, "zh-CN") ||
      b.y - a.y ||
      (dataTypePriority[b.d] || 0) - (dataTypePriority[a.d] || 0) ||
      a.r - b.r,
  );
});

const output = {
  meta: {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputRecords: counts.inputRecords,
    actualRecords: counts.actualRecords,
    indexedLines: linesByKey.size,
    schoolCount: Object.keys(schools).length,
    provinceCount: provinces.size,
    sourceAuthorities: [...sourceAuthorities].sort((a, b) => a.localeCompare(b, "zh-CN")),
    skippedEstimatedRecords: counts.skippedEstimatedRecords,
    skippedInvalidRecords: counts.skippedInvalidRecords,
    representativeRule:
      "Each school-major keeps one actual admission line: latest year first, official data before aggregated data, then smaller minRank.",
    note: "Only official and aggregated admission lines are indexed. Estimated records are intentionally excluded.",
  },
  schools,
};

await Bun.write(outPath, `${JSON.stringify(output)}\n`);
console.log(`Wrote ${linesByKey.size} actual major admission lines to ${path.relative(root, outPath)}`);
