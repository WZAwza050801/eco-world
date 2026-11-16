# 02 数据结构 Schema

> 类型定义的唯一权威来源是契约 `00-design-contract.md` §3 与 §8.4（冻结）。
> `packages/core/src/types.ts` 为其逐字实现。本文件仅做字段速查与占位说明。

- §3.1 Cell / §3.2 SpeciesDefinition / §3.3 PopulationState / §3.4 WorldSnapshot / §3.5 其他关键类型：已实现于 `types.ts`（M0）。
- §8.4 HistoricalEvent：已实现于 `types.ts`（M0）。
- 契约未给出字段定义的引用类型（Physiology、EnvironmentPreference、AgentState 等）在 `types.ts` 中以非冻结占位形式存在，详见问题单 Q1/Q2（docs/03-agent-tasks.md）。
- §2 常量：v2.1（2026-11-16，Q4 owner 批准）补充 `SOLAR_AMPLITUDE_DAY`/`SEASON_AMP`（CLIMATE），新增 `HYDROLOGY`（INFILTRATION_CAPACITY/EVAP_RATE/MAX_SURFACE_WATER）与 `SOIL`（MAX_NUTRIENTS）常量组，实现于 `constants.ts`。
- M1 环境场模块接口（E1–E6，非 §14 冻结签名，实现细节见各文件 @non-frozen 注释）：`TemperatureInput/Result`、`PrecipInput`、`WaterBalanceInput/Result`、`NutrientInput/Result`、`BiomeInput/BiomeRule`。
