/**
 * M1 水文/土壤验收（E4 水量平衡 + 流向缓存 / E5 营养）。
 * 契约 §4 E4/E5、§14.6、§18.1：水流遵守高程方向；所有水量 ≥ 0；
 * 超过 MAX_SURFACE_WATER 转下游流；nutrients ∈ [0, MAX_NUTRIENTS]；
 * §9.3 双缓冲（不修改输入快照）；同输入可复现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell, CellId } from '../src/types.js';
import { computeFlowDirection } from '../src/grid/flowDirection.js';
import {
  waterBalance,
  stepHydrology,
  FIELD_CAPACITY_MM,
} from '../src/hydrology/waterBalance.js';
import { stepNutrients } from '../src/soil/nutrients.js';
import { HYDROLOGY, SOIL } from '../src/constants.js';

const closeTo = (actual: number, expected: number, tol = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${expected}，实际 ${actual}（容差 ${tol}）`,
  );
};

/** 最小 Cell 工厂（4 邻域边界墙，契约 §1.3）；默认 T=20°C、湿度 1（蒸发 0） */
function makeCell(
  x: number,
  y: number,
  W: number,
  H: number,
  elevation: number,
  over: Partial<Cell> = {},
): Cell {
  const neighbors: CellId[] = [];
  if (y > 0) neighbors.push({ x, y: y - 1 });
  if (x < W - 1) neighbors.push({ x: x + 1, y });
  if (y < H - 1) neighbors.push({ x, y: y + 1 });
  if (x > 0) neighbors.push({ x: x - 1, y });
  return {
    id: { x, y },
    elevation,
    slope: 0,
    aspect: 0,
    terrainType: elevation < 0 ? 'ocean' : 'plain',
    geologicalType: 'sedimentary',
    landWaterFraction: elevation < 0 ? 1 : 0,
    coastDistance: 0,
    latitude: 0,
    neighbors,
    temperature: 20,
    precipitation: 0,
    humidity: 1,
    soilMoisture: 0,
    surfaceWater: 0,
    groundwater: 0,
    nutrients: 0,
    oxygen: 1,
    salinity: elevation < 0 ? 35 : 0.1,
    organicMatter: 0,
    diseasePressure: 0,
    pollution: 0,
    fireRisk: 0,
    biome: 'grassland',
    carryingCapacity: {},
    accessibility: 1,
    productivity: 0,
    ...over,
  };
}

function makeGrid(W: number, H: number, elev: (x: number, y: number) => number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) cells.push(makeCell(x, y, W, H, elev(x, y)));
  }
  return cells;
}

// ───────────────────────── E4 流向缓存（§14.6） ─────────────────────────

test('E4 流向: 斜坡逐格指向更低邻居，末端无更低邻居 → -1（汇）', () => {
  const cells = makeGrid(4, 1, (x) => 40 - 10 * x);
  const flow = computeFlowDirection(cells);
  assert.deepEqual(Array.from(flow), [1, 2, 3, -1]);
});

test('E4 流向: 海洋为终极汇（-1），陆地流入海洋', () => {
  const cells = makeGrid(3, 1, (x) => [10, 5, -5][x] as number);
  const flow = computeFlowDirection(cells);
  assert.deepEqual(Array.from(flow), [1, 2, -1]);
});

test('E4 流向: 内陆洼地四邻汇流，洼地本身与无更低邻居的角格为 -1', () => {
  const cells = makeGrid(3, 3, (x, y) => (x === 1 && y === 1 ? 0 : 10));
  const flow = computeFlowDirection(cells);
  assert.equal(flow[4], -1); // 洼地
  for (const i of [1, 3, 5, 7]) assert.equal(flow[i], 4); // 四邻指向洼地
  for (const i of [0, 2, 6, 8]) assert.equal(flow[i], -1); // 角格无更低邻居
});

test('E4 流向: 确定性（两次一致）且索引不越界', () => {
  const cells = makeGrid(8, 8, (x, y) => 100 - 3 * x - 2 * y + ((x * y) % 5));
  const a = computeFlowDirection(cells);
  const b = computeFlowDirection(cells);
  assert.deepEqual(Array.from(a), Array.from(b));
  for (const v of a) assert.ok(v >= -1 && v < cells.length, `流向索引越界: ${v}`);
});

// ───────────────────────── E4 单 cell 水量平衡 ─────────────────────────

