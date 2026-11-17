/**
 * E5 土壤与营养——契约 §4 E5（公式结构与边界冻结）。
 *
 * nutrients_next = nutrients
 *                + decomposition(organicMatter, fungiActivity)
 *                + fixation
 *                − plantUptake
 *                − leaching(soilMoisture)
 *                − erosion(slope, precipitation)
 * 边界（冻结）：nutrients ∈ [0, MAX_NUTRIENTS]。
 *
 * @non-frozen M1 实现细节（子函数算法契约未冻结，M8 可调）：
 *  - decomposition：DECOMP_RATE·organicMatter·tempFactor·moistureFactor·
 *    fungiActivity 为分解的碳量 kgC/day，按 C_N_RATIO 矿化为 kgN/day，
 *    同时扣减 organicMatter（质量一致）；tempFactor = clamp01(T/25)，
 *    moistureFactor = clamp01(soilMoisture/100)；
 *  - fixation = FIXATION_RATE_KGN_DAY（抽象大气沉降/生物固氮）；
 *  - plantUptake 默认 0（M2 植物接线；调用方须保证 ≤ 可用氮库）；
 *    fungiActivity 默认 1（M4 真菌接线）；
 *  - leaching：超出土壤持水（100 mm）驱动的比例淋失；
 *  - erosion：slope · precipitation 驱动的比例侵蚀。
 */
import { CLIMATE, SOIL } from '../constants.js';

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** @non-frozen：有机质日分解率（最优条件下） */
export const DECOMP_RATE_PER_DAY = 0.02;
/** @non-frozen：有机质 C:N 矿化比（kgC/kgN） */
export const C_N_RATIO = 25;
/** @non-frozen：固氮/沉降 kgN/(cell·day) */
export const FIXATION_RATE_KGN_DAY = 0.1;
/** @non-frozen：淋失比例系数 1/day */
export const LEACH_RATE_PER_DAY = 0.01;
/** @non-frozen：侵蚀比例系数 1/day */
export const EROSION_RATE_PER_DAY = 0.05;

export interface NutrientInput {
  nutrients: number; // kgN/cell
  organicMatter: number; // kgC/cell
  soilMoisture: number; // mm
  temperature: number; // °C
  slope: number; // 0..1
  precipitation: number; // mm/day
  fungiActivity?: number; // ≥0，默认 1（M4 真菌接线）
  plantUptake?: number; // kgN/day，默认 0（M2 植物接线）
}

export interface NutrientResult {
  nutrients: number; // kgN/cell（已截断 [0, MAX_NUTRIENTS]）
  organicMatter: number; // kgC/cell（分解扣减后）
  decomposition: number; // kgN/day（矿化通量，供 §8.4 因果记录）
  fixation: number; // kgN/day
  plantUptake: number; // kgN/day
  leaching: number; // kgN/day
  erosion: number; // kgN/day
}

/** E5: 单 cell 营养更新（纯函数） */
export function stepNutrients(input: NutrientInput): NutrientResult {
  const tempFactor = clamp01(input.temperature / 25);
  const moistureFactor = clamp01(input.soilMoisture / 100);
  const fungi = Math.max(0, input.fungiActivity ?? 1);
  const decomposedC = Math.min(
    Math.max(0, input.organicMatter),
    DECOMP_RATE_PER_DAY *
      Math.max(0, input.organicMatter) *
      tempFactor *
      moistureFactor *
      fungi,
  );
  const decomposition = decomposedC / C_N_RATIO;
  const fixation = FIXATION_RATE_KGN_DAY;
  const plantUptake = Math.max(0, input.plantUptake ?? 0);
  const leaching =
    LEACH_RATE_PER_DAY *
    Math.max(0, input.nutrients) *
    clamp01((input.soilMoisture - 100) / 100);
  const erosion =
    EROSION_RATE_PER_DAY *
    Math.max(0, input.nutrients) *
    clamp01(input.slope) *
    clamp01(input.precipitation / CLIMATE.MAX_PRECIP_MM_DAY);
  const nutrients = clamp(
    input.nutrients + decomposition + fixation - plantUptake - leaching - erosion,
    0,
    SOIL.MAX_NUTRIENTS,
  );
  const organicMatter = Math.max(0, input.organicMatter - decomposedC);
  return {
    nutrients,
    organicMatter,
    decomposition,
    fixation,
    plantUptake,
    leaching,
    erosion,
  };
}

