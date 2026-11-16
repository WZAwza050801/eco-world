/**
 * M2 垂直切片系统验收（契约 §16 M2 / §15.6 / §18.1 / §18.2）。
 * 验收项：
 *  - 草-兔-狼振荡：兔先增、狼后增、草下降、狼回落，相位延迟，多周期持续共存；
 *  - 无负数量（每 tick 全量检查）；
 *  - 移除捕食者 → 兔暴增 → 草崩溃（资源压力）；
 *  - 干旱 → 草↓ → 兔↓ → 狼↓；
 *  - 捕食者无猎物不增长；植物缺水不增长；
 *  - 同种子重放逐字节一致；双缓冲不修改输入（§9.3/§10.5）。
 *
 * 生境：6×6 均匀适生平原（纬度 5°），与 data/scenarios/grass_rabbit_wolf.json
 * 同参数（隔离气候空间异质性，专验生态闭环；真实地球场景调参留 M8）。
 * 种群数量为连续密度（种群场表示，§1.1），允许小数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, WorldSnapshot } from '../../core/src/types.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateWorld, seedPopulations, type PopulationSeed } from '../src/scenario.js';
import { stepWorld } from '../src/scheduler.js';
import { createWorldSnapshot, serializeWorldSnapshot } from '../src/snapshot.js';

interface Options {
  wolves?: boolean;
  rabbits?: boolean;
  grass?: boolean;
  coastDistance?: number; // 大值 → 干旱（水源衰减）
  seed?: number;
}

function buildWorld(opts: Options = {}): WorldSnapshot {
  const base = generateWorld({ seed: opts.seed ?? 20261116, width: 6, height: 6 });
  const overrides: Partial<Cell> = {
    latitude: 5,
    elevation: 50,
    slope: 0,
    aspect: 0,
    terrainType: 'plain',
    landWaterFraction: 0,
    coastDistance: opts.coastDistance ?? 0,
    salinity: 0.1,
    soilMoisture: 150,
    nutrients: 300,
    organicMatter: 500,
    surfaceWater: 0,
    groundwater: 0,
  };
  const cells = base.cells.map((c) => ({ ...c, ...overrides }));
  const world = createWorldSnapshot({ time: 0, season: 0, cells, randomState: base.randomState });
  const seeds: PopulationSeed[] = [];
  for (const c of cells) {
    if (opts.grass !== false) seeds.push({ speciesId: 'grass_c3', x: c.id.x, y: c.id.y, biomass: 1500 });
    if (opts.rabbits !== false) seeds.push({ speciesId: 'rabbit', x: c.id.x, y: c.id.y, count: 120 });
    if (opts.wolves) seeds.push({ speciesId: 'wolf', x: c.id.x, y: c.id.y, count: 2 });
  }
  return seedPopulations(world, seeds);
}

interface Totals { grass: number; rabbit: number; wolf: number }

function totals(w: WorldSnapshot): Totals {
  const t: Totals = { grass: 0, rabbit: 0, wolf: 0 };
  for (const p of w.populations) {
    if (p.speciesId === 'grass_c3') t.grass += p.biomass;
    else if (p.speciesId === 'rabbit') t.rabbit += p.count;
    else if (p.speciesId === 'wolf') t.wolf += p.count;
  }
  return t;
}

/** 跑 n tick；每 tick 检查无负数量/非法值（§18.1），返回时间序列与终态 */
function run(world: WorldSnapshot, ticks: number): { series: Totals[]; final: WorldSnapshot } {
  let w = world;
  const series: Totals[] = [];
  for (let t = 1; t <= ticks; t++) {
    const rng = RandomStream.fromSerialized(w.randomState);
    w = stepWorld(w, rng);
    for (const p of w.populations) {
      assert.ok(p.count >= 0 && Number.isFinite(p.count), `负/非法 count @tick ${t}: ${p.speciesId} ${p.count}`);
      assert.ok(p.biomass >= 0 && Number.isFinite(p.biomass), `负/非法 biomass @tick ${t}: ${p.speciesId}`);
      assert.ok(p.energyReserve >= 0 && Number.isFinite(p.energyReserve), `非法 energyReserve @tick ${t}`);
      assert.ok(p.health >= 0 && p.health <= 1, `health 越界 @tick ${t}`);
      const ageSum = p.ageStructure.juvenile + p.ageStructure.adult + p.ageStructure.old;
      assert.ok(Math.abs(ageSum - 1) < 1e-6, `ageStructure 比例和 ≠ 1 @tick ${t}: ${ageSum}`);
    }
    for (const c of w.cells) {
      assert.ok(c.nutrients >= 0 && c.nutrients <= 1000, `nutrients 越界 @tick ${t}`);
      assert.ok(c.surfaceWater >= 0 && c.surfaceWater <= 1000, `surfaceWater 越界 @tick ${t}`);
      assert.ok(c.soilMoisture >= 0 && c.soilMoisture <= 200, `soilMoisture 越界 @tick ${t}`);
      assert.ok(c.organicMatter >= 0, `organicMatter 负 @tick ${t}`);
      assert.ok(c.temperature >= -70 && c.temperature <= 70, `温度越界 @tick ${t}`);
    }
    series.push(totals(w));
  }
  return { series, final: w };
}

