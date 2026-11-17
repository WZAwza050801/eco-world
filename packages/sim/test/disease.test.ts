/**
 * M4 系统验收（契约 §16 M4 / §6 / §15.4 / §15.5 / §18.2）。
 * 验收项：
 *  - 高密度更易传播：高密度兔群病毒爆发（I 峰显著），低密度消退（R0<1）；
 *  - SIR 比例守恒 S+I+R ≤ 1（每 tick）；疾病死亡降低种群；
 *  - 分解真菌加速养分循环（有真菌 vs 无真菌，营养矿化更多）；
 *  - 含疾病/真菌的重放逐字节一致；双缓冲不修改输入。
 * 生境：均质适生暖湿平原（lat 0），隔离生态混淆，短程（30 tick）捕捉疾病动力学。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, WorldSnapshot } from '../../core/src/types.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateWorld, seedPopulations, type PopulationSeed } from '../src/scenario.js';
import { stepWorld } from '../src/scheduler.js';
import { createWorldSnapshot, serializeWorldSnapshot } from '../src/snapshot.js';

const SEED = 20261116;
const PATHOGEN = 'virus_rabbit';

const land: Partial<Cell> = {
  latitude: 0, elevation: 50, slope: 0, aspect: 0, terrainType: 'plain',
  landWaterFraction: 0, coastDistance: 0, salinity: 0.1, soilMoisture: 200,
  nutrients: 300, organicMatter: 500, surfaceWater: 0, groundwater: 0, accessibility: 1,
};

function buildWorld(seeds: PopulationSeed[], overrides: Partial<Cell> = {}): WorldSnapshot {
  const base = generateWorld({ seed: SEED, width: 6, height: 6 });
  const cells = base.cells.map((c) => ({ ...c, ...land, ...overrides }));
  const world = createWorldSnapshot({ time: 0, season: 0, cells, randomState: base.randomState });
  return seedPopulations(world, seeds);
}

function rabbitSeeds(count: number, infected: number): PopulationSeed[] {
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    seeds.push({ speciesId: 'grass_c3', x, y, biomass: 2000 });
    seeds.push({ speciesId: 'rabbit', x, y, count, infectionState: { [PATHOGEN]: infected } });
  }
  return seeds;
}

const infectedFraction = (w: WorldSnapshot): number => {
  let sum = 0, n = 0;
  for (const p of w.populations) {
    if (p.speciesId !== 'rabbit') continue;
    sum += (p.infectionState?.[PATHOGEN] ?? 0) * p.count;
    n += p.count;
  }
  return n > 0 ? sum / n : 0;
};

function run(world: WorldSnapshot, ticks: number, onTick?: (w: WorldSnapshot, t: number) => void): WorldSnapshot {
  let w = world;
  for (let t = 1; t <= ticks; t++) {
    w = stepWorld(w, RandomStream.fromSerialized(w.randomState));
    for (const p of w.populations) {
      const I = p.infectionState?.[PATHOGEN] ?? 0;
      const R = p.recoveredState?.[PATHOGEN] ?? 0;
      assert.ok(I >= 0 && R >= 0 && I + R <= 1 + 1e-6, `SIR 比例越界 @${t}: I=${I} R=${R}`);
      assert.ok(p.count >= 0 && Number.isFinite(p.count), `负数量 @${t}`);
    }
    onTick?.(w, t);
  }
  return w;
}

test('M4 验收：高密度更易传播——高密度兔群病毒爆发，低密度消退（§6 densityFactor）', () => {
  let highPeak = 0, lowPeak = 0;
  run(buildWorld(rabbitSeeds(250, 0.02)), 30, (w) => { highPeak = Math.max(highPeak, infectedFraction(w)); });
  run(buildWorld(rabbitSeeds(30, 0.02)), 30, (w) => { lowPeak = Math.max(lowPeak, infectedFraction(w)); });
  assert.ok(highPeak > 0.1, `高密度应爆发（I 峰 >0.1），实际 ${highPeak.toFixed(3)}`);
  assert.ok(highPeak > 2 * lowPeak, `高密度 I 峰应显著高于低密度: high=${highPeak.toFixed(3)} low=${lowPeak.toFixed(3)}`);
});

test('M4：疾病死亡降低种群（感染高密度群 vs 无感染对照，终态数量更少）', () => {
  const infected = run(buildWorld(rabbitSeeds(250, 0.05)), 40);
  const control = run(buildWorld(rabbitSeeds(250, 0)), 40);
  const count = (w: WorldSnapshot) => w.populations.filter((p) => p.speciesId === 'rabbit').reduce((s, p) => s + p.count, 0);
  assert.ok(count(infected) < count(control), `疾病应降低种群: infected=${count(infected).toFixed(0)} control=${count(control).toFixed(0)}`);
});

test('M4：分解真菌加速有机质周转（有真菌 vs 无真菌，OM 消耗更快；§15.4）', () => {
  const seedsBase: PopulationSeed[] = [];
  const seedsFungus: PopulationSeed[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    seedsBase.push({ speciesId: 'grass_c3', x, y, biomass: 0 });
    seedsFungus.push({ speciesId: 'grass_c3', x, y, biomass: 0 });
    seedsFungus.push({ speciesId: 'decomposer_fungus', x, y, biomass: 50 });
  }
  const ov = { organicMatter: 1000, nutrients: 50 };
  const withFungus = run(buildWorld(seedsFungus, ov), 100);
  const without = run(buildWorld(seedsBase, ov), 100);
  const om = (w: WorldSnapshot) => w.cells.reduce((s, c) => s + c.organicMatter, 0);
  const fungusBiomass = withFungus.populations.filter((p) => p.speciesId === 'decomposer_fungus').reduce((s, p) => s + p.biomass, 0);
  assert.ok(fungusBiomass > 50 * 36, `真菌应生长（生物量增加），实际 ${fungusBiomass.toFixed(0)}`);
  // 真菌同化有机质建生物量 + 加速 E5 矿化 → 有机质周转更快（净营养受淋失混淆，故测 OM 周转）
  assert.ok(om(withFungus) < om(without) * 0.9, `真菌应加速有机质消耗: with=${om(withFungus).toFixed(0)} without=${om(without).toFixed(0)}`);
});

test('M4：含疾病/真菌的重放逐字节一致；双缓冲不修改输入（§10.5/§9.3）', () => {
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    seeds.push({ speciesId: 'grass_c3', x, y, biomass: 1500 });
    seeds.push({ speciesId: 'decomposer_fungus', x, y, biomass: 30 });
    seeds.push({ speciesId: 'rabbit', x, y, count: 150, infectionState: { [PATHOGEN]: 0.03 } });
  }
  const world = buildWorld(seeds);
  const before = serializeWorldSnapshot(world);
  const a = run(world, 50);
  const b = run(world, 50);
  assert.equal(serializeWorldSnapshot(a), serializeWorldSnapshot(b), '含疾病/真菌 50 tick 重放不一致');
  assert.equal(serializeWorldSnapshot(world), before, '输入快照被原地修改');
});
