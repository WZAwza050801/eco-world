# 02 数据结构 Schema

> 类型定义的唯一权威来源是契约 `00-design-contract.md` §3 与 §8.4（冻结）。
> `packages/core/src/types.ts` 为其逐字实现。本文件仅做字段速查与占位说明。

- §3.1 Cell / §3.2 SpeciesDefinition / §3.3 PopulationState / §3.4 WorldSnapshot / §3.5 其他关键类型：已实现于 `types.ts`（M0）。
- §8.4 HistoricalEvent：已实现于 `types.ts`（M0）。
- 契约未给出字段定义的引用类型（Physiology、EnvironmentPreference、AgentState 等）在 `types.ts` 中以非冻结占位形式存在，详见问题单 Q1/Q2（docs/03-agent-tasks.md）。
- §2 常量：v2.1（2026-11-16，Q4 owner 批准）补充 `SOLAR_AMPLITUDE_DAY`/`SEASON_AMP`（CLIMATE），新增 `HYDROLOGY`（INFILTRATION_CAPACITY/EVAP_RATE/MAX_SURFACE_WATER）与 `SOIL`（MAX_NUTRIENTS）常量组，实现于 `constants.ts`。
- M1 环境场模块接口（E1–E6，非 §14 冻结签名，实现细节见各文件 @non-frozen 注释）：`TemperatureInput/Result`、`PrecipInput`、`WaterBalanceInput/Result`、`NutrientInput/Result`、`BiomeInput/BiomeRule`。
- M2（Q9，@non-frozen 可选扩展，待 v2.2 冻结）：`PhotoInput` 增 tempOptimum/tempTolerance/kWater/kNutrient；`respiration` 增可选第 4 参 growthFraction；`PopulationInput.modifiers` 增可选 randomMortality；`Physiology` 增 pMax/maxBiomass/maintenanceRespiration/growthRespiration/tempOptimum/tempTolerance/reserveMaxDays；`ResourceProfile` 增 kWater/kNutrient/energyDensity/conversionEfficiency；食物网边 schema（`FoodwebEdge`）与场景种子（`PopulationSeed`）见 sim/src/scenario.ts。冻结签名/字段名均未改动。
- M3（Q10，@non-frozen 算法/语义，待 v2.2 冻结）：`SuitabilityResult`（suitability + hardConstraint 标记，契约 B8 hard_constraint）；`TRAIT_RANGE_MAP` 耐受性状→环境边界平移（traitMeans 单位 °C/mm，初始 mean 0/variance 1，界 ±30）；B9 因子 helper 与定殖/成本规则见 biology/dispersal.ts；遗传 Lande 方程见 biology/population.ts。冻结类型字段未改动。
- v2.2（Q6，owner 批准的架构变更）：`Cell.id{x,y}` 语义 = 六边形 odd-r offset (col,row)；`Cell.neighbors` 4→6 项（字段名/类型不变）；`WORLD` 几何常量改六边形（CELL_EDGE_KM=中心距 10、新增 CELL_HEX_SIDE_KM、CELL_AREA_KM2≈86.60）。新增 `Cube` 接口与 hex 工具（grid/hex.ts）。**其余冻结类型字段一字未改**；公式拓扑无关。见 docs/05。
- M4（Q11，@non-frozen，待 v2.3 冻结）：新增 `PathogenDefinition`（契约 §6 引用但未定义，按 §6/§15.5 推导）；`PopulationState` 增可选 `recoveredState?`（SIR 的 R 仓室，S=1−I−R）；`PopulationSeed` 增 `infectionState?`（初始感染）。病原与物种同存 content/species/*.json，按 `transmissionMode`（病原）vs `simulationTier`（物种）判别分离。D1 离散式/密度因子/环境因子/真菌模型见 disease/sir.ts、soil/nutrients.ts。冻结字段名未改。
- M5（Q12，@non-frozen，待 v2.3 冻结）：H1 `foodNeed`/`foodModifier`、H2 `settlementGrowth`（SettlementInput/Result）、H3 `landUseImpact`（LandUseInput/Impact）见 humanity/*。智人判别约定 `taxonomy.genus==='Homo'`（与动物分流，人类走 H 系列+参与 SIR）；`homo_sapiens.json` 按 §7/§12.1 推导（§15 无人类实例）；virus_rabbit hostSpecies 含 homo_sapiens（人畜共患）。冻结字段名未改。
