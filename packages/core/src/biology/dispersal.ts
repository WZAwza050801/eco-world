/**
 * 迁徙与扩散（契约 §5 B9；里程碑 M3。契约未冻结本文件函数签名）。
 *
 * B9: flow(i→j) = population_i · movementPressure · suitabilityGradient(i,j)
 *                 · accessibility(i,j) · migrationCapacity · randomFactor
 * 边界（冻结）：flow ≤ population_i；目标 cell 必须 accessibility > 0。
 * 模板六类：seed / spore / walking / flying / wind / human_assisted。
 * §18.1：迁徙有边界和成本（边界墙 4 邻域由调用方 neighbors 保证；成本见 migrationCost）。
 *
 * 各因子算法为 @non-frozen（Q10）实现：
 *  - movementPressure：密度压力（count/CC 超拐点）+ 适合度赤字 + 探索基线；
 *  - suitabilityGradient：max(0, f_j − f_i)；目标为空且适生时加竞争释放加成
 *    （否则等适生空域永远无法定殖）；
 *  - accessibility：物种通行性 × cell.accessibility（步行/种子/孢子不跨海洋）；
 *  - migrationCapacity：speed(km/day)/cell 边长(km) → 每 tick 可跨越的概率上限；
 *  - establishment：定殖量 = flow × 目标绝对生境适合度（硬致死 0 → 不定殖）。
 */
import type { Cell } from '../types.js';
import { WORLD } from '../constants.js';

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** @non-frozen（Q10）：探索基线压力（健康种群也有少量个体探索邻域） */
export const EXPLORATION_BASE = 0.02;
/** @non-frozen（Q10）：密度压力系数与拐点（count/CC 超过拐点开始外迁） */
export const DENSITY_PUSH = 0.5;
export const PRESSURE_ONSET = 0.7;
/** @non-frozen（Q10）：适合度赤字压力系数 */
export const FITNESS_PUSH = 0.8;
/** @non-frozen（Q10）：空适生目标的竞争释放加成 */
export const COLONIZATION_BONUS = 0.3;
/** @non-frozen（Q10）：单 tick 最大外迁比例（B9 边界 flow ≤ population_i 之上再加保守帽） */
export const MAX_EMIGRATION_FRACTION = 0.5;
/** @non-frozen（Q10）：迁徙能量成本 kJ/(kg 体重·km) */
export const MOVE_COST_KJ_PER_KG_KM = 2;
/** @non-frozen（Q10）：扩散随机因子对数正态 σ */
export const DISPERSAL_RANDOM_SIGMA = 0.3;

/** B9 移动能力：每 tick 跨越一个 cell 的概率上限 = speed/边长，clamp01 */
export function migrationCapacity(speedKmPerDay: number): number {
  return clamp01(Math.max(0, speedKmPerDay) / WORLD.CELL_EDGE_KM);
}

/** B9 迁移压力（@non-frozen）：探索基线 + 密度超拐点 + 适合度赤字，clamp01 */
export function movementPressure(
  population: number,
  carryingCapacity: number,
  fitnessValue: number,
): number {
  const ratio = carryingCapacity > 0 ? Math.min(10, Math.max(0, population) / carryingCapacity) : (population > 0 ? 10 : 0);
  const density = DENSITY_PUSH * Math.max(0, ratio - PRESSURE_ONSET);
  const deficit = FITNESS_PUSH * (1 - clamp01(fitnessValue));
  return clamp01(EXPLORATION_BASE + density + deficit);
}

/**
 * B9 适合度梯度（@non-frozen）：只向不差于源的生境移动；
 * 目标为空（无同种占据）且适生 → 竞争释放加成（定殖空域的关键）。
 */
export function suitabilityGradient(
  fitnessI: number,
  fitnessJ: number,
  targetOccupied = true,
): number {
  const uphill = Math.max(0, clamp01(fitnessJ) - clamp01(fitnessI));
  const bonus = !targetOccupied ? clamp01(fitnessJ) * COLONIZATION_BONUS : 0;
  return clamp01(uphill + bonus);
}

/**
 * B9 目标通行性（@non-frozen）：步行/种子/孢子/人为辅助不跨海洋（elevation<0 → 0）；
 * 飞行/风媒可用 cell.accessibility 基础值。冻结边界：目标 accessibility 必须 > 0。
 */
export function targetAccessibility(
  method: 'seed' | 'spore' | 'walking' | 'flying' | 'wind' | 'human_assisted',
  cell: Cell,
): number {
  const base = clamp01(cell.accessibility);
  if (cell.elevation < 0 && method !== 'flying' && method !== 'wind') return 0;
  return base;
}

/** B9: 扩散流量（冻结公式结构与边界 flow ≤ population_i） */
export function dispersalFlow(
  population: number,
  pressure: number,
  gradient: number,
  accessibility: number,
  capacity: number,
  randomFactor: number,
): number {
  const flow =
    Math.max(0, population) *
    clamp01(pressure) *
    clamp01(gradient) *
    clamp01(accessibility) *
    clamp01(capacity) *
    Math.max(0, randomFactor);
  return clamp(flow, 0, Math.max(0, population));
}

/** B9 定殖过滤（@non-frozen）：定殖量 = flow × 目标绝对生境适合度（硬致死 0 → 0） */
export function establishment(flow: number, targetHabitatFitness: number): number {
  return Math.max(0, flow) * clamp01(targetHabitatFitness);
}

/** 迁徙能量成本 kJ/ind（跨越一个 cell；§18.1 迁徙有成本） */
export function migrationCost(bodyMassKg: number): number {
  return Math.max(0, bodyMassKg) * WORLD.CELL_EDGE_KM * MOVE_COST_KJ_PER_KG_KM;
}

/** 扩散随机因子（均值≈1 对数正态）；gaussian 来自 fork('core:biology:dispersal') */
export function dispersalRandomFactor(gaussian: number): number {
  return Math.exp(DISPERSAL_RANDOM_SIGMA * gaussian - (DISPERSAL_RANDOM_SIGMA ** 2) / 2);
}
