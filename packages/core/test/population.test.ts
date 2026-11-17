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
import {
  fitness,
  rangeSuitability,
  fitnessStressModifier,
  habitatFitness,
  effectiveEnvironment,
  HARD_LETHAL_MULT,
  TEMP_SOFT_WIDTH_C,
  TEMP_HARD_MARGIN_C,
} from '../src/biology/fitness.js';
import {
  migrationCapacity,
  movementPressure,
  suitabilityGradient,
  targetAccessibility,
  dispersalFlow,
  establishment,
  migrationCost,
  EXPLORATION_BASE,
  COLONIZATION_BONUS,
  MAX_EMIGRATION_FRACTION,
} from '../src/biology/dispersal.js';
import { traitSelectionDelta, traitMutationDelta, HERITABILITY_DEFAULT } from '../src/biology/population.js';
import {
  stepSIR,
  densityFactor,
  environmentalFactor,
  DENSITY_TRANSMISSION_MAX,
} from '../src/disease/sir.js';
import {
  stepFungus,
  stepNutrients,
  fungiActivityFromBiomass,
  FUNGUS_MAX_ACTIVITY,
} from '../src/soil/nutrients.js';
import type { Cell, SpeciesDefinition } from '../src/types.js';
import { BIOLOGY, WORLD } from '../src/constants.js';
import { RandomStream } from '../src/random/RandomStream.js';

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

