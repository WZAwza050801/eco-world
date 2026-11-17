/**
 * 场景加载与世界生成（契约 §13：sim/src/scenario.ts）。
 *
 * 地形生成方案 v2（2026-11-16 用户指定，问题单 Q5）：
 *  - 大陆分布 = 真实地球海陆数据（Natural Earth 50m，data/earth/land-mask-128x128.json，
 *    由 scripts/build-earth-mask.mjs 可复现生成）；随机生成大陆留给未来版本；
 *  - 海拔细节 = Perlin fBm（排列表由 RandomStream 派生，同 seed 逐 cell 可复现）；
 *  - 经度 lon = 360*(x+0.5)/W - 180；纬度按契约 §1.3：lat = 90 - 180*(y+0.5)/H。
 *
 * M1 气候水文（E1–E6）：generateWorld 经 initializeClimate 完成气候初始化
 * （E2 温度/E3 降水/湿度/E6 群系查表 + 初始水氮库）；tick 级动态更新由
 * scheduler.stepEnvironment（§9.2 步骤 2–4）执行。
 *
 * 随机性红线：全部随机数来自注入的 RandomStream（契约 §8.3），禁 Math.random。
 */
import { readFileSync, readdirSync } from 'node:fs';
import type { Cell, GeologicalType, TerrainType, BiomeType, PopulationState, SpeciesDefinition, WorldSnapshot } from '../../core/src/types.js';
import { HYDROLOGY, WORLD } from '../../core/src/constants.js';
import { RandomStream } from '../../core/src/random/RandomStream.js';
import { temperature } from '../../core/src/climate/temperature.js';
import { precipitation, relativeHumidity } from '../../core/src/climate/precipitation.js';
import { classifyBiome, type BiomeRule } from '../../core/src/climate/biome.js';
import { FIELD_CAPACITY_MM } from '../../core/src/hydrology/waterBalance.js';
import { CARBON_FRACTION, RESERVE_MAX_DAYS } from '../../core/src/biology/population.js';
import { hexNeighbors, hexCenter, hexLonLat, fitPlaneGradient } from '../../core/src/grid/hex.js';
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

// ───────────────────────── 真实地球海陆掩模（内容数据） ─────────────────────────

interface LandMask {
  data: number[];
  W: number;
  H: number;
}

let cachedMask: LandMask | null = null;

function loadLandMask(): LandMask {
  if (cachedMask) return cachedMask;
  const raw = JSON.parse(
    readFileSync(new URL('../../../data/earth/land-mask-128x128.json', import.meta.url), 'utf8'),
  ) as { meta: { width: number; height: number }; landFraction: number[] };
  cachedMask = { data: raw.landFraction, W: raw.meta.width, H: raw.meta.height };
  return cachedMask;
}

/** 查询真实地球某经纬度的陆地分数 ∈ [0,1]（掩模为 lon/lat 栅格，任意世界尺寸按最近邻采样） */
export function landFractionAt(lon: number, lat: number): number {
  const m = loadLandMask();
  let l = lon;
  if (l >= 180) l -= 360;
  if (l < -180) l += 360;
  const x = Math.min(m.W - 1, Math.max(0, Math.floor(((l + 180) / 360) * m.W)));
  const y = Math.min(m.H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * m.H)));
  return m.data[y * m.W + x] as number;
}

// ───────────────────────── E6 群系规则表（内容数据） ─────────────────────────

let cachedBiomeRules: BiomeRule[] | null = null;

/** 加载 E6 分类表（契约 §4 E6：冻结于 content/biomes/biome-rules.json，core 零 I/O，由 sim 加载） */
export function loadBiomeRules(): BiomeRule[] {
  if (cachedBiomeRules) return cachedBiomeRules;
  const raw = JSON.parse(
    readFileSync(new URL('../../../packages/content/biomes/biome-rules.json', import.meta.url), 'utf8'),
  ) as { rules: BiomeRule[] };
  cachedBiomeRules = raw.rules;
  return cachedBiomeRules;
}

// ───────────────────────── 物种与食物网（M2 内容加载） ─────────────────────────

/**
 * 食物网边（@non-frozen schema，Q9；契约 §15.2 捕食系数见 foodweb-edges.json）：
 * carnivory 边用 attackRate/handlingTime（B6，prey 单位 ind）；
 * herbivory 边用 halfSaturationKgC（B3 herbivory 项，prey 单位 kgC）。
 */
