/**
 * M2 捕食验收（B6 Holling II + 能量换算 + B3 herbivory 项）。
 * 契约 §5 B6、§14.4、§18.1：consumption ≤ preyCount；捕食者无猎物不无限增长；
 * 捕食者不产生负能量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  holling2,
  predationEnergyGain,
  herbivory,
  MAX_GRAZE_FRACTION_PER_DAY,
} from '../src/biology/predation.js';

const closeTo = (actual: number, expected: number, tol = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${expected}，实际 ${actual}`);
};

test('B6: Holling II 冻结公式精确值', () => {
  // (0.008·10·100)/(1+0.008·0.05·100) = 8/1.04
  closeTo(holling2(0.008, 0.05, 10, 100), 8 / 1.04);
});

test('B6: consumption ≤ preyCount（冻结边界，即使攻击率极大）', () => {
  closeTo(holling2(10, 0, 100, 5), 5);
  for (const n of [0.5, 5, 100, 1e6]) {
    assert.ok(holling2(0.008, 0.05, 10, n) <= n);
  }
});

test('B6: 零/负输入 → 0（无猎物/无捕食者/无攻击率不产生捕食）', () => {
  closeTo(holling2(0.008, 0.05, 10, 0), 0);
  closeTo(holling2(0.008, 0.05, 0, 100), 0);
  closeTo(holling2(0, 0.05, 10, 100), 0);
  closeTo(holling2(-1, 0.05, 10, 100), 0);
  closeTo(holling2(0.008, 0.05, -10, 100), 0);
});

test('B6: 处理时间饱和——猎物极大时趋近 predatorCount/handlingTime', () => {
  const limit = 10 / 0.05;
  // N=1e9 时渐近相对误差 ≈ 1/(a·h·N) = 2.5e-6，容差取相对 1e-5
  closeTo(holling2(0.008, 0.05, 10, 1e9), limit, limit * 1e-5);
});

test('B6: 对猎物/捕食者数量单调不减', () => {
  assert.ok(holling2(0.008, 0.05, 10, 200) > holling2(0.008, 0.05, 10, 100));
  assert.ok(holling2(0.008, 0.05, 20, 100) > holling2(0.008, 0.05, 10, 100));
});

test('B6: energyGain = consumption·energyDensity·efficiency，非负（冻结公式/边界）', () => {
  closeTo(predationEnergyGain(10, 1000, 0.5), 5000);
  closeTo(predationEnergyGain(-5, 1000, 0.5), 0);
  closeTo(predationEnergyGain(10, -1000, 0.5), 0);
  closeTo(predationEnergyGain(10, 1000, 2), 10000); // efficiency clamp 到 1
});

test('B3 herbivory（@non-frozen Q9）：饱和采食，≤ 植物量×日采食上限比例', () => {
  const b = 1000;
  const g = 100;
  const maxIntake = 0.1;
  const k = 100;
  const eaten = herbivory(b, g, maxIntake, k);
  closeTo(eaten, Math.min(g * maxIntake * (b / (b + k)), b * MAX_GRAZE_FRACTION_PER_DAY));
  assert.ok(eaten <= b * MAX_GRAZE_FRACTION_PER_DAY);
  closeTo(herbivory(0, g, maxIntake, k), 0);
  closeTo(herbivory(b, 0, maxIntake, k), 0);
  // 植物量极大 → 趋近 g·maxIntake（饱和）
  closeTo(herbivory(1e9, g, maxIntake, k), g * maxIntake, 1e-6);
  assert.ok(herbivory(2000, g, maxIntake, k) > herbivory(500, g, maxIntake, k));
});
