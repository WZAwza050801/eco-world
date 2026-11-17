/**
 * M1（地形部分）验收：真实地球海陆掩模 + Perlin 地形生成（scenario.ts）。
 * 验收项：
 *  - 同 seed 逐 cell 完全可复现；不同 seed 地形不同；
 *  - 真实海陆掩模（陆地占比 ≈ 地球 29%；真实地理点抽查）；
 *  - 纬度协议（契约 §1.3）；北极海洋、南极大陆；
 *  - 数值健全（红线 4）与 4 邻域边界墙（契约 §1.3）。
 * M1 气候水文集成验收（E1–E6）：气候初始化边界与群系多样性、真实地理群系抽查、
 * stepEnvironment 双缓冲/重放一致/季节驱动、多 tick 水文营养动态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Cell } from '../../core/src/types.js';
import { HYDROLOGY, SOIL, WORLD } from '../../core/src/constants.js';
import { computeFlowDirection } from '../../core/src/grid/flowDirection.js';
import { hexNeighbors, hexDistance } from '../../core/src/grid/hex.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { generateTerrainCells, generateWorld, landFractionAt } from '../src/scenario.js';
import { stepEnvironment } from '../src/scheduler.js';
import { serializeWorldSnapshot } from '../src/snapshot.js';

const SEED = 20261116;

test('同 seed 两次生成地形，逐 cell 一致（快照序列化逐字节一致）', () => {
  const a = generateWorld({ seed: SEED });
  const b = generateWorld({ seed: SEED });
  assert.strictEqual(serializeWorldSnapshot(a), serializeWorldSnapshot(b));
});

test('不同 seed 生成不同地形', () => {
  const a = generateWorld({ seed: SEED });
  const b = generateWorld({ seed: SEED + 1 });
  assert.notStrictEqual(serializeWorldSnapshot(a), serializeWorldSnapshot(b));
});

test('陆地占比在 [0.2, 0.4]（真实地图 128×128 采样实测 28.7%）', () => {
  const cells = generateTerrainCells({ seed: SEED });
  let land = 0;
  for (const c of cells) {
    if (c.landWaterFraction < 0.5) land++;
  }
  const ratio = land / cells.length;
  assert.ok(ratio > 0.2 && ratio < 0.4, `陆地占比异常: ${ratio.toFixed(3)}`);
});

test('纬度协议：lat = 90 - 180*(y+0.5)/H，范围 [-90,90]', () => {
  const cells = generateTerrainCells({ seed: SEED });
  const H = WORLD.H;
  const first = cells[0] as { latitude: number; id: { y: number } };
  const last = cells[cells.length - 1] as { latitude: number; id: { y: number } };
  assert.ok(Math.abs(first.latitude - (90 - (180 * 0.5) / H)) < 1e-9);
  assert.ok(Math.abs(last.latitude - (90 - (180 * (H - 0.5)) / H)) < 1e-9);
  for (const c of cells) {
    assert.ok(c.latitude >= -90 && c.latitude <= 90);
  }
});

test('北极（lat ≥ 84°）为海洋——北冰洋参考', () => {
  const cells = generateTerrainCells({ seed: SEED });
  for (const c of cells) {
    if (c.latitude >= 84) {
      assert.equal(c.terrainType, 'ocean', `北极出现陆地 @${c.id.x},${c.id.y}`);
    }
  }
});

test('南极（lat ≤ -85°）为大陆——南极洲参考（含极点）', () => {
  const cells = generateTerrainCells({ seed: SEED });
  let land = 0;
  let total = 0;
  for (const c of cells) {
    if (c.latitude <= -85) {
      total++;
      if (c.landWaterFraction < 0.5) land++;
    }
  }
  assert.ok(total > 0, '南极区域不存在（H 太小？）');
  assert.equal(land, total, `南极内陆存在海洋 cell（${total - land}/${total}）`);
});

test('landFractionAt 真实地理点抽查（Natural Earth 50m）', () => {
  // (lon, lat, 期望是否陆地)
  const spots: Array<[string, number, number, boolean]> = [
    ['亚马逊', -62, -5, true],
    ['撒哈拉', 10, 23, true],
    ['西伯利亚', 100, 60, true],
    ['澳洲中部', 134, -25, true],
    ['印度', 78, 20, true],
    ['英国', -2, 54, true],
    ['日本木州', 138, 37, true],
    ['马达加斯加', 47, -19, true],
    ['格陵兰', -42, 73, true],
    ['大西洋', -30, 30, false],
    ['南太平洋', -150, -30, false],
    ['印度洋', 80, -20, false],
    ['北冰洋', 0, 86, false],
  ];
  for (const [name, lon, lat, expectLand] of spots) {
    const lwm = landFractionAt(lon, lat);
    const isLand = lwm >= 0.5;
    assert.equal(isLand, expectLand, `${name}(${lon},${lat}) 期望${expectLand ? '陆' : '海'}，掩模值 ${lwm}`);
  }
});

test('数值健全：无 NaN/Infinity，slope∈[0,1]，coastDistance≥0，aspect∈[0,2π)', () => {
  const cells = generateTerrainCells({ seed: SEED });
  let maxElev = -Infinity;
  let minElev = Infinity;
  let hasMountain = false;
  let hasDeepOcean = false;
  for (const c of cells) {
    assert.ok(Number.isFinite(c.elevation), `NaN 海拔 @${c.id.x},${c.id.y}`);
    assert.ok(c.slope >= 0 && c.slope <= 1, `slope 越界: ${c.slope}`);
    assert.ok(c.landWaterFraction >= 0 && c.landWaterFraction <= 1);
    assert.ok(c.coastDistance >= 0);
    assert.ok(c.aspect >= 0 && c.aspect < 2 * Math.PI);
    assert.ok(c.humidity >= 0 && c.humidity <= 1);
    assert.ok(c.oxygen >= 0 && c.oxygen <= 1);
    maxElev = Math.max(maxElev, c.elevation);
    minElev = Math.min(minElev, c.elevation);
    if (c.terrainType === 'mountain') hasMountain = true;
    if (c.terrainType === 'ocean' && c.elevation < -2000) hasDeepOcean = true;
  }
  assert.ok(maxElev > 800, `缺少山脉（max ${maxElev.toFixed(0)} m）`);
  assert.ok(minElev < -1500, `缺少深海（min ${minElev.toFixed(0)} m）`);
  assert.ok(hasMountain && hasDeepOcean);
});

test('六边形 6 邻域边界墙（v2.2/Q6）：内部 6、边界 <6、无越界/重复/自环、对称、格距 1、与 hexNeighbors 一致', () => {
  const cells = generateTerrainCells({ seed: SEED, width: 16, height: 16 });
  const at = (x: number, y: number) => cells[y * 16 + x] as Cell;
  const key = (n: { x: number; y: number }) => `${n.x},${n.y}`;
  assert.equal(at(8, 8).neighbors.length, 6); // 内部格
  assert.equal(at(7, 7).neighbors.length, 6);
  assert.ok(at(0, 0).neighbors.length < 6); // 边界格
  assert.ok(at(15, 15).neighbors.length < 6);
  for (const c of cells) {
    const ks = c.neighbors.map(key);
    assert.equal(new Set(ks).size, ks.length, '邻居重复');
    assert.ok(!ks.includes(key(c.id)), '邻居含自身');
    assert.ok(c.neighbors.length <= 6, '邻居数超 6');
    assert.deepEqual(ks.slice().sort(), hexNeighbors(c.id.x, c.id.y, 16, 16).map(key).sort(), '与 hexNeighbors 不一致');
    for (const nb of c.neighbors) {
      assert.ok(nb.x >= 0 && nb.x < 16 && nb.y >= 0 && nb.y < 16, '邻居越界');
      assert.equal(hexDistance(c.id, nb), 1, '邻居格距应为 1');
      assert.ok(at(nb.x, nb.y).neighbors.some((n) => key(n) === key(c.id)), '邻居关系不对称');
    }
  }
});

test('海岸距离：水域为 0，陆地为正且连续递增（抽样）', () => {
  const cells = generateTerrainCells({ seed: SEED, width: 32, height: 32 });
  for (const c of cells) {
    if (c.landWaterFraction >= 0.5) {
      assert.equal(c.coastDistance, 0, `水域 coastDistance 应为 0 @${c.id.x},${c.id.y}`);
    } else {
      assert.ok(c.coastDistance >= WORLD.CELL_EDGE_KM, '陆地 coastDistance 应 ≥ 1 cell');
    }
  }
});

// ───────────────────────── M1 气候水文集成验收（E1–E6） ─────────────────────────

/** 经纬度 → cell（与 scenario/掩模同一采样协议） */
function cellAt(cells: Cell[], lon: number, lat: number): Cell {
  const x = Math.min(WORLD.W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * WORLD.W)));
  const y = Math.min(WORLD.H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * WORLD.H)));
  return cells[y * WORLD.W + x] as Cell;
}