test('E4: 蒸发公式 EVAP_RATE·(1+0.1T)·(1−humidity)（20°C、0.5 → 3 mm/day）', () => {
  const r = waterBalance({
    surfaceWater: 100, soilMoisture: 0, groundwater: 0,
    precipitation: 0, temperature: 20, humidity: 0.5, upstreamFlow: 0,
  });
  closeTo(r.evaporation, HYDROLOGY.EVAP_RATE * 3 * 0.5);
  closeTo(r.surfaceWater, 97);
  closeTo(r.infiltration, 0);
});

test('E4: 入渗 = min(precip, INFILTRATION_CAPACITY)，暴雨超出部分留在地表', () => {
  const r = waterBalance({
    surfaceWater: 0, soilMoisture: 0, groundwater: 0,
    precipitation: 50, temperature: 20, humidity: 1, upstreamFlow: 0,
  });
  closeTo(r.infiltration, HYDROLOGY.INFILTRATION_CAPACITY);
  closeTo(r.surfaceWater, 50 - HYDROLOGY.INFILTRATION_CAPACITY);
  closeTo(r.soilMoisture, HYDROLOGY.INFILTRATION_CAPACITY);
});

test('E4: 超过 MAX_SURFACE_WATER 的部分转为 downstreamFlow（冻结边界）', () => {
  const r = waterBalance({
    surfaceWater: 990, soilMoisture: 0, groundwater: 0,
    precipitation: 50, temperature: 20, humidity: 1, upstreamFlow: 0,
  });
  closeTo(r.surfaceWater, HYDROLOGY.MAX_SURFACE_WATER);
  closeTo(r.downstreamFlow, 990 + 50 - HYDROLOGY.INFILTRATION_CAPACITY - HYDROLOGY.MAX_SURFACE_WATER);
});

test('E4: 干旱无水时蒸发为 0，所有水量 ≥ 0（不产生负值）', () => {
  const r = waterBalance({
    surfaceWater: 0, soilMoisture: 0, groundwater: 0,
    precipitation: 0, temperature: 30, humidity: 0, upstreamFlow: 0,
  });
  closeTo(r.evaporation, 0);
  closeTo(r.surfaceWater, 0);
  closeTo(r.soilMoisture, 0);
  closeTo(r.downstreamFlow, 0);
});

test('E4: 地表水不足时蒸发扣土壤水；土壤超田间持水量下渗为地下水', () => {
  const dry = waterBalance({
    surfaceWater: 0, soilMoisture: 50, groundwater: 0,
    precipitation: 0, temperature: 20, humidity: 0.5, upstreamFlow: 0,
  });
  closeTo(dry.evaporation, 3);
  closeTo(dry.soilMoisture, 47);
  const perc = waterBalance({
    surfaceWater: 0, soilMoisture: 190, groundwater: 0,
    precipitation: 20, temperature: 20, humidity: 1, upstreamFlow: 0,
  });
  closeTo(perc.soilMoisture, FIELD_CAPACITY_MM);
  closeTo(perc.groundwater, 190 + 20 - FIELD_CAPACITY_MM);
});

// ───────────────────────── E4 汇流（stepHydrology） ─────────────────────────

test('E4 验收（水流向低处）: 高处超量地表水单 tick 内转移到下游低格', () => {
  const cells = makeGrid(5, 1, (x) => [50, 40, 30, 20, -5][x] as number);
  (cells[0] as Cell).surfaceWater = 1050; // 仅源头超量
  const flow = computeFlowDirection(cells);
  const next = stepHydrology(cells, flow);
  closeTo((next[0] as Cell).surfaceWater, HYDROLOGY.MAX_SURFACE_WATER);
  closeTo((next[1] as Cell).surfaceWater, 50); // 水向低处流了一格
  closeTo((next[2] as Cell).surfaceWater, 0);
  closeTo((next[3] as Cell).surfaceWater, 0);
  closeTo((next[4] as Cell).surfaceWater, HYDROLOGY.MAX_SURFACE_WATER); // 海洋定水头
});

