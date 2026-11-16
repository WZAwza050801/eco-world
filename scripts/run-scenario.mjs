#!/usr/bin/env node
/**
 * 无头跑场景（契约 §13；M2 实现，依赖 stepWorld）。
 * 用法：node scripts/run-scenario.mjs data/scenarios/<场景>.json [--ticks N] [--every N]
 *
 * 场景 JSON（@non-frozen schema）：
 *   { seed, width?, height?, ticks?,
 *     overrides?: {Cell 字段覆盖，均匀生境演示/测试用},
 *     populations: [{speciesId, x, y, count?, biomass?} | {speciesId, all:true, ...}] }
 *   all:true 表示向全部 cell 投放（脚本展开为逐 cell 种子）。
 * 输出：JSON lines 时间序列（每 every tick 一行：各物种总 count/biomass）。
 * 重放语义：每 tick 从快照 randomState 恢复随机流（契约 §10.5）。
 */
import { readFileSync } from 'node:fs';
import { generateWorld, seedPopulations } from '../dist/sim/src/scenario.js';
import { stepWorld } from '../dist/sim/src/scheduler.js';
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

const sc = JSON.parse(readFileSync(file, 'utf8'));
const ticks = argOf('--ticks', sc.ticks ?? 365);
const every = Math.max(1, argOf('--every', Math.max(1, Math.floor(ticks / 20))));

let world = generateWorld({ seed: sc.seed ?? 20261116, width: sc.width, height: sc.height });
if (sc.overrides) {
  world = { ...world, cells: world.cells.map((c) => ({ ...c, ...sc.overrides })) };
}
const seeds = [];
for (const p of sc.populations ?? []) {
  if (p.all) {
    for (const c of world.cells) seeds.push({ ...p, all: undefined, x: c.id.x, y: c.id.y });
  } else {
    seeds.push(p);
  }
}
world = seedPopulations(world, seeds);

const totals = (w) => {
  const t = {};
  for (const p of w.populations) {
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

console.log(JSON.stringify({ tick: 0, ...totals(world) }));
for (let t = 1; t <= ticks; t++) {
  const rng = RandomStream.fromSerialized(world.randomState);
  world = stepWorld(world, rng);
  if (t % every === 0 || t === ticks) {
    console.log(JSON.stringify({ tick: t, ...totals(world) }));
  }
}
