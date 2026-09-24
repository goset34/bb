/**
 * Chunk generator interface. Terrain ("noise" stage) runs in generation workers; decoration
 * (features + structure pieces) runs on the server with access to a 3×3 region.
 */
import type { Chunk } from '../world/chunk';
import type { WorldSeed } from '../math/random';
import type { DimensionType } from '../world/dimension';

export type WorldType = 'normal' | 'flat' | 'floating_islands' | 'amplified' | 'single_biome' | 'debug_simple';

export interface GeneratorSettings {
  type: WorldType;
  /** Flat world layers from bottom to top: [block, count]. */
  flatLayers?: Array<[string, number]>;
  flatBiome?: string;
  singleBiome?: string;
  structures: boolean;
  bonusChest: boolean;
}

export const DEFAULT_SETTINGS: GeneratorSettings = { type: 'normal', structures: true, bonusChest: false };

/** Mutable access to a 3×3 (or larger) chunk neighbourhood during decoration. */
export interface GenRegion {
  readonly seed: WorldSeed;
  readonly dim: DimensionType;
  readonly centerX: number;
  readonly centerZ: number;
  readonly minY: number;
  readonly maxY: number;
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  /** Heightmap query (surface: first air above non-air, motion: above solid/fluid, ocean_floor: above solid). */
  getHeight(kind: 'surface' | 'motion' | 'ocean_floor' | 'opaque', x: number, z: number): number;
  getBiome(x: number, y: number, z: number): number;
  isInside(x: number, z: number): boolean;
  setBlockEntity(x: number, y: number, z: number, type: string, data: Record<string, unknown>): void;
  /** Queue an entity to spawn once the chunk is full (villagers, mobs in structures). */
  addEntity(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): void;
  /** Schedule a block/fluid tick after load (e.g. water falls from springs). */
  scheduleTick(x: number, y: number, z: number, delay: number): void;
}

export interface ChunkGenerator {
  readonly dim: DimensionType;
  /** Fill terrain, surface, carvers and biomes for a chunk (worker-safe, no neighbours). */
  generateTerrain(chunk: Chunk): void;
  /** Place features and structure pieces for the chunk centred in `region`. */
  decorate(region: GenRegion, cx: number, cz: number): void;
  /** Approximate surface height (used for spawn search and far-terrain LOD). */
  surfaceHeight(x: number, z: number): number;
  /** Biome id at block coordinates (climate sampling, no chunk needed). */
  biomeAt(x: number, y: number, z: number): number;
  /** Find a suitable spawn location near the origin. */
  findSpawn(): { x: number; y: number; z: number };
  /** Structure locator for /locate and eyes of the void. */
  locateStructure?(name: string, x: number, z: number, radiusChunks: number): { x: number; y: number; z: number } | null;
}
