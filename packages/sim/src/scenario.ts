/**
 * 场景加载与世界生成（契约 §13：sim/src/scenario.ts）。
 *
 * 地形生成方案（2026-11-16 用户指定，契约未冻结地形算法，见问题单 Q5）：
 *  - Perlin 梯度噪声 + fBm 多倍频细节；
 *  - 排列表(permutation)由 RandomStream 派生，同 seed 逐 cell 可复现；
 *  - 「基本款地球形状」：按真实大陆的经纬度分布放置椭圆软窗口掩模
 *    （北美/南美/非洲/欧亚/欧洲/印度/东南亚/澳洲/格陵兰 + 南极大陆），
 *    北极无大陆掩模（对应北冰洋）；
 *  - 经度 lon = 360*(x+0.5)/W；纬度按契约 §1.3：lat = 90 - 180*(y+0.5)/H。
 *
 * 随机性红线：全部随机数来自注入的 RandomStream（契约 §8.3），禁 Math.random。
 */
import type { Cell, CellId, GeologicalType, TerrainType, BiomeType, WorldSnapshot } from '../../core/src/types.js';
import { WORLD } from '../../core/src/constants.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { createWorldSnapshot } from './snapshot.js';

// ───────────────────────── Perlin 噪声（2D） ─────────────────────────

const FADE = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const LERP = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 8 方向单位梯度（经典 Perlin 2D） */
function grad2(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0: return x;
    case 1: return -x;
    case 2: return y;
    case 3: return -y;
    case 4: return (x + y) * Math.SQRT1_2;
    case 5: return (-x + y) * Math.SQRT1_2;
    case 6: return (x - y) * Math.SQRT1_2;
    default: return (-x - y) * Math.SQRT1_2;
  }
}

/** Perlin 噪声发生器：排列表由注入的 RandomStream 派生（Fisher-Yates 洗牌） */
class Perlin {
  private readonly perm: Uint8Array;

