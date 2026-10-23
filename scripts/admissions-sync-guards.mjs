// These checks are independent of the network so failed refreshes cannot silently
// replace a complete province with an older or incomplete dataset.
export function parseSyncYear(args, currentYear = new Date().getUTCFullYear()) {
  const value = args.find((arg) => arg.startsWith("--year="))?.slice(7);
  if (!/^\d{4}$/.test(value || "") || Number(value) < 2000 || Number(value) > currentYear) {
    throw new Error(`请明确指定有效年份 --year=YYYY（2000–${currentYear}），不会默认回退到旧年份。`);
  }
  return Number(value);
}

export function assertNoYearDowngrade(existing, year, province) {
  const metadataYear = Math.max(
    Number(existing?.meta?.year) || 0,
    Number(existing?.meta?.indexEntry?.source?.year) || 0
  );
  const latestYear = [...(existing?.sources || []), ...(existing?.records || [])]
    .reduce((latest, row) => Math.max(latest, Number(row.year) || 0), metadataYear);
  if (latestYear > year) {
    throw new Error(`${province}: 已有 ${latestYear} 年数据，拒绝用 ${year} 年数据覆盖。`);
  }
}

export function isSameYearCache(existing, year) {
  return Number(existing?.meta?.year) === year &&
    Number(existing?.meta?.indexEntry?.source?.year) === year &&
    existing?.records?.length > 0 &&
    existing.records.every((record) => Number(record.year) === year) &&
    !(existing.meta.failedRequests?.length) &&
    !(existing.meta.indexEntry?.source?.failedFileCount);
}

export function sameYearReference(reference, year) {
  return Number(reference?.meta?.year ?? reference?.year) === year ? reference : null;
}

export function assertSourceRecordYears(records, year) {
  for (const record of records) {
    if (record.year != null && record.year !== "" && Number(record.year) !== year) {
      throw new Error(`请求 ${year} 年，但源记录包含 ${record.year} 年数据。`);
    }
  }
}

export function assertCompleteRefresh({ province, records, failed, previousCount = 0, allowRecordDrop = false }) {
  if (failed.length) {
    throw new Error(`${province}: ${failed.length} 个请求失败，保留原数据；首个错误: ${failed[0].error}`);
  }
  if (!records.length) {
    throw new Error(`${province}: 没有可用录取位次记录，保留原数据（可能尚未发布或缺少同年位次）。`);
  }
  if (!allowRecordDrop && previousCount > 0 && records.length < previousCount * 0.8) {
    throw new Error(`${province}: 记录数从 ${previousCount} 降至 ${records.length}，减少超过 20%，保留原数据；核验后可使用 --allow-record-drop。`);
  }
}
