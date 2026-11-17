/**
 * M6 系统验收（契约 §16 M6 / §8.4 / §10.5 / §11.4）。
 * 验收项：
 *  - 同种子重放逐 tick 一致（存档 round-trip + 独立双重重放）；
 *  - 事件因果链：detectEvents 检测崩溃/暴增/灭绝/疾病爆发，causes 引用真实状态量变化；
 *  - 事件历史累积有上限；whyQuery 按 severity 排序；
 *  - 迁徙携带感染（M5 遗留）：感染源扩散至空适生格，新种群携带感染。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PopulationState, WorldSnapshot } from '../../core/src/types.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateWorld, seedPopulations, type PopulationSeed } from '../src/scenario.js';
import { stepWorld } from '../src/scheduler.js';
import { createWorldSnapshot, serializeWorldSnapshot, deserializeWorldSnapshot } from '../src/snapshot.js';
import { detectEvents, mergeEventHistory, whyQuery, MAX_EVENT_HISTORY } from '../src/events.js';

const SEED = 20261116;

function smallWorld(): WorldSnapshot {
  return generateWorld({ seed: SEED, width: 3, height: 3 });
}

function withPops(world: WorldSnapshot, pops: PopulationState[], time = 0): WorldSnapshot {
  return createWorldSnapshot({ time, season: 0, cells: world.cells, populations: pops, randomState: world.randomState });
}

function rabbit(x: number, y: number, count: number, infected = 0): PopulationState {
  return {
    speciesId: 'rabbit', cellId: { x, y }, count, biomass: count * 1.5 * 0.2,
    ageStructure: { juvenile: 0.2, adult: 0.7, old: 0.1 }, energyReserve: 6000, health: 0.8,
    infectionState: infected > 0 ? { virus_rabbit: infected } : {}, recoveredState: {},
    traitMeans: {}, traitVariance: {},
  };
}

const NO_FIELD = new Set<string>();
const NO_HUMAN = new Set<string>();

test('M6 事件：detectEvents 检测种群崩溃/暴增/灭绝，causes 引用真实状态量（§8.4）', () => {
  const w = smallWorld();
  const prev = withPops(w, [rabbit(0, 0, 100), rabbit(1, 0, 100), rabbit(2, 0, 100)], 0);
  const next = withPops(w, [rabbit(0, 0, 40), rabbit(1, 0, 200), rabbit(2, 0, 0)], 1);
  const events = detectEvents(prev, next, NO_FIELD, NO_HUMAN);
  const crash = events.find((e) => e.type === 'population_crash');
  const boom = events.find((e) => e.type === 'population_boom');
  const extinct = events.find((e) => e.type === 'extinction');
  assert.ok(crash, '应检测到崩溃（−60%）');
  assert.ok(boom, '应检测到暴增（+100%）');
  assert.ok(extinct, '应检测到灭绝');
  assert.ok(crash!.causes.length > 0, '崩溃应有因果归因');
  for (const c of crash!.causes) {
    assert.equal(typeof c.ref, 'string');
    assert.ok(c.ref.length > 0, 'cause.ref 须引用真实状态量');
    assert.equal(typeof c.change, 'number');
  }
  assert.ok(crash!.severity > 0 && crash!.severity <= 1);
  assert.ok(['hidden', 'discoverable', 'headline'].includes(crash!.visibility));
  assert.ok(crash!.outcomes.length > 0);
});

test('M6 事件：疾病爆发（感染比例上穿阈值）记录 disease_outbreak', () => {
  const w = smallWorld();
  const prev = withPops(w, [rabbit(0, 0, 200, 0.05)], 0);
  const next = withPops(w, [rabbit(0, 0, 200, 0.25)], 1);
  const events = detectEvents(prev, next, NO_FIELD, NO_HUMAN);
  const outbreak = events.find((e) => e.type === 'disease_outbreak');
  assert.ok(outbreak, '感染 5%→25% 应记录爆发');
  assert.ok(outbreak!.participants!.includes('virus_rabbit'));
  assert.ok(outbreak!.causes.some((c) => c.ref.startsWith('infection:')));
});

test('M6：事件历史累积有上限；whyQuery 按 severity 排序', () => {
  const w = smallWorld();
  const mk = (t: number): WorldSnapshot => withPops(w, [rabbit(0, 0, 100)], t);
  let history: ReturnType<typeof detectEvents> = [];
  for (let t = 1; t <= MAX_EVENT_HISTORY + 50; t++) {
    const ev = detectEvents(withPops(w, [rabbit(0, 0, 100)], t - 1), withPops(w, [rabbit(0, 0, 40)], t), NO_FIELD, NO_HUMAN);
    history = mergeEventHistory(history, ev);
  }
  assert.ok(history.length <= MAX_EVENT_HISTORY, '事件历史应不超过上限');
  const sorted = whyQuery(history, 'rabbit');
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1]!.severity >= sorted[i]!.severity, 'whyQuery 应按 severity 降序');
});

test('M6 验收：存档 round-trip + 同种子重放逐 tick 一致（§10.5）', () => {
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    seeds.push({ speciesId: 'grass_c3', x, y, biomass: 1500 });
    seeds.push({ speciesId: 'rabbit', x, y, count: 120, infectionState: { virus_rabbit: 0.03 } });
  }
  const world = seedPopulations(smallWorld(), seeds);
  // 存档 round-trip：序列化→反序列化→stepWorld 与直接 stepWorld 一致
  const restored = deserializeWorldSnapshot(serializeWorldSnapshot(world));
  const direct = stepWorld(world, RandomStream.fromSerialized(world.randomState));
  const fromArchive = stepWorld(restored, RandomStream.fromSerialized(restored.randomState));
  assert.equal(serializeWorldSnapshot(direct), serializeWorldSnapshot(fromArchive), '存档 round-trip 后重放应一致');
  // 独立双重重放 50 tick 逐 tick 一致
  const replay = (start: WorldSnapshot): string[] => {
    let cur = start;
    const trace: string[] = [];
    for (let t = 1; t <= 50; t++) {
      cur = stepWorld(cur, RandomStream.fromSerialized(cur.randomState));
      trace.push(serializeWorldSnapshot(cur));
    }
    return trace;
  };
  const a = replay(restored);
  const b = replay(restored);
  assert.deepEqual(a, b, '同种子独立重放应逐 tick 一致');
});

test('M6：疾病爆发场景产生事件（崩溃/爆发），causes 引用真实状态变化', () => {
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    seeds.push({ speciesId: 'grass_c3', x, y, biomass: 2000 });
    seeds.push({ speciesId: 'rabbit', x, y, count: 250, infectionState: { virus_rabbit: 0.05 } });
  }
  let w = seedPopulations(smallWorld(), seeds);
  for (let t = 1; t <= 60; t++) w = stepWorld(w, RandomStream.fromSerialized(w.randomState));
  assert.ok(w.events.length > 0, '疾病爆发场景应产生事件');
  assert.ok(w.events.some((e) => e.type === 'disease_outbreak' || e.type === 'population_crash'), '应有疾病爆发或种群崩溃事件');
  for (const e of w.events) {
    assert.ok(e.causes.length > 0, `事件 ${e.type} 应有因果归因`);
    assert.ok(e.id.length > 0 && typeof e.time === 'number');
  }
});

test('M6：迁徙携带感染——感染源扩散至空适生格，新种群携带感染（M5 遗留收口）', () => {
  // 3×3 全适生；仅中心 (1,1) 有感染兔，其余空；草 everywhere。扩散应把感染带到邻居。
  const seeds: PopulationSeed[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    seeds.push({ speciesId: 'grass_c3', x, y, biomass: 2000 });
  }
  seeds.push({ speciesId: 'rabbit', x: 1, y: 1, count: 300, infectionState: { virus_rabbit: 0.3 } });
  let w = seedPopulations(smallWorld(), seeds);
  for (let t = 1; t <= 80; t++) w = stepWorld(w, RandomStream.fromSerialized(w.randomState));
  const colonizedInfected = w.populations.filter(
    (p) => p.speciesId === 'rabbit' && !(p.cellId.x === 1 && p.cellId.y === 1) && (p.infectionState?.['virus_rabbit'] ?? 0) > 0,
  );
  assert.ok(colonizedInfected.length > 0, '感染应随迁徙传播到原空格的_new_种群');
});
