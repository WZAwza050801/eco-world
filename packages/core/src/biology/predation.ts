/**
 * 捕食（契约 §14.4 冻结签名；公式 B6，里程碑 M2）。
 *
 * B6: consumption = (attackRate·predatorCount·preyCount)
 *                 / (1 + attackRate·handlingTime·preyCount)
 * 单位：prey ind/day；边界（冻结）：consumption ≤ preyCount；捕食者不产生负能量。
 * energyGain = consumption · preyEnergyDensity · conversionEfficiency（冻结公式）。
 *
 * herbivory（@non-frozen，Q9）：B3 的 herbivory 损失项契约未给公式；
 * 植物 prey 以 kgC 计（§1.1 植物用生物量），采用饱和采食 functional response：
 * 单头采食 = maxIntake·B/(B+K)，总量截断 ≤ 植物量·日采食上限比例。
 */

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** @non-frozen（Q9，M8 可调）：单日采食可消耗植物 standing crop 的最大比例（M2 整定：0.35 防啃绝） */
export const MAX_GRAZE_FRACTION_PER_DAY = 0.35;

/** B6: Holling II，返回 prey ind/day，保证 ≤ preyCount（冻结边界） */
export function holling2(
  attackRate: number,
  handlingTime: number,
  predatorCount: number,
  preyCount: number,
): number {
  const a = Math.max(0, attackRate);
  const h = Math.max(0, handlingTime);
  const p = Math.max(0, predatorCount);
  const n = Math.max(0, preyCount);
  if (a === 0 || p === 0 || n === 0) return 0;
  const consumption = (a * p * n) / (1 + a * h * n);
  return clamp(consumption, 0, n);
}

/** B6 能量换算（冻结公式）：kJ/day；输入非负，输出非负（捕食者不产生负能量） */
export function predationEnergyGain(
  consumption: number,
  preyEnergyDensity: number,
  conversionEfficiency: number,
): number {
  return (
    Math.max(0, consumption) *
    Math.max(0, preyEnergyDensity) *
    clamp(conversionEfficiency, 0, 1)
  );
}

/**
 * B3 herbivory 项（@non-frozen Q9）：返回 kgC/day。
 * @param plantBiomassKgC 植物 standing crop kgC/cell
 * @param grazerCount 采食者 ind
 * @param maxIntakeKgCPerInd 单头最大日采食 kgC/(ind·day)
 * @param halfSaturationKgC 半饱和常数 kgC（食物网边参数）
 */
export function herbivory(
  plantBiomassKgC: number,
  grazerCount: number,
  maxIntakeKgCPerInd: number,
  halfSaturationKgC: number,
): number {
  const b = Math.max(0, plantBiomassKgC);
  const g = Math.max(0, grazerCount);
  const k = Math.max(1e-6, halfSaturationKgC);
  if (b === 0 || g === 0) return 0;
  const intake = g * Math.max(0, maxIntakeKgCPerInd) * (b / (b + k));
  return clamp(intake, 0, b * MAX_GRAZE_FRACTION_PER_DAY);
}
