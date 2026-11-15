/**
 * 光合作用（契约 §14.2 冻结签名；实现里程碑 M2，公式 B1–B3）。
 */

export interface PhotoInput {
  solar: number; // E1 输出，无量纲
  temperature: number; // °C
  soilMoisture: number; // mm
  nutrients: number; // kgN/cell
  pMax: number; // kgC/(cell·day)
  efficiency: number; // 0..1
  seasonFactor: number; // 0..1
}

/** B1: 计算总初级生产力，返回 kgC/(cell·day) */
export function grossPrimaryProduction(input: PhotoInput): number {
  void input;
  throw new Error('TODO(M2): B1 未实现');
}

/** B2: 呼吸损耗 */
export function respiration(gpp: number, biomass: number, maintenanceRate: number): number {
  void gpp;
  void biomass;
  void maintenanceRate;
  throw new Error('TODO(M2): B2 未实现');
}

/** B3: 植物生物量更新 */
export function plantGrowth(
  prevBiomass: number,
  gpp: number,
  resp: number,
  losses: number,
  maxBiomass: number,
): number {
  void prevBiomass;
  void gpp;
  void resp;
  void losses;
  void maxBiomass;
  throw new Error('TODO(M2): B3 未实现');
}
