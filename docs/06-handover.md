# ECO WORLD 交接文档（Handover）

> **目的**：供另一个 session/开发者完整接手本项目。本文**诚实记录**当前状态、脚本的问题与局限、模拟层的近似与已知缺陷、环境坑、待决事项。不粉饰。
> **生成**：2026-11-17，M6 完成后。**权威进度仍以 `docs/03-agent-tasks.md` 任务卡为准**；本文是补充性的"问题与局限"全景，可能与后续进展脱节，接手时先核对任务卡与 `git log`。
> **本文档自身**：docs/06 为 §13 冻结树外新增的元文档（非契约 spec），登记于问题单 Q14，待 owner 追认（同 Q7 先例）。

---

## 0. 30 秒速览

- **是什么**：生态沙盒模拟引擎（TypeScript，纯函数核心 + Node 内置测试），按冻结契约 `docs/00-design-contract.md`（**v2.2**）开发。
- **进度**：**M0–M6 完成**，模拟层 §9.2 全 12 步接通；**M7（前端）/M8（场景验证）未做**。`npm test` = 128 项，127 过 / 0 败 / 1 跳过（M7 ui 占位）。
- **网格**：六边形蜂窝（odd-r offset + cube，6 邻域），v2.2 由方形改造而来（Q6，owner 批准）。
- **仓库**：https://github.com/WZAwza050801/eco-world （Public，main），本地与远端对齐。
- **下一步**：M7 是**产品体验层，必须先与 owner 设计讨论再动工程**（方向≠设计批准）；另有 Q1–Q13 问题单待 owner 决策（见 §6）。
- **最大风险**：① 大量 `@non-frozen` 扩展未冻结（契约与代码有漂移风险）；② 气候偏冷（Q8）使世界非地球真实感；③ 临时脚本不在仓库内（§4.2），换机器/清理后需重建；④ github.com 主域间歇被断（§7）。

---

## 1. 如何跑起来

```bash
npm install          # 仅 dev 依赖：typescript ~5.9 + @types/node ^22
npm test             # = tsc -p tsconfig.json && node --test "dist/**/*.test.js"
npm run build        # 仅编译到 dist/（gitignored）

# 无头跑场景（JSON lines 时间序列）
node scripts/run-scenario.mjs data/scenarios/grass_rabbit_wolf.json --ticks 1500 --every 100
node scripts/run-scenario.mjs data/scenarios/disease_outbreak.json --ticks 60 --save archive.json
# 重放存档（逐 tick 确定性验证）
node scripts/replay.mjs archive.json --ticks 30
```

- 运行时：**Node 22**（本机实测 v22.23.2），ESM（`"type":"module"`）。脚本 `.mjs` 直接 import `dist/` 编译产物——**跑脚本前必须先 `npm run build`**，否则 dist 缺失/过期。
- 测试用 Node 内置 `node:test`，**无 jest/vitest**。测试文件在各包 `test/`，编译到 `dist/` 后由 `node --test` 递归执行。
- 场景 JSON 在 `data/scenarios/`：`grass_rabbit_wolf`（M2 振荡）、`settlement_front`（M3 定殖/屏障）、`disease_outbreak`（M4 爆发）、`settlement_growth`（M5 聚落）。

---

## 2. 治理与工作流（接手必读）

