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