export interface FoodwebEdge {
  predator: string; // speciesId
  prey: string; // speciesId
  type: 'herbivory' | 'carnivory';
  preference?: number; // 0..1 取食偏好权重
  attackRate?: number; // 1/(ind·day)，B6
  handlingTime?: number; // day，B6
  halfSaturationKgC?: number; // kgC，herbivory 半饱和
}

let cachedSpecies: Map<string, SpeciesDefinition> | null = null;

/** 加载 content/species/*.json（纯数据）；空 {} 占位（M3–M5 未填物种）跳过 */
export function loadSpeciesDefinitions(): Map<string, SpeciesDefinition> {
  if (cachedSpecies) return cachedSpecies;
  const dir = new URL('../../../packages/content/species/', import.meta.url);
  const map = new Map<string, SpeciesDefinition>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Partial<SpeciesDefinition>;
    if (raw && typeof raw.id === 'string') map.set(raw.id, raw as SpeciesDefinition);
  }
  cachedSpecies = map;
  return map;
}

let cachedEdges: FoodwebEdge[] | null = null;

/** 加载食物网边（content/interactions/foodweb-edges.json） */
export function loadFoodwebEdges(): FoodwebEdge[] {
  if (cachedEdges) return cachedEdges;
  const raw = JSON.parse(
    readFileSync(new URL('../../../packages/content/interactions/foodweb-edges.json', import.meta.url), 'utf8'),
  ) as { edges?: FoodwebEdge[] } | FoodwebEdge[];
  cachedEdges = Array.isArray(raw) ? raw : (raw.edges ?? []);
  return cachedEdges;
}

/** 初始种群投放定义（场景 JSON / 测试用） */
export interface PopulationSeed {
  speciesId: string;
  x: number;
  y: number;
  count?: number; // ind（动物）
  biomass?: number; // kgC（植物；动物缺省按 count×bodyMass×CARBON_FRACTION）
  energyReserve?: number; // kJ/ind，缺省为半满储备
}

/**
 * 向快照投放初始种群（M2 场景入口）。每 cell 每物种至多一个种群（重复拒绝）；
 * 未填写内容的物种拒绝投放。返回新快照（双缓冲，不改输入）。
 */
export function seedPopulations(world: WorldSnapshot, seeds: PopulationSeed[]): WorldSnapshot {
  const species = loadSpeciesDefinitions();
  const pops: PopulationState[] = [...world.populations];
  const seen = new Set(pops.map((p) => `${p.speciesId}@${p.cellId.x},${p.cellId.y}`));
  for (const s of seeds) {
    const def = species.get(s.speciesId);
    if (!def) {
      throw new Error(`seedPopulations: 物种 "${s.speciesId}" 不存在或内容未填写（content/species）`);
    }
    const key = `${s.speciesId}@${s.x},${s.y}`;
    if (seen.has(key)) throw new Error(`seedPopulations: 重复种群 ${key}（每 cell 每物种至多一个）`);
    seen.add(key);
    const isField = def.simulationTier === 'field';
    const count = isField ? 0 : Math.max(0, s.count ?? 0);
    const need = def.resources.minimumDailyEnergy;
    const reserveDays = def.physiology.reserveMaxDays ?? RESERVE_MAX_DAYS;
    pops.push({
      speciesId: s.speciesId,
      cellId: { x: s.x, y: s.y },
      count,
      biomass: Math.max(0, s.biomass ?? (isField ? 0 : count * def.physiology.bodyMass * CARBON_FRACTION)),
      ageStructure: { juvenile: 0.2, adult: 0.7, old: 0.1 },
      energyReserve: s.energyReserve ?? need * reserveDays * 0.5,
      health: 0.8,
      infectionState: {},
      // M3 遗传初始化（@non-frozen Q10）：耐受性状均值 0（中性）、方差 1
      traitMeans: Object.fromEntries((def.genetics?.heritableTraits ?? []).map((t) => [t, 0])),
      traitVariance: Object.fromEntries((def.genetics?.heritableTraits ?? []).map((t) => [t, 1])),
    });
  }
  return createWorldSnapshot({
    time: world.time,
    season: world.season,
    cells: world.cells,
    populations: pops,
    agents: world.agents,
    interactions: world.interactions,
    events: world.events,
    randomState: world.randomState,
  });
}

