/**
 * 调度器（契约 §14.7 冻结签名；§9.2 冻结更新顺序，不可改变）。
 * M1：步骤 2–4（stepEnvironment：气候/水文/土壤，E1–E6）。
 * M2：stepWorld 填充步骤 1–7、9、12（B1–B7 植物-草食-捕食闭环）。
 * M3：步骤 9 续接遗传（Lande 方程，§9.1 十年代尺度）与迁徙扩散（B9，
 *     两阶段流量计算；硬致死带清除不适生种群，空适生格可定殖）。
 * M4：步骤 8 疾病（D1 SIR，密度依赖传播+环境因子+六边形传播邻域，疾病死亡直接移除）；
 *     步骤 5 分解真菌（stepFungus，生物量驱动 E5 fungiActivity）；
 *     步骤 10（智人 M5）、11（事件因果 M6，含宿主跳转稀有事件）为显式占位，位置保留。
 *
 * §9.3 双缓冲解释：不修改 prev 快照对象；管线内下游步骤读上游步骤产出的
 * 新状态（与 M1 stepEnvironment 内部链一致），最后统一 commit 为新快照。
 * §8.3 随机：所有噪声/微观随机取自 rng 的稳定 fork，按固定顺序消费，重放一致。
 */
import type { Cell, PopulationState, SpeciesDefinition, PathogenDefinition, WorldSnapshot } from '../../core/src/types.js';
import type { RandomStream } from '../../core/src/random/RandomStream.js';
import { BIOLOGY, WORLD } from '../../core/src/constants.js';
import { solarInput } from '../../core/src/climate/solar.js';
import {
  temperature,
  WEATHER_NOISE_SIGMA_C,
} from '../../core/src/climate/temperature.js';
import {
  precipitation,
  relativeHumidity,
  stormNoiseFactor,
} from '../../core/src/climate/precipitation.js';
import { classifyBiome } from '../../core/src/climate/biome.js';
import { computeFlowDirection } from '../../core/src/grid/flowDirection.js';
import { stepHydrology } from '../../core/src/hydrology/waterBalance.js';
import { stepNutrients, stepFungus, fungiActivityFromBiomass } from '../../core/src/soil/nutrients.js';
import {
  stepSIR,
  densityFactor as transmissionDensityFactor,
  environmentalFactor as pathogenEnvironmentalFactor,
  NEIGHBOR_EXPOSURE_WEIGHT,
} from '../../core/src/disease/sir.js';
import { foodNeed, foodModifier as humanFoodModifier } from '../../core/src/humanity/food.js';
import { settlementGrowth } from '../../core/src/humanity/settlement.js';
import { landUseImpact } from '../../core/src/humanity/landUse.js';
import {
  grossPrimaryProduction,
  plantGrowth,
  respiration,
} from '../../core/src/biology/photosynthesis.js';
import {
  CARBON_FRACTION,
  climateStressModifier,
  densityModifier,
  RESERVE_MAX_DAYS,
  starvationModifier,
  stepPopulation,
  traitMutationDelta,
  traitSelectionDelta,
} from '../../core/src/biology/population.js';
import { herbivory, holling2 } from '../../core/src/biology/predation.js';
import { effectiveResource } from '../../core/src/biology/competition.js';
import {
  effectiveEnvironment,
  fitness as multiplicativeFitness,
  fitnessStressModifier,
  habitatFitness,
  rangeSuitability,
  TRAIT_MEAN_BOUND,
  TRAIT_RANGE_MAP,
  WATER_HARD_MARGIN_MM,
  WATER_SOFT_WIDTH_MM,
} from '../../core/src/biology/fitness.js';
import {
  dispersalFlow,
  dispersalRandomFactor,
  establishment,
  MAX_EMIGRATION_FRACTION,
  migrationCapacity,
  migrationCost,
  movementPressure,
  suitabilityGradient,
  targetAccessibility,
} from '../../core/src/biology/dispersal.js';
import {
  loadBiomeRules,
  loadFoodwebEdges,
  loadSpeciesDefinitions,
  loadPathogenDefinitions,
  type FoodwebEdge,
} from './scenario.js';
import { createWorldSnapshot } from './snapshot.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

// ───────────────── @non-frozen M2 实现常量（Q9，M8 可调） ─────────────────

/** 草食者最大日采食 = 能量需求/植物能量密度 × 本系数 */
const INTAKE_CAP_FACTOR = 2.2;
/** 草食同化效率（摄入→可用能量） */
const ASSIMILATION_HERB = 0.5;
/** 肉食同化效率 */
const ASSIMILATION_CARN = 0.8;
/** 植物净生长吸氮比例 kgN/kgC */
const PLANT_N_UPTAKE_RATIO = 0.02;
/** 植物 standing crop 日周转 → 凋落物比例 1/day */
const PLANT_TURNOVER_RATE = 0.005;
/** 损失/尸体 → 死亡有机质比例 */
const DETRITUS_FRACTION = 0.9;
/** 萎蔫点 mm（低于则干旱损伤） */
const WILT_POINT_MM = 10;
/** 干旱损伤速率 1/day */
const DROUGHT_DAMAGE_RATE = 0.02;
/** 自疏（拥挤）损失速率 1/day，超过 maxBiomass×CROWDING_ONSET 触发 */
const CROWDING_RATE = 0.01;
const CROWDING_ONSET = 0.8;
/** 配偶可得性 Allee 半饱和 ind（B4 mateAvailability，@non-frozen） */
const MATE_ALLEE_K = 1;
/** 草食者环境容纳量窗口天数：CC = 植物能量/(日需求×天数) */
const CC_WINDOW_DAYS = 30;
/** 捕食者环境容纳量 = 猎物数量 × 比例 */
const PREDATOR_PREY_RATIO = 0.15;
/** 繁殖季节修正下限（B4 seasonalModifier = base + (1−base)·seasonFactor） */
const SEASONAL_BASE = 0.3;
/** B5 randomMortality 对数正态 σ（微观随机，§8.1） */
const MICRO_MORTALITY_SIGMA = 0.1;
/**
 * 领域性捕食者干扰系数（@non-frozen Q9）：movement.pattern='territorial' 的
 * 捕食者有效攻击率 a/(1+系数·捕食者密度)——领域行为限制高密度下的过度捕食，
 * 是均质生境中捕食者-猎物持续共存的关键稳定机制（B6 公式本体不变，仅缩放输入）。
 */
