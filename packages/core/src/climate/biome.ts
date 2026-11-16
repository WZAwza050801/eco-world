/**
 * E6 生物群系分类——契约 §4 E6：只做查表，不做 if 堆积。
 *
 * 分类表冻结在 packages/content/biomes/biome-rules.json（纯数据 JSON）。
 * core 零 I/O（契约技术栈）：规则表由 sim 层加载后注入。
 * 规则按序首条命中生效（first-match-wins）；数值条件为闭区间；
 * terrainType 为精确匹配；末条兜底规则保证全覆盖。
 *
 * seasonality 输入为 0..1 的季节性强度（M1 代理量 |sin(rad(lat))|，
 * @non-frozen，由调用方计算）；vegetationStructure 为 0..1 植被结构
 * （M1 无植被传 0，M2+ 接线，规则表暂未引用）。
 */
import type { BiomeType, TerrainType } from '../types.js';

export interface BiomeRange {
  min?: number;
  max?: number;
}

export interface BiomeRule {
  biome: BiomeType;
  when: {
    temperature?: BiomeRange; // °C
    precipitation?: BiomeRange; // mm/day
    seasonality?: BiomeRange; // 0..1
    soilMoisture?: BiomeRange; // mm
    elevation?: BiomeRange; // m
    salinity?: BiomeRange; // g/L
    landWaterFraction?: BiomeRange; // 0..1
    terrainType?: TerrainType;
  };
}

export interface BiomeInput {
  temperature: number; // °C
  precipitation: number; // mm/day
  seasonality: number; // 0..1
  soilMoisture: number; // mm
  elevation: number; // m
  salinity: number; // g/L
  landWaterFraction: number; // 0..1
  terrainType: TerrainType;
  vegetationStructure: number; // 0..1（M1 传 0）
}

/** E6: 查表分类；规则表必须含兜底规则，否则抛错（加载数据边界校验） */
export function classifyBiome(input: BiomeInput, rules: BiomeRule[]): BiomeType {
  for (const rule of rules) {
    if (ruleMatches(rule, input)) return rule.biome;
  }
  throw new Error('E6: biome-rules 无命中规则（分类表必须覆盖全部输入，含兜底规则）');
}

function inRange(value: number, range: BiomeRange | undefined): boolean {
  if (range === undefined) return true;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function ruleMatches(rule: BiomeRule, input: BiomeInput): boolean {
  const w = rule.when;
  if (w.terrainType !== undefined && w.terrainType !== input.terrainType) return false;
  return (
    inRange(input.temperature, w.temperature) &&
    inRange(input.precipitation, w.precipitation) &&
    inRange(input.seasonality, w.seasonality) &&
    inRange(input.soilMoisture, w.soilMoisture) &&
    inRange(input.elevation, w.elevation) &&
    inRange(input.salinity, w.salinity) &&
    inRange(input.landWaterFraction, w.landWaterFraction)
  );
}
