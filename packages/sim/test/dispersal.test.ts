/**
 * M3 系统验收（契约 §16 M3 / §18.1 / §18.2）。
 * 验收项：
 *  - 物种只在适生区定居：硬致死带（冷区）种群被清除；适生区持续存活；
 *  - 空适生格可被定殖（B9 竞争释放加成）；
 *  - 迁徙有边界：海洋屏障（步行/种子不跨海），隔离适生区保持无菌；
 *  - 遗传性状：边际冷胁迫下 coldTolerance 定向演化（Lande），中性性状仅漂变；
 *  - 扩散/遗传接线后重放仍逐字节一致，双缓冲不修改输入。
 *
 * 生境构造（@non-frozen 测试夹具）：8×8，x=4 整列海洋（拓扑隔离左右），
 * y<4 适生（lat 5），y≥4 冷区（lat 75，冬季硬致死）；遗传测试用 lat 42 边际冷世界。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, WorldSnapshot } from '../../core/src/types.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateWorld, seedPopulations, type PopulationSeed } from '../src/scenario.js';
import { stepWorld } from '../src/scheduler.js';
import { createWorldSnapshot, serializeWorldSnapshot } from '../src/snapshot.js';

const SEED = 20261116;

function landOverrides(latitude: number): Partial<Cell> {
  return {
    latitude,
    elevation: 50,
    slope: 0,
    aspect: 0,
    terrainType: 'plain',
    landWaterFraction: 0,
    coastDistance: 0,
    salinity: 0.1,
    soilMoisture: 150,
    nutrients: 300,
    organicMatter: 500,
    surfaceWater: 0,
    groundwater: 0,
    accessibility: 1,
  };
}

/** 8×8：x=4 海洋屏障；y<4 适生 lat5；y≥4 冷区 lat75 */
function buildHeteroWorld(): WorldSnapshot {
  const base = generateWorld({ seed: SEED, width: 8, height: 8 });
  const cells = base.cells.map((c) => {
    const { x, y } = c.id;
    if (x === 4) {
      return {
        ...c,
        elevation: -5,
        landWaterFraction: 1,
        terrainType: 'ocean' as const,
        accessibility: 0.2,
        salinity: 35,
        latitude: 5,
        soilMoisture: 0,
        surfaceWater: 1000,
        nutrients: 50,
        organicMatter: 0,
        coastDistance: 0,
      };
    }
    return { ...c, ...landOverrides(y >= 4 ? 75 : 5) };
  });
  const world = createWorldSnapshot({ time: 0, season: 0, cells, randomState: base.randomState });
  const seeds: PopulationSeed[] = [];
  for (const c of cells) {
    const { x, y } = c.id;
    if (x <= 3 && y <= 3) {
      seeds.push({ speciesId: 'grass_c3', x, y, biomass: 1500 });
      if (x <= 1) {
        seeds.push({ speciesId: 'rabbit', x, y, count: 120 });
        seeds.push({ speciesId: 'wolf', x, y, count: 2 });
      }
    }
    // 冷区投放只在左侧（清除验收对象）；右侧（x≥5）完全无源——
    // 海洋屏障使其与所有源隔离，任何定殖都意味着越界（注意：冷区与右侧适生区
    // 上下相连，若冷区有动物，它们会按 B9 梯度合法逃逸到右侧适生区，那是正确行为）
    if (x <= 3 && y >= 5) {
      seeds.push({ speciesId: 'grass_c3', x, y, biomass: 800 });
      seeds.push({ speciesId: 'rabbit', x, y, count: 50 });
    }
  }
  return seedPopulations(world, seeds);
}

/** 4×4 边际冷世界（lat 42：兔软耐受带，冬季接近硬界；草勉强维持） */
function buildMarginalWorld(): WorldSnapshot {
  const base = generateWorld({ seed: SEED, width: 4, height: 4 });
  const cells = base.cells.map((c) => ({ ...c, ...landOverrides(42) }));
  const world = createWorldSnapshot({ time: 0, season: 0, cells, randomState: base.randomState });
  const seeds: PopulationSeed[] = [];
  for (const c of cells) {
    seeds.push({ speciesId: 'grass_c3', x: c.id.x, y: c.id.y, biomass: 2000 });
    seeds.push({ speciesId: 'rabbit', x: c.id.x, y: c.id.y, count: 10 });
  }
  return seedPopulations(world, seeds);
}

function run(world: WorldSnapshot, ticks: number): WorldSnapshot {
  let w = world;
  for (let t = 1; t <= ticks; t++) {
    const rng = RandomStream.fromSerialized(w.randomState);
    w = stepWorld(w, rng);
    for (const p of w.populations) {
      assert.ok(p.count >= 0 && Number.isFinite(p.count), `负/非法 count @${t}: ${p.speciesId}`);
      assert.ok(p.biomass >= 0 && Number.isFinite(p.biomass), `负/非法 biomass @${t}`);
      assert.ok(p.energyReserve >= 0 && Number.isFinite(p.energyReserve), `非法储备 @${t}`);
      for (const v of Object.values(p.traitMeans)) {
        assert.ok(Number.isFinite(v) && Math.abs(v) <= 30, `性状越界 @${t}: ${v}`);
      }
    }
  }
  return w;
}

