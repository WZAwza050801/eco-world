/**
 * 土地利用反馈（契约 §7 H3；里程碑 M5）。
 * 冻结结构：landUseImpact = agricultureIntensity + grazingIntensity + settlementFootprint
 *   → 降低 localPlantBiomass、增加 erosion、改变 soilMoisture、增加 diseasePressure。
 * 各强度 0..1；具体效应系数契约未指定 → @non-frozen（Q12）。
 * Cell 无 erosion 字段：erosion 效应以营养流失（nutrients 扣减）+ pollution 表征（Q12 注记）。
 * 人类不直接获得无限资源：强度受人口/技术约束（调度器按聚落规模计算强度）。
 */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** @non-frozen（Q12）：土地利用效应系数 */
export const PLANT_LOSS_COEFF = 0.05; // 每 tick 植物生物量损失比例上限
export const SOIL_MOISTURE_COEFF = 2; // mm/tick 土壤水变化（灌溉/排水，负=变干）
export const DISEASE_PRESSURE_COEFF = 0.02; // 每 tick 疾病压力增量
export const EROSION_NUTRIENT_COEFF = 0.05; // kgN/tick 侵蚀营养流失
export const POLLUTION_COEFF = 0.01; // 每 tick 污染增量

export interface LandUseInput {
  agricultureIntensity: number; // 0..1
  grazingIntensity: number; // 0..1
  settlementFootprint: number; // 0..1
}

export interface LandUseImpact {
  impact: number; // 0..1 总强度
  plantBiomassLossFraction: number; // 0..1 植物生物量损失比例
  soilMoistureDelta: number; // mm/tick
  diseasePressureDelta: number; // 0..1/tick
  erosionNutrientLoss: number; // kgN/tick
  pollutionDelta: number; // 0..1/tick
}

/** H3: 土地利用强度 → 环境效应（纯函数） */
export function landUseImpact(input: LandUseInput): LandUseImpact {
  const impact = clamp01(
    Math.max(0, input.agricultureIntensity) +
      Math.max(0, input.grazingIntensity) +
      Math.max(0, input.settlementFootprint),
  );
  return {
    impact,
    plantBiomassLossFraction: impact * PLANT_LOSS_COEFF,
    soilMoistureDelta: -impact * SOIL_MOISTURE_COEFF,
    diseasePressureDelta: impact * DISEASE_PRESSURE_COEFF,
    erosionNutrientLoss: impact * EROSION_NUTRIENT_COEFF,
    pollutionDelta: impact * POLLUTION_COEFF,
  };
}
