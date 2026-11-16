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

### Q4（M0 · 常量缺失 · 已解决 2026-11-16）
- **位置**：§4 公式引用了未在 §2 定义/赋值的常量：`SOLAR_AMPLITUDE_DAY`、`SEASON_AMP`（E1/E2）、`INFILTRATION_CAPACITY`、`EVAP_RATE`、`MAX_SURFACE_WATER`（E4）、`MAX_NUTRIENTS`（E5）。
- **最小修改建议**：契约 v2.1 在 §2 常量表补充上述数值（冻结），M1 开工前完成。
- **解决（2026-11-16，项目 owner 批准建议值）**：`SOLAR_AMPLITUDE_DAY=0.65`、`SEASON_AMP=15`（入 `CLIMATE`）；`INFILTRATION_CAPACITY=20`、`EVAP_RATE=2`、`MAX_SURFACE_WATER=1000`（新增 `HYDROLOGY` 组）；`MAX_NUTRIENTS=1000`（新增 `SOIL` 组）。已写入契约 v2.1 §2 与 `packages/core/src/constants.ts`，M1-1～M1-6 解除阻塞并完成。

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
- **决策（2026-11-16）**：owner 选择**保持方形网格至 M2 闭环验收通过**（与当前建议一致）。六边形提案保留为候选，M3/M8 视扩散各向异性证据再议；已记入契约 v2.1 变更记录。

### Q7（M1 · 树外脚本 · 低风险）
- **位置**：`scripts/build-earth-mask.mjs` 为 §13 冻结树外新增（真实地球数据管线：TopoJSON → 海陆栅格）。
- **最小修改建议**：契约 v2.1 在 §13 scripts/ 下追认数据构建脚本。

### Q8（M1 · 规范观察 · 非阻塞 · 待 owner 决策）
- **位置**：契约 §4 E2 纬向项 `−SOLAR_AMPLITUDE·|sin(rad(lat))|` 与 §2 `BASE_MEAN_TEMP` 注释「全球平均 °C」。
- **观察**：`|sin(lat)|` 在低纬下降过快，按冻结公式实现的风格化气候偏冷——赤道年均 14°C、23°（撒哈拉）≈ −3.6°C、45° ≈ −14°C、极地 −26°C；面积加权全球均值 ≈ −6°C，与注释「全球平均 14°C」及真实地球（≈15°C）不一致。温带/热带群系被压缩到赤道窄带，大部分陆地呈苔原/沙漠。同源风格化问题：§1.2 cell 边长 10 km 与 §1.3 纬度跨全球并存，`coastDistance`（BFS 步数×10km）远小于真实地理距离，E3 水源衰减尺度已按此适配（`MOISTURE_DECAY_KM=150`，@non-frozen）。
- **当前处理**：严格按冻结公式实现（不私改规范）；`biome-rules.json` 阈值适配当前气候（meta 已注明）；M1 验收针对机制（雨影/汇流/边界/重放）而非气候真实感，全部通过。
- **最小修改建议（供 v2.1/M8 决策）**：E2 纬向形状改 `sin²(rad(lat))` 并调整 `BASE_MEAN_TEMP`/`SOLAR_AMPLITUDE`（示例 24/44：赤道 24、23°≈17、45°≈2、60°≈−9、极地 −20）；变更后需重调 `biome-rules.json` 与 E3 水源基准。若采纳，走架构变更提案。
- **决策人**：项目 owner（用户）；建议在 M2 闭环后、M8 调参前决策。

## 任务卡（M0 已完成）

- [x] M0-1 实现 `packages/core/src/types.ts`（§3 + §8.4）
- [x] M0-2 实现 `packages/core/src/constants.ts`（§2）
- [x] M0-3 实现 `packages/core/src/random/RandomStream.ts`（§14.1/§8.3）
- [x] M0-4 实现 `packages/sim/src/snapshot.ts`
- [x] M0-5 测试 `packages/core/test/random.test.ts`、`packages/sim/test/snapshot.test.ts`

## 任务卡（M1 已完成 2026-11-16）

- [x] M1-0 地形生成 v2：真实地球海陆掩模（Natural Earth 50m，陆地占比 31.9%）+ Perlin fBm 海拔细节（`sim/src/scenario.ts`，方案见 Q5/Q7）
- [x] M1-1 E1 太阳辐射（`climate/solar.ts`：`solarInput` + `seasonPhase`；Q4 已解决，常量冻结 v2.1）
- [x] M1-2 E2 温度（`climate/temperature.ts`：`temperature`，±70°C 截断并标记 `truncated`（事件 M6 接线）；天气噪声 σ=2°C @non-frozen；`seasonalAmplitude` 解释为带符号季节项，海洋削弱振幅 (1−0.6·lwf) 倍）
- [x] M1-3 E3 降水（`climate/precipitation.ts`：`precipitation` + `prevailingWind`/`moistureSource`/`transportFactor`/`orographicLift`/`seasonalFactor`/`stormNoiseFactor`/`relativeHumidity`；各因子算法 @non-frozen 已注释；雨影验收通过）
- [x] M1-4 E4 水文与 `computeFlowDirection`（`grid/flowDirection.ts`：最陡下降、海洋/洼地为汇 −1；`hydrology/waterBalance.ts`：`waterBalance` + `stepHydrology` 高程拓扑序单遍汇流（严格质量守恒）、海洋定水头边界、土壤超持水下渗；汇流验收通过）
- [x] M1-5 E5 营养（`soil/nutrients.ts`：`stepNutrients`，分解矿化 C:N=25 同步扣减有机质、固氮/淋失/侵蚀子模型 @non-frozen；`plantUptake`/`fungiActivity` 接口留给 M2/M4）
- [x] M1-6 E6 群系查表（`climate/biome.ts`：`classifyBiome` 纯查表；`content/biomes/biome-rules.json` 12 条规则首条命中，阈值适配冻结 E2 气候（见 Q8）；core 零 I/O，规则由 sim 加载注入）
- [x] M1-7 集成接线：`scenario.initializeClimate`（确定性气候平均态初始化，无噪声）+ `generateWorld` 接入；`scheduler.stepEnvironment`（§9.2 步骤 2–4，天气/风暴噪声经 `fork('core:climate:weather'|'core:climate:storm')` 注入）；`stepWorld` 仍待 M2+

**M1 验收（契约 §16，`npm test` 61 项：58 通过 / 0 失败 / 3 跳过（M2/M7 占位））**：
1. 山脉两侧降水差异 ✓（西风带 slope 0.6：迎风抬升 1.9× vs 背风 0.7×，比值≈2.71，背风折扣趋近冻结 RAIN_SHADOW_FACTOR=0.5）；
2. 水流向低处 ✓（流向缓存逐格指向更低邻居；超量地表水单 tick 转移至下游；饱和链式汇流入海，陆地水量严格守恒）；
3. 不产生非法值 ✓（温度 [−70,70] 截断标记、降水 [0,60]、水量/营养非负且有界，全球扫描）；
4. 可复现 ✓（同 seed 地形+气候逐字节一致；stepEnvironment 单/多 tick 重放一致；双缓冲不修改输入）；
5. 地理抽查 ✓（撒哈拉 desert / 亚马逊森林 / 南极 tundra / 南太平洋 ocean；群系多样性覆盖沙漠/苔原/草原/森林/海洋）。

**下一步：M2 垂直切片（B1–B7 植物-草食-捕食闭环）**——铁律：M2 未通过验收前不展开 M4–M5。待办问题单：Q1/Q2（类型冻结）、Q5/Q7（v2.1 追认提案）、Q8（E2 气候形状，M8 前决策）。
