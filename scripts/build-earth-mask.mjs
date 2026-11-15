#!/usr/bin/env node
/**
 * 构建真实地球海陆掩模（可复现数据管线）。
 *
 * 输入：data/earth-land-50m.json（world-atlas@2 / Natural Earth 50m 陆地 TopoJSON）
 * 输出：data/earth/land-mask-128.json —— 128×128 的 equirectangular 陆地分数栅格
 *       （每 cell 3×3 超采样，值 ∈ [0,1]，0=纯海 1=纯陆）
 *
 * 用法：node scripts/build-earth-mask.mjs [宽度 默认128] [高度 默认128]
 * 注意：本脚本为 §13 树外扩展（问题单 Q7）；输出 JSON 属内容数据，禁止含逻辑。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const W = Number(process.argv[2] ?? 128);
const H = Number(process.argv[3] ?? 128);

const topo = JSON.parse(readFileSync(join(root, 'data', 'earth-land-50m.json'), 'utf8'));
const { arcs, transform } = topo;

// ── TopoJSON 解码：delta 编码 arcs → 绝对经纬度折线 ──
const [sx, sy] = transform.scale;
const [tx, ty] = transform.translate;
const decodedArcs = arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [tx + sx * x, ty + sy * y];
  });
});

// ── 收集所有环（Polygon/MultiPolygon 的 ring，含洞）──
const rings = [];
function addRing(arcIdxList) {
  const pts = [];
  for (const idx of arcIdxList) {
    const a = idx >= 0 ? decodedArcs[idx] : decodedArcs[~idx].slice().reverse();
    for (let i = pts.length === 0 ? 0 : 1; i < a.length; i++) pts.push(a[i]);
  }
  if (pts.length < 3) return;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lo, la] of pts) {
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
  }
  rings.push({ pts, minLon, maxLon, minLat, maxLat });
}
for (const g of topo.objects.land.geometries) {
  if (g.type === 'Polygon') {
    for (const ring of g.arcs) addRing(ring);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.arcs) for (const ring of poly) addRing(ring);
  }
}
console.log(`环数量: ${rings.length}`);

// ── 1° bin 空间索引（加速点查询）──
const BINX = 360;
const BINY = 180;
const bins = Array.from({ length: BINX * BINY }, () => []);
for (const r of rings) {
  const x0 = Math.max(0, Math.floor(r.minLon + 180));
  const x1 = Math.min(BINX - 1, Math.floor(r.maxLon + 180));
  const y0 = Math.max(0, Math.floor(r.minLat + 90));
  const y1 = Math.min(BINY - 1, Math.floor(r.maxLat + 90));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) bins[y * BINX + x].push(r);
  }
}

// ── even-odd 射线法（含洞自动正确）──
function isLand(lon, lat) {
  // 南极内陆：Natural Earth 用"主海岸环 + 沿 -90° 退化极帽环"表示南极洲，
  // 主环最深约 -84°，极帽环无面积。南极点高原（lat < -84°）按地理事实判陆。
  if (lat < -84) return true;
  if (lon >= 180) lon -= 360;
  const bx = Math.min(BINX - 1, Math.max(0, Math.floor(lon + 180)));
  const by = Math.min(BINY - 1, Math.max(0, Math.floor(lat + 90)));
  let inside = false;
  for (const r of bins[by * BINX + bx]) {
    if (lat < r.minLat || lat > r.maxLat || lon < r.minLon || lon > r.maxLon) continue;
    const pts = r.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ── 每 cell 3×3 超采样 → 陆地分数 ──
const OFF = [1 / 6, 3 / 6, 5 / 6];
const landFraction = new Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let hits = 0;
    for (const oy of OFF) {
      for (const ox of OFF) {
        const lon = (360 * (x + ox)) / W - 180;
        const lat = 90 - (180 * (y + oy)) / H;
        if (isLand(lon, lat)) hits++;
      }
    }
    landFraction[y * W + x] = hits / 9;
  }
}

// ── 输出 ──
const landCells = landFraction.filter((v) => v >= 0.5).length;
const out = {
  meta: {
    source: 'world-atlas@2 land-50m.json (Natural Earth 50m)',
    license: 'Natural Earth 是公有领域数据 (public domain)',
    width: W,
    height: H,
    samples: 9,
    note: 'equirectangular 栅格；值 = cell 内 3×3 采样点的陆地比例，0=海 1=陆',
  },
  landFraction,
};
mkdirSync(join(root, 'data', 'earth'), { recursive: true });
const outPath = join(root, 'data', 'earth', `land-mask-${W}x${H}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`OK ${outPath}`);
console.log(`陆地 cell 占比: ${((landCells / (W * H)) * 100).toFixed(1)}%（地球实际 ~29%，等距圆柱采样偏高为正常）`);
