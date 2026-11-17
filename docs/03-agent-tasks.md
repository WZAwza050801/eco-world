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
- **M2 修复（2026-11-16）**：state 为 int32（Mulberry32 `|0`），消耗后可为负 → 冻结骨架 `serialize()` 输出负十六进制（如 `-6fc5fb46`），原 `fromSerialized` 拒绝负值导致重放入口崩溃（M2 跑场景时暴露）。修复在 Q3 扩展内：接受 [−2³¹, 2³²−1] 解析值，构造器 `>>>0` 恢复位模式；`serialize()` 冻结骨架未动。回归测试：60 种子×30 次消耗往返逐位一致（覆盖负 state 路径）。

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

### Q9（M2 · 接口/公式不对称 · 非阻塞 · 已按 Q3 先例以非冻结扩展实现）
- **位置与处理**（全部不改冻结签名/字段，可选扩展显式标 `@non-frozen`，待 v2.2 冻结）：
  1. §14.2 `PhotoInput` 缺 B1 公式引用的物种参数（最适温/高斯宽度/半饱和常数）→ 增可选字段 `tempOptimum/tempTolerance/kWater/kNutrient`，缺省常量在 `photosynthesis.ts`；
  2. §14.2 `respiration(gpp, biomass, maintenanceRate)` 缺 B2 的 growthRespiration → 增可选第 4 参 `growthFraction`（缺省 0.25）；
  3. §5 B5 的 `randomMortality` 不在 §14.3 `modifiers` 字段中 → 增可选 `modifiers.randomMortality`（缺省 1）；`energyReserve/health` 为因果携带量，修正项以 modifiers 为准，推导 helper（`starvationModifier`/`climateStressModifier`/`densityModifier`）导出供调度器/测试调用；
  4. B3 的 herbivory/droughtDamage/competitionLoss 公式未指定 → herbivory 实现为饱和采食 functional response（`predation.ts`，prey 以 kgC 计，避开 B6 ind 单位冲突）；干旱/自疏在 scheduler 内 @non-frozen 实现；
  5. 狼 `movement.pattern='territorial'`（§15.3）→ 领域性捕食干扰：有效攻击率 a/(1+0.5·捕食者密度)，仅缩放 B6 输入，公式本体不变（均质生境持续共存的关键稳定机制）；
  6. `Physiology` 增可选 `reserveMaxDays`（K 策略者耐饿更久，狼 25 天/缺省 15 天）；`ResourceProfile` 增可选 `kWater/kNutrient/energyDensity/conversionEfficiency`；
  7. `foodweb-edges.json` 边 schema 契约未冻结 → @non-frozen：carnivory 边 attackRate/handlingTime/preference；herbivory 边 halfSaturationKgC；
  8. 繁殖率/基础死亡率契约无显式公式 → 由 lifeHistory/physiology 推导：reproRate = 平均窝仔数×juvenileSurvival/(繁殖间隔×365)，baselineMortality = 1/(maximumAge×365)；环境容纳量 @non-frozen（草食=植物能量/需求×30 天窗口，肉食=猎物×0.15）。
- **最小修改建议**：契约 v2.2 冻结上述可选字段与推导公式（或给出替代定义）；§14.2/§14.3 骨架同步增补。
- **决策人**：项目 owner（用户）；不阻塞 M3+（扩展均向后兼容）。