const argmax = (a: number[]): number => a.indexOf(Math.max(...a));

test('M2 验收：草-兔-狼相位延迟振荡，1500 tick 三物种持续共存（§15.6/§16）', () => {
  const world = buildWorld({ wolves: true });
  const { series, final } = run(world, 1500);
  const f = totals(final);
  assert.ok(f.grass > 0 && f.rabbit > 0 && f.wolf > 0, `终态三物种应共存: ${JSON.stringify(f)}`);

  // 相位延迟：首个兔峰早于首个狼峰（前 600 tick 窗口）
  const rabbitPeak = argmax(series.slice(0, 600).map((s) => s.rabbit));
  const wolfPeak = argmax(series.slice(0, 600).map((s) => s.wolf));
  assert.ok(rabbitPeak < wolfPeak, `兔峰(t=${rabbitPeak + 1})应早于狼峰(t=${wolfPeak + 1})`);

  // 草下降：兔峰后 100 tick 草量显著低于兔峰时
  const gAtRabbitPeak = series[rabbitPeak] as Totals;
  const gAfter = series[rabbitPeak + 100] as Totals;
  assert.ok(gAfter.grass < gAtRabbitPeak.grass * 0.8, `兔峰后草应下降: ${gAtRabbitPeak.grass} → ${gAfter.grass}`);

  // 狼回落：狼峰后 200 tick 狼数量显著回落
  const wAtPeak = (series[wolfPeak] as Totals).wolf;
  const wAfter = (series[wolfPeak + 200] as Totals).wolf;
  assert.ok(wAfter < wAtPeak * 0.8, `狼峰后应回落: ${wAtPeak} → ${wAfter}`);

  // 多周期：1500 tick 内至少 2 个显著兔峰（间隔 ≥150 tick，峰值 >3000）
  const peaks: number[] = [];
  for (let i = 30; i < series.length - 30; i++) {
    const v = (series[i] as Totals).rabbit;
    if (v < 3000) continue;
    let isPeak = true;
    for (let j = i - 30; j <= i + 30; j++) {
      if ((series[j] as Totals).rabbit > v) { isPeak = false; break; }
    }
    if (isPeak && (peaks.length === 0 || i - (peaks[peaks.length - 1] as number) >= 150)) peaks.push(i);
  }
  assert.ok(peaks.length >= 2, `应至少 2 个兔峰（持续振荡而非单次崩溃），实际 ${peaks.length}: ${peaks}`);
});

