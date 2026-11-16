/**
 * 光合作用（契约 §14.2 冻结签名；公式 B1–B3，里程碑 M2）。
 *
 * B1: GPP = P_MAX · lightFactor(solar) · tempFactor(T) · waterFactor(sm)
 *           · nutrientFactor(n) · speciesEfficiency · seasonFactor
 * B2: respiration = maintenanceRate·biomass
 *                 + growthRespiration·max(0, GPP − maintenanceRate·biomass)
 * B3: biomass_next = clamp(biomass + GPP − resp − losses, 0, maxBiomass)
 * 边界（冻结）：各因子截断 [0,1]；GPP ∈ [0, pMax]。
 *
 * Q9（@non-frozen 可选扩展，不改冻结签名）：契约公式引用但 PhotoInput 未给出的
 * 物种参数（最适温/高斯宽度/半饱和常数）以可选字段传入，缺省用下方常量；
 * B2 的 growthRespiration 以可选第 4 参传入（缺省 GROWTH_RESPIRATION_FRACTION）。
 * 待契约 v2.2 冻结（问题单 Q9）。
 */

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
const clamp01 = (x: number): number => clamp(x, 0, 1);

/** @non-frozen 缺省（Q9，M8 可调）：光合最适温度 °C */
export const TEMP_OPTIMUM_C = 20;
/** @non-frozen 缺省（Q9）：温度高斯宽度 σ °C */
export const TEMP_TOLERANCE_C = 12;
/** @non-frozen 缺省（Q9）：水分半饱和常数 mm */
export const K_WATER_MM = 50;
/** @non-frozen 缺省（Q9）：营养半饱和常数 kgN/cell */
export const K_NUTRIENT_KGN = 20;
/** @non-frozen 缺省（Q9）：生长呼吸占盈余 GPP 比例 */
export const GROWTH_RESPIRATION_FRACTION = 0.25;

export interface PhotoInput {
  solar: number; // E1 输出，无量纲
  temperature: number; // °C
  soilMoisture: number; // mm
  nutrients: number; // kgN/cell
  pMax: number; // kgC/(cell·day)
  efficiency: number; // 0..1
  seasonFactor: number; // 0..1
  // Q9 @non-frozen 可选扩展（物种级参数，缺省见上方常量）
  tempOptimum?: number; // °C
  tempTolerance?: number; // °C
  kWater?: number; // mm
  kNutrient?: number; // kgN/cell
}

/** B1 因子：光照 clamp01(solar) */
export function lightFactor(solar: number): number {
  return clamp01(solar);
}

/** B1 因子：温度高斯峰 exp(−((T−Topt)/σ)²) */
export function tempFactor(temperature: number, optimum = TEMP_OPTIMUM_C, sigma = TEMP_TOLERANCE_C): number {
  const s = Math.max(1e-6, sigma);
  return clamp01(Math.exp(-(((temperature - optimum) / s) ** 2)));
}

/** B1 因子：水分饱和曲线 sm/(sm+K_water) */
export function waterFactor(soilMoisture: number, kWater = K_WATER_MM): number {
  const sm = Math.max(0, soilMoisture);
  return clamp01(sm / (sm + Math.max(1e-6, kWater)));
}

/** B1 因子：营养饱和曲线 n/(n+K_n) */
export function nutrientFactor(nutrients: number, kNutrient = K_NUTRIENT_KGN): number {
  const n = Math.max(0, nutrients);
  return clamp01(n / (n + Math.max(1e-6, kNutrient)));
}

/** B1: 计算总初级生产力，返回 kgC/(cell·day)，∈ [0, pMax] */
export function grossPrimaryProduction(input: PhotoInput): number {
  const gpp =
    input.pMax *
    lightFactor(input.solar) *
    tempFactor(input.temperature, input.tempOptimum, input.tempTolerance) *
    waterFactor(input.soilMoisture, input.kWater) *
    nutrientFactor(input.nutrients, input.kNutrient) *
    clamp01(input.efficiency) *
    clamp01(input.seasonFactor);
  return clamp(gpp, 0, Math.max(0, input.pMax));
}

/** B2: 呼吸损耗 kgC/(cell·day)；growthFraction 为 Q9 可选扩展（缺省 0.25） */
export function respiration(
  gpp: number,
  biomass: number,
  maintenanceRate: number,
  growthFraction = GROWTH_RESPIRATION_FRACTION,
): number {
  const maint = Math.max(0, maintenanceRate) * Math.max(0, biomass);
  return maint + clamp01(growthFraction) * Math.max(0, gpp - maint);
}

/** B3: 植物生物量更新 kgC/cell，clamp [0, maxBiomass]（冻结边界） */
export function plantGrowth(
  prevBiomass: number,
  gpp: number,
  resp: number,
  losses: number,
  maxBiomass: number,
): number {
  return clamp(prevBiomass + gpp - resp - losses, 0, Math.max(0, maxBiomass));
}