  constructor(rng: RandomStream) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = p[i] as number;
      p[i] = p[j] as number;
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255] as number;
    }
  }

  /** 单倍频 Perlin 噪声，输出约 [-1,1] */
  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = FADE(xf);
    const v = FADE(yf);
    const aa = this.perm[(this.perm[X] as number) + Y] as number;
    const ab = this.perm[(this.perm[X] as number) + Y + 1] as number;
    const ba = this.perm[(this.perm[X + 1] as number) + Y] as number;
    const bb = this.perm[(this.perm[X + 1] as number) + Y + 1] as number;
    const x1 = LERP(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = LERP(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return LERP(x1, x2, v);
  }

  /** fBm 分形叠加，输出约 [-1,1]（归一化） */
  fbm(x: number, y: number, octaves: number, persistence = 0.5, lacunarity = 2): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

// ───────────────────────── 地球形状掩模（经纬度） ─────────────────────────

interface ContinentBlob {
  lonC: number; // 中心经度 deg
  latC: number; // 中心纬度 deg
  rLon: number; // 经向半径 deg
  rLat: number; // 纬向半径 deg
  weight: number;
}

/** 真实大陆的简化椭圆近似（equirectangular，经度环绕处理） */
const EARTH_CONTINENTS: readonly ContinentBlob[] = [
  { lonC: -100, latC: 45, rLon: 32, rLat: 22, weight: 1.0 }, // 北美
  { lonC: -60, latC: -15, rLon: 12, rLat: 26, weight: 1.0 }, // 南美
  { lonC: 18, latC: 5, rLon: 26, rLat: 30, weight: 1.0 }, // 非洲
  { lonC: 70, latC: 45, rLon: 58, rLat: 24, weight: 1.0 }, // 欧亚主体
  { lonC: 15, latC: 50, rLon: 22, rLat: 12, weight: 0.9 }, // 欧洲
  { lonC: 78, latC: 20, rLon: 9, rLat: 9, weight: 0.85 }, // 印度次大陆
  { lonC: 115, latC: 0, rLon: 14, rLat: 7, weight: 0.75 }, // 东南亚
  { lonC: 134, latC: -25, rLon: 13, rLat: 8, weight: 0.95 }, // 澳洲
  { lonC: -42, latC: 73, rLon: 10, rLat: 7, weight: 0.9 }, // 格陵兰
];

/** 经度差（处理 -180/180 环绕） */
function lonDelta(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** 大陆性掩模 ∈ [0,1]：真实大陆位置的高斯软窗口 + 南极大陆极地盖 */
export function continentMask(lon: number, lat: number): number {
  let m = 0;
  for (const c of EARTH_CONTINENTS) {
    const dx = lonDelta(lon, c.lonC) / c.rLon;
    const dy = (lat - c.latC) / c.rLat;
    m = Math.max(m, c.weight * Math.exp(-(dx * dx + dy * dy)));
  }
  if (lat < -55) {
    // 南极大陆：lat ≤ -67 处全权重
    const t = Math.min(1, (-55 - lat) / 12);
    m = Math.max(m, t);
  }
  return Math.min(1, m);
}

// ───────────────────────── 地形生成 ─────────────────────────

export interface TerrainOptions {
  seed: number; // 根种子
  width?: number; // 默认 WORLD.W
  height?: number; // 默认 WORLD.H
  /** fBm 基础频率（cell 单位）；越小大陆越平缓 */
  noiseScale?: number;
  /** 海平面偏置；越大海越多 */
  seaBias?: number;
}

const TERRAIN_TAG = 'sim:scenario:terrain';

/** 生成地形 Cell[]：Perlin fBm × 地球大陆掩模 → 海拔/坡度/坡向/地表类型/海岸距离 */
export function generateTerrainCells(opts: TerrainOptions): Cell[] {
  const W = opts.width ?? WORLD.W;
  const H = opts.height ?? WORLD.H;
  const scale = opts.noiseScale ?? 0.045;
  const seaBias = opts.seaBias ?? 0.26;

  const root = new RandomStream(opts.seed);
  const perlin = new Perlin(root.fork(`${TERRAIN_TAG}:perlin`));
  const mountain = new Perlin(root.fork(`${TERRAIN_TAG}:mountain`));
  const geology = root.fork(`${TERRAIN_TAG}:geology`);

  // 1) 海拔场
  const elev = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (180 * (y + 0.5)) / H;
    for (let x = 0; x < W; x++) {
      const lon = (360 * (x + 0.5)) / W;
      const mask = continentMask(lon, lat);
      const detail = perlin.fbm(x * scale, y * scale, 6) * 0.5 + 0.5; // 0..1
      const ridge = mountain.fbm(x * scale * 1.7 + 37.3, y * scale * 1.7 - 11.7, 4) * 0.5 + 0.5; // 山脉带 0..1
      // 组合：大陆内部成陆，边缘碎化；陆地上叠加山脉带
      let v = mask * (0.62 + 0.28 * detail) + 0.08 * detail - seaBias;
      if (v > 0) {
        // 起伏度因子：山脉带(fbm ridge)抬升，其余压为平原/丘陵
        const relief = 0.25 + ridge;
        elev[y * W + x] = Math.pow(v, 2.4) * 5000 * relief; // m
      } else {
        elev[y * W + x] = v * 22000; // 海深（mask=0 处约 -1600 ~ -3700 m）
      }
    }
  }

  // 2) 组装 Cell（坡度/坡向由海拔梯度导出；海岸距离下方 BFS）
  const cells: Cell[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (180 * (y + 0.5)) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i] as number;

      // 中心差分梯度（边界取单侧）
      const eE = elev[y * W + Math.min(x + 1, W - 1)] as number;
      const eW_ = elev[y * W + Math.max(x - 1, 0)] as number;
      const eS = elev[Math.min(y + 1, H - 1) * W + x] as number;
      const eN = elev[Math.max(y - 1, 0) * W + x] as number;
      const dzdx = (eE - eW_) / 2;
      const dzdy = (eS - eN) / 2; // y+ 向南

      const grad = Math.hypot(dzdx, dzdy) / (WORLD.CELL_EDGE_KM * 1000); // tan
      const slope = Math.min(1, Math.atan(grad) / (Math.PI / 2)); // 0..1 归一化

      // 坡向（下坡方向方位角，0=北[-y]，顺时针为东[+x]）；平地记 0
      const aspect = dzdx === 0 && dzdy === 0
        ? 0
        : ((Math.atan2(-dzdx, dzdy) + 2 * Math.PI) % (2 * Math.PI)); // rad

      // 海陆分数：海拔 -60..+60 m 间平滑过渡
      const lwf = e <= -60 ? 1 : e >= 60 ? 0 : (60 - e) / 120;

      const terrainType = classifyTerrain(e, slope);
      const geologicalType = classifyGeology(terrainType, slope, geology);
      const biome: BiomeType = e < 0 ? (e < -2000 ? 'deep_ocean' : 'coastal_ocean') : 'grassland'; // TODO(M1): E6 查表替换

      cells[i] = {
        id: { x, y },
        elevation: e,
        slope,
        aspect,
        terrainType,
        geologicalType,
        landWaterFraction: lwf,
        coastDistance: 0,
        latitude: lat,
        neighbors: fourNeighbors(x, y, W, H),
        // 动态环境场：中性初值，待 §9.2 步骤 2-4（E1-E5）在 M1 填充
        temperature: 0,
        precipitation: 0,
        humidity: 0.5,
        soilMoisture: 0,
        surfaceWater: 0,
        groundwater: 0,
        nutrients: 0,
        oxygen: 1,
        salinity: e < 0 ? 35 : 0.1,
        organicMatter: 0,
        diseasePressure: 0,
        pollution: 0,
        fireRisk: 0,
        biome,
        carryingCapacity: {},
        accessibility: e >= 0 ? 1 : 0.2, // TODO(M3): B9 扩散按物种修正
        productivity: 0,
      };
    }
  }

  // 3) 海岸距离 BFS：从水域向陆地扩散，单位 km
  computeCoastDistance(cells, W, H);
  return cells;
}

