# 择木而栖

一个面向高考志愿筛选的静态可视化网站。数据基于教育部《全国普通高等学校名单》（截至 2025-06-20），仅展示普通本科院校，不含港澳台地区高等学校及军事院校。

## 运行

```bash
bun run start
```

打开 `http://localhost:5173/`。

## 数据

- `data/schools.json`：前端使用的数据文件。
- `data/china.json`：中国地图 GeoJSON。
- `data/raw/moe-colleges-2025.xls`：教育部原始附件。
- `data/raw/moe-colleges-2025.rows.json`：由 Excel 转出的二维数组。
- `data/admissions/sources.json`：各省官方投档数据源登记表。
- `data/admissions/raw/`：从省级教育考试机构下载的原始投档表。
- `data/admissions/provinces/`：5 个已取得官方专业线省份的规范化数据。
- `data/admissions/aggregated/provinces/`：其余省份的公开专业录取数据与来源文件索引。
- `scripts/build-data.mjs`：生成前端数据。
- `scripts/sync-admissions.mjs`：下载、校验并规范化官方投档数据。
- `scripts/sync-gaokao-cn.mjs`：逐省逐校查询公开专业录取数据。
- `scripts/verify-admissions.mjs`：检查全国记录数量、来源、重复 ID 和位次字段。

重新生成：

```bash
bun run build:data
```

同步已登记的官方投档表：

```bash
bun run sync:admissions
```

查询公开专业录取数据：

```bash
bun run sync:aggregated
```

校验全国数据：

```bash
bun run verify:admissions
```

## 位次数据规则

排名查询以“省份 + 院校 + 专业”为数据粒度，不用一所学校的最低门槛代替全部专业。数据按以下顺序使用：

1. 浙江、山东、河北、辽宁、重庆使用 2025 年省级考试机构官方专业投档数据。
2. 其余 25 个省级招生地使用 2024 年掌上高考公开专业录取数据，保留每所学校静态 JSON 地址和 SHA-256 文件哈希。
3. 新疆多数专业只公开最低分，使用公开转载的 2024 年文理科一分一段表换算同分位次上限，并校验每一分档的累计递推关系。
4. 西藏没有公开一分一段表，公开专业数据连续多年也不提供位次。470 条西藏普通本科记录仅把公开最低分换算为粗略估算位次，页面单独标注“估算位次”。

公开数据查询对每个待补省份扫描 1,347 个已匹配院校入口；HTTP 404 作为“该校在该省没有公开文件”登记，网络失败不会被当作已查到。提前批、专项、预科、定向和特殊班不进入普通排名推荐。当前全国数据共 475,958 条，校验结果为 0 个重复记录 ID、0 个失败请求。
