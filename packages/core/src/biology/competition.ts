/**
 * 竞争（契约 §5 B7，里程碑 M2；契约未冻结本函数签名）。
 * effectiveResource = resourceAmount / (1 + Σ_j competitionCoefficient_j · competitorDensity_j)
 */

export interface Competitor {
  coefficient: number; // 竞争系数（物种 interactions.competitionCoefficients）
  density: number; // 竞争者密度 ind/cell（或 kgC/cell，与资源单位一致）
}

/** B7: 竞争下的有效资源量；分母 ≥ 1，输出 ∈ [0, resourceAmount] */
export function effectiveResource(
  resourceAmount: number,
  competitors: Competitor[],
): number {
  let sum = 0;
  for (const c of competitors) {
    sum += Math.max(0, c.coefficient) * Math.max(0, c.density);
  }
  return Math.max(0, resourceAmount) / (1 + sum);
}