const FOREST_BIOMES = ['tropical_forest', 'seasonal_forest', 'temperate_forest'];

test('M1 气候初始化：环境场边界健全，群系覆盖多样（沙漠/苔原/草原/森林/海洋）', () => {
  const world = generateWorld({ seed: SEED });
  const counts: Record<string, number> = {};
  for (const c of world.cells) {
    assert.ok(Number.isFinite(c.temperature) && c.temperature >= -70 && c.temperature <= 70, `温度越界: ${c.temperature}`);
    assert.ok(Number.isFinite(c.precipitation) && c.precipitation >= 0 && c.precipitation <= 60, `降水越界: ${c.precipitation}`);
    assert.ok(c.humidity >= 0 && c.humidity <= 1, `湿度越界: ${c.humidity}`);
    assert.ok(c.soilMoisture >= 0 && c.soilMoisture <= 200, `土壤水越界: ${c.soilMoisture}`);
    assert.ok(c.surfaceWater >= 0 && c.surfaceWater <= HYDROLOGY.MAX_SURFACE_WATER);
    assert.ok(c.nutrients >= 0 && c.nutrients <= SOIL.MAX_NUTRIENTS);
    assert.ok(c.organicMatter >= 0);
    counts[c.biome] = (counts[c.biome] ?? 0) + 1;
    if (c.elevation < 0) {
      assert.ok(c.biome === 'deep_ocean' || c.biome === 'coastal_ocean', `海洋群系错误: ${c.biome}`);
      assert.equal(c.surfaceWater, HYDROLOGY.MAX_SURFACE_WATER);
    }
  }
  assert.ok((counts['desert'] ?? 0) > 0, '缺少沙漠群系');
  assert.ok((counts['tundra'] ?? 0) > 0, '缺少苔原群系');
  assert.ok((counts['grassland'] ?? 0) > 0, '缺少草原群系');
  const forest = FOREST_BIOMES.reduce((s, b) => s + (counts[b] ?? 0), 0);
  assert.ok(forest > 0, '缺少森林群系');
});

