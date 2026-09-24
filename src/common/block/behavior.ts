/**
 * Block behaviour hooks. The default implementation is inert; specialised behaviours live in
 * common/block/behaviors/* and are attached to blocks by name at startup (see behaviors/index.ts).
 *
 * All hooks receive a `LevelAccess`, which the server implements fully and the client
 * implements for prediction (placement, shape updates).
 */
import type { Direction } from '../world/direction';
import type { LevelAccess, PlaceContext, UseContext } from '../world/level';
import type { Random } from '../math/random';
import type { Entity } from '../entity/ecs';

export type InteractionResult = 'success' | 'consume' | 'pass' | 'fail';

export class BlockBehavior {
  /** State to place, or null if placement is not allowed here. */
  getStateForPlacement(ctx: PlaceContext): number | null {
    return ctx.defaultStateWithWater();
  }

  /** Can the block exist at this position (support checks). */
  canSurvive(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number): boolean {
    return true;
  }

  /**
   * Shape update: a neighbour in `dir` changed to `neighborState`. Return the new state
   * (AIR to break the block, e.g. unsupported plants).
   */
  updateShape(state: number, _dir: Direction, _neighborState: number, _level: LevelAccess, _x: number, _y: number, _z: number, _nx: number, _ny: number, _nz: number): number {
    return state;
  }

  /** Block update (redstone, falling blocks…). */
  neighborChanged(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _fromBlock: number, _fx: number, _fy: number, _fz: number, _moved: boolean): void {}

  onPlace(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _oldState: number, _moved: boolean): void {}

  onRemove(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _newState: number, _moved: boolean): void {}

  use(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _ctx: UseContext): InteractionResult {
    return 'pass';
  }

  attack(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _player: Entity): void {}

  randomTick(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _rng: Random): void {}

  /** Scheduled tick. */
  tick(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _rng: Random): void {}

  entityInside(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _entity: Entity): void {}

  stepOn(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _entity: Entity): void {}

  /** Called when an entity lands on the block; return the fall damage multiplier. */
  fallOn(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _entity: Entity, _fallDistance: number): number {
    return 1;
  }

  /** Called after vertical collision (slime bounce, bed bounce). Return new vy. */
  updateEntityAfterFallOn(_state: number, _entity: Entity, vy: number, _sneaking: boolean): number {
    return 0 * vy;
  }

  isSignalSource(_state: number): boolean {
    return false;
  }

  /** Weak power emitted towards the neighbour in the opposite of `dir` (reference semantics). */
  getSignal(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _dir: Direction): number {
    return 0;
  }

  /** Strong power. */
  getDirectSignal(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _dir: Direction): number {
    return 0;
  }

  hasAnalogOutput(_state: number): boolean {
    return false;
  }

  getAnalogOutput(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number): number {
    return 0;
  }

  /** Block event (pistons, note blocks, chests). Return true if handled. */
  triggerEvent(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _id: number, _param: number): boolean {
    return false;
  }

  /** Can a mob path through this block. */
  isPathfindable(_state: number, _type: 'land' | 'water' | 'air'): boolean {
    return false;
  }

  /** Called when a player finishes breaking the block (before removal). */
  playerWillDestroy(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _player: Entity): void {}

  /** Projectile hit (target block, bell, chorus flower…). */
  onProjectileHit(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _projectile: Entity): void {}

  /** Client-only ambient particles/sounds. */
  animateTick(_state: number, _level: LevelAccess, _x: number, _y: number, _z: number, _rng: Random): void {}

  /** Mirror/rotate support for structures (return rotated state). */
  rotate(state: number, _quarterTurns: number): number {
    return state;
  }

  mirror(state: number, _axis: 'x' | 'z'): number {
    return state;
  }
}

export const DEFAULT_BEHAVIOR = new BlockBehavior();