const inRegion = (w: WorldSnapshot, pred: (x: number, y: number) => boolean, speciesId?: string) =>
  w.populations.filter((p) => pred(p.cellId.x, p.cellId.y) && (speciesId === undefined || p.speciesId === speciesId));

test('M3 验收：物种只在适生区定居——冷区（硬致死带）兔/草被清除，适生区三物种存活', () => {
  const world = buildHeteroWorld();
  const final = run(world, 365);
  const cold = (x: number, y: number) => x <= 3 && y >= 4;
  const coldRabbits = inRegion(final, cold, 'rabbit').reduce((s, p) => s + p.count, 0);
  const coldWolves = inRegion(final, cold, 'wolf').reduce((s, p) => s + p.count, 0);
  const coldGrass = inRegion(final, cold, 'grass_c3').reduce((s, p) => s + p.biomass, 0);
  assert.ok(coldRabbits + coldWolves < 1, `冷区动物应被清除（初始兔 600），实际 ${coldRabbits + coldWolves}`);
  assert.ok(coldGrass < 9600 * 0.05, `冷区草应崩溃 >95%（初始 9600 kgC，啃食+呼吸消耗，允许少量夏季再生），实际 ${coldGrass}`);
  const suitable = (x: number, y: number) => x <= 3 && y <= 3;
  assert.ok(inRegion(final, suitable, 'rabbit').reduce((s, p) => s + p.count, 0) > 0, '适生区兔应存活');
  assert.ok(inRegion(final, suitable, 'wolf').reduce((s, p) => s + p.count, 0) > 0, '适生区狼应存活');
  assert.ok(inRegion(final, suitable, 'grass_c3').reduce((s, p) => s + p.biomass, 0) > 0, '适生区草应存活');
});

test('M3 验收：空适生格被定殖（B9 扩散），海洋屏障隔离区保持无种群（迁徙有边界）', () => {
  const world = buildHeteroWorld();
  // 初始：x2-3/y0-3 适生但无兔；右侧 x≥5 完全无源且被海洋列拓扑隔离
  assert.equal(inRegion(world, (x, y) => x >= 2 && x <= 3 && y <= 3, 'rabbit').length, 0);
  assert.equal(inRegion(world, (x) => x >= 5).length, 0);
  const final = run(world, 365);
  const colonized = inRegion(final, (x, y) => x >= 2 && x <= 3 && y <= 3, 'rabbit')
    .reduce((s, p) => s + p.count, 0);
  assert.ok(colonized >= 1, `空适生格应被兔定殖（≥1 ind），实际 ${colonized}`);
  assert.equal(inRegion(final, (x) => x === 4).length, 0, '海洋列不应有任何种群（步行/种子不跨海）');
  assert.equal(
    inRegion(final, (x) => x >= 5).length, 0,
    '海洋隔离的右侧（含适生区）不应被定殖（边界墙 + 通行性）',
  );
});

test('M3 验收：边际冷胁迫下 coldTolerance 定向演化，中性性状仅漂变（Lande，世代尺度）', () => {
  const world = buildMarginalWorld();
  const final = run(world, 200);
  const rabbits = final.populations.filter((p) => p.speciesId === 'rabbit');
  assert.ok(rabbits.length > 0, '边际世界兔应存活 200 tick');
  const total = rabbits.reduce((s, p) => s + p.count, 0);
  const coldMean = rabbits.reduce((s, p) => s + (p.traitMeans['coldTolerance'] ?? 0) * p.count, 0) / total;
  const bodyMean = rabbits.reduce((s, p) => s + (p.traitMeans['bodyMass'] ?? 0) * p.count, 0) / total;
  assert.ok(coldMean > 0.008, `coldTolerance 应定向上升（选择），实际 ${coldMean}`);
  assert.ok(Math.abs(bodyMean) < 0.001, `中性性状 bodyMass 应仅微漂变，实际 ${bodyMean}`);
  for (const p of rabbits) {
    assert.equal(p.traitVariance['coldTolerance'], 1); // M3 方差保持（简化，Q10）
  }
});

test('M3：扩散/遗传接线后重放逐字节一致；双缓冲不修改输入（§10.5/§9.3）', () => {
  const world = buildHeteroWorld();
  const before = serializeWorldSnapshot(world);
  const a = run(world, 80);
  const b = run(world, 80);
  assert.equal(serializeWorldSnapshot(a), serializeWorldSnapshot(b), '含扩散/遗传的 80 tick 重放不一致');
  assert.equal(serializeWorldSnapshot(world), before, '输入快照被原地修改');
});
