/**
 * E1 太阳辐射（季节与纬度）——契约 §4 E1（公式与默认参数冻结）。
 *
 * solarInput(lat, day) = 1 + SOLAR_AMPLITUDE_DAY · sin(2π·day/365) · cos(rad(lat))
 * 输出：无量纲辐射强度，赤道 ≈ [0.35, 1.65]（契约「约 [0.3, 1.6]」），
 * 极地 cos(±90°) ≈ 0 → 全年 ≈ 1。用途：温度与光合（B1，M2）的乘法因子。
 *
 * seasonPhase 为 E2 共享的季节相位：契约 E2 仅冻结「随纬度与半球改变符号
 * （北半球与南半球反相）」；振幅按 |sin(lat)| 缩放是 @non-frozen 实现细节
 * （赤道无季节、极地最大，M8 可调）。
 */
import { CLIMATE, WORLD } from '../constants.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** E1: 无量纲辐射强度（未截断；B1 的 lightFactor 负责 clamp01） */
export function solarInput(lat: number, day: number): number {
  return (
    1 +
    CLIMATE.SOLAR_AMPLITUDE_DAY *
      Math.sin((2 * Math.PI * day) / WORLD.DAYS_PER_YEAR) *
      Math.cos(rad(lat))
  );
}

/**
 * 季节相位 ∈ [-1, 1]：北半球与南半球反相（契约 E2 冻结行为），
 * 振幅随 |sin(lat)| 缩放（@non-frozen：赤道 0，极地 ±1）。
 */
export function seasonPhase(lat: number, day: number): number {
  const hemisphere = lat >= 0 ? 1 : -1;
  return (
    Math.sin((2 * Math.PI * day) / WORLD.DAYS_PER_YEAR) *
    hemisphere *
    Math.abs(Math.sin(rad(lat)))
  );
}