1. **冻结契约**：`docs/00-design-contract.md` 是唯一权威。冻结项 = 单位/坐标协议/类型字段名/公式编号与默认参数/更新顺序/随机接口/文件树。**agent 无权私改**。
2. **遇到契约缺失/冲突**：登记问题单到 `docs/03-agent-tasks.md`（Q 编号）+ 最小修改建议 → **owner（用户）批准** → 升级契约版本 → 实现。先例：Q4（常量缺失）走此流程冻结 v2.1。
3. **非冻结实现细节**：代码注释显式标 `@non-frozen`，并登记问题单。M2–M6 大量接口/算法以此方式扩展（Q9–Q13），**尚未冻结回契约**——这是当前最大的规范漂移风险。
4. **里程碑验收**：契约 §16 定义每个里程碑的验收标准；§18 测试清单。垂直切片铁律：M2 闭环验收前不展开 M4–M5（已达成）。
5. **提交约定**：`[Mx] ...` 前缀；每里程碑两个提交（实现 + 记录）。**完成里程碑后提交并推送 GitHub 对齐是用户常设要求**。
6. **M7 起是产品体验层**：界面/交互/视觉/玩法是设计决策，契约 §11 只给冻结参考布局。**开工前先与 owner 跑设计讨论，不直接套工程 spec**（用户明确偏好：方向声明≠设计批准）。

---

## 3. 仓库结构（核心）

```
packages/core/src/      纯逻辑，零 I/O：types/constants/random/grid/climate/hydrology/soil/biology/disease/humanity
packages/sim/src/       调度/快照/事件/场景：scheduler/snapshot/events/scenario（允许 I/O 加载 content）
packages/content/       纯 JSON：species/（物种+病原）、biomes/biome-rules.json、interactions/foodweb-edges.json、events/
packages/ui/            M7 前端，目前仅占位 stub（test 跳过）
scripts/                build-earth-mask / run-scenario / replay / validate-content（stub）
data/                   earth-land-50m.json（Natural Earth 源）、earth/land-mask-128x128.json、scenarios/
docs/                   00 契约 / 01 公式索引 / 02 schema / 03 任务卡+问题单 / 04 术语 / 05 六边形提案 / 06 本文
```

---

## 4. 脚本清单：问题与局限（重点）

### 4.1 仓库内脚本（scripts/）

#### `build-earth-mask.mjs`（M1，真实地球海陆掩模管线）
- **功能**：Natural Earth 50m TopoJSON → 128×128 equirectangular 陆地分数栅格（每 cell 3×3 超采样），输出 `data/earth/land-mask-{W}x{H}.json`。
- **问题/局限**：
  - **头部注释过时**：注释写输出 `land-mask-128.json`，实际代码输出 `land-mask-${W}x${H}.json`（即 `land-mask-128x128.json`）。注释与代码不符，接手别被注释误导。
  - **南极硬编码修正**：`lat < -84 → 判陆`。Natural Earth 南极洲用"主海岸环（最深约 −84°）+ 沿 −90° 退化极帽环"表示，极帽环无面积，故南极内陆按地理事实硬编码判陆。这是**数据源的妥协修正**，非通用算法；换数据源可能失效。
  - **3×3 超采样偏粗**：海岸线分数只有 9 个采样点，小岛屿/狭窄海岸可能失真。
  - **等距圆柱投影固有失真**：高纬面积挤压（与 Q8 气候问题同源）；陆地占比实测 ~28.7–31.9%（注释说地球实际 ~29%，采样偏高自称正常）。
  - **树外脚本**（Q7）：§13 冻结树未列此脚本，待追认。
  - 无输入校验：W/H 来自 argv `Number()`，非法值不报错。

#### `run-scenario.mjs`（M2 实现，M6 加 --save）
- **功能**：加载场景 JSON → generateWorld → 投放种群 → 跑 N tick → JSON lines 时间序列；`--save` 产存档；支持 `overrides`（均匀覆盖 cell 字段）、`regions`（分区覆盖）、`where`（分区投放）、`report`（分区报告）。
- **问题/局限**：
  - **无场景 schema 校验**：场景 JSON 字段拼错/缺失静默忽略，不报错。
  - **参数解析脆弱**：`argOf` 用 `Number()`，`--ticks abc` → NaN，后续循环行为未定义（不校验）。
  - **--save 只存终态快照**，不存轨迹；要逐 tick 档案需另行记录。
  - **overrides 是测试/演示便利**，直接覆盖 cell 字段（含 latitude/elevation），绕过真实地形——演示场景都是均质人工生境，**不是真实地球场景**。真实地球长程运行尚未系统验证（见 §5）。
  - 依赖 dist 编译产物（先 build）。

