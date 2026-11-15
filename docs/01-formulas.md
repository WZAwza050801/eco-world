# 01 公式索引（编号 ↔ 文件 ↔ 函数）

> 来源：契约 §4–§7。本文件是索引，公式正文以 `00-design-contract.md` 为准。

| 编号 | 名称 | 实现文件 | 函数 | 里程碑 |
|---|---|---|---|---|
| E1 | 太阳辐射 | packages/core/src/climate/solar.ts | - | M1 |
| E2 | 温度 | packages/core/src/climate/temperature.ts | - | M1 |
| E3 | 降水 | packages/core/src/climate/precipitation.ts | - | M1 |
| E4 | 水量平衡 | packages/core/src/hydrology/waterBalance.ts、packages/core/src/grid/flowDirection.ts | computeFlowDirection | M1 |
| E5 | 土壤与营养 | packages/core/src/soil/nutrients.ts | - | M1 |
| E6 | 生物群系 | packages/core/src/climate/biome.ts | - | M1 |
| B1 | 光合作用 | packages/core/src/biology/photosynthesis.ts | grossPrimaryProduction | M2 |
| B2 | 呼吸损耗 | packages/core/src/biology/photosynthesis.ts | respiration | M2 |
| B3 | 植物生长 | packages/core/src/biology/photosynthesis.ts | plantGrowth | M2 |
| B4 | 出生 | packages/core/src/biology/population.ts | stepPopulation | M2 |
| B5 | 死亡 | packages/core/src/biology/population.ts | stepPopulation | M2 |
| B6 | 捕食（Holling II） | packages/core/src/biology/predation.ts | holling2 | M2 |
| B7 | 竞争 | packages/core/src/biology/competition.ts | - | M2 |
| B8 | 适合度 | packages/core/src/biology/fitness.ts | fitness | M3 |
| B9 | 迁徙与扩散 | packages/core/src/biology/dispersal.ts | - | M3 |
| D1 | SIR 疾病 | packages/core/src/disease/sir.ts | - | M4 |
| H1 | 食物需求 | packages/core/src/humanity/food.ts | - | M5 |
| H2 | 聚落增长 | packages/core/src/humanity/settlement.ts | - | M5 |
| H3 | 土地利用反馈 | packages/core/src/humanity/landUse.ts | - | M5 |
