# ECO WORLD 生态世界盒子

按冻结设计契约 `docs/00-design-contract.md`（v2.1）开发的生态沙盒模拟引擎。
**本仓库的一切类型字段、公式编号、更新顺序、随机接口、目录结构以契约为准，开发者/agent 无权修改冻结项。**

当前进度：**M0（基础类型与随机数）、M1（地形 + 气候水文）、M2（植物-草食-捕食闭环垂直切片）已完成**——
- 地形：**真实地球海陆数据**（Natural Earth 50m → `data/earth/land-mask-128x128.json`，陆地占比 31.9%，与地球实际 29% 一致）+ Perlin fBm 海拔细节（同 seed 逐 cell 可复现），随机生成大陆留给未来版本；
- 气候水文：**E1–E6 全部实现**（太阳辐射/温度/降水含雨影/水量平衡含流向缓存与质量守恒汇流/土壤营养/群系查表），场景气候平均态初始化（`scenario.initializeClimate`）与 §9.2 步骤 2–4（`scheduler.stepEnvironment`）已接线；
- 生态闭环：**B1–B7 全部实现**（光合/呼吸/生长/出生/死亡/Holling II 捕食/竞争），草-兔-狼内容按 §15 填写，`stepWorld` 接通 §9.2 步骤 1–7/9/12（8/10/11 保序占位待 M4/M5/M6）；**草-兔-狼相位延迟振荡验收通过**（1500 tick 系统测试 + 4000 tick 长跑三物种持续共存）；
- 契约 **v2.1**（2026-11-16 owner 批准）：Q4 六个缺失常量冻结；Q6 决策保持方形网格至 M2 闭环。M2 接口不对称按 Q3 先例以非冻结可选扩展实现（问题单 Q9，待 v2.2 冻结）。

见 `packages/sim/src/scenario.ts`、`packages/sim/src/scheduler.ts` 与 `packages/core/src/climate|hydrology|soil|grid|biology`。里程碑路线见契约 §16，**下一步 M3（B8 适合度、B9 迁徙扩散、遗传性状）**。

## 技术栈

- `packages/core` 与 `packages/sim`：TypeScript，纯函数优先，零 I/O、零 DOM、零渲染依赖；
- 测试：Node 内置 test runner（`node:test`），测试文件位于各包 `test/` 下；
- `packages/content`：纯 JSON，禁止在 JSON 中写任何逻辑代码；
- `scripts/`：Node.js ESM（`.mjs`），不依赖浏览器环境。

## 快速开始

```bash
# 安装依赖（仅 dev 依赖：typescript + @types/node）
npm install

# 跑全部测试（编译 + 测试，一条命令复现 CI 结果）
npm test
```

`npm test` 等价于 `tsc -p tsconfig.json && node --test dist/`：
先用 `tsc` 把 `packages/*/src` 与 `packages/*/test` 编译到 `dist/`，再由 Node 内置 test runner 递归执行所有 `*.test.js`。

## 常用命令

| 命令 | 说明 | 状态 |
|---|---|---|
| `npm test` | 编译 + 全量单元测试 | ✅ M0–M2 可用 |
| `npm run build` | 仅编译 TypeScript → `dist/` | ✅ M0–M2 可用 |
| `node scripts/run-scenario.mjs data/scenarios/<x>.json` | 无头跑场景（JSON lines 时间序列） | ✅ M2 可用 |
| `node scripts/replay.mjs <存档>` | 重放存档（同种子逐 tick 一致） | ⏳ M6 |
| `node scripts/validate-content.mjs` | 校验 content JSON | ⏳ M8 |

## M0 验收标准（提示词第 4 步，全部通过）

1. 同 seed 两次调用 `RandomStream` 生成 10000 个数，序列逐位一致；
2. `fork("a")` 与 `fork("b")` 产生不同但可复现的序列；
3. `serialize()` 后反序列化（`RandomStream.fromSerialized`），继续 `next()` 与原流结果一致；
4. `WorldSnapshot` 序列化再反序列化，所有字段值不变（且拒绝 NaN/Infinity）。

## M1 验收标准（契约 §16，全部通过；`npm test` 61 项：58 通过 / 0 失败 / 3 跳过）

1. **山脉两侧降水差异**：迎风坡抬升 > 1、背风坡折扣趋近 `RAIN_SHADOW_FACTOR=0.5`（西风带 slope 0.6 样例比值 ≈ 2.71）；
2. **水流向低处**：`computeFlowDirection` 最陡下降（海洋/洼地为汇 −1）；超量地表水单 tick 转移至下游；饱和链式汇流严格质量守恒；
3. **不产生非法值**：温度 [−70,70] 截断并标记、降水 [0,60]、水量/营养非负且有界（全球扫描）；
4. **可复现**：同 seed 地形+气候逐字节一致；`stepEnvironment` 单/多 tick 重放一致；双缓冲不修改输入；
5. **地理抽查**：撒哈拉→desert、亚马逊→森林、南极→tundra、南太平洋→ocean（真实地球掩模 + E1–E6）。

测试位置：`packages/core/test/climate.test.ts`、`water.test.ts`、`packages/sim/test/scenario.test.ts`。
已知规范观察见问题单 Q8（E2 纬向形状偏冷，非阻塞，M8 前由 owner 决策）。

## M2 验收标准（契约 §16 垂直切片，全部通过；`npm test` 87 项：86 通过 / 0 失败 / 1 跳过）

1. **草-兔-狼振荡**：兔先增、狼后增（相位延迟）、草下降、狼回落；1500 tick 内 ≥2 个周期、三物种持续共存；4000 tick 长跑验证稳定极限环（狼收敛 14–33 区间）；
2. **无负数量**：每 tick 全量断言种群/生物量/储备/年龄结构/环境场边界；
3. **移除捕食者** → 兔暴增（>2×）→ 草崩溃（<20%）；**干旱** → 草↓兔↓狼↓ 级联；
4. **能量不足降低存活/繁殖；植物缺水不无限增长；捕食者无猎物不增长**；
5. **同种子重放逐字节一致**（含 RandomStream 负 state 修复，Q3）；双缓冲不修改输入。

复现：`npm test`；观察振荡：`node scripts/run-scenario.mjs data/scenarios/grass_rabbit_wolf.json --ticks 4000 --every 200`。
测试位置：`packages/core/test/population.test.ts`、`predation.test.ts`、`packages/sim/test/scheduler.test.ts`。
接口不对称与整定记录见问题单 Q9 与任务卡（docs/03-agent-tasks.md）。

## 仓库结构

目录树冻结于契约 §13。核心：

```
docs/00-design-contract.md   # 设计契约（最高优先级，冻结项见 §0.3）
packages/core/               # 纯逻辑：types / constants / RandomStream / 公式模块
packages/sim/                # 调度 / 快照 / 事件 / 场景
packages/content/            # 物种、群系、食物网、事件模板（纯 JSON）
scripts/                     # 无头场景 / 重放 / 内容校验
```

公式索引见 `docs/01-formulas.md`；问题单（规范矛盾/缺失登记）见 `docs/03-agent-tasks.md`。
