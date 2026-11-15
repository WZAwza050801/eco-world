/**
 * ECO WORLD 全局常量与默认参数（契约 §2 的逐字实现，冻结）。
 *
 * - 冻结来源：docs/00-design-contract.md §2「全局常量与默认参数」。
 * - 这些默认值被公式引用。内容 agent 录入物种时只能覆盖物种级参数，
 *   不能覆盖全局常量（契约 §2 注）。
 * - 已知缺失：E1–E5 公式引用的 SOLAR_AMPLITUDE_DAY / SEASON_AMP /
 *   INFILTRATION_CAPACITY / EVAP_RATE / MAX_SURFACE_WATER / MAX_NUTRIENTS
 *   未在契约 §2 中赋值，待 v2.1 冻结（问题单 Q4），故此处不得擅自补值。
 */

/** 契约 §2：世界尺寸与时间 */
export const WORLD = {
  W: 128, // 列数
  H: 128, // 行数
  CELL_EDGE_KM: 10, // 单元格边长
  CELL_AREA_KM2: 100,
  DAYS_PER_YEAR: 365,
  SEASON_LENGTH_DAYS: 91, // 约一季度
  TICKS_PER_DAY: 1, // 生态 tick
} as const;

/** 契约 §2：气候默认参数 */
export const CLIMATE = {
  SOLAR_AMPLITUDE: 40, // 纬向温度振幅 °C（赤道↔极地）
  BASE_MEAN_TEMP: 14, // 全球平均 °C
  LAPSE_RATE: 6.5e-3, // 温度随海拔递减 °C/m
  OCEAN_MODERATION: 0.6, // 海洋削弱季节振幅的比例
  RAIN_SHADOW_FACTOR: 0.5, // 背风坡降水折扣
  MAX_PRECIP_MM_DAY: 60, // 单日降水上限
} as const;

/** 契约 §2：生物默认参数 */
export const BIOLOGY = {
  HANDLING_TIME_DEFAULT: 0.05, // 捕食处理时间 (1/day)
  ATTACK_RATE_DEFAULT: 0.008, // 攻击率 (1/(ind·day))
  STARVATION_FLOOR: 0.02, // 最低存活能量比例
  DENSITY_KNEE: 0.5, // 密度制约拐点
} as const;
