/**
 * 种群更新（契约 §14.3 冻结签名；实现里程碑 M2，公式 B4–B5）。
 */

export interface PopulationInput {
  population: number;
  adults: number;
  reproductionRate: number;
  baselineMortality: number;
  carryingCapacity: number;
  energyReserve: number;
  health: number;
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
  };
}

/** B4 + B5：一步差分更新，保证非负 */
export function stepPopulation(input: PopulationInput): {
  population: number;
  births: number;
  deaths: number;
} {
  void input;
  throw new Error('TODO(M2): B4+B5 未实现');
}
