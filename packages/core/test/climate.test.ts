/**
 * M1 气候模块验收（E1 太阳辐射 / E2 温度 / E3 降水 / E6 群系查表）。
 * 契约 §4、§18.1：温度和降水不产生非法值；山脉两侧降水差异（雨影）；
 * 随机种子可重放（风暴噪声）。常量冻结于契约 §2 v2.1（问题单 Q4 已解决）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarInput, seasonPhase } from '../src/climate/solar.js';
import { temperature } from '../src/climate/temperature.js';
import {
  precipitation,
  prevailingWind,
  orographicLift,
  moistureSource,
  transportFactor,
  seasonalFactor,
  stormNoiseFactor,
  relativeHumidity,
} from '../src/climate/precipitation.js';
import { classifyBiome, type BiomeInput, type BiomeRule } from '../src/climate/biome.js';
import { CLIMATE } from '../src/constants.js';
import { RandomStream } from '../src/random/RandomStream.js';

const closeTo = (actual: number, expected: number, tol = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `期望 ${expected}，实际 ${actual}（容差 ${tol}）`,
  );
};

// ───────────────────────── E1 太阳辐射 ─────────────────────────

test('E1: 赤道夏至≈1.65、冬至≈0.35（SOLAR_AMPLITUDE_DAY=0.65，契约约[0.3,1.6]）', () => {
  closeTo(solarInput(0, 365 / 4), 1 + CLIMATE.SOLAR_AMPLITUDE_DAY);
  closeTo(solarInput(0, (3 * 365) / 4), 1 - CLIMATE.SOLAR_AMPLITUDE_DAY);
});

test('E1: 极地全年≈1（cos(±90°)=0），全球扫描输出有限且≈[0.3,1.7]', () => {
  for (const day of [0, 91, 182, 273]) {
    closeTo(solarInput(90, day), 1, 1e-12);
    closeTo(solarInput(-90, day), 1, 1e-12);
  }
  for (let lat = -90; lat <= 90; lat += 5) {
    for (let day = 0; day < 365; day += 7) {
      const s = solarInput(lat, day);
      assert.ok(Number.isFinite(s), `非有限辐射 @lat=${lat},day=${day}`);
      assert.ok(s >= 0.3 && s <= 1.7, `辐射越界: ${s} @lat=${lat},day=${day}`);
    }
  }
});

test('E1/E2: seasonPhase 南北半球反相、赤道为 0、振幅随纬度增大', () => {
  const day = 365 / 4;
  assert.ok(seasonPhase(45, day) > 0);
  assert.ok(seasonPhase(-45, day) < 0);
  closeTo(seasonPhase(45, day), -seasonPhase(-45, day));
  closeTo(seasonPhase(0, day), 0);
  assert.ok(Math.abs(seasonPhase(80, day)) > Math.abs(seasonPhase(20, day)));
});

// ───────────────────────── E2 温度 ─────────────────────────

test('E2: 赤道海平面年均 = BASE_MEAN_TEMP = 14°C', () => {
  const r = temperature({ latitude: 0, elevation: 0, landWaterFraction: 0, day: 0 });
  closeTo(r.value, CLIMATE.BASE_MEAN_TEMP);
  assert.equal(r.truncated, false);
});

test('E2: 海拔递减 LAPSE_RATE=6.5e-3 °C/m（1000m → −6.5°C）', () => {
  const r = temperature({ latitude: 0, elevation: 1000, landWaterFraction: 0, day: 0 });
  closeTo(r.value, CLIMATE.BASE_MEAN_TEMP - 6.5);
});

test('E2: 纬向梯度（极地年均 14−40 = −26°C）与南北半球季节反相', () => {
  const pole = temperature({ latitude: 90, elevation: 0, landWaterFraction: 0, day: 0 });
  closeTo(pole.value, CLIMATE.BASE_MEAN_TEMP - CLIMATE.SOLAR_AMPLITUDE);
  const day = 365 / 4; // 北半球盛夏
  const north = temperature({ latitude: 45, elevation: 0, landWaterFraction: 0, day });
  const south = temperature({ latitude: -45, elevation: 0, landWaterFraction: 0, day });
  assert.ok(north.value > south.value, '北半球盛夏应比南半球同纬度暖');
  const expectedDiff = 2 * CLIMATE.SEASON_AMP * Math.abs(Math.sin((45 * Math.PI) / 180));
  closeTo(north.value - south.value, expectedDiff, 1e-6);
});

test('E2: 海洋削弱季节振幅（OCEAN_MODERATION=0.6，全水 cell 振幅为陆地 0.4 倍）', () => {
  const day = 365 / 4;
  const base = { latitude: 45, elevation: 0, day };
  const land = temperature({ ...base, landWaterFraction: 0 });
  const ocean = temperature({ ...base, landWaterFraction: 1 });
  const mean = CLIMATE.BASE_MEAN_TEMP - CLIMATE.SOLAR_AMPLITUDE * Math.abs(Math.sin((45 * Math.PI) / 180));
  closeTo(land.value - mean, CLIMATE.SEASON_AMP * Math.abs(Math.sin((45 * Math.PI) / 180)), 1e-6);
  closeTo(ocean.value - mean, 0.4 * CLIMATE.SEASON_AMP * Math.abs(Math.sin((45 * Math.PI) / 180)), 1e-6);
});

test('E2: 边界截断 [−70,70] 并标记 truncated（契约 E2 冻结边界）', () => {
  const cold = temperature({ latitude: 0, elevation: 20000, landWaterFraction: 0, day: 0 });
  assert.equal(cold.value, -70);
  assert.equal(cold.truncated, true);
  const hot = temperature({ latitude: 0, elevation: 0, landWaterFraction: 0, day: 0, greenhouseDelta: 200 });
  assert.equal(hot.value, 70);
  assert.equal(hot.truncated, true);
  const normal = temperature({ latitude: 30, elevation: 500, landWaterFraction: 0.2, day: 100 });
  assert.equal(normal.truncated, false);
});

test('E2: 天气噪声与温室项按加法注入（纯函数，可复现）', () => {
  const base = { latitude: 20, elevation: 100, landWaterFraction: 0, day: 50 };
  const a = temperature({ ...base, weatherNoise: 1.5, greenhouseDelta: 2 });
  const b = temperature({ ...base, weatherNoise: 1.5, greenhouseDelta: 2 });
  closeTo(a.value, b.value);
  const neutral = temperature(base);
  closeTo(a.value, neutral.value + 3.5);
});

// ───────────────────────── E3 降水 ─────────────────────────

test('E3 验收（山脉两侧降水差异）: 迎风坡 > 背风坡，背风折扣趋近 RAIN_SHADOW_FACTOR', () => {
  const lat = 45; // 西风带，风吹向东（windDir = π/2）
  const wind = prevailingWind(lat);
  closeTo(wind, Math.PI / 2);
  const base = { latitude: lat, coastDistance: 100, slope: 0.6, day: 180 };
  // aspect 为下坡方位角：迎风坡面朝来风（aspect = wind + π = 3π/2），背风坡 aspect = π/2
  const windward = precipitation({ ...base, aspect: wind + Math.PI }, 1);
  const leeward = precipitation({ ...base, aspect: wind }, 1);
  assert.ok(windward > leeward, `迎风 ${windward} 应 > 背风 ${leeward}`);
  const liftW = orographicLift(0.6, wind + Math.PI, wind);
  const liftL = orographicLift(0.6, wind, wind);
  closeTo(liftW, 1 + (2.5 - 1) * 0.6); // 最大抬升 2.5（@non-frozen）
  closeTo(liftL, 1 - (1 - CLIMATE.RAIN_SHADOW_FACTOR) * 0.6); // 背风折扣（冻结 0.5）
  closeTo(windward / leeward, liftW / liftL, 1e-9);
  // 平地无地形效应
  closeTo(orographicLift(0, wind, wind), 1);
  closeTo(orographicLift(0, wind + Math.PI, wind), 1);
});

test('E3: 全球扫描降水 ∈ [0, MAX_PRECIP_MM_DAY]，无非法值（契约 §18.1）', () => {
  for (let lat = -85; lat <= 85; lat += 10) {
    for (const coast of [0, 50, 200, 600]) {
      for (const slope of [0, 0.3, 1]) {
        for (const aspect of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
          for (const day of [0, 91, 182, 273]) {
            for (const storm of [0, 0.5, 1, 3, 100]) {
              const p = precipitation({ latitude: lat, coastDistance: coast, slope, aspect, day }, storm);
              assert.ok(Number.isFinite(p), `非有限降水 @lat=${lat}`);
              assert.ok(p >= 0 && p <= CLIMATE.MAX_PRECIP_MM_DAY, `降水越界: ${p}`);
            }
          }
        }
      }
    }
  }
});

test('E3: 水源随离岸距离衰减、副热带干燥带、赤道辐合带更湿', () => {
  assert.ok(moistureSource(0, 0) > moistureSource(0, 150));
  assert.ok(moistureSource(0, 150) > moistureSource(0, 600));
  assert.ok(transportFactor(0) > transportFactor(25), '赤道辐合 > 副热带高压');
  assert.ok(transportFactor(25) < 0.2, '副热带下沉抑制应显著');
  assert.ok(transportFactor(45) > transportFactor(25), '西风带 > 副热带');
  assert.ok(seasonalFactor(45, 365 / 4) > seasonalFactor(45, (3 * 365) / 4), '北半球夏湿冬干');
  assert.ok(seasonalFactor(-45, 365 / 4) < seasonalFactor(-45, (3 * 365) / 4), '南半球反相');
});

test('E3: 风暴噪声同种子可复现、均值≈1（契约 §8.3 随机红线）', () => {
  const draw = (seed: number): number[] => {
    const rng = new RandomStream(seed).fork('core:climate:storm');
    return Array.from({ length: 5000 }, () => stormNoiseFactor(rng.nextGaussian()));
  };
  const a = draw(20261116);
  const b = draw(20261116);
  assert.deepEqual(a, b);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(mean - 1) < 0.05, `风暴噪声均值偏离 1: ${mean}`);
  assert.ok(a.every((v) => v > 0 && Number.isFinite(v)));
});

test('E3: 相对湿度诊断 ∈ [0,1]，海洋比干旱陆地湿', () => {
  for (const p of [0, 1, 5, 60]) {
    for (const sm of [0, 100, 200]) {
      for (const lwf of [0, 0.5, 1]) {
        const h = relativeHumidity(p, sm, lwf);
        assert.ok(h >= 0 && h <= 1, `湿度越界: ${h}`);
      }
    }
  }
  assert.ok(relativeHumidity(5, 100, 1) > relativeHumidity(0, 0, 0));
});

// ───────────────────────── E6 群系查表 ─────────────────────────

const biomeInput = (over: Partial<BiomeInput> = {}): BiomeInput => ({
  temperature: 10,
  precipitation: 2,
  seasonality: 0.3,
  soilMoisture: 50,
  elevation: 100,
  salinity: 0.1,
  landWaterFraction: 0,
  terrainType: 'plain',
  vegetationStructure: 0,
  ...over,
});

const fixtureRules: BiomeRule[] = [
  { biome: 'freshwater', when: { terrainType: 'river' } },
  { biome: 'deep_ocean', when: { landWaterFraction: { min: 0.5 }, elevation: { max: -2000 } } },
  { biome: 'coastal_ocean', when: { landWaterFraction: { min: 0.5 } } },
  { biome: 'desert', when: { precipitation: { max: 0.7 } } },
  { biome: 'grassland', when: {} },
];

test('E6: 只做查表——首条命中、闭区间边界、terrainType 精确匹配、兜底规则', () => {
  assert.equal(classifyBiome(biomeInput(), fixtureRules), 'grassland');
  assert.equal(classifyBiome(biomeInput({ precipitation: 0.7 }), fixtureRules), 'desert'); // 闭区间
  assert.equal(classifyBiome(biomeInput({ precipitation: 0.71 }), fixtureRules), 'grassland');
  assert.equal(classifyBiome(biomeInput({ landWaterFraction: 0.5, elevation: -2000 }), fixtureRules), 'deep_ocean');
  assert.equal(classifyBiome(biomeInput({ landWaterFraction: 0.5, elevation: -1999 }), fixtureRules), 'coastal_ocean');
  assert.equal(classifyBiome(biomeInput({ terrainType: 'river' }), fixtureRules), 'freshwater');
  assert.throws(() => classifyBiome(biomeInput(), []), /无命中规则/);
});