test('M1 地理抽查：撒哈拉沙漠、亚马逊森林、南极苔原、南太平洋海洋（真实地球掩模+气候）', () => {
  const world = generateWorld({ seed: SEED });
  const sahara = cellAt(world.cells, 15, 25);
  assert.equal(sahara.biome, 'desert', `撒哈拉(15,25) 期望 desert，实际 ${sahara.biome}（P=${sahara.precipitation.toFixed(2)}, T=${sahara.temperature.toFixed(1)}）`);
  const amazon = cellAt(world.cells, -62, -5);
  assert.ok(FOREST_BIOMES.includes(amazon.biome), `亚马逊(-62,-5) 期望森林，实际 ${amazon.biome}（P=${amazon.precipitation.toFixed(2)}, T=${amazon.temperature.toFixed(1)}）`);
  const antarctic = cellAt(world.cells, 0, -87);
  assert.equal(antarctic.biome, 'tundra', `南极(0,-87) 期望 tundra，实际 ${antarctic.biome}`);
  const pacific = cellAt(world.cells, -150, -30);
  assert.equal(pacific.terrainType, 'ocean');
  assert.ok(pacific.biome === 'deep_ocean' || pacific.biome === 'coastal_ocean');
});

test('M1 stepEnvironment：双缓冲不改输入、同种子重放一致、季节驱动温度变化（§9.2/§9.3/§8.3）', () => {
  const world = generateWorld({ seed: SEED });
  const flow = computeFlowDirection(world.cells);
  const before = JSON.stringify(world.cells);
  const run = (day: number): Cell[] =>
    stepEnvironment(world.cells, flow, day, RandomStream.fromSerialized(world.randomState));
  const a = run(1);
  const b = run(1);
  assert.equal(JSON.stringify(a), JSON.stringify(b), '同种子同 day 重放不一致');
  assert.equal(JSON.stringify(world.cells), before, '输入快照被原地修改（违反双缓冲）');
  for (const c of a) {
    assert.ok(c.temperature >= -70 && c.temperature <= 70);
    assert.ok(c.precipitation >= 0 && c.precipitation <= 60);
    assert.ok(c.humidity >= 0 && c.humidity <= 1);
    assert.ok(c.nutrients >= 0 && c.nutrients <= SOIL.MAX_NUTRIENTS);
    assert.ok(c.surfaceWater >= 0 && c.surfaceWater <= HYDROLOGY.MAX_SURFACE_WATER);
    assert.ok(c.soilMoisture >= 0 && c.groundwater >= 0);
  }
  // 季节：北半球盛夏（day 91）vs 隆冬（day 273），中纬度陆地温差显著
  const summer = run(91);
  const winter = run(273);
  let seasonalSwing = false;
  for (let i = 0; i < world.cells.length; i++) {
    const c = world.cells[i] as Cell;
    if (c.elevation >= 0 && c.latitude > 30 && c.latitude < 60) {
      if (Math.abs((summer[i] as Cell).temperature - (winter[i] as Cell).temperature) > 5) {
        seasonalSwing = true;
        break;
      }
    }
  }
  assert.ok(seasonalSwing, '中纬度陆地冬夏温差应 > 5°C（SEASON_AMP=15）');
});

