/**
 * ECO WORLD 核心类型定义（契约 §3 + §8.4 的逐字实现，冻结）。
 *
 * - 冻结来源：docs/00-design-contract.md §3「核心数据结构」、§8.4「事件因果记录」。
 * - 字段名与契约一字不差，禁止别名（契约 §1.3）。
 * - 注释一律带单位（契约 §1.2 单位系统）。
 * - 契约未给出字段定义的引用类型在本文件尾部集中给出【非冻结占位】定义，
 *   均标注 @non-frozen，详见 docs/03-agent-tasks.md 问题单 Q1/Q2。
 */

// ───────────────────────── §3.1 Cell（地理单元） ─────────────────────────

export interface CellId {
  x: number; // 列，x ∈ [0, W)
  y: number; // 行，y ∈ [0, H)
}

export interface Cell {
  id: CellId;
  // 静态（地质/地形，慢变）
  elevation: number; // m
  slope: number; // 0..1
  aspect: number; // rad, 0=北
  terrainType: TerrainType;
  geologicalType: GeologicalType;
  landWaterFraction: number; // 0..1, 0=全陆地 1=全水
  coastDistance: number; // km
  latitude: number; // deg
  neighbors: CellId[]; // 4 邻域（契约 §1.3：上右下左，边界墙）

  // 动态环境场
  temperature: number; // °C
  precipitation: number; // mm/day
  humidity: number; // 0..1
  soilMoisture: number; // mm 有效水
  surfaceWater: number; // mm 地表水
  groundwater: number; // mm 地下水
  nutrients: number; // kgN/cell
  oxygen: number; // 0..1 饱和度
  salinity: number; // g/L
  organicMatter: number; // kgC/cell 死亡有机质
  diseasePressure: number; // 0..1
  pollution: number; // 0..1
  fireRisk: number; // 0..1

  // 派生（缓存）
  biome: BiomeType;
  carryingCapacity: Record<string, number>; // speciesId -> kgC or ind
  accessibility: number; // 0..1
  productivity: number; // kgC/(cell·day) 净初级生产力
}

// ───────────────────── §3.2 SpeciesDefinition（物种模板） ─────────────────────

export interface SpeciesDefinition {
  id: string; // 命名规则见契约 §17.3：{genus}_{specific}_{type}
  taxonomy: Taxonomy;
  roles: FunctionalRoles; // 0..1 权重，用于食物网绘制与粗分类
  physiology: Physiology;
  environment: EnvironmentPreference;
  resources: ResourceProfile;
  lifeHistory: LifeHistory;
  movement: MovementProfile;
  interactions: InteractionProfile;
  genetics: GeneticsProfile;
  disease: DiseaseProfile;
  ecosystemEffects: EcosystemEffectProfile;
  simulationTier: 'field' | 'population' | 'agent' | 'network';
}

// ─────────────────── §3.3 PopulationState（种群运行时状态） ───────────────────

export interface PopulationState {
  speciesId: string;
  cellId: CellId;
  count: number; // ind/cell（植物为 kgC 存于 biomass 字段）
  biomass: number; // kgC/cell
  ageStructure: { juvenile: number; adult: number; old: number }; // 比例和
  energyReserve: number; // kJ/ind 平均
  health: number; // 0..1
  infectionState: Record<string, number>; // pathogenId -> 感染个体比例 I 0..1
  recoveredState?: Record<string, number>; // Q11 @non-frozen 可选扩展：pathogenId -> 康复比例 R 0..1（S=1−I−R）
  traitMeans: Record<string, number>; // 性状均值
  traitVariance: Record<string, number>;
}

// ─────────────────── §3.4 WorldSnapshot（时间步快照，不可变） ───────────────────

export interface WorldSnapshot {
  time: number; // day
  season: number; // 0..1（年相位）
  cells: Cell[];
  populations: PopulationState[];
  agents: AgentState[];
  interactions: InteractionState[];
  events: HistoricalEvent[];
  randomState: string; // 随机流序列化
}

// ───────────────────────── §3.5 其他关键类型 ─────────────────────────

export type TerrainType =
  | 'mountain'
  | 'hill'
  | 'plain'
  | 'river'
  | 'lake'
  | 'ocean'
  | 'wetland';

