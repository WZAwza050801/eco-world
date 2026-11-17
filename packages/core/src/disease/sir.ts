/**
 * SIR 疾病模型（契约 §6 D1；里程碑 M4）。
 *
 * 冻结公式：S + I + R = 1（单种群内比例）
 *   dI = transmissionRate·S·I·densityFactor·environmentalFactor − (recoveryRate + mortalityRate)·I
 * 离散 Euler（@non-frozen Q11）：
 *   newInfections = transmissionRate·S·exposure·densityFactor·envFactor（≤ S）
 *   recoveries = recoveryRate·I；deaths = mortalityRate·I（rec+death ≤ I 缩放）
 *   S' = S − newInf；I' = I + newInf − rec − death；R' = R + rec
 *   死亡移除质量 → S'+I'+R' = 1 − deaths ≤ 1。
 *
 * densityFactor（§6 高密度促进传播，@non-frozen）：count/densityThreshold，clamp [0, MAX]。
 *   阈值即流行 tipping point：count < threshold → R0 < 1 消退；> threshold → R0 > 1 爆发。
 * environmentalFactor（§6 湿度/温度影响病原存活，@non-frozen）：
 *   persistence · clamp01(humidity/0.5) · clamp01((T+10)/40)。
 * exposure（传播邻域，§6 transmissionMode）：contact = 本地 I；air/water/vector/food =
 *   本地 I + Σ 邻居 I·NEIGHBOR_EXPOSURE_WEIGHT（六边形 6 邻域，由调度器算）。
 */

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** @non-frozen（Q11）：密度传播因子上限 */
export const DENSITY_TRANSMISSION_MAX = 10;
/** @non-frozen（Q11）：非接触传播邻居感染贡献权重（六边形 6 邻域） */
export const NEIGHBOR_EXPOSURE_WEIGHT = 0.3;

/** 密度因子：count/threshold（高密度 >1 促进传播，低密度 <1 抑制），clamp [0, MAX] */
export function densityFactor(count: number, densityThreshold: number): number {
  if (densityThreshold <= 0) return 1;
  return clamp(Math.max(0, count) / densityThreshold, 0, DENSITY_TRANSMISSION_MAX);
}

/** 环境因子：湿度/温度对病原存活的影响 × 环境存活能力，0..1 */
export function environmentalFactor(
  humidity: number,
  temperature: number,
  persistence: number,
): number {
  const h = clamp01(Math.max(0, humidity) / 0.5);
  const t = clamp01((temperature + 10) / 40);
  return clamp01(persistence) * h * t;
}

export interface SIRInput {
  susceptible: number; // S 比例 0..1
  infected: number; // I 比例 0..1
  recovered: number; // R 比例 0..1
  exposure?: number; // 有效感染压力（缺省 = infected；非接触传播含邻居贡献）
  transmissionRate: number; // 1/day
  recoveryRate: number; // 1/day
  mortalityRate: number; // 1/day
  densityFactor: number; // ≥0
  environmentalFactor: number; // 0..1
}

export interface SIRResult {
  susceptible: number;
  infected: number;
  recovered: number;
  newInfections: number; // 比例
  recoveries: number; // 比例
  deaths: number; // 比例（疾病死亡，移出种群）
}

/** D1: 单种群单病原一步 SIR 更新（纯函数；比例守恒 S+I+R = 1 − deaths） */
export function stepSIR(input: SIRInput): SIRResult {
  const S = clamp01(input.susceptible);
  const I = clamp01(input.infected);
  const R = clamp01(input.recovered);
  const exposure = Math.max(0, input.exposure ?? I);
  const force =
    Math.max(0, input.transmissionRate) *
    S *
    exposure *
    Math.max(0, input.densityFactor) *
    clamp01(input.environmentalFactor);
  const newInfections = Math.min(force, S);
  const out = (Math.max(0, input.recoveryRate) + Math.max(0, input.mortalityRate)) * I;
  const scale = out > I && out > 0 ? I / out : 1;
  const recoveries = Math.max(0, input.recoveryRate) * I * scale;
  const deaths = Math.max(0, input.mortalityRate) * I * scale;
  return {
    susceptible: Math.max(0, S - newInfections),
    infected: Math.max(0, I + newInfections - recoveries - deaths),
    recovered: Math.max(0, R + recoveries),
    newInfections,
    recoveries,
    deaths,
  };
}
