/**
 * M2 生物模块验收（B1–B5 光合/呼吸/生长/出生/死亡 + B7 竞争）。
 * 契约 §5、§14.2–14.3、§18.1：生物数量不为负；能量不足降低存活/繁殖；
 * 植物缺水不无限增长；边界截断冻结项。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grossPrimaryProduction,
  respiration,
  plantGrowth,
  lightFactor,
  tempFactor,
  waterFactor,
  nutrientFactor,
  GROWTH_RESPIRATION_FRACTION,
  type PhotoInput,
} from '../src/biology/photosynthesis.js';
import {
  stepPopulation,
  densityModifier,
  starvationModifier,
  climateStressModifier,
  RESERVE_MAX_DAYS,
  STARVATION_MAX,
  type PopulationInput,
} from '../src/biology/population.js';
import { effectiveResource } from '../src/biology/competition.js';
import { BIOLOGY } from '../src/constants.js';

const closeTo = (actual: number, expected: number, tol = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${expected}，实际 ${actual}`);
};

const photo = (over: Partial<PhotoInput> = {}): PhotoInput => ({
  solar: 1.2,
  temperature: 20,
  soilMoisture: 150,
  nutrients: 100,
  pMax: 120,
  efficiency: 1,
  seasonFactor: 1,
  ...over,
});

const popInput = (over: Partial<PopulationInput> = {}): PopulationInput => ({
  population: 100,
  adults: 70,
  reproductionRate: 0.05,
  baselineMortality: 0.001,
  carryingCapacity: 1000,
  energyReserve: 6000,
  health: 0.9,
  modifiers: {
    food: 1, healthMod: 1, mate: 1, seasonal: 1, density: 1,
    starvation: 1, disease: 1, predation: 1, climate: 1,
  },
  ...over,
});

// ───────────────────────── B1 光合作用 ─────────────────────────

test('B1 因子：光照 clamp01、温度高斯峰、水分/营养饱和曲线（冻结边界 [0,1]）', () => {
  closeTo(lightFactor(1.65), 1);
  closeTo(lightFactor(0.35), 0.35);
  closeTo(lightFactor(-1), 0);
  closeTo(tempFactor(20, 20, 12), 1);
  closeTo(tempFactor(32, 20, 12), Math.exp(-1));
  closeTo(tempFactor(-50, 20, 12), Math.exp(-((70 / 12) ** 2)), 1e-12);
  closeTo(waterFactor(50, 50), 0.5);
  closeTo(waterFactor(0, 50), 0);
  assert.ok(waterFactor(200, 50) > waterFactor(100, 50));
  closeTo(nutrientFactor(20, 20), 0.5);
  closeTo(nutrientFactor(-5, 20), 0);
});

test('B1: 全因子饱和时 GPP = pMax；缺水/低温 → 0；GPP ∈ [0, pMax]（冻结边界）', () => {
  // 真正饱和夹具：水分/营养远大于半饱和常数，光照/温度/效率/季节均最优
  closeTo(grossPrimaryProduction(photo({ soilMoisture: 1e9, nutrients: 1e9 })), 120, 1e-3);
  // 一般夹具按公式精确核对：120 × 1 × 1 × (150/200) × (100/120) = 75
  closeTo(grossPrimaryProduction(photo()), 120 * (150 / 200) * (100 / 120));
  closeTo(grossPrimaryProduction(photo({ soilMoisture: 0 })), 0);
  assert.ok(grossPrimaryProduction(photo({ temperature: -60 })) < 1e-6);
  const g = grossPrimaryProduction(photo({ efficiency: 5, seasonFactor: 3, solar: 99 }));
  assert.ok(g >= 0 && g <= 120, `GPP 越界: ${g}`);
});

// ───────────────────────── B2 呼吸 / B3 生长 ─────────────────────────

test('B2: 维持呼吸 + 生长呼吸（冻结公式；growthFraction 为 Q9 可选扩展）', () => {
  closeTo(respiration(100, 1000, 0.01), 10 + GROWTH_RESPIRATION_FRACTION * 90);
  closeTo(respiration(5, 1000, 0.01), 10); // GPP < 维持 → 无生长呼吸
  closeTo(respiration(100, 1000, 0.01, 0.5), 10 + 0.5 * 90);
});

test('B3: 生物量更新 clamp [0, maxBiomass]（冻结边界）', () => {
  closeTo(plantGrowth(100, 50, 20, 10, 2000), 120);
  closeTo(plantGrowth(1990, 50, 0, 0, 2000), 2000);
  closeTo(plantGrowth(10, 0, 20, 0, 2000), 0);
});

test('B3/§18.1: 植物缺水不无限增长——GPP=0 时生物量单调衰减至近 0', () => {
  let b = 1000;
  for (let day = 0; day < 1000; day++) {
    const gpp = grossPrimaryProduction(photo({ soilMoisture: 0 }));
    const resp = respiration(gpp, b, 0.01);
    const next = plantGrowth(b, gpp, resp, 0, 2000);
    assert.ok(next <= b, '缺水时生物量不应增长');
    b = next;
  }
  assert.ok(b < 1, `1000 天缺水后生物量应近 0，实际 ${b}`);
});

// ───────────────────────── B4 出生 ─────────────────────────

test('B4: densityModifier 冻结公式 1/(1+DENSITY_KNEE·N/K)；K≤0 → 0', () => {
  closeTo(densityModifier(100, 1000), 1 / (1 + BIOLOGY.DENSITY_KNEE * 0.1));
  closeTo(densityModifier(0, 1000), 1);
  closeTo(densityModifier(100, 0), 0);
});

test('B4: births ∈ [0, adults·reproductionRate]（冻结边界，修正项再大也不超）', () => {
  const m = { food: 10, healthMod: 10, mate: 10, seasonal: 10, density: 10, starvation: 1, disease: 1, predation: 1, climate: 1 };
  const r = stepPopulation(popInput({ modifiers: m }));
  closeTo(r.births, 70 * 0.05);
  const zero = stepPopulation(popInput({ modifiers: { ...m, food: 0 } }));
  closeTo(zero.births, 0);
});

// ───────────────────────── B5 死亡 ─────────────────────────

test('B5: 饥饿修正——储备充足为 1，低于 STARVATION_FLOOR 指数上升（上限 STARVATION_MAX）', () => {
  const need = 800;
  closeTo(starvationModifier(need * RESERVE_MAX_DAYS * 0.5, need), 1);
  closeTo(starvationModifier(0, need), STARVATION_MAX);
  const low = starvationModifier(need * RESERVE_MAX_DAYS * 0.01, need);
  assert.ok(low > 1 && low < STARVATION_MAX, `低储备修正应介于 (1, max): ${low}`);
  assert.ok(starvationModifier(0, need) > low);
  closeTo(starvationModifier(0, 0), 1); // 植物不经过饥饿路径
});

test('B5: 气候胁迫——适生范围内 1，范围外死亡乘子上升', () => {
  closeTo(climateStressModifier(15, { min: -10, max: 35 }), 1);
  closeTo(climateStressModifier(-15, { min: -10, max: 35 }), 1 + 5 * 0.5);
  closeTo(climateStressModifier(-40, { min: -10, max: 35 }), 6);
});

test('B5/§18.1: 能量不足降低存活——starvation 乘子越大死亡越多；数量永不超界/为负', () => {
  const calm = stepPopulation(popInput());
  const starved = stepPopulation(popInput({
    modifiers: { ...popInput().modifiers, starvation: STARVATION_MAX },
  }));
  assert.ok(starved.deaths > calm.deaths);
  assert.ok(starved.population < calm.population);
  const extreme = stepPopulation(popInput({ population: 1, baselineMortality: 100 }));
  assert.ok(extreme.population >= 0);
  assert.ok(extreme.deaths <= 1);
  closeTo(extreme.population, Math.max(0, 1 + extreme.births - extreme.deaths));
});

test('B4+B5: 差分恒等式 population_next = population + births − deaths（≥0）', () => {
  for (const n of [0, 1, 50, 10000]) {
    const r = stepPopulation(popInput({ population: n, adults: n * 0.7 }));
    assert.ok(r.population >= 0 && Number.isFinite(r.population));
    closeTo(r.population, Math.max(0, n + r.births - r.deaths), 1e-9);
  }
});

// ───────────────────────── B7 竞争 ─────────────────────────

test('B7: effectiveResource = R/(1+Σ coef·density)；无竞争者不变，竞争越强越少', () => {
  closeTo(effectiveResource(100, []), 100);
  closeTo(effectiveResource(100, [{ coefficient: 0.5, density: 10 }]), 100 / 6);
  closeTo(effectiveResource(100, [
    { coefficient: 0.5, density: 10 },
    { coefficient: 0.2, density: 5 },
  ]), 100 / 7);
  assert.ok(effectiveResource(100, [{ coefficient: 1, density: 100 }]) < effectiveResource(100, [{ coefficient: 1, density: 10 }]));
  closeTo(effectiveResource(-5, []), 0);
});
