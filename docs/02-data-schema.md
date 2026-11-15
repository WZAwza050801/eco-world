# 02 数据结构 Schema

> 类型定义的唯一权威来源是契约 `00-design-contract.md` §3 与 §8.4（冻结）。
> `packages/core/src/types.ts` 为其逐字实现。本文件仅做字段速查与占位说明。

- §3.1 Cell / §3.2 SpeciesDefinition / §3.3 PopulationState / §3.4 WorldSnapshot / §3.5 其他关键类型：已实现于 `types.ts`（M0）。
- §8.4 HistoricalEvent：已实现于 `types.ts`（M0）。
- 契约未给出字段定义的引用类型（Physiology、EnvironmentPreference、AgentState 等）在 `types.ts` 中以非冻结占位形式存在，详见问题单 Q1/Q2（docs/03-agent-tasks.md）。