/** 生成完整初始世界快照（time=0, season=0，随机流状态入库） */
export function generateWorld(opts: TerrainOptions): WorldSnapshot {
  const root = new RandomStream(opts.seed);
  const cells = generateTerrainCells(opts);
  // 快照的 randomState = 尚未消耗的根流状态（重放起点）
  return createWorldSnapshot({
    time: 0,
    season: 0,
    cells,
    randomState: root.serialize(),
  });
}

// ───────────────────────── 内部工具 ─────────────────────────

/** 契约 §1.3：4 邻域（上右下左），边界墙——不含越界邻居 */
function fourNeighbors(x: number, y: number, W: number, H: number): CellId[] {
  const n: CellId[] = [];
  if (y > 0) n.push({ x, y: y - 1 });
  if (x < W - 1) n.push({ x: x + 1, y });
  if (y < H - 1) n.push({ x, y: y + 1 });
  if (x > 0) n.push({ x: x - 1, y });
  return n;
}

function classifyTerrain(elevation: number, slope: number): TerrainType {
  if (elevation < 0) return 'ocean';
  if (elevation > 1100 || (elevation > 700 && slope > 0.35)) return 'mountain';
  if (elevation > 350 || slope > 0.3) return 'hill';
  if (elevation < 80 && slope < 0.08) return 'wetland';
  return 'plain';
  // TODO(M1 后半): lake/river 由 E4 流向矩阵派生
}

function classifyGeology(
  terrain: TerrainType,
  slope: number,
  rng: RandomStream,
): GeologicalType {
  // @non-frozen 占位（Q2）：按地形倾向 + 随机扰动分配三大岩类
  const r = rng.next();
  if (terrain === 'mountain' || slope > 0.4) return r < 0.6 ? 'igneous' : 'metamorphic';
  if (terrain === 'hill') return r < 0.5 ? 'metamorphic' : 'sedimentary';
  return r < 0.8 ? 'sedimentary' : 'igneous';
}

/** 多源 BFS：水域 cell 距离 0，陆地按到最近水域的步数 × CELL_EDGE_KM */
function computeCoastDistance(cells: Cell[], W: number, H: number): void {
  const queue: number[] = [];
  const dist = new Float64Array(W * H).fill(-1);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Cell;
    if (c.landWaterFraction >= 0.5) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++] as number;
    const c = cells[i] as Cell;
    for (const nb of c.neighbors) {
      const j = nb.y * W + nb.x;
      if ((dist[j] as number) === -1) {
        dist[j] = (dist[i] as number) + 1;
        queue.push(j);
      }
    }
  }
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Cell;
    c.coastDistance = (dist[i] as number) * WORLD.CELL_EDGE_KM;
  }
}