#### `replay.mjs`（M6）
- **功能**：读存档 → 反序列化 → 独立重放两次 N tick → 逐 tick 比对序列化 → determinism PASS/FAIL；`--out` 存终态。
- **问题/局限（诚实）**：
  - **确定性验证是"自洽性"而非"绝对正确性"**：它从同一存档独立重放两次比对，证明**重放可复现**，但**不验证重放结果与原始前向运行一致**（没有 golden trace 对照），也不验证存档之前的历史。即：它保证"同存档→同结果"，不保证"模拟本身正确"。
  - 存档是单快照，重放只能**从存档点向后**继续，不能回放存档点之前。
  - 大存档（128×128 全量）序列化比对内存/耗时可观；测试用小世界规避。
  - 依赖 dist。

#### `validate-content.mjs`（M8，**未实现**）
- **现状**：stub，`console.error('TODO(M8)')` + `exit(1)`。**content JSON 目前没有任何自动校验**——物种/病原 schema、单位、范围全靠人工与测试间接保证。这是 M8 待办，也是当前内容质量的缺口。

### 4.2 临时辅助脚本（**不在仓库内**，在 `C:\Users\31168\.qwen\tmp\`）

> ⚠️ **重要**：这些脚本在用户级 `.qwen/tmp/`，**不随仓库分发**，可能被系统清理。换机器/新 session 可能需要重建。技术要点已存 USER 记忆（network-reachability-download / gh-cli-auth-setup）。

#### `eco-world-sync-github-api.mjs`（github 主域被断时的推送绕行）
- **功能**：经 api.github.com Git Data API 精确复刻本地提交（blob→tree→commit 逐字段，SHA 一致才更新 ref）。用法 `node <脚本> <owner> <repo> <branch> <sha...>`（按序，父提交须已是远端头）。
- **问题/局限**：
  - **只支持 A/M/D 变更**：遇到 rename/copy（R/C）直接 throw（`不支持的变更类型`）。有重命名的提交不能用此脚本，须直推。
  - **顺序限制**：提交的父必须已是远端头，只能线性追加，不能推分叉/历史改写。
  - **不创建分支**：只更新已存在的 ref。
  - **依赖**：api.github.com 可达 + gh keyring 有效 token（脚本内清空失效 GITHUB_TOKEN）。
  - **大文件/大仓**：blob 走 base64 内存编码，大文件耗内存；API 速率限制（认证 5000/h）大仓可能撞。
  - **临时脚本**，不在仓库；重建需照 USER 记忆技术要点。
  - 安全：token 不打印不落盘（仅内存 Authorization header）。

#### `eco-world-anisotropy-probe.mjs` / `hex-debug.mjs`（诊断，一次性）
- 各向异性探针（Eden 定殖波支撑函数比）与六边形邻居正确性判别。**纯诊断，非生产代码**。
- **曾踩的坑（已修，记录供参考）**：探针初版对 sim 网格误用**方形整数坐标**量支撑比 → 假偏差 1.26/1.41；改六边形 Cartesian 中心后得正确 1.1547。随机 Eden T 过长撞矩形边界会扭曲支撑比（确定性短程才干净）。`hex-debug` 用绝对坐标算支撑比得负值（无意义）——支撑比须相对中心。
- 教训：**邻居正确性须独立校验**（dist hexNeighbors vs 独立 axial 规则逐格对比），不能"拿 hexNeighbors 验 hexNeighbors"循环论证。

---

## 5. 模拟层的已知局限与近似（诚实清单）

> 这些是**设计简化/未实现项**，多数已登记问题单或标 @non-frozen。接手不要误以为是 bug。

### 5.1 表示层
- **种群是平均场（mean-field）**：count 可为**小数**（如 0.01 ind），不是离散个体。§1.1 的"个体代理"层**未实现**——`WorldSnapshot.agents` 恒为空数组（AgentState 是 Q2 占位类型）。
- **关系网络未实现**：`WorldSnapshot.interactions` 恒为空（InteractionState 占位）。食物网靠 content 的 foodweb-edges.json + 调度器硬接线，不是运行时关系网络。