// ───────────────────────── 分解真菌（M4，§15.4） ─────────────────────────

/** @non-frozen（Q11）：真菌最大生长率 1/day（最优温湿+有机质饱和） */
export const FUNGUS_GROWTH_RATE = 0.1;
/** @non-frozen（Q11）：真菌维持呼吸 1/day */
export const FUNGUS_MAINTENANCE = 0.02;
/** @non-frozen（Q11）：真菌死亡率 1/day */
export const FUNGUS_MORTALITY = 0.01;
/** @non-frozen（Q11）：有机质半饱和 kgC/cell */
export const FUNGUS_OM_HALF_SAT = 200;
/** @non-frozen（Q11）：同化产率 kgC 真菌/kgC 有机质 */
export const FUNGUS_YIELD = 0.5;
/** @non-frozen（Q11）：真菌活性参考生物量 kgC（活性 = 1 + biomass/参考） */
export const FUNGUS_REF_BIOMASS = 100;
/** @non-frozen（Q11）：真菌活性上限（E5 分解乘子） */
export const FUNGUS_MAX_ACTIVITY = 5;

/** 真菌生物量 → E5 fungiActivity（无真菌基线 1，有真菌加速分解，上限 FUNGUS_MAX_ACTIVITY） */
export function fungiActivityFromBiomass(biomass: number): number {
  return clamp(1 + Math.max(0, biomass) / FUNGUS_REF_BIOMASS, 1, FUNGUS_MAX_ACTIVITY);
}

export interface FungusInput {
  biomass: number; // kgC/cell 菌落生物量
  organicMatter: number; // kgC/cell 死亡有机质（底物）
  temperature: number; // °C
  soilMoisture: number; // mm
}

export interface FungusResult {
  biomass: number; // kgC/cell 更新后
  organicMatter: number; // kgC/cell 同化扣减后
  assimilatedC: number; // kgC/day 同化有机质
  respiredC: number; // kgC/day 呼吸损失（CO2）
  deadC: number; // kgC/day 死亡菌体（→ 有机质）
}

/**
 * 分解真菌一步更新（@non-frozen Q11， saprotroph）：
 * 生长 ∝ 生物量×温湿适宜度×有机质饱和；同化有机质建生物量（产率 YIELD）；
 * 维持呼吸+死亡消耗生物量；死亡菌体回有机质。湿度高+有机质多+温度适宜 → 分解快（§15.4）。
 */
export function stepFungus(input: FungusInput): FungusResult {
  const tempF = clamp01(input.temperature / 25);
  const moistF = clamp01(input.soilMoisture / 100);
  const suit = tempF * moistF;
  const om = Math.max(0, input.organicMatter);
  const b = Math.max(0, input.biomass);
  const growth = FUNGUS_GROWTH_RATE * b * suit * (om / (om + FUNGUS_OM_HALF_SAT));
  const assimilatedC = Math.min(om, growth / FUNGUS_YIELD);
  const growthActual = assimilatedC * FUNGUS_YIELD;
  const respiredC = FUNGUS_MAINTENANCE * b;
  const deadC = FUNGUS_MORTALITY * b;
  const biomass = Math.max(0, b + growthActual - respiredC - deadC);
  return {
    biomass,
    organicMatter: Math.max(0, om - assimilatedC),
    assimilatedC,
    respiredC,
    deadC,
  };
}
