# 03 Agent 任务卡仓库

> 任务卡格式与行为红线见契约 §17。发现规范矛盾时在此登记问题单，不自行改契约。

## 问题单

### Q1（M0 · 类型缺失 · 非阻塞）
- **位置**：契约 §3.2 `SpeciesDefinition` 引用了 `Taxonomy`（已定义）、`FunctionalRoles`（已定义）及以下类型，但契约全文未给出其字段定义：`Physiology`、`EnvironmentPreference`、`ResourceProfile`、`LifeHistory`、`MovementProfile`、`InteractionProfile`、`GeneticsProfile`、`DiseaseProfile`、`EcosystemEffectProfile`。
- **影响**：M0 要求“类型编译通过”且“字段名一字不差”，两者无法同时满足（未定义则无法编译）。
- **当前处理**：在 `types.ts` 中按契约 §15 物种实例（15.1–15.5）反推出的最小字段集定义上述类型，并全部标注 `@non-frozen`（非冻结）。字段名可能与最终契约不一致。
- **最小修改建议**：契约 v2.1 新增 §3.6「SpeciesDefinition 依赖类型定义」，冻结各 profile 字段名与单位；随后以冻结版覆盖 `types.ts` 对应段落。

### Q2（M0 · 类型缺失 · 非阻塞）
- **位置**：§3.4 `WorldSnapshot` 引用 `AgentState`、`InteractionState`；§8.4 `HistoricalEvent` 引用 `EventType`、`CausalFactor`、`Outcome`——契约均未定义。
- **当前处理**：`types.ts` 中给出非冻结占位定义（`AgentState`/`InteractionState` 为带 TODO 的最小结构；`CausalFactor`/`Outcome` 按 §8.4 文字说明“引用真实状态量及其变化”推导）。
- **最小修改建议**：契约 v2.1 补充上述 5 个类型的冻结定义。

### Q3（M0 · 接口不对称 · 非阻塞）
- **位置**：§14.1 骨架中 `serialize(): string` 有序列化，但 §8.3 冻结接口无反序列化方法；测试验收要求“serialize 后反序列化继续 next() 与原流一致”。
- **当前处理**：在 `RandomStream` 上增加静态方法 `static fromSerialized(s: string): RandomStream`（`parseInt(s, 16)` 恢复 state）。未改动 §8.3 冻结的 5 个实例方法签名。
- **最小修改建议**：契约 §8.3 接口注释中明确“反序列化通过静态构造方法由实现方扩展”。

### Q4（M0 · 常量缺失 · 不阻塞 M0，阻塞 M1）
- **位置**：§4 公式引用了未在 §2 定义/赋值的常量：`SOLAR_AMPLITUDE_DAY`、`SEASON_AMP`（E1/E2）、`INFILTRATION_CAPACITY`、`EVAP_RATE`、`MAX_SURFACE_WATER`（E4）、`MAX_NUTRIENTS`（E5）。
- **最小修改建议**：契约 v2.1 在 §2 常量表补充上述数值（冻结），M1 开工前完成。

### Q5（M1 · 算法未指定 · 已按用户指示解决）
- **位置**：契约 §16 M1 要求"地形"生成，但 §4–§7 无地形生成公式，§13 文件树亦无 terrain 模块。
- **处理**：2026-11-16 用户指定方案——Perlin 梯度噪声（fBm 多倍频）+ 地球形状参考（真实大陆经纬度椭圆掩模，北极无掩模对应北冰洋，南极极地盖）。实现于 `packages/sim/src/scenario.ts`（场景初始化职责），随机性全部经 RandomStream 派生（`sim:scenario:terrain:*` fork tag），未新增目录树外顶层结构。
- **最小修改建议**：契约 v2.1 增补 §3.7「地形生成器」小节，冻结掩模大陆表与海拔映射参数；或明确地形算法为可改项。

## 任务卡（M0 已完成）

- [x] M0-1 实现 `packages/core/src/types.ts`（§3 + §8.4）
- [x] M0-2 实现 `packages/core/src/constants.ts`（§2）
- [x] M0-3 实现 `packages/core/src/random/RandomStream.ts`（§14.1/§8.3）
- [x] M0-4 实现 `packages/sim/src/snapshot.ts`
- [x] M0-5 测试 `packages/core/test/random.test.ts`、`packages/sim/test/snapshot.test.ts`

## 任务卡（M1 进行中）

- [x] M1-0 地形生成：Perlin + fBm + 地球大陆掩模 → elevation/slope/aspect/terrainType/landWaterFraction/coastDistance/latitude/neighbors（`sim/src/scenario.ts`，方案见 Q5）
- [ ] M1-1 E1 太阳辐射（`climate/solar.ts`）——阻塞于 Q4 常量
- [ ] M1-2 E2 温度（`climate/temperature.ts`）——阻塞于 Q4 常量
- [ ] M1-3 E3 降水（`climate/precipitation.ts`，含雨影 RAIN_SHADOW_FACTOR）
- [ ] M1-4 E4 水文与 `computeFlowDirection`（`hydrology/waterBalance.ts`、`grid/flowDirection.ts`）
- [ ] M1-5 E5 营养（`soil/nutrients.ts`）
- [ ] M1-6 E6 群系查表（`climate/biome.ts` + `content/biomes/biome-rules.json`）
