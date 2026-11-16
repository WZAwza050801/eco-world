/**
 * E2 温度——契约 §4 E2（公式与默认参数冻结）。
 *
 * temperature = BASE_MEAN_TEMP
 *             − SOLAR_AMPLITUDE · |sin(rad(lat))|
 *             − LAPSE_RATE · elevation
 *             + SEASON_AMP · seasonPhase(lat)
 *             − OCEAN_MODERATION · landWaterFraction · seasonalAmplitude
 *             + greenhouseDelta + weatherNoise
 *
 * 解释（@non-frozen 实现细节）：seasonalAmplitude 取带符号季节项
 * SEASON_AMP·seasonPhase(lat, day)，因此海洋把季节振幅削弱为
 * (1 − OCEAN_MODERATION·landWaterFraction) 倍。
 *
 * 边界（冻结）：温度允许超出 [−60, 60]；超出 [−70, 70] 时截断并标记
 * truncated（事件记录由 M6 events.ts 接线，core 保持纯函数）。
 * 雨影、洋流等地理修正按契约放「区域修正表」，不在本公式内特判。
 */
import { CLIMATE } from '../constants.js';
import { seasonPhase } from './solar.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** @non-frozen（M1 实现细节，M8 可调）：天气噪声标准差 °C，调度器经 RandomStream 注入 */
export const WEATHER_NOISE_SIGMA_C = 2;

export interface TemperatureInput {
  latitude: number; // deg
  elevation: number; // m
  landWaterFraction: number; // 0..1, 0=全陆地 1=全水
  day: number; // 年内日 day
  greenhouseDelta?: number; // °C，默认 0（M1 无人为强迫，H 系列 M5 接线）
  weatherNoise?: number; // °C，默认 0（调度器经 RandomStream 注入，见 §8）
}

export interface TemperatureResult {
  value: number; // °C，已截断到 [−70, 70]
  truncated: boolean; // 是否触发 [−70, 70] 截断（契约 E2 边界；M6 记录事件）
}

/** E2: 每 cell 每 tick 一次；返回截断后的温度与截断标记 */
export function temperature(input: TemperatureInput): TemperatureResult {
  const seasonal = CLIMATE.SEASON_AMP * seasonPhase(input.latitude, input.day);
  const raw =
    CLIMATE.BASE_MEAN_TEMP -
    CLIMATE.SOLAR_AMPLITUDE * Math.abs(Math.sin(rad(input.latitude))) -
    CLIMATE.LAPSE_RATE * input.elevation +
    seasonal -
    CLIMATE.OCEAN_MODERATION * input.landWaterFraction * seasonal +
    (input.greenhouseDelta ?? 0) +
    (input.weatherNoise ?? 0);
  const truncated = raw < -70 || raw > 70;
  return { value: Math.min(70, Math.max(-70, raw)), truncated };
}