export type BiomeType =
  | 'tropical_forest'
  | 'seasonal_forest'
  | 'temperate_forest'
  | 'grassland'
  | 'desert'
  | 'tundra'
  | 'wetland'
  | 'freshwater'
  | 'coastal_ocean'
  | 'deep_ocean';

export interface Range {
  min: number;
  max: number;
}

export interface Taxonomy {
  domain: string;
  kingdom: string;
  phylum?: string;
  className?: string;
  order?: string;
  family?: string;
  genus?: string;
  speciesName: string;
  fictional: boolean;
}

export interface FunctionalRoles {
  producer: number;
  herbivore: number;
  carnivore: number;
  omnivore: number;
  decomposer: number;
  pollinator: number;
  parasite: number;
  pathogen: number;
  ecosystemEngineer: number;
}

// ───────────────────── §8.4 HistoricalEvent（事件因果记录，冻结） ─────────────────────

export interface HistoricalEvent {
  id: string;
  time: number; // day
  type: EventType;
  location?: CellId[];
  participants?: string[];
  causes: CausalFactor[]; // 引用真实状态量及其变化
  outcomes: Outcome[];
  severity: number;
  visibility: 'hidden' | 'discoverable' | 'headline';
}

// ═════════════════════════════════════════════════════════════════
// 以下为【非冻结占位类型】：契约引用但未给出字段定义，字段按 §15 实例
// 反推，待契约 v2.1 冻结后覆盖。见 docs/03-agent-tasks.md 问题单 Q1/Q2。
// ═════════════════════════════════════════════════════════════════

/**
 * @non-frozen 占位（Q2）：契约 §3.1 引用 GeologicalType 但未定义。
 */
export type GeologicalType = string;

/**
 * @non-frozen 占位（Q1）：按契约 §15.1–15.3 实例推导。
 * Q9 扩展（M2，可选字段，不改冻结签名）：B1/B2 公式引用但契约接口未给出的
 * 物种级代谢参数，缺省值见 biology/photosynthesis.ts 的 @non-frozen 常量。
 */
export interface Physiology {
  bodyMass: number; // kg
  maturityAge: number; // year
  maximumAge: number; // year
  rStrategyScore: number; // 0..1，r/k 策略谱位置
  pMax?: number; // kgC/(cell·day) 植物最大总初级生产力（B1 P_MAX）
  maxBiomass?: number; // kgC/cell 植物 standing crop 上限（B3）
  maintenanceRespiration?: number; // 1/day 维持呼吸占生物量比例（B2）
  growthRespiration?: number; // 0..1 生长呼吸占盈余 GPP 比例（B2）
  tempOptimum?: number; // °C 光合/代谢最适温度（B1 高斯峰）
  tempTolerance?: number; // °C 高斯宽度 σ（B1）
  reserveMaxDays?: number; // day 能量储备满额天数（K 策略者耐饿更久；缺省 RESERVE_MAX_DAYS）
}

/**
 * @non-frozen 占位（Q1）：按契约 §15.1 实例（温度 [−5,35]°C、水分 [20,200] mm）推导。
 */
export interface EnvironmentPreference {
  temperature: Range; // °C
  water: Range; // mm
  biomes: BiomeType[];
}

/**
 * @non-frozen 占位（Q1）：按契约 §15.2–15.3 实例（食物来源、minimumDailyEnergy kJ）推导。
 * Q9 扩展（M2，可选字段）：B1 半饱和常数与食物网能量换算参数。
 */
export interface ResourceProfile {
  foodSources: string[]; // speciesId 列表或资源类别
  minimumDailyEnergy: number; // kJ/(ind·day)
  kWater?: number; // mm 水分半饱和常数（B1 waterFactor）
  kNutrient?: number; // kgN/cell 营养半饱和常数（B1 nutrientFactor）
  energyDensity?: number; // kJ/kgC（植物）或 kJ/kg 体重（动物）能量密度
  conversionEfficiency?: number; // 0..1 摄入→同化的转化效率（B6 energyGain）
}

/**
 * @non-frozen 占位（Q1）：按契约 §15.1–15.3 实例（offspringPerEvent、繁殖间隔、juvenileSurvival）推导。
 */
