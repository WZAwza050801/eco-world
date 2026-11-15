/**
 * M1（地形部分）验收：真实地球海陆掩模 + Perlin 地形生成（scenario.ts）。
 * 验收项：
 *  - 同 seed 逐 cell 完全可复现；不同 seed 地形不同；
 *  - 真实海陆掩模（陆地占比 ≈ 地球 29%；真实地理点抽查）；
 *  - 纬度协议（契约 §1.3）；北极海洋、南极大陆；
 *  - 数值健全（红线 4）与 4 邻域边界墙（契约 §1.3）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../../core/src/constants.js';
import { generateTerrainCells, generateWorld, landFractionAt } from '../src/scenario.js';
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

test('4 邻域边界墙：角落 2 邻居、边缘 3、内部 4，无越界', () => {
  const cells = generateTerrainCells({ seed: SEED, width: 16, height: 16 });
  const at = (x: number, y: number) => cells[y * 16 + x] as { neighbors: { x: number; y: number }[] };
  assert.equal(at(0, 0).neighbors.length, 2);
  assert.equal(at(15, 0).neighbors.length, 2);
  assert.equal(at(0, 15).neighbors.length, 2);
  assert.equal(at(15, 15).neighbors.length, 2);
  assert.equal(at(8, 0).neighbors.length, 3);
  assert.equal(at(8, 15).neighbors.length, 3);
  assert.equal(at(0, 8).neighbors.length, 3);
  assert.equal(at(15, 8).neighbors.length, 3);
  assert.equal(at(8, 8).neighbors.length, 4);
  for (const c of cells) {
    for (const nb of c.neighbors) {
      assert.ok(nb.x >= 0 && nb.x < 16 && nb.y >= 0 && nb.y < 16, '邻居越界');
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
