/**
 * 六边形网格工具（契约 v2.2 §1.3，Q6 架构变更提案 docs/05 获批）。
 *
 * 坐标约定：**odd-r offset**（pointy-top，奇数行右移半格）存储，
 * Cell.id {x=col, y=row}，世界 W×H 矩形布局；**cube 坐标**做邻居/距离运算。
 * 纬度公式保留 lat = 90 − 180·(row+0.5)/H（row 仍映射纬度带）。
 * 几何：中心距 d = CELL_EDGE_KM（10km），边长 d/√3，面积 (√3/2)d² ≈ 86.60 km²。
 * 边界墙：越界邻居过滤，不环回（契约 §1.3）。
 */
import type { CellId } from '../types.js';
import { WORLD } from '../constants.js';

export interface Cube {
  x: number;
  y: number;
  z: number;
}

/** odd-r offset → cube（cx+cy+cz=0） */
export function offsetToCube(col: number, row: number): Cube {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return { x, y: -x - z, z };
}

/** cube → odd-r offset */
export function cubeToOffset(c: Cube): { col: number; row: number } {
  return { col: c.x + (c.z - (c.z & 1)) / 2, row: c.z };
}

/** cube 六方向（相邻格，格距 1） */
export const CUBE_DIRS: readonly Cube[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
];

/** 六边形 6 邻居（边界墙过滤越界）；顺序固定 = CUBE_DIRS，保证确定性 */
export function hexNeighbors(col: number, row: number, W: number, H: number): CellId[] {
  const c = offsetToCube(col, row);
  const out: CellId[] = [];
  for (const d of CUBE_DIRS) {
    const n = cubeToOffset({ x: c.x + d.x, y: c.y + d.y, z: c.z + d.z });
    if (n.col >= 0 && n.col < W && n.row >= 0 && n.row < H) {
      out.push({ x: n.col, y: n.row });
    }
  }
  return out;
}

/** 六边形格距（cube 曼哈顿/2） */
export function hexDistance(a: CellId, b: CellId): number {
  const ca = offsetToCube(a.x, a.y);
  const cb = offsetToCube(b.x, b.y);
  return (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) + Math.abs(ca.z - cb.z)) / 2;
}

/** cell 中心 Cartesian（km；px 东向，py 南向，与 row 增大=向南一致） */
export function hexCenter(col: number, row: number, spacing: number = WORLD.CELL_EDGE_KM): { px: number; py: number } {
  return {
    px: spacing * (col + 0.5 * (row & 1)),
    py: spacing * (Math.sqrt(3) / 2) * row,
  };
}

/** cell 中心经纬度（lon 按行奇偶偏半格；lat 公式保留契约 §1.3） */
export function hexLonLat(col: number, row: number, W: number, H: number): { lon: number; lat: number } {
  return {
    lon: (360 * (col + 0.5 * (row & 1))) / W - 180,
    lat: 90 - (180 * (row + 0.5)) / H,
  };
}

/**
 * 最小二乘平面拟合 elev = a·px + b·py + c，返回梯度 (a,b)（每 km）。
 * 用于六边形坡度/坡向（替代方形中心差分）。点集 = 中心 + 邻居（≥3 非共线可解；
 * 退化时返回零梯度）。px,py 单位 km。
 */
export function fitPlaneGradient(
  points: Array<{ px: number; py: number; e: number }>,
): { a: number; b: number } {
  const n = points.length;
  if (n < 3) return { a: 0, b: 0 };
  let sx = 0, sy = 0, se = 0, sxx = 0, syy = 0, sxy = 0, sxe = 0, sye = 0;
  for (const p of points) {
    sx += p.px; sy += p.py; se += p.e;
    sxx += p.px * p.px; syy += p.py * p.py; sxy += p.px * p.py;
    sxe += p.px * p.e; sye += p.py * p.e;
  }
  // 正规方程 [[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]]·[a,b,c]=[sxe,sye,se]
  const m = [
    [sxx, sxy, sx, sxe],
    [sxy, syy, sy, sye],
    [sx, sy, n, se],
  ];
  const sol = solve3(m);
  if (!sol) return { a: 0, b: 0 };
  return { a: sol[0], b: sol[1] };
}

/** 3×3 高斯消元（带主元）；奇异返回 null */
function solve3(m: number[][]): [number, number, number] | null {
  const a: number[][] = m.map((r) => [...r]);
  const g = (i: number, j: number): number => a[i]![j]!;
  const set = (i: number, j: number, v: number): void => { a[i]![j] = v; };
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(g(r, col)) > Math.abs(g(piv, col))) piv = r;
    if (Math.abs(g(piv, col)) < 1e-12) return null;
    const tmp = a[col]!; a[col] = a[piv]!; a[piv] = tmp;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = g(r, col) / g(col, col);
      for (let k = col; k < 4; k++) set(r, k, g(r, k) - f * g(col, k));
    }
  }
  return [g(0, 3) / g(0, 0), g(1, 3) / g(1, 1), g(2, 3) / g(2, 2)];
}
