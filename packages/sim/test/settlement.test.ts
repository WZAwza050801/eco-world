/**
 * M5 系统验收（契约 §16 M5 / §7 H1–H3 / §18.2）。
 * 验收项：聚落受食物与疾病约束。
 *  - 食物约束：有食物（草+猎物）聚落增长，无食物衰减；
 *  - 疾病约束：感染聚落（人畜共患 virus_rabbit）数量低于无感染对照；
 *  - 土地利用（H3）：聚落降低局部植物生物量、增加疾病压力；
 *  - 含人类的重放逐字节一致；双缓冲不修改输入。
 * 生境：均质暖湿平原（lat 0）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, WorldSnapshot } from '../../core/src/types.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateWorld, seedPopulations, type PopulationSeed } from '../src/scenario.js';
import { stepWorld } from '../src/scheduler.js';
import { createWorldSnapshot, serializeWorldSnapshot } from '../src/snapshot.js';

const SEED = 20261116;
const land: Partial<Cell> = {
  latitude: 0, elevation: 50, slope: 0, aspect: 0, terrainType: 'plain',
  landWaterFraction: 0, coastDistance: 0, salinity: 0.1, soilMoisture: 200,
  nutrients: 300, organicMatter: 500, surfaceWater: 0, groundwater: 0, accessibility: 1,
};

function buildWorld(seeds: PopulationSeed[]): WorldSnapshot {
  const base = generateWorld({ seed: SEED, width: 6, height: 6 });
  const cells = base.cells.map((c) => ({ ...c, ...land }));
  const world = createWorldSnapshot({ time: 0, season: 0, cells, randomState: base.randomState });
  return seedPopulations(world, seeds);
}

function gridSeeds(fn: (x: number, y: number) => PopulationSeed[]): PopulationSeed[] {
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) seeds.push(...fn(x, y));
  return seeds;
}

const humanCount = (w: WorldSnapshot): number =>
  w.populations.filter((p) => p.speciesId === 'homo_sapiens').reduce((s, p) => s + p.count, 0);
const grassBiomass = (w: WorldSnapshot): number =>
  w.populations.filter((p) => p.speciesId === 'grass_c3').reduce((s, p) => s + p.biomass, 0);

function run(world: WorldSnapshot, ticks: number): WorldSnapshot {
  let w = world;
  for (let t = 1; t <= ticks; t++) {
    w = stepWorld(w, RandomStream.fromSerialized(w.randomState));
    for (const p of w.populations) {
      assert.ok(p.count >= 0 && Number.isFinite(p.count), `负数量 @${t}: ${p.speciesId}`);
      assert.ok(p.biomass >= 0 && Number.isFinite(p.biomass), `负生物量 @${t}`);
    }
  }
  return w;
}

test('M5 验收：聚落受食物约束——有食物增长，无食物衰减（H1/H2）', () => {
  const fed = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 2000 },
    { speciesId: 'rabbit', x, y, count: 100 },
    { speciesId: 'homo_sapiens', x, y, count: 100 },
  ])), 365);
  const starved = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'homo_sapiens', x, y, count: 100 },
  ])), 365);
  const fedN = humanCount(fed), starvedN = humanCount(starved);
  assert.ok(fedN > starvedN * 1.02, `有食物聚落应大于无食物: fed=${fedN.toFixed(1)} starved=${starvedN.toFixed(1)}`);
  assert.ok(fedN >= 100 * 36, `有食物聚落应不衰减（≥初始）: ${fedN.toFixed(1)}`);
  assert.ok(starvedN < 100 * 36, `无食物聚落应衰减: ${starvedN.toFixed(1)}`);
});

test('M5 验收：聚落受疾病约束——感染聚落数量低于无感染对照（D1 人畜共患）', () => {
  const infected = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 2000 },
    { speciesId: 'rabbit', x, y, count: 100 },
    { speciesId: 'homo_sapiens', x, y, count: 200, infectionState: { virus_rabbit: 0.05 } },
  ])), 100);
  const control = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 2000 },
    { speciesId: 'rabbit', x, y, count: 100 },
    { speciesId: 'homo_sapiens', x, y, count: 200 },
  ])), 100);
  assert.ok(humanCount(infected) < humanCount(control), `疾病应降低聚落: infected=${humanCount(infected).toFixed(1)} control=${humanCount(control).toFixed(1)}`);
});

test('M5：土地利用反馈（H3）——聚落降低局部植物生物量、增加疾病压力', () => {
  const withHumans = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 2000 },
    { speciesId: 'homo_sapiens', x, y, count: 200 },
  ])), 50);
  const control = run(buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 2000 },
  ])), 50);
  assert.ok(grassBiomass(withHumans) < grassBiomass(control), `聚落应降低植物生物量: with=${grassBiomass(withHumans).toFixed(0)} control=${grassBiomass(control).toFixed(0)}`);
  const diseasePressure = withHumans.cells.reduce((s, c) => s + c.diseasePressure, 0);
  assert.ok(diseasePressure > 0, '聚落应增加疾病压力');
});

test('M5：含人类/疾病的重放逐字节一致；双缓冲不修改输入（§10.5/§9.3）', () => {
  const world = buildWorld(gridSeeds((x, y) => [
    { speciesId: 'grass_c3', x, y, biomass: 1500 },
    { speciesId: 'rabbit', x, y, count: 80 },
    { speciesId: 'homo_sapiens', x, y, count: 120, infectionState: { virus_rabbit: 0.03 } },
  ]));
  const before = serializeWorldSnapshot(world);
  const a = run(world, 50);
  const b = run(world, 50);
  assert.equal(serializeWorldSnapshot(a), serializeWorldSnapshot(b), '含人类 50 tick 重放不一致');
  assert.equal(serializeWorldSnapshot(world), before, '输入快照被原地修改');
});
