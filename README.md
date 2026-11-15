# ECO WORLD 生态世界盒子

按冻结设计契约 `docs/00-design-contract.md`（v2.0）开发的生态沙盒模拟引擎。
**本仓库的一切类型字段、公式编号、更新顺序、随机接口、目录结构以契约为准，开发者/agent 无权修改冻结项。**

当前进度：**M0（基础类型与随机数）已完成**；**M1 地形部分已完成**——**真实地球海陆数据**（Natural Earth 50m → `data/earth/land-mask-128x128.json`，陆地占比 31.9%，与地球实际 29% 一致）+ Perlin fBm 海拔细节（同 seed 逐 cell 可复现），随机生成大陆留给未来版本。见 `packages/sim/src/scenario.ts` 与预览 `dist/terrain-preview.html`（`node dist/gen-preview.mjs` 重新生成）。里程碑路线见契约 §16（M1 气候水文 → … → M8 场景验证）。

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
| `npm test` | 编译 + 全量单元测试 | ✅ M0 可用 |
| `npm run build` | 仅编译 TypeScript → `dist/` | ✅ M0 可用 |
| `node scripts/run-scenario.mjs data/scenarios/<x>.json` | 无头跑场景 | ⏳ M1+（依赖 stepWorld） |
| `node scripts/replay.mjs <存档>` | 重放存档（同种子逐 tick 一致） | ⏳ M6 |
| `node scripts/validate-content.mjs` | 校验 content JSON | ⏳ M8 |

## M0 验收标准（提示词第 4 步，全部通过）

1. 同 seed 两次调用 `RandomStream` 生成 10000 个数，序列逐位一致；
2. `fork("a")` 与 `fork("b")` 产生不同但可复现的序列；
3. `serialize()` 后反序列化（`RandomStream.fromSerialized`），继续 `next()` 与原流结果一致；
4. `WorldSnapshot` 序列化再反序列化，所有字段值不变（且拒绝 NaN/Infinity）。

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
