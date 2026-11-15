/**
 * 调度器（契约 §14.7 冻结签名；§9.2 冻结更新顺序）。
 * 实现里程碑：M2 起逐步填充，M6 完成全部 12 步。
 */
import type { WorldSnapshot } from '../../core/src/types.js';
import type { RandomStream } from '../../core/src/random/RandomStream.js';

/** §9.2 冻结更新顺序（不可改变）：
 *  1. 读时间与随机种子
 *  2. 太阳、季节、天气
 *  3. 温度、降水、水文
 *  4. 土壤、营养、污染
 *  5. 植物与真菌
 *  6. 食物资源与分解
 *  7. 动物能量、捕食、竞争
 *  8. 疾病与寄生网络
 *  9. 繁殖、死亡、遗传、迁徙
 * 10. 人类聚落与土地利用
 * 11. 生成事件与因果记录
 * 12. 统计、缓存、前端快照
 */
export function stepWorld(prev: WorldSnapshot, rng: RandomStream): WorldSnapshot {
  // §9.3 双缓冲：读 prev（旧快照）、写 next（新快照）、统一提交。
  void prev;
  void rng;
  throw new Error('TODO(M2+): §9.2 更新顺序未实现（12 步，顺序不可变）');
}
