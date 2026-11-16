/**
 * E4 水文（水量平衡）——契约 §4 E4（公式与边界冻结）。
 *
 * surfaceWater_next = surfaceWater + precipitation + upstreamFlow
 *                   − evaporation − infiltration − downstreamFlow − consumption
 * infiltration = min(precipitation, INFILTRATION_CAPACITY)
 * evaporation  = EVAP_RATE · (1 + 0.1·temperature) · (1 − humidity)
 * 边界（冻结）：所有水量 ≥ 0；超过 MAX_SURFACE_WATER 的部分转为 downstreamFlow。
 * upstreamFlow / downstreamFlow 由邻居高差与流向缓存决定（水流向低处）。
 *
 * @non-frozen M1 实现细节（契约未冻结子过程，M8 可调）：
 *  - 蒸发先扣地表水、不足再扣土壤水；T < −10°C 时蒸发需求为负，截为 0；
 *  - 入渗补给土壤水；超过 FIELD_CAPACITY_MM 的部分下渗为地下水；
 *  - consumption 默认 0（生物耗水 M2+ 接线；调用方须保证 ≤ 可用水量）；
 *  - 汇流方案：按高程降序拓扑序处理（流向严格向低 → 无环），上游出流即时
 *    累加为下游入流，单遍严格质量守恒；流入汇（-1）的水量离开系统；
 *  - 海洋 cell 为定水头边界水库：surfaceWater 恒为 MAX_SURFACE_WATER，
 *    入流丢弃，不参与陆地水量预算（海洋蒸发已由 E3 moistureSource 抽象）。
 */
import type { Cell } from '../types.js';
import { HYDROLOGY } from '../constants.js';

/** @non-frozen：土壤田间持水量 mm（超出部分下渗为地下水） */
export const FIELD_CAPACITY_MM = 200;

export interface WaterBalanceInput {
  surfaceWater: number; // mm
  soilMoisture: number; // mm
  groundwater: number; // mm
  precipitation: number; // mm/day
  temperature: number; // °C
  humidity: number; // 0..1
  upstreamFlow: number; // mm/day（上游邻居出流累加）
  consumption?: number; // mm/day（生物耗水，M2+；默认 0）
}

export interface WaterBalanceResult {
  surfaceWater: number; // mm
  soilMoisture: number; // mm
  groundwater: number; // mm
  evaporation: number; // mm/day（实际蒸发，≤ 需求）
  infiltration: number; // mm/day
  downstreamFlow: number; // mm/day（超 MAX_SURFACE_WATER 的出流）
}

/** E4: 单 cell 水量平衡（纯函数；upstreamFlow 由汇流层给出） */
export function waterBalance(input: WaterBalanceInput): WaterBalanceResult {
  const consumption = Math.max(0, input.consumption ?? 0);
  const evapDemand = Math.max(
    0,
    HYDROLOGY.EVAP_RATE * (1 + 0.1 * input.temperature) * (1 - input.humidity),
  );
  const infiltration = Math.min(
    Math.max(0, input.precipitation),
    HYDROLOGY.INFILTRATION_CAPACITY,
  );

  const surfaceRaw =
    input.surfaceWater +
    input.precipitation +
    input.upstreamFlow -
    infiltration -
    consumption;

  // 蒸发先扣地表水，不足再扣土壤水
  const evapSurface = Math.min(Math.max(0, surfaceRaw), evapDemand);
  const evapSoil = Math.min(Math.max(0, input.soilMoisture), evapDemand - evapSurface);
  const evaporation = evapSurface + evapSoil;

  let soil = Math.max(0, input.soilMoisture + infiltration - evapSoil);
  let groundwater = Math.max(0, input.groundwater);
  if (soil > FIELD_CAPACITY_MM) {
    groundwater += soil - FIELD_CAPACITY_MM;
    soil = FIELD_CAPACITY_MM;
  }

  let surface = Math.max(0, surfaceRaw - evapSurface);
  let downstreamFlow = 0;
  if (surface > HYDROLOGY.MAX_SURFACE_WATER) {
    downstreamFlow = surface - HYDROLOGY.MAX_SURFACE_WATER;
    surface = HYDROLOGY.MAX_SURFACE_WATER;
  }

  return {
    surfaceWater: surface,
    soilMoisture: soil,
    groundwater,
    evaporation,
    infiltration,
    downstreamFlow,
  };
}

/**
 * E4: 汇流 + 逐 cell 水量平衡（§9.3 双缓冲：读 cells、返回新数组，不改输入）。
 * flow 为 computeFlowDirection 的缓存（契约 E4：不逐 tick 重算）。
 * 调用方须先更新 temperature/precipitation/humidity（§9.2 步骤 3 顺序）。
 */
export function stepHydrology(cells: Cell[], flow: Int32Array): Cell[] {
  // 高程降序（上游先于下游）；同高程按索引升序，保证确定性
  const order = cells.map((_, i) => i).sort((a, b) => {
    const ea = (cells[a] as Cell).elevation;
    const eb = (cells[b] as Cell).elevation;
    return eb - ea || a - b;
  });
  const upstream = new Float64Array(cells.length);
  const next: Cell[] = new Array(cells.length);
  for (const i of order) {
    const c = cells[i] as Cell;
    if (c.elevation < 0) {
      // 海洋 = 定水头边界水库：入流丢弃，不参与陆地预算
      next[i] = { ...c, surfaceWater: HYDROLOGY.MAX_SURFACE_WATER };
      continue;
    }
    const r = waterBalance({
      surfaceWater: c.surfaceWater,
      soilMoisture: c.soilMoisture,
      groundwater: c.groundwater,
      precipitation: c.precipitation,
      temperature: c.temperature,
      humidity: c.humidity,
      upstreamFlow: upstream[i] as number,
    });
    const down = flow[i] as number;
    if (down >= 0) {
      upstream[down] = (upstream[down] as number) + r.downstreamFlow;
    }
    next[i] = {
      ...c,
      surfaceWater: r.surfaceWater,
      soilMoisture: r.soilMoisture,
      groundwater: r.groundwater,
    };
  }
  return next;
}
