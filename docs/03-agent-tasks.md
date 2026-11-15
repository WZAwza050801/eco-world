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

### Q5（M1 · 算法未指定 · 已按用户指示解决，v2）
- **位置**：契约 §16 M1 要求"地形"生成，但 §4–§7 无地形生成公式，§13 文件树亦无 terrain 模块。
- **处理 v2（2026-11-16 用户升级指示）**：大陆分布改为**真实地球海陆数据**——Natural Earth 50m（world-atlas TopoJSON），经 `scripts/build-earth-mask.mjs` 转为 128×128 陆地分数栅格（`data/earth/land-mask-128x128.json`，每 cell 3×3 超采样）。随机生成大陆留给未来版本。海拔细节仍为 Perlin fBm（RandomStream 派生，可复现）。实现于 `packages/sim/src/scenario.ts`。
- **已知数据修正**：Natural Earth 南极洲 = 主海岸环（最深约 -84°）+ 沿 -90° 退化极帽环，南极内陆（lat < -84°）按地理事实直接判陆（南极点高原）。
- **最小修改建议**：契约 v2.1 增补 §3.7「地形生成器」：冻结掩模数据源、经度协议（lon = 360*(x+0.5)/W - 180）与海拔映射参数。

### Q6（M1 · 架构变更提案候选 · 未决）
- **议题**：用户提出"空间单位是否六边形更合适"。六边形 6 邻居等距等向（扩散各向同性、无对角线歧义）确实优于 4 邻域方形；但 §1.3 坐标协议（方形网格/4 邻域/纬度公式/边界墙）为冻结项，且：
  1. 真实地球数据为 equirectangular 矩形栅格，映射六边形需重采样，高纬环带挤压问题需专门处理；
  2. E4 水流（邻居高差）、B9 扩散、§9.2 全管线均按 4 邻域书写；
  3. M2 垂直切片铁律在前，切换网格拓扑将推迟闭环验证。
- **当前建议**：保持方形网格至 M2 闭环通过；将本条留作 v2.1 架构变更提案候选。若 M3/M8 扩散各向异性产生可观测偏差，届时在有全量测试保护下一次性切换（axial 坐标 + 数据重采样）。缓解措施：契约 §1.3 已含 8 邻域展示平滑；扩散可后续引入对角 0.5 权重近似各向同性。
- **决策人**：项目 owner（用户）。

### Q7（M1 · 树外脚本 · 低风险）
- **位置**：`scripts/build-earth-mask.mjs` 为 §13 冻结树外新增（真实地球数据管线：TopoJSON → 海陆栅格）。
- **最小修改建议**：契约 v2.1 在 §13 scripts/ 下追认数据构建脚本。

## 任务卡（M0 已完成）

- [x] M0-1 实现 `packages/core/src/types.ts`（§3 + §8.4）
- [x] M0-2 实现 `packages/core/src/constants.ts`（§2）
- [x] M0-3 实现 `packages/core/src/random/RandomStream.ts`（§14.1/§8.3）
- [x] M0-4 实现 `packages/sim/src/snapshot.ts`
- [x] M0-5 测试 `packages/core/test/random.test.ts`、`packages/sim/test/snapshot.test.ts`

## 任务卡（M1 进行中）

- [x] M1-0 地形生成 v2：真实地球海陆掩模（Natural Earth 50m，陆地占比 31.9%）+ Perlin fBm 海拔细节（`sim/src/scenario.ts`，方案见 Q5/Q7）
- [ ] M1-1 E1 太阳辐射（`climate/solar.ts`）——阻塞于 Q4 常量
- [ ] M1-2 E2 温度（`climate/temperature.ts`）——阻塞于 Q4 常量
- [ ] M1-3 E3 降水（`climate/precipitation.ts`，含雨影 RAIN_SHADOW_FACTOR）
- [ ] M1-4 E4 水文与 `computeFlowDirection`（`hydrology/waterBalance.ts`、`grid/flowDirection.ts`）
- [ ] M1-5 E5 营养（`soil/nutrients.ts`）
- [ ] M1-6 E6 群系查表（`climate/biome.ts` + `content/biomes/biome-rules.json`）