test('M1 多 tick 水文/营养动态：地下水得到补给、营养库演化、数值始终健全（32×32 快速世界）', () => {
  const world = generateWorld({ seed: SEED, width: 32, height: 32 });
  const flow = computeFlowDirection(world.cells);
  const runTicks = (): Cell[] => {
    let cells = world.cells;
    const rng = RandomStream.fromSerialized(world.randomState);
    for (let day = 1; day <= 20; day++) {
      cells = stepEnvironment(cells, flow, day, rng);
    }
    return cells;
  };
  const a = runTicks();
  const b = runTicks();
  assert.equal(JSON.stringify(a), JSON.stringify(b), '多 tick 重放不一致');
  let groundwaterCells = 0;
  let nutrientDrift = false;
  for (const c of a) {
    assert.ok(Number.isFinite(c.temperature) && Number.isFinite(c.precipitation));
    assert.ok(c.surfaceWater >= 0 && c.surfaceWater <= HYDROLOGY.MAX_SURFACE_WATER);
    assert.ok(c.soilMoisture >= 0 && c.soilMoisture <= 200);
    assert.ok(c.groundwater >= 0);
    assert.ok(c.nutrients >= 0 && c.nutrients <= SOIL.MAX_NUTRIENTS);
    assert.ok(c.organicMatter >= 0);
    if (c.elevation >= 0) {
      if (c.groundwater > 0) groundwaterCells++;
      if (Math.abs(c.nutrients - 100) > 1e-6) nutrientDrift = true;
    }
  }
  assert.ok(groundwaterCells > 0, '20 tick 后应有土壤超持水下渗补给地下水');
  assert.ok(nutrientDrift, '营养库应随分解/固氮/淋失演化（E5）');
});
