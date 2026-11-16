/**
 * 流向缓存（契约 §14.6 冻结签名）。
 * E4：一次性计算每个 cell 的下游邻居；返回 -1 表示汇。
 * 契约 E4 注：河流结构由本函数一次性求出流向矩阵缓存，不逐 tick 重算。
 *
 * 约定（@non-frozen 实现细节）：
 *  - 返回值为下游邻居在 cells 数组中的索引（行主序 y*W+x，W 由最大 x+1 导出，
 *    调用方保证 cells 为完整矩形网格的行主序排列，scenario.ts 满足）；
 *  - 海洋 cell（elevation < 0）为终极汇 → -1；
 *  - 陆地 cell 取 4 邻域中严格最低者（最陡下降）；无更低邻居 → -1（内陆洼地）；
 *  - 并列取 neighbors 存储顺序（上右下左，契约 §1.3）首个，保证确定性；
 *  - 流向严格向低程 → 无环，可按高程拓扑序单遍汇流（见 waterBalance.stepHydrology）。
 */
import type { Cell } from '../types.js';

/** E4: 一次性计算每个 cell 的下游邻居索引；-1 表示汇（海洋/内陆洼地） */
export function computeFlowDirection(cells: Cell[]): Int32Array {
  const flow = new Int32Array(cells.length).fill(-1);
  if (cells.length === 0) return flow;
  let W = 0;
  for (const c of cells) W = Math.max(W, c.id.x + 1);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Cell;
    if (c.elevation < 0) continue; // 海洋 = 终极汇
    let best = -1;
    let bestElev = c.elevation;
    for (const nb of c.neighbors) {
      const j = nb.y * W + nb.x;
      const n = cells[j] as Cell;
      if (n.elevation < bestElev) {
        bestElev = n.elevation;
        best = j;
      }
    }
    flow[i] = best;
  }
  return flow;
}
