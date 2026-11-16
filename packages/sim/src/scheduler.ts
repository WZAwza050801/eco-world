/**
 * 调度器（契约 §14.7 冻结签名；§9.2 冻结更新顺序）。
 * M1：实现步骤 2–4（stepEnvironment：气候/水文/土壤，E1–E6）。
 * M2 起逐步填充其余步骤，M6 完成全部 12 步（stepWorld）。
 */
import type { Cell, WorldSnapshot } from '../../core/src/types.js';
import type { RandomStream } from '../../core/src/random/RandomStream.js';
import {
  temperature,
  WEATHER_NOISE_SIGMA_C,
} from '../../core/src/climate/temperature.js';
import {
  precipitation,
  relativeHumidity,
  stormNoiseFactor,
} from '../../core/src/climate/precipitation.js';
import { classifyBiome } from '../../core/src/climate/biome.js';
import { stepHydrology } from '../../core/src/hydrology/waterBalance.js';
import { stepNutrients } from '../../core/src/soil/nutrients.js';
import { loadBiomeRules } from './scenario.js';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * §9.2 步骤 2–4（M1）：太阳/季节/天气 → 温度/降水/水文 → 土壤/营养。
 * E1 太阳辐射由 climate/solar.ts 独立提供（M2 接线 B1 光合）；此处接线 E2–E6。
 * biome 为派生缓存（§3.1），随环境场更新（E6 查表）。
 *
 * §9.3 双缓冲：读 cells（上一快照状态）、返回新数组，不修改输入。
 * §8.3 随机：天气/风暴噪声取自 rng.fork('core:climate:weather'|'core:climate:storm')，
 * 按 cell 索引顺序消费，保证重放一致。
 * flow 为 computeFlowDirection 缓存（契约 E4：不逐 tick 重算），由调用方持有。
 */
export function stepEnvironment(
  cells: Cell[],
  flow: Int32Array,
  day: number,
  rng: RandomStream,
): Cell[] {
  const weather = rng.fork('core:climate:weather');
  const storm = rng.fork('core:climate:storm');

  // 步骤 2–3：E2 温度、E3 降水、湿度诊断
  const climateNext: Cell[] = cells.map((c) => {
    const t = temperature({
      latitude: c.latitude,
      elevation: c.elevation,
      landWaterFraction: c.landWaterFraction,
      day,
      weatherNoise: WEATHER_NOISE_SIGMA_C * weather.nextGaussian(),
    });
    const p = precipitation(
      {
        latitude: c.latitude,
        coastDistance: c.coastDistance,
        slope: c.slope,
        aspect: c.aspect,
        day,
      },
      stormNoiseFactor(storm.nextGaussian()),
    );
    // TODO(M6): t.truncated 时按契约 E2 边界记录事件（events.ts）
    return {
      ...c,
      temperature: t.value,
      precipitation: p,
      humidity: relativeHumidity(p, c.soilMoisture, c.landWaterFraction),
    };
  });

  // 步骤 3：E4 水文（流向缓存，水流向低处）
  const waterNext = stepHydrology(climateNext, flow);

  // 步骤 4：E5 土壤/营养 + E6 群系派生缓存
  const rules = loadBiomeRules();
  return waterNext.map((c) => {
    const n = stepNutrients({
      nutrients: c.nutrients,
      organicMatter: c.organicMatter,
      soilMoisture: c.soilMoisture,
      temperature: c.temperature,
      slope: c.slope,
      precipitation: c.precipitation,
    });
    const biome = classifyBiome(
      {
        temperature: c.temperature,
        precipitation: c.precipitation,
        seasonality: Math.abs(Math.sin(rad(c.latitude))),
        soilMoisture: c.soilMoisture,
        elevation: c.elevation,
        salinity: c.salinity,
        landWaterFraction: c.landWaterFraction,
        terrainType: c.terrainType,
        vegetationStructure: 0, // M1 无植被（M2+ 接线）
      },
      rules,
    );
    return { ...c, nutrients: n.nutrients, organicMatter: n.organicMatter, biome };
  });
}

/** §9.2 冻结更新顺序（不可改变）：
 *  1. 读时间与随机种子
 *  2. 太阳、季节、天气
 *  3. 温度、降水、水文
 *  4. 土壤、营养、污染
 *  5. 植物与真菌
 *  6. 食物资源与分解
 *  7. 动物能量、捕食、竞争
 *  8. 疾病与寄生网络
 *  9. 繁殖、死亡、遗传、迁徙
 * 10. 人类聚落与土地利用
 * 11. 生成事件与因果记录
 * 12. 统计、缓存、前端快照
 *
 * M1 已实现步骤 2–4（stepEnvironment）；步骤 5–12 待 M2–M6。
 */
export function stepWorld(prev: WorldSnapshot, rng: RandomStream): WorldSnapshot {
  // §9.3 双缓冲：读 prev（旧快照）、写 next（新快照）、统一提交。
  void prev;
  void rng;
  throw new Error('TODO(M2+): §9.2 更新顺序未实现（12 步，顺序不可变）');
}