### Q10（M3 · 算法/语义未指定 · 非阻塞 · 已按非冻结实现）
- **位置与处理**（B8/B9/遗传的契约未冻结细节，全部 `@non-frozen` 标注）：
  1. **B8 宽容函数**形状未指定 → 高斯软衰减 `exp(−(d/softWidth)²)`（尾部梯度非零，边际生境中自然选择可作用）；硬致死边际由 preferred 范围导出（温度 ±15°C / 水分 ±100mm），超出 → suitability 0 + `hardConstraint` 标记（契约 B8 的 hard_constraint 要求）；
  2. **硬致死接线**：B5 climate 修正项超硬界 → `HARD_LETHAL_MULT=200`（M2 的软上限 6 为占位，M3 升级；M2 气候单测期望值随之更新——这是实现契约 B8 硬致死要求，非降验收）；climate 胁迫含温度+水分（取 max）；
  3. **B9 各因子**算法未指定 → 压力 = 探索基线 0.02 + 密度超拐点 0.7 推挤 + 适合度赤字；梯度 = max(0, f_j−f_i) + **空适生目标竞争释放加成 0.3**（否则等适生空域永远无法定殖）；通行性 = 物种方式 × cell.accessibility（步行/种子/孢子/人为辅助不跨海洋，飞行/风媒可）；能力 = speed/10km；随机因子对数正态 σ0.3；单 tick 外迁帽 0.5；
  4. **定殖与成本**（§18.1 迁徙有边界和成本）：定殖量 = flow × 目标**绝对**生境适合度（硬致死 0 → 不定殖）；迁徙成本 2 kJ/(kg·km)×10km 从迁徙者储备扣减；定殖失败 = 死亡 → 有机质；最小定殖阈值 0.01 ind / 0.01 kgC（防僵尸种群）；
  5. **B8 全适合度接线**：环境×食物×氧气驱动迁移压力；疾病/竞争/捕食修正暂 1（M4+ 接线）；梯度/定殖用**生境适合度（仅环境）**——空 cell 无食物，若用全适合度则先驱者永远无法定殖（鸡生蛋问题）；
  6. **遗传**契约无公式编号（仅 §9.1 尺度、§3.3 traitMeans/Variance、§3.2 GeneticsProfile）→ Lande 方程 Δmean = h²σ²β/世代天数，世代天数 = reproductiveIntervalYears×365（内容驱动：兔 ~36 天演化快，草/狼 ~365 天符合 decade 尺度）；β 为性状→生境适合度数值梯度（±0.5 差分）；`TRAIT_RANGE_MAP`：coldTolerance/heatTolerance/droughtTolerance/waterloggingTolerance 每 +1 均值外扩对应环境边界 1 单位；中性性状仅突变漂变；方差保持（简化）；均值界 ±30；基因流随迁徙按数量加权混合；
  7. **植物种子扩散**（B9 seed 模板）：每 tick 分配生物量 2% 为种子库，定殖再乘 0.5；0 生物量植物种群保留作再生基础（M2 约定）。
- **最小修改建议**：契约 v2.2 与 Q9 合并冻结（宽容函数形状/硬边际、B9 因子定义、遗传模型与性状语义、定殖/成本规则）。
- **决策人**：项目 owner（用户）；不阻塞 M4+。

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

## 任务卡（M2 已完成 2026-11-16）

- [x] M2-1 B1–B3 光合/呼吸/植物生长（`biology/photosynthesis.ts`，冻结签名；因子 helper 导出；Q9 可选扩展）
- [x] M2-2 B4–B5 出生/死亡（`biology/population.ts`：`stepPopulation` + `densityModifier`/`starvationModifier`/`climateStressModifier` helper；饥饿指数 M2 整定 exp(3) 上限 20×，种群可撑过资源低谷）
- [x] M2-3 B6 捕食（`biology/predation.ts`：`holling2` 冻结签名 + `predationEnergyGain` + `herbivory`（B3 项，kgC 饱和采食，日采食上限 0.35 防啃绝））
- [x] M2-4 B7 竞争（`biology/competition.ts`：`effectiveResource`，接入草食者共享植物资源）
- [x] M2-5 内容填写（§15 范例 → `grass_c3/rabbit/wolf.json` + `foodweb-edges.json`；物种数值可改项；狼→兔边 a=0.014/h=0.3，兔→草 K=100kgC；deer/oak/fungus/virus/homo 仍为空占位，**铁律：M3–M5 再填**）
- [x] M2-6 调度接线（`scheduler.stepWorld`：§9.2 步骤 1–7/9/12 实现，8/10/11 显式占位保序（M4/M5/M6）；流向 WeakMap 缓存传递；领域性捕食干扰（Q9-5）；年龄结构轻量动态；尸体/凋落物→有机质路由；`scenario.loadSpeciesDefinitions/loadFoodwebEdges/seedPopulations`）
- [x] M2-7 无头场景（`scripts/run-scenario.mjs` 实现 + `data/scenarios/grass_rabbit_wolf.json`：6×6 均匀适生平原，草 1500/兔 120/狼 2 每 cell；overrides/all:true 为 @non-frozen 场景便利）
- [x] M2-8 测试与整定（`population.test.ts`/`predation.test.ts` 替换占位 + 新增 `sim/test/scheduler.test.ts` 系统验收；RandomStream 负 state 重放修复（Q3）+ 回归测试）

**M2 验收（契约 §16，`npm test` 87 项：86 通过 / 0 失败 / 1 跳过（M7 占位））**：
1. **草-兔-狼振荡 ✓**：1500 tick 系统测试断言兔峰早于狼峰（相位延迟）、兔峰后草下降 >20%、狼峰后回落 >20%、≥2 个显著兔峰（持续振荡非单次崩溃）、终态三物种共存；脚本长跑 4000 tick（≈11 年）三物种持续共存，狼收敛至 14–33 区间振荡；
2. **无负数量 ✓**：每 tick 全量断言 count/biomass/储备/年龄结构/环境场边界（§18.1）；
3. **移除捕食者 → 兔暴增（>2×）→ 草崩溃（<20%）✓**（§15.6）；
4. **干旱 → 草↓兔↓狼↓ 营养级联 ✓**（§15.6）；
5. **捕食者无猎物不增长 ✓ / 植物缺水不无限增长 ✓ / 能量不足降低存活繁殖 ✓**（§18.1）；
6. **同种子重放逐字节一致 + 双缓冲不改输入 ✓**（§10.5/§9.3）。

