/**
 * 流向缓存（契约 §14.6 冻结签名；实现里程碑 M1）。
 * E4：一次性计算每个 cell 的下游邻居；返回 -1 表示汇。
 */
import type { Cell } from '../types.js';

export function computeFlowDirection(cells: Cell[]): Int32Array {
  void cells;
  throw new Error('TODO(M1): E4 流向矩阵未实现');
}
