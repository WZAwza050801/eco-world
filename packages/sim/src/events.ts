/**
 * 事件因果记录（契约 §8.4 HistoricalEvent，冻结结构；里程碑 M6）。
 * 系统内部保存完整因果链，界面可只展示摘要（§11.4「为什么」查询的数据源）。
 *
 * detectEvents(prev, next)：纯函数，对比前后快照检测显著变化 → HistoricalEvent[]。
 * 因果归因（causes）引用**真实状态量及其变化**（契约 §8.4 冻结要求）：
 *   食物生物量变化、感染比例变化、温度、捕食者数量等，ref 形如 "biomass:grass_c3:cell(3,4)"。
 * 事件 id 确定性（time:type:entity:cell），保证重放一致（§10.5）。
 *
 * 事件类型/阈值/visibility 分级为 @non-frozen（Q13，契约仅冻结 HistoricalEvent 结构）。
 */
import type {
  Cell,
  CausalFactor,
  HistoricalEvent,
  Outcome,
  PopulationState,
  WorldSnapshot,
} from '../../core/src/types.js';

/** @non-frozen（Q13）：事件检测阈值 */
export const CRASH_THRESHOLD = 0.3; // 相对下降 ≥30% → 崩溃
export const BOOM_THRESHOLD = 0.5; // 相对上升 ≥50% → 暴增
export const OUTBREAK_THRESHOLD = 0.1; // 感染比例 crosses 10% → 爆发
export const CLIMATE_EXTREME_C = 60; // |温度| > 60 → 气候极端（E2 边界）
export const MIN_POP_FOR_EVENT = 5; // 小种群不报崩溃/暴增（噪声）
export const MAX_EVENTS_PER_TICK = 50; // 每 tick 事件上限（防刷屏）

const cellRef = (x: number, y: number): string => `cell(${x},${y})`;
const popRef = (speciesId: string, x: number, y: number): string => `${speciesId}:${cellRef(x, y)}`;

function popMagnitude(p: PopulationState, isField: boolean): number {
  return isField ? p.biomass : p.count;
}

function isFieldTier(p: PopulationState, fieldIds: Set<string>): boolean {
  return fieldIds.has(p.speciesId);
}

function isHuman(p: PopulationState, humanIds: Set<string>): boolean {
  return humanIds.has(p.speciesId);
}

/**
 * 检测 prev→next 的显著事件（纯函数，确定性）。
 * fieldIds/humanIds 由调度器从物种定义传入（避免 events.ts 依赖内容加载）。
 */