### 5.2 气候/地理（Q8，待 owner 决策）
- **世界偏冷**：E2 纬向项 `−SOLAR_AMPLITUDE·|sin(lat)|` 在低纬下降过快——赤道年均 14°C、撒哈拉 ≈ −3.6°C、45° ≈ −14°C、全球面积加权均值 ≈ −6°C（真实地球 ≈ +15°C）。**非地球真实感**。biome-rules.json 阈值是**适配这个冷世界**调的；若 owner 决定改 E2 形状（Q8 建议 sin² + 调 BASE/AMP），群系表与 E3 水源基准需重调。
- **尺度风格化**：cell 边长（中心距）10km，但纬度公式跨全球（128 行映射 180°）——每 cell 实际跨 ~2.8°（赤道 ~310km），与"10km"矛盾。`coastDistance = BFS 步数×10km` 远小于真实地理距离；E3 水源衰减尺度（MOISTURE_DECAY_KM=150）是适配此风格化调的。**这是冻结坐标协议的固有张力**，六边形改造未解决（Q8 同源）。

### 5.3 遗传（M3，Q10）
- **traitVariance 恒定**（无突变-选择平衡，简化）；只有耐受性状（coldTolerance/heatTolerance/droughtTolerance/waterloggingTolerance）受选择，**中性性状仅突变漂变**。
- 世代时间 = reproductiveIntervalYears×365（内容驱动）；Lande 方程每 tick /世代天数。
- **culturalComplexity 性状未接线**：人类 culturalModifier 恒 1（见 5.5）。

### 5.4 疾病（M4，Q11）
- **简单 SIR，无潜伏仓室**：`incubationPeriod` 字段存在但**未使用**（无 E 仓室）。
- **病原不演化**：`mutationRate` 字段存在但**未使用**（无病原突变/抗原漂移）。
- `environmentalPersistence` 用作标量乘子；传播邻域 contact=本地、air/water/vector/food=本地+六边形邻居×0.3（权重 @non-frozen）。
- 宿主跳转已实现（hostJumpPotential 溢出 + SIR「宿主 OR 已感染」条件），但**稀有**（virus_rabbit hostJumpPotential=0.001）。
- 疾病死亡在步骤 9/10 直接移除（与捕食一致），B5 disease 修正恒 1（避免重复计死）——**非致死 morbidity 未建模**。

### 5.5 人类（M5，Q12）
- **culturalModifier 恒 1**：无技术/文化进步；v1 §6.5 的技术成本（材料/能源/人口/知识/维护）**未实现**（归 M6+，实际仍未做）。
- **immigration/emigration 恒 0**：人类聚落定居，**不迁徙**（H2 移民项接口在但缺省 0）。
- 食物获取 = 农业收割植物（≤10%/tick，70% 膳食）+ 狩猎（≤5%，30% 膳食），系数 @non-frozen。
- 人类判别 = `taxonomy.genus==='Homo'`（硬编码属名约定）。
- 人畜共患：virus_rabbit hostSpecies 含 homo_sapiens（内容可改项）。

### 5.6 事件（M6，Q13）
- **阈值任意**：崩溃 ≥30%、暴增 ≥50%、爆发感染上穿 10%、气候极端 |T|>60——皆 @non-frozen，无理论依据，M8 可调。
- **因果归因是启发式代理**：`buildCauses` 从 prev/next **可观测状态**推导（感染比例变化、温度变化、生产力变化），**不是从实际通量计算归因**。例如捕食致死未直接归因，用 productivity 变化代理食物因素。**因果链是"相关"而非严格"因果"**——§8.4 要求"引用真实状态量变化"已满足（ref 是真实状态量），但归因完整性有限。
- **每 tick 相对变化检测**：渐变（如缓慢振荡）不触发事件；只有剧烈变化报。平静场景事件数为 0 是正常的。
- 事件历史累积上限 500（确定性 slice）；每 tick 事件上限 50。
- visibility 分级（headline/discoverable）按幅度，hidden 未使用。

