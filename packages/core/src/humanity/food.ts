/**
 * 智人食物需求（契约 §7 H1；里程碑 M5）。
 * 冻结公式：foodNeed = population · perCapitaFood · ageStructureFactor · activityFactor
 * perCapitaFood 单位 kJ/(人·day)。
 * ageStructureFactor/activityFactor 契约未给缺省值 → @non-frozen（Q12）缺省 1。
 */

/** H1: 聚落日食物需求 kJ/day */
export function foodNeed(
  population: number,
  perCapitaFood: number,
  ageStructureFactor = 1,
  activityFactor = 1,
): number {
  return (
    Math.max(0, population) *
    Math.max(0, perCapitaFood) *
    Math.max(0, ageStructureFactor) *
    Math.max(0, activityFactor)
  );
}

/**
 * 食物修饰因子（@non-frozen Q12，H2 foodModifier）：摄入/需求，clamp01。
 * 食物充足 → 1（不限制增长）；短缺 → <1（限制出生，聚落受食物约束）。
 */
export function foodModifier(intakeKJ: number, needKJ: number): number {
  if (needKJ <= 0) return 1;
  const x = Math.max(0, intakeKJ) / needKJ;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