// ───────────────────────── 气候初始化（M1，E2/E3/E6） ─────────────────────────

/** @non-frozen 初始条件（M1，M8 可调）：陆地营养/有机质库 kgN、kgC /cell */
const INITIAL_NUTRIENTS_KGN = 100;
const INITIAL_ORGANIC_MATTER_KGC = 100;
const INITIAL_OCEAN_NUTRIENTS_KGN = 50;

/**
 * M1 气候初始化（§9.2 步骤 2–3 的气候部分 + E6 派生缓存）：
 * E2 温度、E3 降水、湿度诊断、初始水/营养库（@non-frozen）、E6 群系查表。
 * 初始态为**确定性气候平均态**（weatherNoise = 0、stormNoise = 1）；
 * 天气/风暴噪声与 E4/E5 动态更新自 tick 1 起由 scheduler.stepEnvironment 注入。
 * §9.3 双缓冲：读 cells、返回新数组，不修改输入。
 */
export function initializeClimate(cells: Cell[], day: number): Cell[] {
  const rules = loadBiomeRules();
  return cells.map((c) => {
    const t = temperature({
      latitude: c.latitude,
      elevation: c.elevation,
      landWaterFraction: c.landWaterFraction,
      day,
    });
    const p = precipitation({
      latitude: c.latitude,
      coastDistance: c.coastDistance,
      slope: c.slope,
      aspect: c.aspect,
      day,
    });
    const ocean = c.elevation < 0;
    const soilMoisture = ocean ? 0 : Math.min(FIELD_CAPACITY_MM, 20 + 30 * p);
    const humidity = relativeHumidity(p, soilMoisture, c.landWaterFraction);
    const biome = classifyBiome(
      {
        temperature: t.value,
        precipitation: p,
        seasonality: Math.abs(Math.sin((c.latitude * Math.PI) / 180)),
        soilMoisture,
        elevation: c.elevation,
        salinity: c.salinity,
        landWaterFraction: c.landWaterFraction,
        terrainType: c.terrainType,
        vegetationStructure: 0, // M1 无植被（M2+ 接线）
      },
      rules,
    );
    return {
      ...c,
      temperature: t.value,
      precipitation: p,
      humidity,
      soilMoisture,
      surfaceWater: ocean ? HYDROLOGY.MAX_SURFACE_WATER : 0,
      groundwater: 0,
      nutrients: ocean ? INITIAL_OCEAN_NUTRIENTS_KGN : INITIAL_NUTRIENTS_KGN,
      organicMatter: ocean ? 0 : INITIAL_ORGANIC_MATTER_KGC,
      biome,
    };
  });
}

// ───────────────────────── 地形生成 ─────────────────────────

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface TerrainOptions {
  seed: number; // 根种子
  width?: number; // 默认 WORLD.W
  height?: number; // 默认 WORLD.H
  /** fBm 基础频率（cell 单位）；越小陆地起伏越平缓 */
  noiseScale?: number;
}

const TERRAIN_TAG = 'sim:scenario:terrain';