### 5.7 测试覆盖缺口
- **M7 ui 测试跳过**（占位）。
- **无真实地球 128×128 长程集成测试**：系统测试都用小世界（3×3/6×6）+ 人工均质生境隔离变量。真实地球全尺寸长程运行的稳定性/性能**未系统验证**。
- **validate-content 未实现**：content 无自动校验。
- 性能：128×128 每 tick 含排序（stepHydrology 高程拓扑排序）+ 全 cell 遍历，长程运行耗时未基准化。

---

## 6. 问题单全表（Q1–Q14，待 owner 决策状态）

| Q | 里程碑 | 主题 | 状态 | 待决 |
|---|---|---|---|---|
| Q1 | M0 | SpeciesDefinition 依赖类型缺失（Physiology 等） | 非冻结占位实现 | 类型冻结 |
| Q2 | M0 | AgentState/InteractionState/EventType/CausalFactor/Outcome 缺失 | 非冻结占位 | 类型冻结 |
| Q3 | M0 | RandomStream 无反序列化入口 | 已解决（fromSerialized 扩展；M2 修负 state bug） | 契约注释追认 |
| Q4 | M0 | 6 个公式常量缺失 | **已解决**（owner 批准，v2.1 冻结） | — |
| Q5 | M1 | 地形算法未指定 | 已按用户指示解决（真实地球掩模 v2） | §3.7 地形生成器追认 |
| Q6 | M1 | 六边形网格架构变更 | **已解决**（owner 批准，v2.2 实现；标题已同步修正为"已解决"） | — |
| Q7 | M1 | build-earth-mask 树外脚本 | 待追认 | §13 追认 |
| Q8 | M1 | E2 纬向公式偏冷 | 忠实实现+登记观察 | **owner 决策气候形状（M8 前）** |
| Q9 | M2 | B1/B2/B5 接口不对称 | 非冻结可选扩展 | v2.3 冻结 |
| Q10 | M3 | B8/B9/遗传算法未指定 | 非冻结实现 | v2.3 冻结 |
| Q11 | M4 | PathogenDefinition 缺失/SIR 离散/真菌 | 非冻结实现 | v2.3 冻结 |
| Q12 | M5 | H 系列因子/死亡式/土地利用/食物获取 | 非冻结实现 | v2.3 冻结 |
| Q13 | M6 | 事件类型/阈值/历史容量/因果 ref | 非冻结实现 | v2.3 冻结 |
| Q14 | — | docs/06 本交接文档树外新增 | 待追认 | §13 追认 |

**核心待决**：Q8（气候真实感）+ Q9–Q13（合并升级契约 v2.3，把大量 @non-frozen 扩展冻结回契约，消除规范漂移）。Q1/Q2（类型冻结）、Q5/Q7/Q14（树追认）。

---

## 7. 环境坑（本机实测，接手必读）

- **shell 是 cmd.exe + Windows PowerShell 5.1**（不是 pwsh7，不是 bash）。
  - PS 5.1 函数内**禁用 Write-Output 打日志**（会污染返回值为数组，`.IndexOf` 恒 −1）；诊断用 Write-Host。
  - `Set-Content -Encoding UTF8` 加 BOM；无 BOM 写回用 `UTF8Encoding($false)` + `[IO.File]::WriteAllText`。
  - cmd 内嵌 PowerShell 的 `%%`/引号/中文路径坑多；**超一行逻辑写 .ps1 文件**。
  - 本项目脚本都是 Node `.mjs`（不受 PS 坑影响），但若新 session 写 PS 脚本须注意。
