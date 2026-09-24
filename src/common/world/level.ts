/**
 * World access interface shared by block behaviours, physics and AI.
 * Implemented by ServerLevel (authoritative) and ClientLevel (prediction/rendering).
 */
import type { Block } from '../block/registry';
import type { Direction } from './direction';
import type { Random } from '../math/random';
import type { Entity } from '../entity/ecs';
import type { DimensionType } from './dimension';
import type { BlockEntityData } from './chunk';
import type { ItemStack } from '../item/stack';
import type { AABB } from '../math/geom';

/** setBlock flags (reference semantics). */
export const UPDATE_NEIGHBORS = 1;
export const UPDATE_CLIENTS = 2;
export const UPDATE_INVISIBLE = 4;
export const UPDATE_IMMEDIATE = 8;
export const UPDATE_KNOWN_SHAPE = 16;
export const UPDATE_SUPPRESS_DROPS = 32;
export const UPDATE_MOVE_BY_PISTON = 64;
export const UPDATE_ALL = UPDATE_NEIGHBORS | UPDATE_CLIENTS;

/** Minimal read access (physics, meshing helpers). */
export interface BlockGetter {
  getBlockState(x: number, y: number, z: number): number;
}

export interface LevelAccess extends BlockGetter {
  readonly isClient: boolean;
  readonly dim: DimensionType;
  readonly random: Random;
  readonly minY: number;
  readonly maxY: number;

  getGameTime(): number;
  getDayTime(): number;
  isLoaded(x: number, z: number): boolean;

  setBlock(x: number, y: number, z: number, state: number, flags?: number): boolean;
  removeBlock(x: number, y: number, z: number, moved?: boolean): boolean;
  destroyBlock(x: number, y: number, z: number, drop: boolean, breaker?: Entity): boolean;

  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined;
  setBlockEntity(be: BlockEntityData): void;
  removeBlockEntity(x: number, y: number, z: number): void;
  blockEntityChanged(x: number, y: number, z: number): void;

  scheduleTick(x: number, y: number, z: number, block: Block, delay: number, priority?: number): void;
  hasScheduledTick(x: number, y: number, z: number, block: Block): boolean;
  scheduleFluidTick(x: number, y: number, z: number, fluid: 'water' | 'lava', delay: number): void;

  /** Notify the 6 neighbours with neighborChanged (block update). */
  updateNeighborsAt(x: number, y: number, z: number, block: Block): void;
  updateNeighborsAtExceptFromFacing(x: number, y: number, z: number, block: Block, skip: Direction): void;
  neighborChanged(x: number, y: number, z: number, fromBlock: Block, fx: number, fy: number, fz: number): void;
  /** Queue a block event (pistons, note blocks…). */
  blockEvent(x: number, y: number, z: number, block: Block, id: number, param: number): void;
  /** Comparator/analog neighbours update. */
  updateNeighbourForOutputSignal(x: number, y: number, z: number, block: Block): void;

  // Redstone queries (reference semantics)
  getSignal(x: number, y: number, z: number, dir: Direction): number;
  getDirectSignal(x: number, y: number, z: number, dir: Direction): number;
  getDirectSignalTo(x: number, y: number, z: number): number;
  hasNeighborSignal(x: number, y: number, z: number): number | boolean;
  getBestNeighborSignal(x: number, y: number, z: number): number;
  hasSignal(x: number, y: number, z: number, dir: Direction): boolean;

  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  /** Raw brightness max(sky - skyDarken, block). */
  getMaxLocalRawBrightness(x: number, y: number, z: number): number;
  canSeeSky(x: number, y: number, z: number): boolean;
  getHeight(type: 'surface' | 'motion' | 'opaque', x: number, z: number): number;
  getBiome(x: number, y: number, z: number): number;
  isRaining(): boolean;
  isThundering(): boolean;
  isRainingAt(x: number, y: number, z: number): boolean;
  getSkyDarken(): number;
  isDay(): boolean;

  playSound(x: number, y: number, z: number, sound: string, volume?: number, pitch?: number, except?: Entity): void;
  /** Level events (particles/sounds by numeric id, like "block break" effects). */
  levelEvent(type: number, x: number, y: number, z: number, data: number, except?: Entity): void;
  addParticle(type: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, count?: number, data?: number): void;
  /** Vibration / game event. */
  gameEvent(type: string, x: number, y: number, z: number, source?: Entity, blockState?: number): void;

  spawnItem(x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number, pickupDelay?: number): Entity | null;
  spawnExperience(x: number, y: number, z: number, amount: number): void;
  addFreshEntity(e: Entity): boolean;
  createEntity(type: string, x: number, y: number, z: number, opts?: Record<string, unknown>): Entity | null;
  getEntities(box: AABB, filter?: (e: Entity) => boolean, except?: Entity): Entity[];
  getPlayers(): Entity[];
  explode(source: Entity | null, x: number, y: number, z: number, power: number, fire: boolean, mode: 'none' | 'block' | 'mob' | 'tnt' | 'trigger'): void;
  getDifficulty(): number;
  getGameRule(name: string): boolean | number;
}

/** Context passed to getStateForPlacement. */
export interface PlaceContext {
  readonly level: LevelAccess;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Face of the clicked block. */
  readonly face: Direction;
  /** Hit position relative to the placed block (0..1). */
  readonly hitX: number;
  readonly hitY: number;
  readonly hitZ: number;
  readonly block: Block;
  /** Player look direction. */
  readonly yaw: number;
  readonly pitch: number;
  readonly sneaking: boolean;
  /** Whether the target position was replaced (clicked a replaceable block). */
  readonly replacingClicked: boolean;
  readonly player: Entity | null;
  readonly stack: ItemStack | null;
  /** Horizontal direction the player looks at. */
  horizontalDirection(): Direction;
  /** Directions ordered by closeness to look vector. */
  nearestLookingDirections(): Direction[];
  /** Default state of the block, waterlogged if placed into water. */
  defaultStateWithWater(): number;
  /** Is there water source at the target position. */
  inWater(): boolean;
}

export interface UseContext {
  readonly player: Entity;
  readonly hand: 'main' | 'off';
  readonly stack: ItemStack;
  readonly face: Direction;
  readonly hitX: number;
  readonly hitY: number;
  readonly hitZ: number;
  readonly sneaking: boolean;
}
