/**
 * E3 降水——契约 §4 E3（公式结构与边界冻结）。
 *
 * precipitation = moistureSource
 *               · transportFactor(lat, windDirection)
 *               · orographicLift(slope, aspect, windDirection)
 *               · seasonalFactor(day)
 *               · stormNoise
 * 边界（冻结）：precipitation ∈ [0, MAX_PRECIP_MM_DAY]，负值截为 0。
 * orographicLift（冻结）：迎风坡 > 1，背风坡 = RAIN_SHADOW_FACTOR。
 *
 * 契约未冻结各因子的具体算法，以下为 @non-frozen M1 实现细节（M8 可调）：
 *  - prevailingWind：纬度带盛行风（信风带/西风带/极地东风带），返回风吹向
 *    的方向（罗盘弧度，0=北，π/2=东，顺时针）；
 *  - moistureSource：海洋水源随 coastDistance 指数衰减，纬度控制基准；
 *  - transportFactor：赤道辐合抬升、副热带（~25°）与极地（~75°）下沉抑制；
 *    M1 为纬向带模型，windDirection 参数保留（季风/经向输送 M8 引入）；
 *  - orographicLift：迎风坡最大 OROGRAPHIC_LIFT_MAX，背风坡趋近
 *    RAIN_SHADOW_FACTOR（冻结值），平地 = 1；
 *  - seasonalFactor：夏半球更湿（南北反相）；
 *  - stormNoise：乘法噪声（均值≈1），由调度器经 RandomStream 注入，默认 1。
 */
import { CLIMATE, WORLD } from '../constants.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;
const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** @non-frozen：海岸水源基准 mm/day */
export const MOISTURE_BASE_MM_DAY = 12;
/**
 * @non-frozen：水源指数衰减尺度 km。coastDistance 按契约 km 制
 * （地形 BFS 步数 × CELL_EDGE_KM=10km）；128 网格跨全球为冻结坐标协议
 * 的风格化约定，衰减尺度取 150km（≈15 cell）使内陆干旱带成立。
 */
export const MOISTURE_DECAY_KM = 150;
/** @non-frozen：迎风坡最大抬升倍数 */
export const OROGRAPHIC_LIFT_MAX = 2.5;
/** @non-frozen：降水季节振幅 */
export const PRECIP_SEASONALITY = 0.35;
/** @non-frozen：风暴噪声对数标准差 */
export const STORM_NOISE_SIGMA = 0.6;

/**
 * 盛行风向（风吹向的方向，罗盘弧度）：
 * |lat| < 30 信风→西；30 ≤ |lat| < 60 西风→东；|lat| ≥ 60 极地东风→西。
 */
export function prevailingWind(lat: number): number {
  const a = Math.abs(lat);
  if (a < 30) return (3 * Math.PI) / 2;
  if (a < 60) return Math.PI / 2;
  return (3 * Math.PI) / 2;
}

/** 水源 mm/day：海洋供给随离岸距离指数衰减（coastDistance 由地形 BFS 给出） */
export function moistureSource(lat: number, coastDistance: number): number {
  return (
    MOISTURE_BASE_MM_DAY *
    (0.3 + 0.7 * Math.cos(rad(lat))) *
    Math.exp(-Math.max(0, coastDistance) / MOISTURE_DECAY_KM)
  );
}

/**
 * 输送因子：赤道辐合带（ITCZ）抬升、副热带高压与极地下沉抑制。
 * windDirection 为契约公式保留输入；M1 纬向带模型暂未使用（@non-frozen）。
 */
export function transportFactor(lat: number, windDirection?: number): number {
  void windDirection;
  const a = Math.abs(lat);
  const itcz = 0.6 * Math.exp(-((lat / 12) ** 2));
  const subtropical = 0.95 * Math.exp(-(((a - 25) / 12) ** 2));
  const polar = 0.5 * Math.exp(-(((a - 75) / 15) ** 2));
  return clamp(1 + itcz - subtropical - polar, 0.05, 2);
}

/**
 * 地形抬升：aspect 为下坡方位角（0=北，顺时针，契约 §3.1）；
 * 迎风坡 = 坡面朝向 incoming 风（aspect ≈ windDirection + π）。
 * 迎风 ∈ (1, OROGRAPHIC_LIFT_MAX]，背风 → RAIN_SHADOW_FACTOR（冻结），平地 = 1。
 */
export function orographicLift(
  slope: number,
  aspect: number,
  windDirection: number,
): number {
  const alignment = -Math.cos(aspect - windDirection); // >0 迎风，<0 背风
  const s = clamp(slope, 0, 1);
  if (alignment >= 0) return 1 + (OROGRAPHIC_LIFT_MAX - 1) * alignment * s;
  return 1 - (1 - CLIMATE.RAIN_SHADOW_FACTOR) * -alignment * s;
}

/** 季节因子：夏半球更湿（南北反相），下限 0.1 防止负降水 */
export function seasonalFactor(lat: number, day: number): number {
  const hemisphere = lat >= 0 ? 1 : -1;
  return Math.max(
    0.1,
    1 +
      PRECIP_SEASONALITY *
        Math.sin((2 * Math.PI * day) / WORLD.DAYS_PER_YEAR) *
        hemisphere,
  );
}

export interface PrecipInput {
  latitude: number; // deg
  coastDistance: number; // km
  slope: number; // 0..1
  aspect: number; // rad, 下坡方位角
  day: number; // 年内日 day
  windDirection?: number; // rad，默认 prevailingWind(latitude)
}

/** E3: 降水 mm/day，截断到 [0, MAX_PRECIP_MM_DAY]（冻结边界） */
export function precipitation(input: PrecipInput, stormNoise = 1): number {
  const wind = input.windDirection ?? prevailingWind(input.latitude);
  const p =
    moistureSource(input.latitude, input.coastDistance) *
    transportFactor(input.latitude, wind) *
    orographicLift(input.slope, input.aspect, wind) *
    seasonalFactor(input.latitude, input.day) *
    Math.max(0, stormNoise);
  return clamp(p, 0, CLIMATE.MAX_PRECIP_MM_DAY);
}

/** @non-frozen：风暴乘法噪声因子（均值≈1）；gaussian 来自 fork('core:climate:storm') */
export function stormNoiseFactor(gaussian: number): number {
  return Math.exp(STORM_NOISE_SIGMA * gaussian - (STORM_NOISE_SIGMA ** 2) / 2);
}

/**
 * @non-frozen：相对湿度 0..1（由降水/土壤水/海陆分数诊断，供 E4 蒸发使用）。
 * 海洋 ≈ 0.8+，湿润陆地 ≈ 0.7，干旱陆地 ≈ 0.35。
 */
export function relativeHumidity(
  precipMmDay: number,
  soilMoistureMm: number,
  landWaterFraction: number,
): number {
  return clamp(
    0.3 +
      0.5 * landWaterFraction +
      0.3 * Math.min(1, Math.max(0, precipMmDay) / 5) +
      0.15 * Math.min(1, Math.max(0, soilMoistureMm) / 150),
    0,
    1,
  );
}
