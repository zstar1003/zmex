// Filter the complete query result before pagination, preserving its sort order.
export function filterMajorMatches(matches, keyword = "") {
  const query = String(keyword).trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
  if (!query) return matches;
  return matches.filter((item) =>
    String(item.major?.name || "").normalize("NFKC").toLocaleLowerCase("zh-CN").includes(query),
  );
}
