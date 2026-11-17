/**
 * 聚落增长（契约 §7 H2；里程碑 M5）。
 * 冻结公式：
 *   settlementGrowth = births − deaths + immigration − emigration
 *   births = adults · fertility · foodModifier · healthModifier · culturalModifier
 * deaths 公式契约未指定 → @non-frozen（Q12）：population·baselineMortality；
 *   疾病死亡由 D1 SIR（步骤 8）另行直接移除（与动物一致），此处不重复计死。
 * immigration/emigration 缺省 0（M5 聚落定居，迁徙 M6+ 细化）。
 * 边界：population_next ≥ 0。
 */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface SettlementInput {
  population: number;
  adults: number;
  fertility: number; // 1/day 每成年个体出生率
  foodModifier: number; // 0..1（H1）
  healthModifier: number; // 0..1
  culturalModifier: number; // 0..1+（文化/技术对繁殖的影响，缺省 1）
  baselineMortality: number; // 1/day
  immigration?: number; // ind/day
  emigration?: number; // ind/day
}

export interface SettlementResult {
  population: number;
  births: number;
  deaths: number;
  netMigration: number;
  growth: number;
}

/** H2: 聚落一步增长（纯函数，非负） */
export function settlementGrowth(input: SettlementInput): SettlementResult {
  const population = Math.max(0, input.population);
  const adults = Math.min(Math.max(0, input.adults), population);
  const births = Math.max(
    0,
    adults *
      Math.max(0, input.fertility) *
      clamp01(input.foodModifier) *
      clamp01(input.healthModifier) *
      Math.max(0, input.culturalModifier),
  );
  const deaths = Math.max(0, population * Math.max(0, input.baselineMortality));
  const netMigration = (input.immigration ?? 0) - (input.emigration ?? 0);
  const growth = births - deaths + netMigration;
  return {
    population: Math.max(0, population + growth),
    births,
    deaths,
    netMigration,
    growth,
  };
}