- **`GITHUB_TOKEN` 环境变量已失效**且抢占 gh 优先级：gh 命令前 `set "GITHUB_TOKEN="`（仅该进程清空，不动全局）。
- **gh keyring 账号 `WZAwza050801`**（scopes gist/read:org/repo），API/git 可用。
- **git credential.helper 是 WorkBuddy PortableGit 的 GCM**（可能弹交互窗）；非交互推送用每命令覆盖：
  `git -c credential.helper= -c credential.https://github.com.helper= -c credential.https://github.com.helper="!gh auth git-credential" push origin main`（配合清空 GITHUB_TOKEN）。
- **github.com 主域可达性数小时内翻转**（本会话多次验证：先通后断再通）：
  - 推送前先 `git ls-remote origin main` 探测；通则直推。
  - 断则走 api.github.com（通常通）+ `eco-world-sync-github-api.mjs` 复刻（§4.2）。
  - **每次网络操作前探测，不照旧结论**（USER 记忆 network-reachability-download）。
- **CRLF**：git autocrlf 导致 LF→CRLF warning（正常，非错误）。
- **`.serena/`**：未跟踪目录，是其他工具（Serena MCP）缓存，**不要提交**，逐路径暂存避开它。
- **dist/ gitignored**：脚本依赖 dist，跑脚本前先 build。

---

## 8. 待办（下一步）

1. **M7 前端**（ui/*）：图层/详情/时间线，验收"玩家能看懂为什么"。**先与 owner 设计讨论**（六边形渲染、图层切换、因果展示、观察 vs 干预玩法），拍板后动工程。
2. **M8 场景验证/调参**：validate-content.mjs 实现、真实地球长程场景、参数整定（Q8 气候决策在此前）。
3. **契约 v2.3 冻结**：Q9–Q13 合并，把 @non-frozen 扩展冻结回契约（owner 批准）。
4. **类型冻结**：Q1/Q2。
5. **树追认**：Q5/Q7/Q14。
6. **文档不一致修复**（小）：build-earth-mask 头部注释输出文件名仍写 `land-mask-128.json`（实际 `land-mask-{W}x{H}.json`），待修。Q6 标题"未决"→"已解决"已随本次交接提交修正。

---

## 9. 接手 checklist

- [ ] 读 `docs/00-design-contract.md`（v2.2）§0.3 冻结规则、§16 里程碑、§17 任务模板、§18 验收。
- [ ] 读 `docs/03-agent-tasks.md` 任务卡（权威进度）+ 问题单 Q1–Q14。
- [ ] `git log --oneline` 核对提交历史；`git status` 确认干净（.serena/ 除外）。
- [ ] `npm install && npm test` 确认 128 项 127 过基线。
- [ ] 确认 gh 凭据（`set "GITHUB_TOKEN=" && gh auth status`）与远端对齐（`git ls-remote origin main` vs `git rev-parse main`）。
- [ ] 动冻结项前查契约版本+问题单，被阻塞先提案等 owner 批准。
- [ ] M7 先设计讨论；完成里程碑提交+推送对齐。
- [ ] 临时脚本（§4.2）若被清理，照 USER 记忆重建 sync 脚本。

---

## 10. 诚实总结

这个项目在**模拟层工程**上是扎实的：冻结契约驱动、问题单治理、每里程碑验收测试、确定性重放、六边形改造有量化证据。但接手须清楚：

- **它不是地球真实模拟器**：气候偏冷（Q8）、尺度风格化、平均场种群、大量 @non-frozen 近似。验收针对**机制正确**（振荡/传播/定居/重放），不是生态真实感。
- **规范与代码有漂移**：M2–M6 的接口/算法扩展还没冻结回契约（Q9–Q13），契约 v2.2 只冻结到六边形几何。
- **产品体验层（M7/M8）基本空白**：ui 是 stub，content 无校验，真实地球长程未验证。
- **因果链是启发式相关**，不是严格通量因果。
- **临时脚本不在仓库**，环境（网络/凭据/shell）有坑。

把这些当作已知边界，而非待修的 bug——多数是设计简化或待 owner 决策项。