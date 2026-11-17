#!/usr/bin/env node
/**
 * 无头跑场景（契约 §13；M2 实现，依赖 stepWorld）。
 * 用法：node scripts/run-scenario.mjs data/scenarios/<场景>.json [--ticks N] [--every N]
 *
 * 场景 JSON（@non-frozen schema）：
 *   { seed, width?, height?, ticks?,
 *     overrides?: {Cell 字段覆盖，均匀生境演示/测试用},
 *     regions?: [{x0,y0,x1,y1,overrides}]  // 按序 applied（后覆盖前），M3 空间生境
 *     populations: [{speciesId, x, y, count?, biomass?}
 *                   | {speciesId, all:true, where?:{x0,y0,x1,y1}, ...}]
 *     report?: [{name,x0,y0,x1,y1}] }      // 分区报告（M3 定殖/清除观察）
 *   all:true 表示向全部（或 where 范围内）cell 投放。
 * 输出：JSON lines 时间序列（每 every tick 一行：全局各物种总 count/biomass + 分区）。
 * 重放语义：每 tick 从快照 randomState 恢复随机流（契约 §10.5）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateWorld, seedPopulations } from '../dist/sim/src/scenario.js';
import { stepWorld } from '../dist/sim/src/scheduler.js';
import { serializeWorldSnapshot } from '../dist/sim/src/snapshot.js';
import { RandomStream } from '../dist/core/src/random/RandomStream.js';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('用法: node scripts/run-scenario.mjs <场景.json> [--ticks N] [--every N]');
  process.exit(1);
}
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : dflt;
};
const argStr = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const savePath = argStr('--save', null);

const sc = JSON.parse(readFileSync(file, 'utf8'));
const ticks = argOf('--ticks', sc.ticks ?? 365);
const every = Math.max(1, argOf('--every', Math.max(1, Math.floor(ticks / 20))));

let world = generateWorld({ seed: sc.seed ?? 20261116, width: sc.width, height: sc.height });
if (sc.overrides) {
  world = { ...world, cells: world.cells.map((c) => ({ ...c, ...sc.overrides })) };
}
const inBox = (c, b) => c.id.x >= b.x0 && c.id.x <= b.x1 && c.id.y >= b.y0 && c.id.y <= b.y1;
for (const r of sc.regions ?? []) {
  world = { ...world, cells: world.cells.map((c) => (inBox(c, r) ? { ...c, ...r.overrides } : c)) };
}
const seeds = [];
for (const p of sc.populations ?? []) {
  if (p.all) {
    for (const c of world.cells) {
      if (p.where && !inBox(c, p.where)) continue;
      seeds.push({ ...p, all: undefined, where: undefined, x: c.id.x, y: c.id.y });
    }
  } else {
    seeds.push(p);
  }
}
world = seedPopulations(world, seeds);

const totals = (w, box) => {
  const t = {};
  for (const p of w.populations) {
    if (box && !inBox({ id: p.cellId }, box)) continue;
    const e = (t[p.speciesId] ??= { count: 0, biomass: 0 });
    e.count += p.count;
    e.biomass += p.biomass;
  }
  for (const e of Object.values(t)) {
    e.count = Math.round(e.count * 100) / 100;
    e.biomass = Math.round(e.biomass * 10) / 10;
  }
  return t;
};
const snapshotLine = (w, tick) => {
  const line = { tick, ...totals(w) };
  if (sc.report) {
    line.regions = {};
    for (const r of sc.report) line.regions[r.name] = totals(w, r);
  }
  return JSON.stringify(line);
};

console.log(snapshotLine(world, 0));
for (let t = 1; t <= ticks; t++) {
  const rng = RandomStream.fromSerialized(world.randomState);
  world = stepWorld(world, rng);
  if (t % every === 0 || t === ticks) {
    console.log(snapshotLine(world, t));
  }
}
if (savePath) {
  writeFileSync(savePath, serializeWorldSnapshot(world));
  console.error(`存档已保存（快照+随机流，供 replay.mjs 重放）: ${savePath}`);
}
