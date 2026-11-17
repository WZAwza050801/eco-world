#!/usr/bin/env node
/**
 * 重放存档（契约 §13、§10.5；里程碑 M6）。
 * 存档 = 快照 + 随机流序列化（WorldSnapshot.randomState）；同种子重放逐 tick 一致（M6 验收）。
 *
 * 用法：node scripts/replay.mjs <存档.json> [--ticks N] [--out <最终快照.json>]
 * 默认验证模式：从同一存档独立重放两次，逐 tick 比对序列化结果，全部一致 → 确定性 PASS。
 * 存档由 run-scenario.mjs --save 产出（或任意 serializeWorldSnapshot 输出）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deserializeWorldSnapshot, serializeWorldSnapshot } from '../dist/sim/src/snapshot.js';
import { stepWorld } from '../dist/sim/src/scheduler.js';
import { RandomStream } from '../dist/core/src/random/RandomStream.js';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('用法: node scripts/replay.mjs <存档.json> [--ticks N] [--out <最终快照.json>]');
  process.exit(1);
}
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const ticks = Number(argOf('--ticks', 100));
const out = argOf('--out', null);

const archive = readFileSync(file, 'utf8');
const snapshot0 = deserializeWorldSnapshot(archive);

/** 从存档独立重放 N tick，返回每 tick 序列化序列与终态 */
function replay() {
  let cur = snapshot0;
  const trace = [];
  for (let t = 1; t <= ticks; t++) {
    const rng = RandomStream.fromSerialized(cur.randomState);
    cur = stepWorld(cur, rng);
    trace.push(serializeWorldSnapshot(cur));
  }
  return { trace, final: cur };
}

const a = replay();
const b = replay();
let identical = a.trace.length === b.trace.length;
let firstDiff = -1;
for (let i = 0; i < a.trace.length && identical; i++) {
  if (a.trace[i] !== b.trace[i]) {
    identical = false;
    firstDiff = i + 1;
  }
}

console.log(JSON.stringify({
  archive: file,
  initialTime: snapshot0.time,
  ticksReplayed: ticks,
  finalTime: a.final.time,
  finalPopulations: a.final.populations.length,
  eventsAccumulated: a.final.events.length,
  determinism: identical ? 'PASS' : `FAIL@tick${firstDiff}`,
}, null, 2));

if (out) {
  writeFileSync(out, serializeWorldSnapshot(a.final));
  console.error(`最终快照已保存: ${out}`);
}
if (!identical) process.exit(2);