const TERRITORIAL_INTERFERENCE = 0.5;
/** 植物缺省维持呼吸 1/day（content 未给时） */
const DEFAULT_MAINTENANCE_RESPIRATION = 0.01;
/** 动物能量密度缺省 kJ/kg 体重 */
const DEFAULT_ANIMAL_ENERGY_DENSITY = 7000;
/** 植物能量密度缺省 kJ/kgC */
const DEFAULT_PLANT_ENERGY_DENSITY = 17000;

// ───────────────── @non-frozen M3 实现常量（Q10，M8 可调） ─────────────────

/** 植物每 tick 种子分配比例（占生物量，B9 seed 模板的繁殖成本） */
const SEED_ALLOC_FRACTION = 0.02;
/** 种子到达后的定殖成功率（再乘目标生境适合度） */
const SEED_ESTABLISH_RATE = 0.5;
/** 动物最小定殖量 ind（低于且无居民种群 → 不定殖，避免僵尸种群；慢扩散者如狼也能逐步定殖） */
const MIN_ESTABLISH_IND = 0.01;
/** 植物最小定殖量 kgC */
const MIN_SEED_ESTABLISH_KGC = 0.01;
/** 食物适合度半饱和：草食者 kgC/cell，肉食者 prey ind/cell */
const FOOD_SAT_KGC = 500;
const PREY_SAT_IND = 50;
/** 迁徙者年龄结构（成年偏置，@non-frozen） */
const MIGRANT_AGE = { juvenile: 0.1, adult: 0.8, old: 0.1 };

// ───────────────── @non-frozen M5 实现常量（Q12，M8 可调） ─────────────────

/** 人类植物性食物比例（其余来自动物猎物） */
const HUMAN_PLANT_DIET_FRACTION = 0.7;
/** 人类每 tick 可收割植物生物量比例（农业） */
const HUMAN_AGRI_HARVEST_FRACTION = 0.1;
/** 人类每 tick 可猎取猎物比例（狩猎） */
const HUMAN_HUNT_FRACTION = 0.05;
/** 农业强度参考人口（ind/cell，达此值强度 1） */
const HUMAN_AGRI_REF_POP = 200;
/** 聚落 footprint 参考人口（ind/cell） */
const HUMAN_FOOTPRINT_REF_POP = 500;

// ───────────────── 流向缓存（契约 E4：不逐 tick 重算） ─────────────────

const flowCache = new WeakMap<Cell[], Int32Array>();

function flowFor(cells: Cell[]): Int32Array {
  let f = flowCache.get(cells);
  if (!f) {
    f = computeFlowDirection(cells);
    flowCache.set(cells, f);
  }
  return f;
}

// ───────────────── §9.2 步骤 2–4（M1） ─────────────────

/**
 * 步骤 2–4：太阳/季节/天气 → 温度/降水/水文 → 土壤/营养（E2–E6）。
 * E1 由 solarInput 独立提供（stepWorld 步骤 5 光合使用）。
 * flow 为 computeFlowDirection 缓存，由调用方持有。
 */
export function stepEnvironment(
  cells: Cell[],
  flow: Int32Array,
  day: number,
  rng: RandomStream,
  fungiActivityByCell?: Map<number, number>,
): Cell[] {
  const weather = rng.fork('core:climate:weather');
  const storm = rng.fork('core:climate:storm');

  // 步骤 2–3：E2 温度、E3 降水、湿度诊断
  const climateNext: Cell[] = cells.map((c) => {
    const t = temperature({
      latitude: c.latitude,
      elevation: c.elevation,
      landWaterFraction: c.landWaterFraction,
      day,
      weatherNoise: WEATHER_NOISE_SIGMA_C * weather.nextGaussian(),
    });
    const p = precipitation(
      {
        latitude: c.latitude,
        coastDistance: c.coastDistance,
        slope: c.slope,
        aspect: c.aspect,
        day,
      },
      stormNoiseFactor(storm.nextGaussian()),
    );
    // TODO(M6): t.truncated 时按契约 E2 边界记录事件（events.ts）
    return {
      ...c,
      temperature: t.value,
      precipitation: p,
      humidity: relativeHumidity(p, c.soilMoisture, c.landWaterFraction),
    };
  });

  // 步骤 3：E4 水文（流向缓存，水流向低处）
  const waterNext = stepHydrology(climateNext, flow);

  // 步骤 4：E5 土壤/营养 + E6 群系派生缓存
  const rules = loadBiomeRules();
  return waterNext.map((c, i) => {
    const n = stepNutrients({
      nutrients: c.nutrients,
      organicMatter: c.organicMatter,
      soilMoisture: c.soilMoisture,
      temperature: c.temperature,
      slope: c.slope,
      precipitation: c.precipitation,
      fungiActivity: fungiActivityByCell?.get(i) ?? 1, // M4：真菌加速分解（缺省基线 1）
    });
    const biome = classifyBiome(
      {
        temperature: c.temperature,
        precipitation: c.precipitation,
        seasonality: Math.abs(Math.sin(rad(c.latitude))),
        soilMoisture: c.soilMoisture,
        elevation: c.elevation,
        salinity: c.salinity,
        landWaterFraction: c.landWaterFraction,
        terrainType: c.terrainType,
        vegetationStructure: 0, // M2 植被结构仍未接线（M3+）
      },
      rules,
    );
    return { ...c, nutrients: n.nutrients, organicMatter: n.organicMatter, biome };
  });
}

// ───────────────── §9.2 全管线（M2 垂直切片） ─────────────────

const popKey = (p: PopulationState): string => `${p.speciesId}@${p.cellId.x},${p.cellId.y}`;

interface AnimalWork {
  intakePerInd: number; // kJ/(ind·day)
  reserveNext: number; // kJ/ind
  foodMod: number; // 0..1
  healthNext: number; // 0..1
}

/**
 * §14.7 冻结签名；§9.2 冻结更新顺序（12 步，顺序不可变）。
 * M2 实现：1–7、9、12；8/10/11 为显式占位（M4/M5/M6），位置保留。
 * 每 cell 每物种至多一个种群（M2 约定，seedPopulations 强制）。
 */