**整定记录（全部可改项/@non-frozen，M8 复调）**：狼→兔 a 0.008→0.014、h 0.05→0.3；兔→草 K 300→100；采食上限系数 3→2.2、日采食比例 0.6→0.35；饥饿指数 6→3（上限 400→20）；狼 juvenileSurvival 0.5→0.7（§15.3 parentalCare 高）、reserveMaxDays 25；领域干扰系数 0.5。整定路径：狼先灭绝→兔草崩溃→引入领域干扰+温和饥饿→持续振荡→狼生活史整定→4000 tick 稳定极限环。

**下一步：M3（B8 适合度、B9 迁徙扩散、遗传性状）**——验收：物种只在适生区定居。待决问题单：Q1/Q2（类型冻结）、Q5/Q7（v2.1 追认）、Q8（E2 气候形状）、Q9（v2.2 接口冻结）。

## 任务卡（M3 已完成 2026-11-16）

- [x] M3-1 B8 适合度（`biology/fitness.ts`：冻结 `fitness()` 未动；`rangeSuitability` 高斯软衰减+硬致死标记、`fitnessStressModifier`、`habitatFitness`、`effectiveEnvironment`/`TRAIT_RANGE_MAP` 性状→适生范围耦合；Q10）
- [x] M3-2 B9 迁徙扩散（`biology/dispersal.ts`：`dispersalFlow` 冻结公式结构+边界 flow≤源；`movementPressure`/`suitabilityGradient`（空适生格竞争释放加成）/`targetAccessibility`（步行/种子不跨海）/`migrationCapacity`/`establishment`/`migrationCost`/`dispersalRandomFactor`；Q10）
- [x] M3-3 遗传性状（`biology/population.ts`：`traitSelectionDelta`（Lande h²σ²β/世代天数）+ `traitMutationDelta`；世代时间由 lifeHistory 内容驱动；方差保持简化；Q10）
- [x] M3-4 调度接线（`scheduler.stepWorld` 步骤 9 续：遗传→迁徙两阶段流量（先算后应用，基因流加权混合）；B5 climate 升级温度+水分+硬致死；性状平移适生范围参与存活；步骤 12 按扩散后终态重算 CC；`seedPopulations` 性状初始化 mean 0/var 1）
- [x] M3-5 内容调整（可改项：草种子扩散 speed 0.5→2 km/day；兔/狼 heritableTraits += coldTolerance）
- [x] M3-6 场景工具（`run-scenario.mjs` 增 regions 分区覆盖 / where 分区投放 / report 分区报告；`data/scenarios/settlement_front.json` 定殖前沿演示：8×8，海洋屏障+冷区+空适生格）
- [x] M3-7 测试（`population.test.ts` 增 B8/B9/遗传单元节 + M2 气候单测升级硬致死语义；新增 `sim/test/dispersal.test.ts` 系统验收）

**M3 验收（契约 §16，`npm test` 100 项：99 通过 / 0 失败 / 1 跳过（M7 占位））**：
1. **物种只在适生区定居 ✓**：冷区（lat 75，冬季硬致死）兔 600→<1、草 >99% 崩溃；适生区草/兔/狼持续存活（730 tick 演示）；
2. **空适生格定殖 ✓**：初始无兔的适生格被 B9 扩散定殖（≥1 ind；演示区兔 960→2820 含定殖增量）；
3. **迁徙有边界和成本 ✓**：海洋列零种群；拓扑隔离右侧 730 tick 始终为空；flow≤源种群；迁徙能量成本扣储备；定殖失败计死亡；
4. **遗传 ✓**：边际冷世界 200 tick coldTolerance 定向上升 >0.008（Lande），中性性状 bodyMass 仅漂变 |·|<0.001，方差保持，基因流混合；
5. **重放 ✓**：含扩散/遗传 80 tick 逐字节一致；双缓冲不改输入；M2 振荡验收回归通过。

**测试设计记录**：初版夹具把冷区动物投在右侧，它们按 B9 梯度**合法逃逸**到右侧适生区定殖（正确行为）导致隔离断言失败——修正为冷区投放仅在左侧、右侧完全无源，隔离断言无歧义。此现象本身即"物种只在适生区定居"的佐证（不适生→向适生迁移）。

**下一步：M4（D1 疾病 + 真菌）**——验收：高密度更易传播。待决问题单：Q1/Q2（类型冻结）、Q5/Q7（v2.1 追认）、Q8（E2 气候形状）、Q9/Q10（v2.2 接口/算法冻结）。
