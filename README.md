# 全国本科院校可视化分布

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
- `scripts/build-data.mjs`：生成前端数据。

重新生成：

```bash
bun run build:data
```

## 推荐模型

院校推荐分、专业排名参考和省排名估算均为静态模型生成，用于志愿初筛；正式填报前仍需结合各省一分一段表、招生计划、近年投档线和专业组要求复核。
