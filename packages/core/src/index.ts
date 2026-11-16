/**
 * ECO WORLD core 包入口。
 * 导出契约 §2 常量、§3/§8.4 类型、§8.3 随机流，
 * M1 环境场模块（E1–E6：climate / grid / hydrology / soil），
 * 以及 M2 生物模块（B1–B7：biology）。
 */
export * from './types.js';
export * from './constants.js';
export { RandomStream } from './random/RandomStream.js';
export * from './climate/solar.js';
export * from './climate/temperature.js';
export * from './climate/precipitation.js';
export * from './climate/biome.js';
export * from './grid/index.js';
export * from './hydrology/waterBalance.js';
export * from './soil/nutrients.js';
export * from './biology/photosynthesis.js';
export * from './biology/population.js';
export * from './biology/predation.js';
export * from './biology/competition.js';