test('B5: 气候胁迫——适生范围内 1，软耐受带高斯衰减上升，硬致死带 HARD_LETHAL_MULT（M3/B8 hard_constraint）', () => {
  closeTo(climateStressModifier(15, { min: -10, max: 35 }), 1);
  closeTo(climateStressModifier(-15, { min: -10, max: 35 }), 1 + 5 * (1 - Math.exp(-0.25))); // d=5, soft=10
  closeTo(climateStressModifier(-22, { min: -10, max: 35 }), 1 + 5 * (1 - Math.exp(-1.44))); // d=12，未过硬界 15
  closeTo(climateStressModifier(-40, { min: -10, max: 35 }), HARD_LETHAL_MULT); // 硬致死 d=30≥15
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

// ───────────────────────── M3：B8 适合度 ─────────────────────────

const rabbitDef = {
  environment: { temperature: { min: -10, max: 35 }, water: { min: 10, max: 300 }, biomes: [] },
  genetics: { heritableTraits: ['coldTolerance', 'bodyMass'], mutationRate: 0.002 },
} as unknown as SpeciesDefinition;

test('B8: 乘法适合度（冻结实现）——因子连乘、clamp01、空数组返回 base', () => {
  closeTo(fitness(2, [0.5, 0.5]), 0.5);
  closeTo(fitness(1, [2, 0.5]), 0.5); // 超 1 因子截断
  closeTo(fitness(3, []), 3);
  closeTo(fitness(1, [-1, 0.5]), 0);
});

test('B8 宽容函数：范围内 1；高斯软衰减；硬致死带 suitability=0 + hard_constraint 标记', () => {
  const r1 = rangeSuitability(15, { min: -10, max: 35 }, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C);
  closeTo(r1.suitability, 1);
  assert.equal(r1.hardConstraint, false);
  const r2 = rangeSuitability(-15, { min: -10, max: 35 }, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C);
  closeTo(r2.suitability, Math.exp(-0.25)); // d=5
  assert.equal(r2.hardConstraint, false);
  const r3 = rangeSuitability(-25, { min: -10, max: 35 }, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C);
  closeTo(r3.suitability, 0); // d=15 = 硬界
  assert.equal(r3.hardConstraint, true);
  assert.equal(fitnessStressModifier(r3.suitability, r3.hardConstraint), HARD_LETHAL_MULT);
});

test('B8 性状→适生范围：coldTolerance +5 → 温度下限外扩 5°C；中性性状不动范围', () => {
  const env = effectiveEnvironment(rabbitDef, { coldTolerance: 5, bodyMass: 3 });
  closeTo(env.temperature.min, -15);
  closeTo(env.temperature.max, 35);
  closeTo(env.water.min, 10);
  // 演化后 −14°C 变为完全适生（未演化时处于软耐受带 <1）
  assert.equal(rangeSuitability(-14, env.temperature, TEMP_SOFT_WIDTH_C, TEMP_HARD_MARGIN_C).hardConstraint, false);
  closeTo(habitatFitness(rabbitDef, -14, 150, { coldTolerance: 5 }), 1);
  assert.ok(habitatFitness(rabbitDef, -14, 150, {}) < 1);
});

test('B8 生境适合度：适生 1，硬致死 0（定殖过滤的依据）', () => {
  closeTo(habitatFitness(rabbitDef, 15, 150), 1);
  closeTo(habitatFitness(rabbitDef, -40, 150), 0); // 温度硬致死 d=30≥15
  closeTo(habitatFitness(rabbitDef, 15, -100), 0); // 水分硬致死 d=110≥100
});

// ───────────────────────── M3：B9 迁徙与扩散 ─────────────────────────

const cellFixture = (elevation: number, accessibility: number): Cell =>
  ({ elevation, accessibility }) as Cell;

test('B9: migrationCapacity = speed/边长（clamp01）；pressure 随密度/适合度赤字上升', () => {
  closeTo(migrationCapacity(2), 0.2);
  closeTo(migrationCapacity(15), 1);
  closeTo(migrationCapacity(0), 0);
  closeTo(movementPressure(100, 1000, 1), EXPLORATION_BASE); // 健康不拥挤 → 仅探索基线
  assert.ok(movementPressure(2000, 1000, 1) > movementPressure(100, 1000, 1)); // 拥挤外迁
  assert.ok(movementPressure(100, 1000, 0) > movementPressure(100, 1000, 1)); // 不适生外迁
  assert.ok(movementPressure(100, 1000, 0) <= 1);
});

test('B9: 适合度梯度只向上；空适生目标有竞争释放加成（定殖空域的关键）', () => {
  closeTo(suitabilityGradient(0.8, 0.5, true), 0);
  closeTo(suitabilityGradient(0.5, 0.8, true), 0.3);
  closeTo(suitabilityGradient(1, 1, true), 0); // 等适生已占据 → 无谓 churn 为 0
  closeTo(suitabilityGradient(1, 1, false), COLONIZATION_BONUS); // 空适生格 → 可定殖
  closeTo(suitabilityGradient(1, 0, false), 0); // 空但不适生 → 不去
});

test('B9: 通行性——步行/种子不跨海洋（冻结边界 accessibility>0），飞行可跨', () => {
  closeTo(targetAccessibility('walking', cellFixture(-5, 0.2)), 0);
  closeTo(targetAccessibility('seed', cellFixture(-5, 0.2)), 0);
  closeTo(targetAccessibility('flying', cellFixture(-5, 0.2)), 0.2);
  closeTo(targetAccessibility('walking', cellFixture(50, 1)), 1);
});

test('B9: 流量公式与冻结边界 flow ≤ population_i；定殖过滤；迁徙成本', () => {
  closeTo(dispersalFlow(100, 0.5, 0.4, 1, 0.2, 1), 100 * 0.5 * 0.4 * 1 * 0.2 * 1);
  closeTo(dispersalFlow(100, 1, 1, 1, 1, 100), 100); // 边界：不超源种群
  closeTo(dispersalFlow(100, 0, 0.5, 1, 0.2, 1), 0);
  closeTo(establishment(10, 0.5), 5);
  closeTo(establishment(10, 0), 0); // 硬致死目标不定殖
  closeTo(migrationCost(1.5), 1.5 * WORLD.CELL_EDGE_KM * 2); // 兔 30 kJ
  closeTo(migrationCost(40), 40 * WORLD.CELL_EDGE_KM * 2); // 狼 800 kJ
  assert.ok(MAX_EMIGRATION_FRACTION <= 1);
});

// ───────────────────────── M3：遗传性状 ─────────────────────────

test('遗传: Lande 方程 Δmean = h²σ²β/世代天数；方差 0 → 无选择响应；突变可复现', () => {
  closeTo(traitSelectionDelta(0.1, 1, 36.5), (HERITABILITY_DEFAULT * 1 * 0.1) / 36.5);
  closeTo(traitSelectionDelta(0.1, 0, 36.5), 0);
  closeTo(traitSelectionDelta(0.1, 1, 365), (HERITABILITY_DEFAULT * 0.1) / 365); // 慢世代物种
  const a = new RandomStream(7).fork('core:biology:genetics');
  const b = new RandomStream(7).fork('core:biology:genetics');
  for (let i = 0; i < 100; i++) {
    closeTo(traitMutationDelta(a.nextGaussian(), 0.002, 36.5), traitMutationDelta(b.nextGaussian(), 0.002, 36.5));
  }
});

// ───────────────────────── M4：D1 疾病 SIR ─────────────────────────

test('D1: 密度因子 = count/threshold（clamp），阈值即流行 tipping point；环境因子随湿度/温度/存活能力', () => {
  closeTo(densityFactor(50, 100), 0.5);
  closeTo(densityFactor(300, 100), 3);
  closeTo(densityFactor(1e9, 100), DENSITY_TRANSMISSION_MAX);
  closeTo(densityFactor(50, 0), 1); // 无阈值 → 中性
  closeTo(environmentalFactor(0.5, 30, 1), 1); // 湿暖+全存活
  assert.ok(environmentalFactor(0, 30, 1) < 0.01); // 干燥抑制
  assert.ok(environmentalFactor(0.5, -10, 1) < 0.01); // 低温抑制
  closeTo(environmentalFactor(0.5, 30, 0), 0); // 无存活能力
});

test('D1: SIR 比例守恒 S+I+R = 1 − deaths（死亡移除质量）；冻结公式精确值', () => {
  const r = stepSIR({
    susceptible: 0.9, infected: 0.1, recovered: 0,
    transmissionRate: 0.5, recoveryRate: 0.1, mortalityRate: 0.4,
    densityFactor: 1, environmentalFactor: 1,
  });
  closeTo(r.newInfections, 0.5 * 0.9 * 0.1); // 0.045
  closeTo(r.recoveries, 0.01);
  closeTo(r.deaths, 0.04);
  closeTo(r.susceptible, 0.855);
  closeTo(r.infected, 0.095);
  closeTo(r.recovered, 0.01);
  closeTo(r.susceptible + r.infected + r.recovered, 1 - r.deaths);
});

test('D1 验收核心：高密度更易传播——高 densityFactor 新感染更多；R0>1 爆发 / R0<1 消退', () => {
  const base = {
    susceptible: 0.99, infected: 0.01, recovered: 0,
    transmissionRate: 0.8, recoveryRate: 0.1, mortalityRate: 0.4,
    environmentalFactor: 1,
  };
  const high = stepSIR({ ...base, densityFactor: 3 }); // R0 = 0.8·3/0.5 = 4.8 > 1
  const low = stepSIR({ ...base, densityFactor: 0.3 }); // R0 = 0.48 < 1
  assert.ok(high.newInfections > low.newInfections, '高密度新感染应更多');
  assert.ok(high.infected > base.infected, 'R0>1 感染比例应上升（爆发）');
  assert.ok(low.infected < base.infected, 'R0<1 感染比例应下降（消退）');
});

test('D1: 边界——newInfections ≤ S，rec+death ≤ I，比例非负；邻居暴露增强传播', () => {
  const r = stepSIR({
    susceptible: 0.2, infected: 0.8, recovered: 0,
    transmissionRate: 100, recoveryRate: 100, mortalityRate: 100,
    densityFactor: 10, environmentalFactor: 1,
  });
  assert.ok(r.newInfections <= 0.2 + 1e-9);
  assert.ok(r.recoveries + r.deaths <= 0.8 + 1e-9);
  assert.ok(r.susceptible >= 0 && r.infected >= 0 && r.recovered >= 0);
  const local = stepSIR({ susceptible: 0.9, infected: 0.1, recovered: 0, transmissionRate: 0.5, recoveryRate: 0.1, mortalityRate: 0.4, densityFactor: 1, environmentalFactor: 1 });
  const exposed = stepSIR({ susceptible: 0.9, infected: 0.1, recovered: 0, exposure: 0.5, transmissionRate: 0.5, recoveryRate: 0.1, mortalityRate: 0.4, densityFactor: 1, environmentalFactor: 1 });
  assert.ok(exposed.newInfections > local.newInfections, '邻居暴露应增强传播');
});

// ───────────────────────── M4：分解真菌 ─────────────────────────

test('真菌: 生物量 → E5 活性（基线 1，随生物量升，上限 FUNGUS_MAX_ACTIVITY）', () => {
  closeTo(fungiActivityFromBiomass(0), 1);
  closeTo(fungiActivityFromBiomass(100), 2);
  closeTo(fungiActivityFromBiomass(1e9), FUNGUS_MAX_ACTIVITY);
});

test('真菌: E5 分解通量随 fungiActivity 线性加速（矿化更多营养，§15.4 加速养分循环）', () => {
  const base = { nutrients: 50, organicMatter: 1000, soilMoisture: 100, temperature: 25, slope: 0, precipitation: 0 };
  const d1 = stepNutrients({ ...base, fungiActivity: 1 });
  const d3 = stepNutrients({ ...base, fungiActivity: 3 });
  closeTo(d3.decomposition, 3 * d1.decomposition);
  assert.ok(d3.nutrients > d1.nutrients, '高真菌活性应矿化更多营养');
});

test('真菌: 温湿+有机质充足时生长并同化有机质；无有机质/低温干燥时衰减（§15.4）', () => {
  const grow = stepFungus({ biomass: 50, organicMatter: 1000, temperature: 25, soilMoisture: 100 });
  assert.ok(grow.biomass > 50, '充足条件下真菌应生长');
  assert.ok(grow.assimilatedC > 0 && grow.organicMatter < 1000, '应同化有机质');
  assert.ok(grow.deadC > 0, '死亡菌体回有机质');
  const starve = stepFungus({ biomass: 50, organicMatter: 0, temperature: 25, soilMoisture: 100 });
  assert.ok(starve.biomass < 50, '无有机质应衰减');
  const cold = stepFungus({ biomass: 50, organicMatter: 1000, temperature: 0, soilMoisture: 100 });
  assert.ok(cold.biomass < 50, '低温应衰减');
  const dry = stepFungus({ biomass: 50, organicMatter: 1000, temperature: 25, soilMoisture: 0 });
  assert.ok(dry.biomass < 50, '干燥应衰减');
});