export function detectEvents(
  prev: WorldSnapshot,
  next: WorldSnapshot,
  fieldIds: Set<string>,
  humanIds: Set<string>,
): HistoricalEvent[] {
  const events: HistoricalEvent[] = [];
  const time = next.time;
  const prevPops = new Map<string, PopulationState>();
  for (const p of prev.populations) prevPops.set(`${p.speciesId}@${p.cellId.x},${p.cellId.y}`, p);
  const prevCells = new Map<string, Cell>();
  for (const c of prev.cells) prevCells.set(cellRef(c.id.x, c.id.y), c);
  const nextCells = new Map<string, Cell>();
  for (const c of next.cells) nextCells.set(cellRef(c.id.x, c.id.y), c);

  const push = (e: HistoricalEvent): void => {
    if (events.length < MAX_EVENTS_PER_TICK) events.push(e);
  };

  for (const p of next.populations) {
    const key = `${p.speciesId}@${p.cellId.x},${p.cellId.y}`;
    const before = prevPops.get(key);
    const field = isFieldTier(p, fieldIds);
    const human = isHuman(p, humanIds);
    const now = popMagnitude(p, field);
    const was = before ? popMagnitude(before, field) : 0;
    const { x, y } = p.cellId;
    const cNow = nextCells.get(cellRef(x, y));
    const cBefore = prevCells.get(cellRef(x, y));

    // 灭绝（动物/人类；植物 0 生物量保留作再生基础，不报灭绝）
    if (!field && was >= MIN_POP_FOR_EVENT && now <= 0) {
      push({
        id: `${time}:extinction:${key}`,
        time,
        type: human ? 'settlement_collapse' : 'extinction',
        location: [{ x, y }],
        participants: [p.speciesId],
        causes: buildCauses(p, before, cBefore, cNow, fieldIds),
        outcomes: [{ description: `${p.speciesId} 局部灭绝`, magnitude: was }],
        severity: 1,
        visibility: 'headline',
      });
      continue;
    }

    if (was >= MIN_POP_FOR_EVENT && now > 0) {
      const rel = (now - was) / was;
      if (rel <= -CRASH_THRESHOLD) {
        push({
          id: `${time}:crash:${key}`,
          time,
          type: human ? 'settlement_decline' : 'population_crash',
          location: [{ x, y }],
          participants: [p.speciesId],
          causes: buildCauses(p, before, cBefore, cNow, fieldIds),
          outcomes: [{ description: `${p.speciesId} 减少 ${Math.round(-rel * 100)}%`, magnitude: now - was }],
          severity: Math.min(1, -rel),
          visibility: -rel >= 0.5 ? 'headline' : 'discoverable',
        });
      } else if (rel >= BOOM_THRESHOLD) {
        push({
          id: `${time}:boom:${key}`,
          time,
          type: human ? 'settlement_growth' : 'population_boom',
          location: [{ x, y }],
          participants: [p.speciesId],
          causes: [
            { ref: popRef(p.speciesId, x, y), change: now - was, description: '资源充足/天敌减少，繁殖上升' },
          ],
          outcomes: [{ description: `${p.speciesId} 增加 ${Math.round(rel * 100)}%`, magnitude: now - was }],
          severity: Math.min(1, rel),
          visibility: 'discoverable',
        });
      }
    }

    // 疾病爆发（感染比例上穿阈值）
    for (const [pid, nextI] of Object.entries(p.infectionState ?? {})) {
      const prevI = before?.infectionState?.[pid] ?? 0;
      if (nextI >= OUTBREAK_THRESHOLD && prevI < OUTBREAK_THRESHOLD) {
        push({
          id: `${time}:outbreak:${pid}:${key}`,
          time,
          type: 'disease_outbreak',
          location: [{ x, y }],
          participants: [p.speciesId, pid],
          causes: [
            { ref: `infection:${pid}:${popRef(p.speciesId, x, y)}`, change: nextI - prevI, description: '高密度促进传播（密度依赖）' },
            { ref: `population:${popRef(p.speciesId, x, y)}`, change: now - was, description: '宿主密度' },
          ],
          outcomes: [{ description: `${pid} 在 ${p.speciesId} 爆发（感染 ${Math.round(nextI * 100)}%）`, magnitude: nextI }],
          severity: Math.min(1, nextI),
          visibility: nextI >= 0.3 ? 'headline' : 'discoverable',
        });
      }
    }
  }

  // 气候极端（温度上穿 |60|）
  for (const c of next.cells) {
    if (Math.abs(c.temperature) <= CLIMATE_EXTREME_C) continue;
    const before = prevCells.get(cellRef(c.id.x, c.id.y));
    if (before && Math.abs(before.temperature) > CLIMATE_EXTREME_C) continue; // 已在极端态不重复报
    push({
      id: `${time}:climate:${cellRef(c.id.x, c.id.y)}`,
      time,
      type: 'climate_extreme',
      location: [{ x: c.id.x, y: c.id.y }],
      causes: [{ ref: `temperature:${cellRef(c.id.x, c.id.y)}`, change: c.temperature - (before?.temperature ?? 0), description: '温度超出 [−60,60]' }],
      outcomes: [{ description: `极端温度 ${c.temperature.toFixed(1)}°C`, magnitude: Math.abs(c.temperature) }],
      severity: Math.min(1, Math.abs(c.temperature) / 70),
      visibility: 'discoverable',
    });
  }

  return events;
}

/** 因果归因：引用真实状态量变化（食物/疾病/气候/捕食），契约 §8.4 */
function buildCauses(
  p: PopulationState,
  before: PopulationState | undefined,
  cBefore: Cell | undefined,
  cNow: Cell | undefined,
  fieldIds: Set<string>,
): CausalFactor[] {
  const causes: CausalFactor[] = [];
  const { x, y } = p.cellId;
  // 疾病：感染比例上升
  for (const [pid, nextI] of Object.entries(p.infectionState ?? {})) {
    const prevI = before?.infectionState?.[pid] ?? 0;
    if (nextI > prevI + 0.01) {
      causes.push({ ref: `infection:${pid}:${popRef(p.speciesId, x, y)}`, change: nextI - prevI, description: `${pid} 传播` });
    }
  }
  // 气候：温度变化
  if (cNow && cBefore && Math.abs(cNow.temperature - cBefore.temperature) > 0.5) {
    causes.push({ ref: `temperature:${cellRef(x, y)}`, change: cNow.temperature - cBefore.temperature, description: '温度变化' });
  }
  // 食物：植物生物量变化（草食/人类）
  if (cNow && cBefore) {
    const dBiomass = cNow.productivity - cBefore.productivity;
    if (Math.abs(dBiomass) > 0.1) {
      causes.push({ ref: `productivity:${cellRef(x, y)}`, change: dBiomass, description: '初级生产力变化（食物）' });
    }
  }
  if (causes.length === 0) {
    causes.push({ ref: popRef(p.speciesId, x, y), change: 0, description: '多种因素综合（详见状态量）' });
  }
  return causes;
}

/** 事件历史合并（累积 + 上限，确定性；@non-frozen Q13） */
export const MAX_EVENT_HISTORY = 500;
export function mergeEventHistory(
  prevEvents: HistoricalEvent[],
  newEvents: HistoricalEvent[],
): HistoricalEvent[] {
  const merged = [...prevEvents, ...newEvents];
  return merged.length > MAX_EVENT_HISTORY ? merged.slice(merged.length - MAX_EVENT_HISTORY) : merged;
}

/** 「为什么」查询（§11.4）：返回某实体相关事件，按贡献（severity）排序 */
export function whyQuery(events: HistoricalEvent[], entityRef: string): HistoricalEvent[] {
  return events
    .filter((e) => e.causes.some((c) => c.ref.includes(entityRef)) || (e.participants ?? []).includes(entityRef))
    .sort((a, b) => b.severity - a.severity);
}
