/**
 * M0 验收：WorldSnapshot 创建/序列化/反序列化（契约 §3.4）。
 * 验收项：序列化再反序列化，所有字段值不变。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AgentState,
  Cell,
  HistoricalEvent,
  InteractionState,
  PopulationState,
} from '../../core/src/types.js';
import {
  createWorldSnapshot,
  deserializeWorldSnapshot,
  serializeWorldSnapshot,
} from '../src/snapshot.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';

function makeCell(x: number, y: number): Cell {
  return {
    id: { x, y },
    elevation: 120 + x,
    slope: 0.2,
    aspect: 1.57,
    terrainType: 'plain',
    geologicalType: 'sedimentary',
    landWaterFraction: 0,
    coastDistance: 40,
    latitude: 90 - (180 * (y + 0.5)) / 128,
    neighbors: [
      { x, y: y - 1 },
      { x: x + 1, y },
      { x, y: y + 1 },
      { x: x - 1, y },
    ],
    temperature: 15.5,
    precipitation: 3.2,
    humidity: 0.6,
    soilMoisture: 80,
    surfaceWater: 0.5,
    groundwater: 200,
    nutrients: 12.5,
    oxygen: 0.95,
    salinity: 0.1,
    organicMatter: 30,
    diseasePressure: 0.01,
    pollution: 0,
    fireRisk: 0.05,
    biome: 'grassland',
    carryingCapacity: { rabbit: 500, wolf: 20 },
    accessibility: 1,
    productivity: 0.8,
  };
}

function makePopulation(): PopulationState {
  return {
    speciesId: 'rabbit',
    cellId: { x: 3, y: 4 },
    count: 320,
    biomass: 480,
    ageStructure: { juvenile: 0.3, adult: 0.6, old: 0.1 },
    energyReserve: 5000,
    health: 0.9,
    infectionState: { virus_rabbit: 0.05 },
    traitMeans: { bodyMass: 1.5, speed: 2 },
    traitVariance: { bodyMass: 0.1, speed: 0.2 },
  };
}

function makeEvent(): HistoricalEvent {
  return {
    id: 'evt-001',
    time: 365,
    type: 'population_decline',
    location: [{ x: 3, y: 4 }],
    participants: ['wolf', 'rabbit'],
    causes: [
      { ref: 'population:rabbit:cell(3,4)', change: -0.4, description: '兔群下降 40%' },
    ],
    outcomes: [{ description: '狼群食物短缺', magnitude: -0.25 }],
    severity: 0.6,
    visibility: 'headline',
  };
}

test('序列化再反序列化，所有字段值不变', () => {
  const rng = new RandomStream(42);
  rng.next();
  const snapshot = createWorldSnapshot({
    time: 365,
    season: 0.5,
    cells: [makeCell(3, 4), makeCell(4, 4)],
    populations: [makePopulation()],
    agents: [
      { id: 'agent-wolf-alpha', kind: 'pack_leader', cellId: { x: 4, y: 4 }, state: { age: 5, rank: 1 } },
    ] satisfies AgentState[],
    interactions: [
      { id: 'ix-001', kind: 'predation', participants: ['wolf', 'rabbit'], strength: 0.7 },
    ] satisfies InteractionState[],
    events: [makeEvent()],
    randomState: rng.serialize(),
  });

  const restored = deserializeWorldSnapshot(serializeWorldSnapshot(snapshot));
  assert.deepStrictEqual(restored, snapshot);
  // 逐字段抽检（deepStrictEqual 已覆盖，此处显式标注关键字段）
  assert.strictEqual(restored.time, 365);
  assert.strictEqual(restored.randomState, snapshot.randomState);
  assert.strictEqual(restored.cells[0]?.carryingCapacity.rabbit, 500);
  assert.deepStrictEqual(restored.populations[0]?.ageStructure, {
    juvenile: 0.3,
    adult: 0.6,
    old: 0.1,
  });
});

test('createWorldSnapshot 默认空集与非法值拒绝', () => {
  const s = createWorldSnapshot({ time: 0, season: 0, cells: [], randomState: 'ff' });
  assert.deepStrictEqual(s.populations, []);
  assert.deepStrictEqual(s.events, []);
  assert.throws(() => createWorldSnapshot({ time: 0, season: 1.5, cells: [], randomState: 'ff' }), RangeError);
  assert.throws(() => createWorldSnapshot({ time: NaN, season: 0, cells: [], randomState: 'ff' }), RangeError);
});

test('序列化拒绝含 NaN/Infinity 的快照（红线 4）', () => {
  const badCell = makeCell(0, 0);
  badCell.temperature = NaN;
  const snapshot = createWorldSnapshot({ time: 0, season: 0, cells: [badCell], randomState: 'ff' });
  assert.throws(() => serializeWorldSnapshot(snapshot), RangeError);
});

test('空世界往返一致', () => {
  const s = createWorldSnapshot({ time: 0, season: 0, cells: [], randomState: '0' });
  const restored = deserializeWorldSnapshot(serializeWorldSnapshot(s));
  assert.deepStrictEqual(restored, s);
});
