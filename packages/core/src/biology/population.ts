/**
 * 种群更新（契约 §14.3 冻结签名；公式 B4–B5，里程碑 M2）。
 *
 * B4: births = adults · reproductionRate · food · healthMod · mate · seasonal · density
 *     densityModifier = 1/(1 + DENSITY_KNEE·(count/carryingCapacity))（冻结）
 *     边界（冻结）：births ∈ [0, adults·reproductionRate]
 * B5: deaths = population · baselineMortality · starvation · disease · predation
 *              · climate · randomMortality
 *     starvationModifier：能量储备低于 STARVATION_FLOOR 时指数上升（§14 注）
 * 边界：population_next ≥ 0；deaths ≤ population。
 *
 * modifiers 为「已算好的乘法修正项」（契约 §14.3 注）：本函数只做乘合与截断，
 * 各修正项的推导公式由下方导出 helper 提供（调度器/测试调用）。
 * Q9（@non-frozen）：B5 的 randomMortality 不在冻结 modifiers 字段中，
 * 以可选字段扩展（缺省 1 中性）；energyReserve/health 为因果记录携带量，
 * 修正项以 modifiers 为准（由 helper 从它们推导）。待契约 v2.2 冻结。
 */
import { BIOLOGY } from '../constants.js';
import type { Range } from '../types.js';
import {
  fitnessStressModifier,
  rangeSuitability,
  TEMP_HARD_MARGIN_C,
  TEMP_SOFT_WIDTH_C,
} from './fitness.js';

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** @non-frozen（Q9，M8 可调）：能量储备满额天数（reserveMax = dailyNeed × 天数） */
export const RESERVE_MAX_DAYS = 15;
/** @non-frozen（Q9）：动物体重（kg 湿重）→ 生物量（kgC）换算比例 */
export const CARBON_FRACTION = 0.2;
/** @non-frozen（Q9）：饥饿死亡指数上升系数（M2 整定：3 → 上限 e³≈20×，种群可撑过资源低谷） */
export const STARVATION_EXP = 3;
/** @non-frozen（Q9）：饥饿死亡乘子上限 */
export const STARVATION_MAX = 20;
// 气候胁迫常量（CLIMATE_STRESS_K / 软耐受宽度 / 硬致死边际）自 M3 起统一在 fitness.ts（Q10）。

export interface PopulationInput {
  population: number;
  adults: number;
  reproductionRate: number;
  baselineMortality: number;
  carryingCapacity: number;
  energyReserve: number; // kJ/ind（因果携带；starvation 修正项已算好）
  health: number; // 0..1（因果携带；healthMod 已算好）
  // 已算好的乘法修正项（0..∞，1 为中性）
  modifiers: {
    food: number;
    healthMod: number;
    mate: number;
    seasonal: number;
    density: number;
    starvation: number;
    disease: number;
    predation: number;
    climate: number;
    randomMortality?: number; // Q9 @non-frozen 可选扩展（B5），缺省 1
  };
}

/** B4 密度制约（冻结公式）：1/(1 + DENSITY_KNEE·count/CC)；CC ≤ 0 → 0（无容量不繁殖） */
export function densityModifier(count: number, carryingCapacity: number): number {
  if (carryingCapacity <= 0) return 0;
  return 1 / (1 + BIOLOGY.DENSITY_KNEE * (Math.max(0, count) / carryingCapacity));
}

/**
 * B5 饥饿修正（§14 注：低于 STARVATION_FLOOR 指数上升）。
 * reserveRatio = energyReserve/(dailyNeed·RESERVE_MAX_DAYS) ∈ [0,1]；
 * ratio ≥ floor → 1；ratio < floor → exp(STARVATION_EXP·(floor−ratio)/floor)，上限 STARVATION_MAX。
 * @non-frozen 映射（Q9）：契约只冻结「指数上升」行为与 STARVATION_FLOOR 常量。
 */
export function starvationModifier(
  energyReserve: number,
  dailyNeed: number,
  reserveMaxDays = RESERVE_MAX_DAYS,
): number {
  if (dailyNeed <= 0) return 1;
  const ratio = clamp01(Math.max(0, energyReserve) / (dailyNeed * Math.max(1, reserveMaxDays)));
  if (ratio >= BIOLOGY.STARVATION_FLOOR) return 1;
  const m = Math.exp((STARVATION_EXP * (BIOLOGY.STARVATION_FLOOR - ratio)) / BIOLOGY.STARVATION_FLOOR);
  return Math.min(STARVATION_MAX, m);
}

/**
 * B5 气候胁迫修正（M3 升级，Q10）：委托 B8 宽容函数——
 * 适生范围内 1；软耐受带 1 + K·(1−suitability)；
 * 超出硬致死边际（hard_constraint，契约 B8）→ HARD_LETHAL_MULT（快速清除不适生种群）。
 */
export function climateStressModifier(temperature: number, range: Range): number {
  const s = rangeSuitability(temperature, range, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C);
  return fitnessStressModifier(s.suitability, s.hardConstraint);
}

/** B4 + B5：一步差分更新，保证非负 */
export function stepPopulation(input: PopulationInput): {
  population: number;
  births: number;
  deaths: number;
} {
  const m = input.modifiers;
  const population = Math.max(0, input.population);
  const adults = clamp(input.adults, 0, population);
  const rate = Math.max(0, input.reproductionRate);

  // B4（冻结边界：births ∈ [0, adults·reproductionRate]）
  const rawBirths =
    adults * rate * m.food * m.healthMod * m.mate * m.seasonal * m.density;
  const births = clamp(rawBirths, 0, adults * rate);

  // B5（randomMortality 为 Q9 可选扩展，缺省 1）
  const rawDeaths =
    population *
    Math.max(0, input.baselineMortality) *
    m.starvation *
    m.disease *
    m.predation *
    m.climate *
    (m.randomMortality ?? 1);
  const deaths = clamp(rawDeaths, 0, population);

  return { population: Math.max(0, population + births - deaths), births, deaths };
}

// ───────────────────────── 遗传性状（M3，§9.1 十年代尺度） ─────────────────────────

/** @non-frozen（Q10）：狭义遗传力 h²（Lande 方程） */
export const HERITABILITY_DEFAULT = 0.3;
/** @non-frozen（Q10）：突变标准差尺度（性状单位/世代） */
export const MUTATION_SD = 0.1;

/**
 * 数量遗传 Lande 方程：Δmean = h²·σ²·β（选择梯度），每世代一步。
 * 每 tick 变化 = 世代变化/世代天数（generationDays 由物种
 * lifeHistory.reproductiveIntervalYears×365 给出，@non-frozen Q10 时间尺度映射；
 * 兔 ~36 天/世代 → 演化快，草/狼 ~365 天/世代 → §9.1 decade 尺度）。
 */
export function traitSelectionDelta(
  selectionGradient: number,
  traitVariance: number,
  generationDays: number,
  heritability = HERITABILITY_DEFAULT,
): number {
  return (
    clamp01(heritability) * Math.max(0, traitVariance) * selectionGradient / Math.max(1, generationDays)
  );
}

/** 每 tick 突变微扰（§8.1 微观随机；gaussian 来自 fork('core:biology:genetics')） */
export function traitMutationDelta(gaussian: number, mutationRate: number, generationDays: number): number {
  return (gaussian * Math.max(0, mutationRate) * MUTATION_SD) / Math.max(1, generationDays);
}
