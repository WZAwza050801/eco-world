/**
 * 适合度（契约 §14.5 冻结签名与实现，公式 B8）。
 */

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** B8: 乘法适合度；suitabilities 为 0..1 数组 */
export function fitness(base: number, suitabilities: number[]): number {
  return suitabilities.reduce((acc, s) => acc * clamp01(s), base);
}