export interface LifeHistory {
  reproductionType: 'seed' | 'sexual';
  offspringPerEvent: Range; // ind
  reproductiveIntervalYears: number; // year
  juvenileSurvival: number; // 0..1
}

/**
 * @non-frozen 占位（Q1）：按契约 §5 B9 扩散模板与 §15 实例（speed km/day、territorial/diffusive）推导。
 */
export interface MovementProfile {
  dispersalMethod: 'seed' | 'spore' | 'walking' | 'flying' | 'wind' | 'human_assisted';
  speedKmPerDay: number; // km/day
  pattern: 'diffusive' | 'territorial';
}

/**
 * @non-frozen 占位（Q1）：按契约 §5 B7、§15.3（捕食系数见 foodweb-edges.json）推导。
 */
export interface InteractionProfile {
  preysOn: string[]; // speciesId 列表
  preyedOnBy: string[]; // speciesId 列表
  competitionCoefficients: Record<string, number>; // speciesId -> 系数
}

/**
 * @non-frozen 占位（Q1）：遗传性状（B8/§9.1 年尺度遗传频率）。
 */
export interface GeneticsProfile {
  heritableTraits: string[];
  mutationRate: number; // 0..1
}

/**
 * @non-frozen 占位（Q1）：病原易感性（§6 疾病模型）。
 */
export interface DiseaseProfile {
  susceptibility: Record<string, number>; // pathogenId -> 0..1
}

/**
 * @non-frozen 占位（Q1）：按契约 §15.1（固定土壤、降低 erosion、可燃）推导。
 */
export interface EcosystemEffectProfile {
  soilFixation: number; // 0..1
  erosionReduction: number; // 0..1
  flammability: number; // 0..1
}

/**
 * @non-frozen 占位（Q2）：契约 §3.4 引用 AgentState 但未定义。
 * 个体代理（首领、异常个体等，契约 §1.1）的运行时状态。
 */
export interface AgentState {
  id: string;
  kind: string;
  cellId: CellId;
  state: Record<string, number | string>;
}

/**
 * @non-frozen 占位（Q2）：契约 §3.4 引用 InteractionState 但未定义。
 * 关系网络（食物网、贸易等，契约 §1.1）的运行时状态。
 */
export interface InteractionState {
  id: string;
  kind: string;
  participants: string[];
  strength: number;
}

/**
 * @non-frozen 占位（Q2）：契约 §8.4 引用 EventType 但未定义。
 */
export type EventType = string;

/**
 * @non-frozen 占位（Q2）：按契约 §8.4 文字「引用真实状态量及其变化」推导。
 */
export interface CausalFactor {
  ref: string; // 状态量引用，如 "population:wolf:cell(3,4)"
  change: number; // 该状态量的变化
  description: string;
}

/**
 * @non-frozen 占位（Q2）：按契约 §8.4 文字「outcomes」推导。
 */
export interface Outcome {
  description: string;
  magnitude: number;
}

/**
 * @non-frozen 占位（Q11）：契约 §6 引用 PathogenDefinition 但 §3 未定义；
 * 按 §6（SIR/transmissionMode/hostJumpPotential）与 §15.5（virus_rabbit 实例）推导。
 * 病原内容存于 content/species/*.json，以 transmissionMode 字段与物种区分
 * （loadPathogenDefinitions 加载）。待契约 v2.3 冻结。
 */
export interface PathogenDefinition {
  id: string;
  hostSpecies: string[]; // 易感宿主 speciesId
  transmissionMode: 'contact' | 'air' | 'water' | 'vector' | 'food'; // 传播邻域（§6）
  transmissionRate: number; // 1/day 基础传播率
  recoveryRate: number; // 1/day 康复率
  mortalityRate: number; // 1/day 感染额外死亡率（毒力）
  incubationPeriod: number; // day 潜伏期
  environmentalPersistence: number; // 0..1 环境存活能力
  hostJumpPotential: number; // 0..1 宿主跳转稀有事件概率（§8）
  mutationRate: number; // 0..1 突变率
  densityThreshold: number; // ind/cell 密度阈值（§8.2 高密度更易传播）
}
