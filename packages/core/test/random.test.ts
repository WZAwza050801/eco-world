/**
 * M0 验收：RandomStream（契约 §8.3 / §14.1）。
 * 验收项对应提示词第 4 步：
 *  - 同 seed 两次生成 10000 个数，序列逐位一致；
 *  - fork("a") 与 fork("b") 产生不同但可复现的序列；
 *  - serialize 后反序列化，继续 next() 与原流结果一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RandomStream } from '../src/random/RandomStream.js';

test('同 seed 两次生成 10000 个数，序列逐位一致', () => {
  const a = new RandomStream(12345);
  const b = new RandomStream(12345);
  for (let i = 0; i < 10000; i++) {
    assert.strictEqual(a.next(), b.next(), `第 ${i} 个数不一致`);
  }
});

test('next() 输出均在 [0,1) 且无 NaN', () => {
  const r = new RandomStream(1);
  let min = 1;
  let max = 0;
  for (let i = 0; i < 100000; i++) {
    const v = r.next();
    assert.ok(Number.isFinite(v), '出现 NaN/Infinity');
    assert.ok(v >= 0 && v < 1, `越界: ${v}`);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(max > 0.9 && min < 0.1, '分布明显偏离均匀');
});

test('nextInt(n) 输出均在 [0,n)', () => {
  const r = new RandomStream(42);
  for (let i = 0; i < 10000; i++) {
    const v = r.nextInt(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6, `nextInt 越界: ${v}`);
  }
  assert.throws(() => r.nextInt(0), RangeError);
  assert.throws(() => r.nextInt(2.5), RangeError);
});

test('nextGaussian() 均值≈0、标准差≈1（20000 样本）', () => {
  const r = new RandomStream(2026);
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = r.nextGaussian();
    assert.ok(Number.isFinite(v), '出现 NaN');
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);
  assert.ok(Math.abs(mean) < 0.05, `均值偏离: ${mean}`);
  assert.ok(Math.abs(std - 1) < 0.05, `标准差偏离: ${std}`);
});

test('fork("a") 与 fork("b") 序列不同', () => {
  const r = new RandomStream(42);
  const fa = r.fork('a');
  const fb = r.fork('b');
  const seqA = Array.from({ length: 1000 }, () => fa.next());
  const seqB = Array.from({ length: 1000 }, () => fb.next());
  assert.notDeepStrictEqual(seqA, seqB, 'fork("a") 与 fork("b") 产生了相同序列');
});

test('fork(tag) 可复现：同 seed 同调用顺序结果一致', () => {
  const r1 = new RandomStream(42);
  const fa1 = r1.fork('biology:population:cell(3,4)');
  const fb1 = r1.fork('climate:weather:cell(5,6)');
  const r2 = new RandomStream(42);
  const fa2 = r2.fork('biology:population:cell(3,4)');
  const fb2 = r2.fork('climate:weather:cell(5,6)');
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(fa1.next(), fa2.next());
    assert.strictEqual(fb1.next(), fb2.next());
  }
});

test('serialize → fromSerialized 后继续 next() 与原流逐位一致', () => {
  const r = new RandomStream(7);
  // 先消耗若干个数，使 state 偏离初始种子
  r.next();
  r.next();
  r.nextInt(100);
  const snapshot = r.serialize();
  const restored = RandomStream.fromSerialized(snapshot);
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(r.next(), restored.next(), `恢复后第 ${i} 个数不一致`);
  }
});

test('fromSerialized 对非法输入抛错', () => {
  assert.throws(() => RandomStream.fromSerialized('not-hex'), RangeError);
  assert.throws(() => RandomStream.fromSerialized(''), RangeError);
  assert.throws(() => RandomStream.fromSerialized('100000000'), RangeError); // > 2^32-1
  assert.throws(() => RandomStream.fromSerialized('-80000001'), RangeError); // < -2^31
});

test('负 state 往返回归（M2 修复）：serialize 输出负十六进制时 fromSerialized 仍逐位恢复', () => {
  let sawNegative = false;
  for (let seed = 1; seed <= 60; seed++) {
    const r = new RandomStream(seed);
    for (let k = 0; k < 30; k++) {
      r.next();
      const s = r.serialize();
      if (s.startsWith('-')) sawNegative = true;
      const restored = RandomStream.fromSerialized(s);
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(r.next(), restored.next(), `seed=${seed} k=${k} 第 ${i} 个数不一致`);
      }
    }
  }
  assert.ok(sawNegative, '测试未覆盖负 state（serialize 负十六进制路径）');
});

test('同 seed 的 nextGaussian 也可复现', () => {
  const a = new RandomStream(999);
  const b = new RandomStream(999);
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(a.nextGaussian(), b.nextGaussian());
  }
});