test('E4: 饱和链式汇流——上游出流逐级累加至海洋，陆地水量严格守恒', () => {
  // 4 陆地格（地表已满 1000mm）+ 1 海洋格；降水 30、湿度 1（蒸发 0）、入渗 20
  const cells = makeGrid(5, 1, (x) => [40, 30, 20, 10, -5][x] as number);
  for (let i = 0; i < 4; i++) {
    (cells[i] as Cell).surfaceWater = HYDROLOGY.MAX_SURFACE_WATER;
    (cells[i] as Cell).precipitation = 30;
  }
  const flow = computeFlowDirection(cells);
  const next = stepHydrology(cells, flow);
  for (let i = 0; i < 4; i++) {
    closeTo((next[i] as Cell).surfaceWater, HYDROLOGY.MAX_SURFACE_WATER);
    closeTo((next[i] as Cell).soilMoisture, 20); // 入渗补给
  }
  // 守恒：Δ陆地储量 = Σ降水 − Σ蒸发 − 入汇出流（40mm 入海丢弃）
  const storage = (cs: Cell[]): number =>
    cs.slice(0, 4).reduce((s, c) => s + c.surfaceWater + c.soilMoisture + c.groundwater, 0);
  const delta = storage(next) - storage(cells);
  closeTo(delta, 4 * 30 - 0 - 40);
});

test('E4: 双缓冲（§9.3）——stepHydrology 不修改输入；同输入两次结果一致', () => {
  const cells = makeGrid(6, 6, (x, y) => 50 - 5 * x - 3 * y);
  for (const c of cells) {
    c.precipitation = 25;
    c.surfaceWater = 900;
    c.humidity = 0.6;
  }
  const before = JSON.stringify(cells);
  const flow = computeFlowDirection(cells);
  const a = stepHydrology(cells, flow);
  const b = stepHydrology(cells, flow);
  assert.equal(JSON.stringify(cells), before, '输入被原地修改（违反双缓冲）');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  for (const c of a) {
    assert.ok(c.surfaceWater >= 0 && c.surfaceWater <= HYDROLOGY.MAX_SURFACE_WATER);
    assert.ok(c.soilMoisture >= 0 && c.soilMoisture <= FIELD_CAPACITY_MM);
    assert.ok(c.groundwater >= 0);
    assert.ok(Number.isFinite(c.surfaceWater) && Number.isFinite(c.soilMoisture));
  }
});

// ───────────────────────── E5 土壤与营养 ─────────────────────────

test('E5: 分解矿化有机质→营养（C:N=25），同步扣减有机质；固氮常量注入', () => {
  const r = stepNutrients({
    nutrients: 100, organicMatter: 1000, soilMoisture: 100,
    temperature: 25, slope: 0, precipitation: 0,
  });
  closeTo(r.decomposition, (0.02 * 1000) / 25); // 20 kgC/day → 0.8 kgN/day
  closeTo(r.organicMatter, 980);
  closeTo(r.nutrients, 100 + 0.8 + 0.1);
  closeTo(r.fixation, 0.1);
});

test('E5: 边界 nutrients ∈ [0, MAX_NUTRIENTS]（冻结边界，不产生负值/超限）', () => {
  const rich = stepNutrients({
    nutrients: 999.99, organicMatter: 1000, soilMoisture: 100,
    temperature: 25, slope: 0, precipitation: 0,
  });
  closeTo(rich.nutrients, SOIL.MAX_NUTRIENTS);
  const poor = stepNutrients({
    nutrients: 0, organicMatter: 0, soilMoisture: 0,
    temperature: 25, slope: 0, precipitation: 0, plantUptake: 5,
  });
  closeTo(poor.nutrients, 0);
});

test('E5: 淋失与侵蚀按公式结构扣减（土壤超持水驱动淋失，slope·降水驱动侵蚀）', () => {
  const r = stepNutrients({
    nutrients: 100, organicMatter: 0, soilMoisture: 200,
    temperature: 0, slope: 1, precipitation: 60,
  });
  closeTo(r.leaching, 0.01 * 100 * 1);
  closeTo(r.erosion, 0.05 * 100 * 1 * 1);
  closeTo(r.nutrients, 100 + 0.1 - 1 - 5);
});

test('E5: 低温/干旱/无真菌时分解停止；植物吸收（M2 接口）扣减营养', () => {
  const base = { nutrients: 100, organicMatter: 1000, soilMoisture: 100, temperature: 25, slope: 0, precipitation: 0 };
  closeTo(stepNutrients({ ...base, temperature: -20 }).decomposition, 0);
  closeTo(stepNutrients({ ...base, soilMoisture: 0 }).decomposition, 0);
  closeTo(stepNutrients({ ...base, fungiActivity: 0 }).decomposition, 0);
  const uptake = stepNutrients({ ...base, plantUptake: 2 });
  closeTo(uptake.nutrients, 100 + 0.8 + 0.1 - 2);
  closeTo(uptake.plantUptake, 2);
});