export function stepWorld(prev: WorldSnapshot, rng: RandomStream): WorldSnapshot {
  const species = loadSpeciesDefinitions();
  const pathogens = loadPathogenDefinitions();
  const edges = loadFoodwebEdges();

  // ── 步骤 1：读时间与随机种子（rng 由调用方注入；randomState 于步骤 12 提交） ──
  const timeNext = prev.time + WORLD.TICKS_PER_DAY;
  const day = timeNext % WORLD.DAYS_PER_YEAR;
  const seasonNext = day / WORLD.DAYS_PER_YEAR;
  let W = 0;
  for (const c of prev.cells) W = Math.max(W, c.id.x + 1);
  const idx = (x: number, y: number): number => y * W + x;

  // ── 步骤 2–4：太阳/季节/天气 → 温度/降水/水文 → 土壤/营养 ──
  const flow = flowFor(prev.cells);
  // M4：真菌活性（prev 分解者生物量 → E5 分解乘子，双缓冲滞后一拍）
  const fungiActivityByCell = new Map<number, number>();
  for (const p of prev.populations) {
    const d = species.get(p.speciesId);
    if (d?.simulationTier === 'field' && d.roles.decomposer >= 0.5) {
      fungiActivityByCell.set(idx(p.cellId.x, p.cellId.y), fungiActivityFromBiomass(p.biomass));
    }
  }
  const cells = stepEnvironment(prev.cells, flow, day, rng, fungiActivityByCell); // 全新中间对象，可安全写
  for (const c of cells) c.productivity = 0;

  const defOf = (p: PopulationState): SpeciesDefinition | undefined => species.get(p.speciesId);
  // M5：智人（taxonomy.genus==='Homo'）与动物分流——动物走 B4/B5/B6，人类走 H1/H2/H3（步骤 10）
  const isHuman = (d: SpeciesDefinition | undefined): boolean => d?.taxonomy?.genus === 'Homo';
  const plants = prev.populations.filter((p) => defOf(p)?.simulationTier === 'field');
  const populationPops = prev.populations.filter((p) => defOf(p)?.simulationTier === 'population');
  const animals = populationPops.filter((p) => !isHuman(defOf(p)));
  const humans = populationPops.filter((p) => isHuman(defOf(p)));
  const animalsByCell = new Map<number, PopulationState[]>();
  for (const p of populationPops) {
    const i = idx(p.cellId.x, p.cellId.y);
    const list = animalsByCell.get(i) ?? [];
    list.push(p);
    animalsByCell.set(i, list);
  }

  const nextPops: PopulationState[] = [];
  const herbIntakeKJ = new Map<string, number>(); // grazerKey -> kJ/day（种群总量）
  const consumedRecords: Array<{ preyKey: string; predatorKey: string; amount: number }> = [];

  // ── 步骤 5：植物与真菌（真菌 M4；B1–B3 + B3 herbivory 项 + B7 竞争） ──
  for (const p of plants) {
    const def = defOf(p);
    if (!def) { nextPops.push(p); continue; }
    const i = idx(p.cellId.x, p.cellId.y);
    const c = cells[i] as Cell;

    // M4：分解真菌（§15.4 saprotroph，非光合）——同化有机质建生物量，驱动 E5 分解
    if (def.roles.decomposer >= 0.5) {
      const f = stepFungus({
        biomass: p.biomass,
        organicMatter: c.organicMatter,
        temperature: c.temperature,
        soilMoisture: c.soilMoisture,
      });
      const maxB = def.physiology.maxBiomass ?? Infinity;
      c.organicMatter = f.organicMatter + f.deadC; // 死亡菌体回有机质
      nextPops.push({ ...p, count: 0, biomass: Math.min(f.biomass, maxB) });
      continue;
    }

    const solar = solarInput(c.latitude, day);
    const seasonFactor = clamp01((solar - 0.35) / 1.3); // @non-frozen：E1 → 0..1 物候
    const maxB = def.physiology.maxBiomass ?? 0;
    const gpp = grossPrimaryProduction({
      solar,
      temperature: c.temperature,
      soilMoisture: c.soilMoisture,
      nutrients: c.nutrients,
      pMax: def.physiology.pMax ?? 0,
      efficiency: def.roles.producer,
      seasonFactor,
      tempOptimum: def.physiology.tempOptimum,
      tempTolerance: def.physiology.tempTolerance,
      kWater: def.resources.kWater,
      kNutrient: def.resources.kNutrient,
    });
    const resp = respiration(
      gpp,
      p.biomass,
      def.physiology.maintenanceRespiration ?? DEFAULT_MAINTENANCE_RESPIRATION,
      def.physiology.growthRespiration,
    );

    // herbivory（B3 损失项）：按食物网边，采食者读 prev 数量（双缓冲）
    let herbLoss = 0;
    for (const e of edges) {
      if (e.prey !== p.speciesId || e.type !== 'herbivory') continue;
      const grazer = (animalsByCell.get(i) ?? []).find((q) => q.speciesId === e.predator);
      const gDef = grazer ? defOf(grazer) : undefined;
      if (!grazer || !gDef || grazer.count <= 0) continue;
      // B7：其他共享该植物的草食者按竞争系数折减有效资源
      const competitors = (animalsByCell.get(i) ?? [])
        .filter((q) => q.speciesId !== grazer.speciesId && q.count > 0 &&
          edges.some((e2) => e2.predator === q.speciesId && e2.prey === p.speciesId && e2.type === 'herbivory'))
        .map((q) => ({
          coefficient: gDef.interactions.competitionCoefficients[q.speciesId] ?? 0,
          density: q.count,
        }));
      const avail = effectiveResource(p.biomass, competitors);
      const plantEnergy = def.resources.energyDensity ?? DEFAULT_PLANT_ENERGY_DENSITY;
      const maxIntake = (gDef.resources.minimumDailyEnergy / plantEnergy) * INTAKE_CAP_FACTOR;
      const eaten = herbivory(avail, grazer.count, maxIntake, e.halfSaturationKgC ?? 300);
      herbLoss += eaten;
      const key = popKey(grazer);
      herbIntakeKJ.set(key, (herbIntakeKJ.get(key) ?? 0) + eaten * plantEnergy);
    }

    const drought = c.soilMoisture < WILT_POINT_MM
      ? p.biomass * DROUGHT_DAMAGE_RATE * (1 - c.soilMoisture / WILT_POINT_MM)
      : 0;
    const crowding = maxB > 0 && p.biomass > CROWDING_ONSET * maxB
      ? p.biomass * CROWDING_RATE * ((p.biomass / maxB - CROWDING_ONSET) / (1 - CROWDING_ONSET))
      : 0;
    const turnover = p.biomass * PLANT_TURNOVER_RATE;
    const losses = herbLoss + drought + crowding; // diseaseLoss/fireLoss：M4/M7 接线
    const biomassNext = plantGrowth(p.biomass, gpp, resp, losses, maxB);

    // 吸氮（E5 plantUptake，步骤 4 之后按双缓冲滞后 applied）与凋落物（步骤 6 路由）
    const uptake = Math.max(0, gpp - resp) * PLANT_N_UPTAKE_RATIO;
    c.nutrients = Math.max(0, c.nutrients - uptake);
    c.organicMatter += (drought + crowding + turnover) * DETRITUS_FRACTION
      + herbLoss * (1 - ASSIMILATION_HERB);
    c.productivity += gpp - resp; // 净初级生产力缓存 kgC/(cell·day)

    nextPops.push({ ...p, count: 0, biomass: biomassNext });
  }

  // ── 步骤 6：食物资源与分解 ──
  // 分解已在步骤 4（E5）执行；本步的凋落物/尸体路由在步骤 5/9 写入 organicMatter，
  // 于步骤 12 统一提交（双缓冲滞后一拍，M2 约定）。

  // ── 步骤 7：动物能量、捕食、竞争 ──
  // 7a 捕食量（B6，全部读 prev 数量）
  for (const p of animals) {
    const def = defOf(p);
    if (!def || p.count <= 0) continue;
    const i = idx(p.cellId.x, p.cellId.y);
    for (const e of edges) {
      if (e.predator !== p.speciesId || e.type !== 'carnivory') continue;
      const prey = (animalsByCell.get(i) ?? []).find((q) => q.speciesId === e.prey);
      const preyDef = prey ? defOf(prey) : undefined;
      if (!prey || !preyDef || prey.count <= 0) continue;
      const baseAttack = e.attackRate ?? BIOLOGY.ATTACK_RATE_DEFAULT;
      const attack = def.movement.pattern === 'territorial'
        ? baseAttack / (1 + TERRITORIAL_INTERFERENCE * p.count)
        : baseAttack;
      const amount = holling2(
        attack,
        e.handlingTime ?? BIOLOGY.HANDLING_TIME_DEFAULT,
        p.count,
        prey.count,
      ) * clamp01(e.preference ?? 1);
      if (amount > 0) consumedRecords.push({ preyKey: popKey(prey), predatorKey: popKey(p), amount });
    }
  }
  // 7b 共享猎物总量截断 ≤ 猎物数量（多捕食者按比例缩放）
  const consumedTotal = new Map<string, number>();
  for (const r of consumedRecords) {
    consumedTotal.set(r.preyKey, (consumedTotal.get(r.preyKey) ?? 0) + r.amount);
  }
  const preyPrevCount = new Map<string, number>();
  for (const p of animals) preyPrevCount.set(popKey(p), p.count);
  const consumedByPrey = new Map<string, number>();
  for (const r of consumedRecords) {
    const total = consumedTotal.get(r.preyKey) ?? 0;
    const cap = preyPrevCount.get(r.preyKey) ?? 0;
    const scaled = total > cap ? r.amount * (cap / total) : r.amount;
    consumedByPrey.set(r.preyKey, (consumedByPrey.get(r.preyKey) ?? 0) + scaled);
  }
  // 7c 能量收支（每头）：摄入 − 需求 → 储备；food/health 修正项
  const work = new Map<string, AnimalWork>();
  for (const p of animals) {
    const def = defOf(p);
    if (!def) continue;
    const key = popKey(p);
    const need = def.resources.minimumDailyEnergy;
    let intakeTotal = herbIntakeKJ.get(key) ?? 0;
    for (const r of consumedRecords) {
      if (r.predatorKey !== key) continue;
      const total = consumedTotal.get(r.preyKey) ?? 0;
      const cap = preyPrevCount.get(r.preyKey) ?? 0;
      const scaled = total > cap ? r.amount * (cap / total) : r.amount;
      const preyDef = species.get(r.preyKey.split('@')[0] as string);
      const energyPerInd = preyDef
        ? preyDef.physiology.bodyMass * (preyDef.resources.energyDensity ?? DEFAULT_ANIMAL_ENERGY_DENSITY)
        : 0;
      intakeTotal += scaled * energyPerInd * ASSIMILATION_CARN;
    }
    const intakePerInd = p.count > 0 ? intakeTotal / p.count : 0;
    const reserveDays = def.physiology.reserveMaxDays ?? RESERVE_MAX_DAYS;
    const reserveNext = clamp(
      p.energyReserve + intakePerInd - need,
      0,
      Math.max(0, need * reserveDays),
    );
    const foodMod = need > 0 ? clamp01(intakePerInd / need) : 1;
    work.set(key, {
      intakePerInd,
      reserveNext,
      foodMod,
      healthNext: clamp01(0.5 + 0.5 * foodMod),
    });
  }

  // ── 步骤 8：疾病与寄生网络（D1 SIR，M4；高密度更易传播） ──
  // 每动物种群每病原一步 SIR；密度因子=count/threshold（阈值即流行 tipping point），
  // 环境因子=湿度/温度×存活能力；传播邻域 contact=本地，air/water/vector/food=本地+六边形邻居贡献。
  // 疾病死亡（mortalityRate·I）于步骤 9 直接移除（与捕食移除一致，避免 B5 重复计死）。
  // 宿主跳转 hostJumpPotential 为 §8 稀有事件，归 M6 事件系统（Q11 注记）。
  const diseaseWork = new Map<string, { infState: Record<string, number>; recState: Record<string, number>; deathFraction: number }>();
  for (const p of populationPops) {
    const def = defOf(p);
    if (!def || p.count <= 0) continue;
    const key = popKey(p);
    const c = cells[idx(p.cellId.x, p.cellId.y)] as Cell;
    const infState: Record<string, number> = { ...(p.infectionState ?? {}) };
    const recState: Record<string, number> = { ...(p.recoveredState ?? {}) };
    let deathFraction = 0;
    for (const [pid, path] of pathogens) {
      if (!path.hostSpecies.includes(p.speciesId)) continue;
      const I = clamp01(infState[pid] ?? 0);
      const R = clamp01(recState[pid] ?? 0);
      const S = clamp01(1 - I - R);
      let exposure = I;
      if (path.transmissionMode !== 'contact') {
        for (const nb of c.neighbors) {
          const np = (animalsByCell.get(idx(nb.x, nb.y)) ?? []).find((q) => q.speciesId === p.speciesId);
          if (np) exposure += NEIGHBOR_EXPOSURE_WEIGHT * clamp01((np.infectionState ?? {})[pid] ?? 0);
        }
      }
      const sir = stepSIR({
        susceptible: S,
        infected: I,
        recovered: R,
        exposure,
        transmissionRate: path.transmissionRate,
        recoveryRate: path.recoveryRate,
        mortalityRate: path.mortalityRate,
        densityFactor: transmissionDensityFactor(p.count, path.densityThreshold),
        environmentalFactor: pathogenEnvironmentalFactor(c.humidity, c.temperature, path.environmentalPersistence),
      });
      infState[pid] = sir.infected;
      recState[pid] = sir.recovered;
      deathFraction += sir.deaths;
    }
    diseaseWork.set(key, { infState, recState, deathFraction: clamp01(deathFraction) });
  }

  // ── 步骤 9：繁殖、死亡、遗传、迁徙（遗传/迁徙 M3；B4+B5） ──
  const mortality = rng.fork('sim:scheduler:mortality');
  const plantBiomassNext = new Map<string, number>();
  for (const p of nextPops) {
    if (defOf(p)?.simulationTier === 'field') plantBiomassNext.set(popKey(p), p.biomass);
  }
  const animalBase = new Map<string, number>(); // 捕食移除后的基数
  for (const p of animals) {
    const key = popKey(p);
    animalBase.set(key, Math.max(0, p.count - (consumedByPrey.get(key) ?? 0)));
  }
  for (const p of animals) {
    const def = defOf(p);
    const key = popKey(p);
    const w = work.get(key);
    if (!def || !w) { nextPops.push(p); continue; }
    const i = idx(p.cellId.x, p.cellId.y);
    const c = cells[i] as Cell;
    // M4：疾病死亡（步骤 8 SIR mortalityRate·I）直接移除，与捕食移除一致
    const dw = diseaseWork.get(key);
    const deathFraction = dw?.deathFraction ?? 0;
    const afterPredation = animalBase.get(key) ?? 0;
    const diseaseDeaths = afterPredation * deathFraction;
    const base = afterPredation - diseaseDeaths;

    // 环境容纳量（派生缓存 @non-frozen：草食=植物能量窗口，肉食=猎物比例）
    let cc = 0;
    for (const foodId of def.resources.foodSources) {
      const foodDef = species.get(foodId);
      if (!foodDef) continue;
      if (foodDef.simulationTier === 'field') {
        const b = plantBiomassNext.get(`${foodId}@${p.cellId.x},${p.cellId.y}`) ?? 0;
        const energy = foodDef.resources.energyDensity ?? DEFAULT_PLANT_ENERGY_DENSITY;
        cc += (b * energy) / (Math.max(1, def.resources.minimumDailyEnergy) * CC_WINDOW_DAYS);
      } else {
        cc += (animalBase.get(`${foodId}@${p.cellId.x},${p.cellId.y}`) ?? 0) * PREDATOR_PREY_RATIO;
      }
    }

    const solar = solarInput(c.latitude, day);
    const seasonFactor = clamp01((solar - 0.35) / 1.3);
    const lh = def.lifeHistory;
    const offspringMean = (lh.offspringPerEvent.min + lh.offspringPerEvent.max) / 2;
    const reproductionRate =
      (offspringMean * lh.juvenileSurvival) / (Math.max(1e-6, lh.reproductiveIntervalYears) * WORLD.DAYS_PER_YEAR);
    const baselineMortality = 1 / (Math.max(1e-6, def.physiology.maximumAge) * WORLD.DAYS_PER_YEAR);
    const sigma = MICRO_MORTALITY_SIGMA;
    const randomMortality = Math.exp(sigma * mortality.nextGaussian() - (sigma * sigma) / 2);

    // M3：性状平移后的有效适生范围（遗传→存活耦合）；气候胁迫含温度+水分，硬致死带清除不适生种群
    const effEnv = effectiveEnvironment(def, p.traitMeans ?? {});
    const waterStress = rangeSuitability(c.soilMoisture, effEnv.water, WATER_SOFT_WIDTH_MM, WATER_HARD_MARGIN_MM);
    const climateMod = Math.max(
      climateStressModifier(c.temperature, effEnv.temperature),
      fitnessStressModifier(waterStress.suitability, waterStress.hardConstraint),
    );

    const r = stepPopulation({
      population: base,
      adults: base * p.ageStructure.adult,
      reproductionRate,
      baselineMortality,
      carryingCapacity: cc,
      energyReserve: w.reserveNext,
      health: w.healthNext,
      modifiers: {
        food: w.foodMod,
        healthMod: w.healthNext,
        mate: base / (base + MATE_ALLEE_K),
        seasonal: SEASONAL_BASE + (1 - SEASONAL_BASE) * seasonFactor,
        density: densityModifier(base, cc),
        starvation: starvationModifier(
          w.reserveNext,
          def.resources.minimumDailyEnergy,
          def.physiology.reserveMaxDays ?? RESERVE_MAX_DAYS,
        ),
        disease: 1, // 疾病死亡已在步骤 8/9 直接移除（避免重复计死）；非致死 morbidity 后续
        predation: 1, // 捕食移除已直接应用；非消费性恐惧效应后续里程碑
        climate: climateMod,
        randomMortality,
      },
    });

    // 年龄结构轻量动态（@non-frozen Q9）：出生入幼体，成熟/老化按生命史速率
    const maturation = 1 / (Math.max(1e-6, def.physiology.maturityAge) * WORLD.DAYS_PER_YEAR);
    const aging = 1 / (Math.max(1e-6, def.physiology.maximumAge - def.physiology.maturityAge) * WORLD.DAYS_PER_YEAR);
    const j0 = base * p.ageStructure.juvenile;
    const a0 = base * p.ageStructure.adult;
    const o0 = base * p.ageStructure.old;
    let j = Math.max(0, j0 - maturation * j0 - r.deaths * p.ageStructure.juvenile + r.births);
    let a = Math.max(0, a0 + maturation * j0 - aging * a0 - r.deaths * p.ageStructure.adult);
    let o = Math.max(0, o0 + aging * a0 - r.deaths * p.ageStructure.old);
    const sum = j + a + o;
    const ageStructure = sum > 0
      ? { juvenile: j / sum, adult: a / sum, old: o / sum }
      : { juvenile: 0.2, adult: 0.7, old: 0.1 };

    // 尸体/粪便 → 死亡有机质（步骤 6 路由，步骤 12 提交）；含疾病死亡（M4）
    const carcass = (r.deaths + diseaseDeaths) * def.physiology.bodyMass * CARBON_FRACTION
      + (consumedByPrey.get(key) ?? 0) * def.physiology.bodyMass * CARBON_FRACTION * (1 - ASSIMILATION_CARN);
    c.organicMatter += carcass * DETRITUS_FRACTION;

    if (r.population > 0) {
      nextPops.push({
        ...p,
        count: r.population,
        biomass: r.population * def.physiology.bodyMass * CARBON_FRACTION,
        ageStructure,
        energyReserve: w.reserveNext,
        health: w.healthNext,
        infectionState: dw?.infState ?? p.infectionState ?? {},
        recoveredState: dw?.recState ?? p.recoveredState ?? {},
      });
    }
    // r.population = 0 → 局部灭绝（再定殖靠下方 B9 迁徙）
  }

  // 规范化为全新对象（双缓冲：后续遗传/扩散原地写不触及 prev 共享引用）
  let finalPops: PopulationState[] = nextPops.map((p) => ({ ...p }));

  // ── 步骤 9（续）：遗传（§9.2 顺序在迁徙之前；§9.1 decade/century 尺度） ──
  // Lande 方程 Δmean = h²σ²β（β 为性状→生境适合度的数值选择梯度）+ 突变微扰。
  const geneticsRng = rng.fork('core:biology:genetics');
  for (const p of finalPops) {
    const def = defOf(p);
    if (!def) continue;
    const traits = def.genetics?.heritableTraits ?? [];
    if (traits.length === 0) continue;
    const c = cells[idx(p.cellId.x, p.cellId.y)] as Cell;
    const means = { ...p.traitMeans };
    const variances = { ...p.traitVariance };
    const generationDays = Math.max(1, def.lifeHistory.reproductiveIntervalYears * WORLD.DAYS_PER_YEAR);
    for (const trait of traits) {
      let delta = 0;
      if (TRAIT_RANGE_MAP[trait]) {
        const eps = 0.5;
        const plus = { ...means, [trait]: (means[trait] ?? 0) + eps };
        const minus = { ...means, [trait]: (means[trait] ?? 0) - eps };
        const gradient =
          (habitatFitness(def, c.temperature, c.soilMoisture, plus) -
            habitatFitness(def, c.temperature, c.soilMoisture, minus)) / (2 * eps);
        delta = traitSelectionDelta(gradient, variances[trait] ?? 1, generationDays);
      }
      const mutation = traitMutationDelta(geneticsRng.nextGaussian(), def.genetics.mutationRate, generationDays);
      means[trait] = clamp((means[trait] ?? 0) + delta + mutation, -TRAIT_MEAN_BOUND, TRAIT_MEAN_BOUND);
      variances[trait] = variances[trait] ?? 1;
    }
    p.traitMeans = means;
    p.traitVariance = variances;
  }

  // ── 步骤 9（续）：迁徙/扩散（B9；两阶段：先按繁殖后状态算全部流量，再统一应用） ──
  const dispersalRng = rng.fork('core:biology:dispersal');
  const popAt = new Map<string, PopulationState>();
  for (const p of finalPops) popAt.set(popKey(p), p);
  const cellXY = (i: number): [number, number] => [i % W, Math.floor(i / W)];
  const foodSuitAt = (def: SpeciesDefinition, i: number): number => {
    if (def.simulationTier === 'field') return 1;
    const [x, y] = cellXY(i);
    let sat = 0;
    for (const foodId of def.resources.foodSources) {
      const fd = species.get(foodId);
      if (!fd) continue;
      const q = popAt.get(`${foodId}@${x},${y}`);
      if (fd.simulationTier === 'field') sat = Math.max(sat, clamp01((q?.biomass ?? 0) / FOOD_SAT_KGC));
      else sat = Math.max(sat, clamp01((q?.count ?? 0) / PREY_SAT_IND));
    }
    return sat;
  };
  interface Transfer {
    speciesId: string;
    toKey: string;
    toIdx: number;
    amount: number;
    reserve: number;
    health: number;
    means: Record<string, number>;
    variances: Record<string, number>;
    isPlant: boolean;
  }
  const transfers: Transfer[] = [];
  const outflow = new Map<string, number>();
  for (const p of finalPops) {
    const def = defOf(p);
    if (!def) continue;
    const isPlant = def.simulationTier === 'field';
    const standing = isPlant ? p.biomass : p.count;
    if (standing <= 0) continue;
    const i = idx(p.cellId.x, p.cellId.y);
    const c = cells[i] as Cell;
    const habI = habitatFitness(def, c.temperature, c.soilMoisture, p.traitMeans);
    // B8 全适合度（环境×食物×氧气；疾病/竞争/捕食修正 M4+ 接线）驱动迁移压力
    const fullI = isPlant ? habI : multiplicativeFitness(habI, [foodSuitAt(def, i), clamp01(c.oxygen)]);
    const cc = c.carryingCapacity[p.speciesId] ?? 0;
    const pressure = movementPressure(standing, cc, fullI);
    const capacity = migrationCapacity(def.movement.speedKmPerDay);
    const sourcePool = isPlant ? p.biomass * SEED_ALLOC_FRACTION : p.count;
    const raw: Array<{ j: number; x: number; y: number; flow: number; habJ: number }> = [];
    for (const nb of c.neighbors) {
      const j = idx(nb.x, nb.y);
      const cj = cells[j] as Cell;
      const access = targetAccessibility(def.movement.dispersalMethod, cj);
      if (access <= 0) continue; // 冻结边界：目标 accessibility 必须 > 0（步行/种子不跨海）
      const target = popAt.get(`${p.speciesId}@${nb.x},${nb.y}`);
      const isOccupied = target ? (isPlant ? target.biomass > 0 : target.count > 0) : false;
      const habJ = habitatFitness(def, cj.temperature, cj.soilMoisture, p.traitMeans);
      const grad = suitabilityGradient(habI, habJ, isOccupied);
      if (grad <= 0) continue;
      const rf = dispersalRandomFactor(dispersalRng.nextGaussian());
      const flow = dispersalFlow(sourcePool, pressure, grad, access, capacity, rf);
      if (flow > 1e-12) raw.push({ j, x: nb.x, y: nb.y, flow, habJ });
    }
    const total = raw.reduce((s, r) => s + r.flow, 0);
    const cap = sourcePool * MAX_EMIGRATION_FRACTION;
    const scale = total > cap && total > 0 ? cap / total : 1;
    for (const r of raw) {
      const flow = r.flow * scale;
      let settled = establishment(flow, r.habJ);
      if (isPlant) settled *= SEED_ESTABLISH_RATE;
      const target = popAt.get(`${p.speciesId}@${r.x},${r.y}`);
      const minUnit = isPlant ? MIN_SEED_ESTABLISH_KGC : MIN_ESTABLISH_IND;
      outflow.set(popKey(p), (outflow.get(popKey(p)) ?? 0) + flow);
      if (!target && settled < minUnit) {
        // 低于定殖阈值且无居民种群：全部损失为碎屑（避免僵尸种群）
        const deadKgC = isPlant ? flow : flow * def.physiology.bodyMass * CARBON_FRACTION;
        (cells[r.j] as Cell).organicMatter += deadKgC * DETRITUS_FRACTION;
        continue;
      }
      const failed = flow - settled; // 定殖失败 = 迁徙死亡（成本，§18.1）
      if (failed > 0) {
        const deadKgC = isPlant ? failed : failed * def.physiology.bodyMass * CARBON_FRACTION;
        (cells[r.j] as Cell).organicMatter += deadKgC * DETRITUS_FRACTION;
      }
      transfers.push({
        speciesId: p.speciesId,
        toKey: `${p.speciesId}@${r.x},${r.y}`,
        toIdx: r.j,
        amount: settled,
        reserve: Math.max(0, p.energyReserve - migrationCost(def.physiology.bodyMass)),
        health: p.health,
        means: { ...p.traitMeans },
        variances: { ...p.traitVariance },
        isPlant,
      });
    }
  }
  // 应用：源种群扣减外迁
  for (const p of finalPops) {
    const out = outflow.get(popKey(p)) ?? 0;
    if (out <= 0) continue;
    const def = defOf(p);
    if (def?.simulationTier === 'field') {
      p.biomass = Math.max(0, p.biomass - out);
    } else {
      p.count = Math.max(0, p.count - out);
      p.biomass = p.count * (def?.physiology.bodyMass ?? 0) * CARBON_FRACTION;
    }
  }
  // 应用：目标合并/新建（基因流按数量加权混合）
  for (const t of transfers) {
    const def = species.get(t.speciesId);
    if (!def) continue;
    const existing = popAt.get(t.toKey);
    if (existing) {
      if (t.isPlant) {
        existing.biomass += t.amount;
      } else {
        const n0 = existing.count;
        const n1 = t.amount;
        const n = n0 + n1;
        if (n > 0) {
          existing.energyReserve = (existing.energyReserve * n0 + t.reserve * n1) / n;
          existing.health = (existing.health * n0 + t.health * n1) / n;
          existing.ageStructure = {
            juvenile: (existing.ageStructure.juvenile * n0 + MIGRANT_AGE.juvenile * n1) / n,
            adult: (existing.ageStructure.adult * n0 + MIGRANT_AGE.adult * n1) / n,
            old: (existing.ageStructure.old * n0 + MIGRANT_AGE.old * n1) / n,
          };
          const mixed = { ...existing.traitMeans };
          for (const trait of Object.keys(t.means)) {
            mixed[trait] = ((existing.traitMeans[trait] ?? 0) * n0 + (t.means[trait] ?? 0) * n1) / n;
          }
          existing.traitMeans = mixed;
        }
        existing.count = n;
        existing.biomass = n * def.physiology.bodyMass * CARBON_FRACTION;
      }
    } else {
      const [x, y] = cellXY(t.toIdx);
      const created: PopulationState = {
        speciesId: t.speciesId,
        cellId: { x, y },
        count: t.isPlant ? 0 : t.amount,
        biomass: t.isPlant ? t.amount : t.amount * def.physiology.bodyMass * CARBON_FRACTION,
        ageStructure: t.isPlant ? { juvenile: 0.2, adult: 0.7, old: 0.1 } : { ...MIGRANT_AGE },
        energyReserve: t.isPlant ? 0 : t.reserve,
        health: t.health,
        infectionState: {},
        traitMeans: { ...t.means },
        traitVariance: { ...t.variances },
      };
      finalPops.push(created);
      popAt.set(t.toKey, created);
    }
  }
  // 局部灭绝清理（动物 count ≤ 0 移除；植物保留 0 生物量作再生基础，M2 约定）
  finalPops = finalPops.filter((p) => defOf(p)?.simulationTier === 'field' || p.count > 0);

  // ── 步骤 10：人类聚落与土地利用（H1/H2/H3，M5） ──
  // 食物获取（农业收割植物 + 狩猎猎物）→ H1 需求/食物修饰 → H2 增长（疾病死亡先移除）→ H3 土地利用反馈。
  // 人类定居（M5 不扩散）；文化修饰暂 1（技术成本 v1 §6.5 归 M6+，Q12）。
  const plantBiomassByCell = new Map<number, number>();
  const preyCountByCell = new Map<number, number>();
  for (const p of finalPops) {
    const d = defOf(p);
    const i = idx(p.cellId.x, p.cellId.y);
    if (d?.simulationTier === 'field' && d.roles.decomposer < 0.5) {
      plantBiomassByCell.set(i, (plantBiomassByCell.get(i) ?? 0) + p.biomass);
    } else if (d?.simulationTier === 'population' && !isHuman(d)) {
      preyCountByCell.set(i, (preyCountByCell.get(i) ?? 0) + p.count);
    }
  }
  for (const p of humans) {
    const def = defOf(p);
    if (!def || p.count <= 0) continue;
    const key = popKey(p);
    const i = idx(p.cellId.x, p.cellId.y);
    const c = cells[i] as Cell;
    const dw = diseaseWork.get(key);
    const deathFraction = dw?.deathFraction ?? 0;
    const infState = dw?.infState ?? p.infectionState ?? {};
    const infected = clamp01(Object.values(infState).reduce((s, v) => s + v, 0));

    // H1 食物需求与获取（农业 + 狩猎）
    const need = foodNeed(p.count, def.resources.minimumDailyEnergy);
    const plantE = DEFAULT_PLANT_ENERGY_DENSITY;
    const preyE = 1.5 * DEFAULT_ANIMAL_ENERGY_DENSITY; // 猎物平均体重近似（@non-frozen Q12）
    const availPlant = plantBiomassByCell.get(i) ?? 0;
    const availPrey = preyCountByCell.get(i) ?? 0;
    const plantHarvest = Math.min(availPlant * HUMAN_AGRI_HARVEST_FRACTION, (need * HUMAN_PLANT_DIET_FRACTION) / plantE);
    const preyHarvest = Math.min(availPrey * HUMAN_HUNT_FRACTION, (need * (1 - HUMAN_PLANT_DIET_FRACTION)) / preyE);
    const intake = plantHarvest * plantE + preyHarvest * preyE;
    const foodMod = humanFoodModifier(intake, need);

    // H3 土地利用强度与效应
    const lu = landUseImpact({
      agricultureIntensity: clamp01(p.count / HUMAN_AGRI_REF_POP),
      grazingIntensity: 0,
      settlementFootprint: clamp01(p.count / HUMAN_FOOTPRINT_REF_POP),
    });
    c.diseasePressure = clamp01(c.diseasePressure + lu.diseasePressureDelta);
    c.pollution = clamp01(c.pollution + lu.pollutionDelta);
    c.soilMoisture = Math.max(0, c.soilMoisture + lu.soilMoistureDelta);
    c.nutrients = Math.max(0, c.nutrients - lu.erosionNutrientLoss);

    // 收割/狩猎 + H3  clearing：从 finalPops 按比例扣减植物生物量与猎物数量
    const plantRemove = plantHarvest + availPlant * lu.plantBiomassLossFraction;
    for (const q of finalPops) {
      const qd = defOf(q);
      if (idx(q.cellId.x, q.cellId.y) !== i) continue;
      if (qd?.simulationTier === 'field' && qd.roles.decomposer < 0.5 && availPlant > 0) {
        q.biomass = Math.max(0, q.biomass - plantRemove * (q.biomass / availPlant));
      } else if (qd?.simulationTier === 'population' && !isHuman(qd) && availPrey > 0) {
        q.count = Math.max(0, q.count - preyHarvest * (q.count / availPrey));
        q.biomass = q.count * (qd?.physiology.bodyMass ?? 0) * CARBON_FRACTION;
      }
    }

    // H2 聚落增长（疾病死亡先移除，与动物一致）
    const base = p.count * (1 - deathFraction);
    const diseaseDeaths = p.count * deathFraction;
    const lh = def.lifeHistory;
    const fertility =
      (((lh.offspringPerEvent.min + lh.offspringPerEvent.max) / 2) * lh.juvenileSurvival) /
      (Math.max(1e-6, lh.reproductiveIntervalYears) * WORLD.DAYS_PER_YEAR);
    const baselineMortality = 1 / (Math.max(1e-6, def.physiology.maximumAge) * WORLD.DAYS_PER_YEAR);
    const sg = settlementGrowth({
      population: base,
      adults: base * p.ageStructure.adult,
      fertility,
      foodModifier: foodMod,
      healthModifier: clamp01(1 - infected),
      culturalModifier: 1,
      baselineMortality,
    });

    // 年龄结构轻量更新（与动物一致）
    const maturation = 1 / (Math.max(1e-6, def.physiology.maturityAge) * WORLD.DAYS_PER_YEAR);
    const aging = 1 / (Math.max(1e-6, def.physiology.maximumAge - def.physiology.maturityAge) * WORLD.DAYS_PER_YEAR);
    const j0 = base * p.ageStructure.juvenile;
    const a0 = base * p.ageStructure.adult;
    const o0 = base * p.ageStructure.old;
    const j = Math.max(0, j0 - maturation * j0 - sg.deaths * p.ageStructure.juvenile + sg.births);
    const a = Math.max(0, a0 + maturation * j0 - aging * a0 - sg.deaths * p.ageStructure.adult);
    const o = Math.max(0, o0 + aging * a0 - sg.deaths * p.ageStructure.old);
    const sum = j + a + o;
    const ageStructure = sum > 0 ? { juvenile: j / sum, adult: a / sum, old: o / sum } : { juvenile: 0.2, adult: 0.7, old: 0.1 };

    // 尸体 → 有机质
    c.organicMatter += (diseaseDeaths + sg.deaths) * def.physiology.bodyMass * CARBON_FRACTION * DETRITUS_FRACTION;

    if (sg.population > 0) {
      finalPops.push({
        ...p,
        count: sg.population,
        biomass: sg.population * def.physiology.bodyMass * CARBON_FRACTION,
        ageStructure,
        infectionState: infState,
        recoveredState: dw?.recState ?? p.recoveredState ?? {},
      });
    }
  }

  // ── 步骤 11：生成事件与因果记录（M6 占位，位置保留） ──
  // TODO(M6): 截断/饥饿/灭绝/捕食崩溃/疾病爆发/聚落兴衰等事件与因果链（events.ts）

  // ── 步骤 12：统计、缓存、前端快照（按遗传/扩散后的最终状态重算） ──
  const plantBiomassFinal = new Map<string, number>();
  const animalCountFinal = new Map<string, number>();
  for (const p of finalPops) {
    if (defOf(p)?.simulationTier === 'field') plantBiomassFinal.set(popKey(p), p.biomass);
    else animalCountFinal.set(popKey(p), p.count);
  }
  for (const c of cells) c.carryingCapacity = {};
  for (const p of finalPops) {
    const def = defOf(p);
    if (!def) continue;
    const c = cells[idx(p.cellId.x, p.cellId.y)] as Cell;
    if (def.simulationTier === 'field') {
      c.carryingCapacity[p.speciesId] = def.physiology.maxBiomass ?? 0;
      continue;
    }
    let cc = 0;
    for (const foodId of def.resources.foodSources) {
      const foodDef = species.get(foodId);
      if (!foodDef) continue;
      if (foodDef.simulationTier === 'field') {
        const b = plantBiomassFinal.get(`${foodId}@${p.cellId.x},${p.cellId.y}`) ?? 0;
        const energy = foodDef.resources.energyDensity ?? DEFAULT_PLANT_ENERGY_DENSITY;
        cc += (b * energy) / (Math.max(1, def.resources.minimumDailyEnergy) * CC_WINDOW_DAYS);
      } else {
        cc += (animalCountFinal.get(`${foodId}@${p.cellId.x},${p.cellId.y}`) ?? 0) * PREDATOR_PREY_RATIO;
      }
    }
    c.carryingCapacity[p.speciesId] = cc;
  }
  // 地形静态（M2）：流向不变，缓存传递给下一快照（地形编辑接线时须失效，M7+）
  flowCache.set(cells, flow);

  return createWorldSnapshot({
    time: timeNext,
    season: seasonNext,
    cells,
    populations: finalPops,
    agents: prev.agents,
    interactions: prev.interactions,
    events: prev.events,
    randomState: rng.serialize(),
  });
}
