/**
 * 适合度（契约 §14.5 冻结签名与实现，公式 B8；里程碑 M3 扩展 helper）。
 *
 * B8: fitness = baseFitness · temperatureSuitability · moistureSuitability
 *             · foodSuitability · oxygenSuitability · diseaseModifier
 *             · competitionModifier · predationModifier · randomnessModifier
 * 每个 suitability 由物种 EnvironmentPreference 的 Range 与当前环境值经
 * 宽容函数映射到 0..1；硬致死条件 fitness = 0 且带 hard_constraint 标记（冻结要求）。
 *
 * @non-frozen（Q10，契约未冻结宽容函数形状/硬耐受范围）：
 *  - 软耐受：范围内 1，范围外按距离线性衰减（softWidth 宽度内降到 0）；
 *  - 硬致死：超出 preferred ± hardMargin → suitability 0 + hardConstraint 标记；
 *  - 硬耐受范围由 preferred + 固定边际导出（温度 15°C / 水分 100mm）；
 *  - 性状→适生范围平移映射（TRAIT_RANGE_MAP）：coldTolerance 等耐受性状
 *    每 +1 单位把对应边界外扩 1 单位（°C 或 mm），遗传演化的选择靶点。
 */
import type { Range, SpeciesDefinition } from '../types.js';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** B8: 乘法适合度；suitabilities 为 0..1 数组（冻结实现） */
export function fitness(base: number, suitabilities: number[]): number {
  return suitabilities.reduce((acc, s) => acc * clamp01(s), base);
}

/** @non-frozen（Q10）：温度软耐受宽度 °C */
export const TEMP_SOFT_WIDTH_C = 10;
/** @non-frozen（Q10）：温度硬致死边际 °C（超出 preferred±margin → hard_constraint） */
export const TEMP_HARD_MARGIN_C = 15;
/** @non-frozen（Q10）：水分软耐受宽度 mm */
export const WATER_SOFT_WIDTH_MM = 50;
/** @non-frozen（Q10）：水分硬致死边际 mm */
export const WATER_HARD_MARGIN_MM = 100;
/** @non-frozen（Q10）：硬致死条件下的死亡乘子（B5 climate 修正项，快速清除不适生种群） */
export const HARD_LETHAL_MULT = 200;
/** @non-frozen（Q9/M2）：软胁迫死亡乘子系数 */
export const CLIMATE_STRESS_K = 5;

export interface SuitabilityResult {
  suitability: number; // 0..1
  hardConstraint: boolean; // 契约 B8：硬致死标记（hard_constraint）
}

/**
 * 宽容函数（@non-frozen Q10）：preferred 内 → 1；外距 d 按高斯衰减
 * exp(−(d/softWidth)²)（尾部梯度非零 → 边际生境中自然选择仍可作用）；
 * d ≥ hardMargin → 0 且 hardConstraint = true（契约 B8 硬致死标记）。
 */
export function rangeSuitability(
  value: number,
  preferred: Range,
  softWidth: number,
  hardMargin: number,
): SuitabilityResult {
  const d = value < preferred.min ? preferred.min - value : value > preferred.max ? value - preferred.max : 0;
  if (d >= hardMargin) return { suitability: 0, hardConstraint: true };
  return { suitability: clamp01(Math.exp(-((d / Math.max(1e-6, softWidth)) ** 2))), hardConstraint: false };
}

/** B5 气候/环境胁迫死亡乘子：硬致死 → HARD_LETHAL_MULT；否则 1 + K·(1−suitability) */
export function fitnessStressModifier(suitability: number, hardConstraint: boolean): number {
  if (hardConstraint) return HARD_LETHAL_MULT;
  return 1 + CLIMATE_STRESS_K * (1 - clamp01(suitability));
}

/**
 * 性状 → 适生范围平移映射（@non-frozen Q10）：
 * 耐受性状均值每 +1，对应环境边界外扩 1 单位（°C / mm）。
 * 未列出的性状（bodyMass/litterSize/packSize 等）M3 为中性（仅突变漂变）。
 */
export const TRAIT_RANGE_MAP: Record<string, { quantity: 'temperature' | 'water'; bound: 'min' | 'max'; sign: 1 | -1 }> = {
  coldTolerance: { quantity: 'temperature', bound: 'min', sign: -1 },
  heatTolerance: { quantity: 'temperature', bound: 'max', sign: 1 },
  droughtTolerance: { quantity: 'water', bound: 'min', sign: -1 },
  waterloggingTolerance: { quantity: 'water', bound: 'max', sign: 1 },
};

/** @non-frozen（Q10）：性状均值 bounds（防 runaway，°C/mm 量级） */
export const TRAIT_MEAN_BOUND = 30;

/** 按性状均值平移后的有效适生范围（遗传→适合度耦合） */
export function effectiveEnvironment(
  def: SpeciesDefinition,
  traitMeans: Record<string, number>,
): { temperature: Range; water: Range } {
  const temperature: Range = { ...def.environment.temperature };
  const water: Range = { ...def.environment.water };
  for (const [trait, map] of Object.entries(TRAIT_RANGE_MAP)) {
    const m = traitMeans[trait] ?? 0;
    if (m === 0) continue;
    const target = map.quantity === 'temperature' ? temperature : water;
    target[map.bound] += map.sign * m;
  }
  return { temperature, water };
}

/**
 * 生境适合度（B8 环境部分：温度×水分，性状平移后）——
 * 用于 B9 适合度梯度/定殖过滤与遗传选择梯度。食物/氧气等由调用方另行乘合。
 */
export function habitatFitness(
  def: SpeciesDefinition,
  temperature: number,
  soilMoisture: number,
  traitMeans: Record<string, number> = {},
): number {
  const env = effectiveEnvironment(def, traitMeans);
  const t = rangeSuitability(temperature, env.temperature, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C);
  const w = rangeSuitability(soilMoisture, env.water, WATER_SOFT_WIDTH_MM, WATER_HARD_MARGIN_MM);
  return fitness(1, [t.suitability, w.suitability]);
}