/** 生成地形 Cell[]：真实地球海陆掩模 + Perlin fBm 起伏 → 海拔/坡度/坡向/地表类型/海岸距离 */
export function generateTerrainCells(opts: TerrainOptions): Cell[] {
  const W = opts.width ?? WORLD.W;
  const H = opts.height ?? WORLD.H;
  const scale = opts.noiseScale ?? 0.045;

  const root = new RandomStream(opts.seed);
  const perlin = new Perlin(root.fork(`${TERRAIN_TAG}:perlin`));
  const mountain = new Perlin(root.fork(`${TERRAIN_TAG}:mountain`));
  const geology = root.fork(`${TERRAIN_TAG}:geology`);

  // 1) 海拔场：真实海陆掩模定海陆，Perlin fBm 做陆地起伏与海底
  const elev = new Float64Array(W * H);
  const landFrac = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { lon, lat } = hexLonLat(x, y, W, H); // 六边形中心经纬度（行奇偶偏半格，v2.2）
      const lwm = landFractionAt(lon, lat); // 真实陆地分数 0..1
      landFrac[y * W + x] = lwm;
      const ctr = hexCenter(x, y, 1); // 单位中心距 Cartesian（噪声采样位置）
      const detail = clamp01(perlin.fbm(ctr.px * scale, ctr.py * scale, 6) * 0.9 + 0.5); // 0..1
      const ridge = clamp01(mountain.fbm(ctr.px * scale * 1.7 + 37.3, ctr.py * scale * 1.7 - 11.7, 4) * 0.9 + 0.5); // 山脉带 0..1
      let e: number;
      if (lwm >= 0.5) {
        // 陆地：幂曲线 + 山脉带起伏度（平原为主，山成条状）
        const relief = 0.25 + 0.75 * ridge;
        e = 30 + Math.pow(detail, 1.9) * 3000 * relief;
      } else if (lwm >= 0.25) {
        // 海岸过渡带：浅滩
        e = (lwm - 0.5) * 160;
      } else {
        // 海洋：离岸越远越深 + 噪声
        const offshore = (0.25 - lwm) / 0.25; // (0,1]
        e = -(60 + 3400 * Math.pow(offshore, 0.7) * (0.35 + 0.65 * detail));
      }
      elev[y * W + x] = e;
    }
  }

  // 2) 组装 Cell（坡度/坡向由海拔梯度导出；海岸距离下方 BFS）
  const cells: Cell[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (180 * (y + 0.5)) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i] as number;

      // 六边形坡度/坡向：中心+6 邻居最小二乘平面拟合（v2.2，替代方形中心差分）
      const nbrs = hexNeighbors(x, y, W, H);
      const c0 = hexCenter(x, y);
      const pts = [{ px: c0.px, py: c0.py, e }];
      for (const nb of nbrs) {
        const cn = hexCenter(nb.x, nb.y);
        pts.push({ px: cn.px, py: cn.py, e: elev[nb.y * W + nb.x] as number });
      }
      const { a, b } = fitPlaneGradient(pts); // de/dpx, de/dpy（每 km；px 东、py 南）
      const grad = Math.hypot(a, b) / 1000; // tan（m/m）
      const slope = Math.min(1, Math.atan(grad) / (Math.PI / 2)); // 0..1 归一化

      // 坡向（下坡方位角，0=北[-py]，顺时针东[+px]）；平地记 0
      const aspect = a === 0 && b === 0
        ? 0
        : ((Math.atan2(-a, b) + 2 * Math.PI) % (2 * Math.PI)); // rad

      // 海陆分数：直接取真实掩模的陆地分数（海岸带自带中间值）
      const lwf = 1 - (landFrac[i] as number);

      const terrainType = classifyTerrain(e, slope);
      const geologicalType = classifyGeology(terrainType, slope, geology);
      // 占位值：generateWorld 会经 initializeClimate（E6 查表）覆盖
      const biome: BiomeType = e < 0 ? (e < -2000 ? 'deep_ocean' : 'coastal_ocean') : 'grassland';

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
        neighbors: nbrs, // 六边形 6 邻居（v2.2，上方已算）
        // 动态环境场：中性初值，由 initializeClimate（M1，E2/E3/E6）覆盖；
        // E4/E5 动态更新自 tick 1 起由 scheduler.stepEnvironment 执行
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

/** 生成完整初始世界快照（time=0, season=0，地形 + M1 气候平均态初始化，随机流状态入库） */
export function generateWorld(opts: TerrainOptions): WorldSnapshot {
  const root = new RandomStream(opts.seed);
  const cells = generateTerrainCells(opts);
  const initialized = initializeClimate(cells, 0);
  // 快照的 randomState = 根流初始状态（地形/气候初始化均为确定性派生；重放起点，契约 §10.5）
  return createWorldSnapshot({
    time: 0,
    season: 0,
    cells: initialized,
    randomState: root.serialize(),
  });
}

// ───────────────────────── 内部工具 ─────────────────────────

function classifyTerrain(elevation: number, slope: number): TerrainType {
  if (elevation < 0) return 'ocean';
  if (elevation > 1100 || (elevation > 700 && slope > 0.35)) return 'mountain';
  if (elevation > 500 || slope > 0.3) return 'hill';
  if (elevation < 80 && slope < 0.08) return 'wetland';
  return 'plain';
  // TODO(后续里程碑): lake/river 地形类型由 E4 汇流累积派生（M1 不改地形）
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
