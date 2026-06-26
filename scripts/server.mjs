import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const port = Number(Bun.env.PORT || 5173);
const gaokaoHistoryCache = new Map();

const trackByType = {
  "1": "physics",
  "2": "history",
  "3": "general",
  "2073": "physics",
  "2074": "history",
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
};

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "");
}

function safeFilePath(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, normalized));
  return filePath.startsWith(root) ? filePath : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function flattenProviderRecords(payload) {
  const groups = payload?.data && typeof payload.data === "object" ? Object.values(payload.data) : [];
  return groups.flatMap((group) => group?.item || []);
}

async function fetchProviderRows(endpoint, schoolId, year, provinceCode) {
  const sourceUrl = `https://static-data.gaokao.cn/www/2.0/${endpoint}/${schoolId}/${year}/${provinceCode}.json`;
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; ZemuErqi-Preview/1.0)" },
  });
  if (!response.ok) return { sourceUrl, status: response.status, rows: [] };
  const payload = await response.json();
  const rows = flattenProviderRecords(payload);
  return { sourceUrl, status: 200, rows };
}

function createPlanLookup(planRows) {
  const byExact = new Map();
  const normalizedPlans = [];
  for (const item of planRows) {
    const track = trackByType[String(item.type)] || "general";
    const majorName = String(item.spname || item.sp_name || "").trim();
    const planCount = positiveNumber(item.num);
    if (!majorName || !planCount) continue;
    const normalized = normalizeName(majorName);
    const entry = { track, normalized, planCount };
    const exactKey = `${track}:${normalized}`;
    if (!byExact.has(exactKey)) byExact.set(exactKey, []);
    byExact.get(exactKey).push(entry);
    normalizedPlans.push(entry);
  }
  return { byExact, normalizedPlans };
}

function findPlanCount(planLookup, track, majorName) {
  const normalized = normalizeName(majorName);
  const exact = planLookup.byExact.get(`${track}:${normalized}`) || [];
  if (exact.length === 1) return exact[0].planCount;

  const prefixMatches = planLookup.normalizedPlans.filter(
    (entry) =>
      entry.track === track &&
      entry.normalized.startsWith(`${normalized}(`)
  );
  return prefixMatches.length === 1 ? prefixMatches[0].planCount : null;
}

async function historyResponse(request) {
  const url = new URL(request.url);
  const schoolId = url.searchParams.get("schoolId");
  const provinceCode = url.searchParams.get("provinceCode");
  if (!/^\d+$/.test(schoolId || "") || !/^\d+$/.test(provinceCode || "")) {
    return Response.json({ error: "invalid query" }, { status: 400 });
  }

  const cacheKey = `${schoolId}:${provinceCode}`;
  if (gaokaoHistoryCache.has(cacheKey)) {
    return Response.json(gaokaoHistoryCache.get(cacheKey));
  }

  const years = [2021, 2022, 2023, 2024, 2025];
  const records = [];
  const planRecords = [];
  const sources = [];
  await Promise.all(
    years.map(async (year) => {
      try {
        const [scoreSource, planSource] = await Promise.all([
          fetchProviderRows("schoolspecialscore", schoolId, year, provinceCode),
          fetchProviderRows("schoolspecialplan", schoolId, year, provinceCode),
        ]);
        sources.push({
          year,
          kind: "score",
          sourceUrl: scoreSource.sourceUrl,
          status: scoreSource.status,
          rawRecordCount: scoreSource.rows.length,
        });
        sources.push({
          year,
          kind: "plan",
          sourceUrl: planSource.sourceUrl,
          status: planSource.status,
          rawRecordCount: planSource.rows.length,
        });

        for (const item of planSource.rows) {
          const track = trackByType[String(item.type)] || "general";
          const majorName = String(item.spname || item.sp_name || "").trim();
          const planCount = positiveNumber(item.num);
          if (!majorName || !planCount) continue;
          planRecords.push({
            year,
            track,
            majorName,
            planCount,
            countSource: "招生计划",
            batch: String(item.local_batch_name || item.batch || "").trim(),
            subjectRequirement: String(item.sp_info || item.sg_info || "").trim(),
            admissionType: String(item.zslx_name || "").trim(),
            specialGroup: String(item.special_group || "").trim(),
            sourceUrl: planSource.sourceUrl,
          });
        }

        const planLookup = createPlanLookup(planSource.rows);
        let importedRecordCount = 0;
        let resultCountKnown = 0;
        let planMatchedCount = 0;
        for (const item of scoreSource.rows) {
          const track = trackByType[String(item.type)] || "general";
          const majorName = String(item.spname || item.sp_name || "").trim();
          const minScore = positiveNumber(item.min);
          const minRank = positiveNumber(item.min_section);
          if (!majorName || !minRank) continue;
          importedRecordCount += 1;
          const resultPlanCount = positiveNumber(item.lq_num);
          const matchedPlanCount = resultPlanCount ? null : findPlanCount(planLookup, track, majorName);
          if (resultPlanCount) resultCountKnown += 1;
          if (matchedPlanCount) planMatchedCount += 1;
          records.push({
            year,
            track,
            majorName,
            minScore,
            minRank,
            planCount: resultPlanCount || matchedPlanCount,
            countSource: resultPlanCount ? "录取结果" : matchedPlanCount ? "招生计划" : null,
            batch: String(item.local_batch_name || item.batch || "").trim(),
            subjectRequirement: String(item.sp_info || item.sg_info || "").trim(),
            admissionType: String(item.zslx_name || "").trim(),
            specialGroup: String(item.special_group || "").trim(),
            sourceUrl: scoreSource.sourceUrl,
          });
        }
        const scoreEntry = sources.find((source) => source.year === year && source.kind === "score");
        if (scoreEntry) {
          scoreEntry.importedRecordCount = importedRecordCount;
          scoreEntry.resultCountKnown = resultCountKnown;
          scoreEntry.planMatchedCount = planMatchedCount;
        }
      } catch (error) {
        sources.push({ year, kind: "history", status: "error", error: error.message });
      }
    })
  );

  const payload = {
    schoolId,
    provinceCode,
    generatedAt: new Date().toISOString(),
    years,
    sources: sources.sort((a, b) => a.year - b.year),
    planRecords: planRecords.sort(
      (a, b) =>
        a.year - b.year ||
        a.track.localeCompare(b.track) ||
        b.planCount - a.planCount ||
        a.majorName.localeCompare(b.majorName, "zh-CN")
    ),
    records: records.sort(
      (a, b) =>
        a.year - b.year ||
        a.track.localeCompare(b.track) ||
        a.minRank - b.minRank ||
        a.majorName.localeCompare(b.majorName, "zh-CN")
    ),
  };
  gaokaoHistoryCache.set(cacheKey, payload);
  return Response.json(payload);
}

Bun.serve({
  port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/gaokao-history") return historyResponse(request);

    const filePath = safeFilePath(request.url);
    if (!filePath) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: {
        "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      },
    });
  },
});

console.log(`Gaokao atlas running at http://localhost:${port}/`);
