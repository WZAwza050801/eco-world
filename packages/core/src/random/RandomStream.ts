/**
 * 可复现随机流（契约 §8.3 冻结接口 + §14.1 冻结骨架的实现）。
 *
 * - 冻结来源：docs/00-design-contract.md §8.3「随机数接口」、§14.1「随机流骨架」。
 * - 红线：禁止任何模块直接调用全局 Math.random（契约 §8.3）；
 *   所有随机数从根种子派生的流获取，派生 tag 由「模块:对象:id」组成，保证重放一致。
 * - 算法：next() 用 Mulberry32；nextGaussian() 用 Box-Muller；
 *   fork(tag) 用 tag 的 FNV-1a 32 位稳定哈希与父流随机数混合派生新种子。
 */

/** FNV-1a 32 位稳定字符串哈希（fork 的 tag 哈希，跨平台跨会话稳定） */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RandomStream {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** §14.1: Mulberry32，返回 [0,1) 均匀分布 */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** §14.1: 返回 [0,n) 整数；参数必须为正整数，防止 NaN/越界（红线 4） */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`nextInt(n): n 必须为正整数，收到 ${n}`);
    }
    return Math.floor(this.next() * n);
  }

  /** §14.1: Box-Muller，用两次 next()，保证同种子可复现 */
  nextGaussian(): number {
    const u1 = 1 - this.next(); // ∈ (0,1]，避免 log(0)
    const u2 = this.next(); // ∈ [0,1)
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** §8.3: 派生流，tag 稳定；tag 哈希与父流随机数混合派生新种子（§14.1 骨架注释） */
  fork(tag: string): RandomStream {
    const tagHash = fnv1a32(tag);
    return new RandomStream((tagHash ^ this.nextInt(0x10000000)) >>> 0);
  }

  /** §14.1: 返回可存档的状态字符串（16 进制） */
  serialize(): string {
    return this.state.toString(16);
  }

  /**
   * 反序列化（问题单 Q3）：契约 §8.3 冻结的 5 个实例方法不含反序列化入口，
   * 此处以静态构造方法扩展，不改动冻结签名。parseInt(s, 16) 恢复 state。
   */
  static fromSerialized(serialized: string): RandomStream {
    const parsed = parseInt(serialized, 16);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new RangeError(`fromSerialized: 非法的随机流状态 "${serialized}"`);
    }
    return new RandomStream(parsed);
  }
}
