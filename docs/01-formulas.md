# 01 公式索引（编号 ↔ 文件 ↔ 函数）

> 来源：契约 §4–§7。本文件是索引，公式正文以 `00-design-contract.md` 为准。
> 遗传（M3，契约无公式编号）：`packages/core/src/biology/population.ts` 的 `traitSelectionDelta`（Lande h²σ²β/世代天数）与 `traitMutationDelta`；性状→适生范围映射 `TRAIT_RANGE_MAP`（fitness.ts）。见问题单 Q10。

| 编号 | 名称 | 实现文件 | 函数 | 里程碑 |
|---|---|---|---|---|
| E1 | 太阳辐射 | packages/core/src/climate/solar.ts | solarInput、seasonPhase | M1 ✅ |
| E2 | 温度 | packages/core/src/climate/temperature.ts | temperature | M1 ✅ |
| E3 | 降水 | packages/core/src/climate/precipitation.ts | precipitation、prevailingWind、moistureSource、transportFactor、orographicLift、seasonalFactor、stormNoiseFactor、relativeHumidity | M1 ✅ |
| E4 | 水量平衡 | packages/core/src/hydrology/waterBalance.ts、packages/core/src/grid/flowDirection.ts | waterBalance、stepHydrology、computeFlowDirection | M1 ✅ |
| E5 | 土壤与营养 | packages/core/src/soil/nutrients.ts | stepNutrients | M1 ✅ |
| E6 | 生物群系 | packages/core/src/climate/biome.ts（规则表 packages/content/biomes/biome-rules.json） | classifyBiome | M1 ✅ |
| B1 | 光合作用 | packages/core/src/biology/photosynthesis.ts | grossPrimaryProduction（lightFactor/tempFactor/waterFactor/nutrientFactor） | M2 ✅ |
| B2 | 呼吸损耗 | packages/core/src/biology/photosynthesis.ts | respiration | M2 ✅ |
| B3 | 植物生长 | packages/core/src/biology/photosynthesis.ts | plantGrowth（herbivory 项见 predation.ts） | M2 ✅ |
| B4 | 出生 | packages/core/src/biology/population.ts | stepPopulation、densityModifier | M2 ✅ |
| B5 | 死亡 | packages/core/src/biology/population.ts | stepPopulation、starvationModifier、climateStressModifier | M2 ✅ |
| B6 | 捕食（Holling II） | packages/core/src/biology/predation.ts | holling2、predationEnergyGain | M2 ✅ |
| B7 | 竞争 | packages/core/src/biology/competition.ts | effectiveResource | M2 ✅ |
| B8 | 适合度 | packages/core/src/biology/fitness.ts | fitness（冻结）、rangeSuitability、fitnessStressModifier、habitatFitness、effectiveEnvironment | M3 ✅ |
| B9 | 迁徙与扩散 | packages/core/src/biology/dispersal.ts | dispersalFlow、movementPressure、suitabilityGradient、targetAccessibility、migrationCapacity、establishment、migrationCost | M3 ✅ |
| D1 | SIR 疾病 | packages/core/src/disease/sir.ts | - | M4 |
| H1 | 食物需求 | packages/core/src/humanity/food.ts | - | M5 |
| H2 | 聚落增长 | packages/core/src/humanity/settlement.ts | - | M5 |
| H3 | 土地利用反馈 | packages/core/src/humanity/landUse.ts | - | M5 |