test('M2 验收：全程无负数量/非法值（§18.1，run 内每 tick 全量断言）', () => {
  // 由 run() 的逐 tick 断言保证；此处显式跑一个含捕食压力的世界并复核终态
  const { final } = run(buildWorld({ wolves: true }), 300);
  for (const p of final.populations) {
    assert.ok(p.count >= 0 && p.biomass >= 0);
  }
  assert.ok(final.populations.length > 0);
});

test('M2/§15.6：移除捕食者 → 兔暴增 → 草崩溃（资源压力）', () => {
  const world = buildWorld({ wolves: false });
  const initial = totals(world);
  const { series } = run(world, 600);
  const rabbitMax = Math.max(...series.map((s) => s.rabbit));
  const grassMin = Math.min(...series.map((s) => s.grass));
  assert.ok(rabbitMax > initial.rabbit * 2, `无狼时兔应暴增 >2×: ${rabbitMax} vs ${initial.rabbit}`);
  assert.ok(grassMin < initial.grass * 0.2, `兔暴增后草应崩溃 <20%: ${grassMin} vs ${initial.grass}`);
});

test('M2/§15.6：干旱 → 草↓ → 兔↓ → 狼↓（营养级联）', () => {
  const world = buildWorld({ wolves: true, coastDistance: 3000 }); // 水源指数衰减 → 降水≈0
  const initial = totals(world);
  const { final } = run(world, 300);
  const f = totals(final);
  assert.ok(f.grass < initial.grass * 0.5, `干旱后草应下降: ${f.grass} vs ${initial.grass}`);
  assert.ok(f.rabbit < initial.rabbit, `干旱后兔应下降: ${f.rabbit} vs ${initial.rabbit}`);
  assert.ok(f.wolf < initial.wolf, `干旱后狼应下降: ${f.wolf} vs ${initial.wolf}`);
});

test('M2/§18.1：捕食者无猎物不增长（狼单独存在 → 饥饿衰减）', () => {
  const world = buildWorld({ wolves: true, rabbits: false, grass: false });
  const initial = totals(world);
  const { series, final } = run(world, 200);
  const wolfMax = Math.max(...series.map((s) => s.wolf));
  assert.ok(wolfMax <= initial.wolf + 1e-9, `无猎物狼数量不应超过初始: ${wolfMax}`);
  assert.ok(totals(final).wolf < initial.wolf, `无猎物狼应衰减: ${totals(final).wolf}`);
});

test('M2/§18.1：植物缺水不无限增长（干旱下草生物量衰减）', () => {
  const world = buildWorld({ wolves: false, rabbits: false, coastDistance: 3000 });
  const initial = totals(world);
  const { final } = run(world, 200);
  assert.ok(totals(final).grass < initial.grass * 0.5, `缺水草应衰减: ${totals(final).grass}`);
});

test('M2/§10.5：同种子重放逐字节一致；双缓冲不修改输入快照', () => {
  const world = buildWorld({ wolves: true });
  const before = serializeWorldSnapshot(world);
  const a = run(world, 100).final;
  const b = run(world, 100).final;
  assert.equal(serializeWorldSnapshot(a), serializeWorldSnapshot(b), '同种子 100 tick 重放不一致');
  assert.equal(serializeWorldSnapshot(world), before, '输入快照被原地修改（违反 §9.3 双缓冲）');
  assert.notEqual(a.randomState, world.randomState, 'randomState 应随 tick 推进');
  assert.equal(a.time, 100);
});

test('M2：seedPopulations 拒绝重复投放与未填写物种', () => {
  const world = buildWorld({ wolves: false, rabbits: false, grass: false });
  assert.throws(
    () => seedPopulations(world, [
      { speciesId: 'rabbit', x: 0, y: 0, count: 10 },
      { speciesId: 'rabbit', x: 0, y: 0, count: 5 },
    ]),
    /重复种群/,
  );
  assert.throws(() => seedPopulations(world, [{ speciesId: 'deer', x: 0, y: 0, count: 5 }]), /不存在或内容未填写/);
});
