/**
 * WorldSnapshot 的创建、序列化、反序列化接口（契约 §3.4 快照结构，冻结）。
 *
 * - 冻结来源：docs/00-design-contract.md §3.4 WorldSnapshot（字段名一字不差）。
 * - 契约 §10.5：快照不可变；存档 = 快照 + 随机流序列化，保存后必须能逐 tick 重放。
 * - 契约未冻结本文件的函数签名（§14 仅冻结 scheduler/stepWorld 等），
 *   此处接口为 M0 实现，后续里程碑沿用。
 */

import type {
  AgentState,
  Cell,
  HistoricalEvent,
  InteractionState,
  PopulationState,
  WorldSnapshot,
} from '../../core/src/types.js';

/** createWorldSnapshot 的输入：cells 必填，其余可选（默认空集/0） */
export interface SnapshotInit {
  time: number; // day
  season: number; // 0..1（年相位）
  cells: Cell[];
  populations?: PopulationState[];
  agents?: AgentState[];
  interactions?: InteractionState[];
  events?: HistoricalEvent[];
  randomState: string; // 随机流序列化（RandomStream.serialize() 的输出）
}

/** 创建一个不可变快照（浅冻结，深层数组由调用方保证不再原地修改） */
export function createWorldSnapshot(init: SnapshotInit): WorldSnapshot {
  validateFinite(init.time, 'time');
  validateFinite(init.season, 'season');
  if (init.season < 0 || init.season > 1) {
    throw new RangeError(`season 必须在 [0,1]，收到 ${init.season}`);
  }
  return Object.freeze({
    time: init.time,
    season: init.season,
    cells: init.cells,
    populations: init.populations ?? [],
    agents: init.agents ?? [],
    interactions: init.interactions ?? [],
    events: init.events ?? [],
    randomState: init.randomState,
  });
}

/** 序列化：快照 → 存档字符串（JSON）。NaN/Infinity 会破坏重放，提前拒绝（红线 4） */
export function serializeWorldSnapshot(snapshot: WorldSnapshot): string {
  assertSnapshotSanity(snapshot, 'serializeWorldSnapshot');
  return JSON.stringify(snapshot);
}

/** 反序列化：存档字符串 → 快照 */
export function deserializeWorldSnapshot(serialized: string): WorldSnapshot {
  const parsed = JSON.parse(serialized) as WorldSnapshot;
  assertSnapshotSanity(parsed, 'deserializeWorldSnapshot');
  return Object.freeze(parsed);
}

// ───────────────────────── 内部校验 ─────────────────────────

function validateFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} 必须为有限数，收到 ${value}`);
  }
}

/** 递归校验所有数值字段为有限数，防止 NaN/Infinity 混入存档 */
function assertSnapshotSanity(snapshot: WorldSnapshot, where: string): void {
  const stack: unknown[] = [snapshot];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new RangeError(`${where}: 快照含非有限数 ${v}（契约红线：禁止 NaN/Infinity）`);
      }
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
    } else if (v !== null && typeof v === 'object') {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        stack.push((v as Record<string, unknown>)[key]);
      }
    }
  }
}
