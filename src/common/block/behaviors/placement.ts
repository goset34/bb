/**
 * Placement and shape-update behaviours for building blocks (orientation, connections,
 * double blocks, support checks). Mirrors the reference placement rules.
 */
import { BlockBehavior, InteractionResult } from '../behavior';
import {
  blockOf, getValue, setValue, tryGetValue, isFaceSturdy, stateFlags, F, hasTag, S, Block, isBlock, getBlock,
} from '../registry';
import { P } from '../properties';
import type { LevelAccess, PlaceContext, UseContext } from '../../world/level';
import { UPDATE_ALL, UPDATE_CLIENTS } from '../../world/level';
import {
  Direction, DOWN, UP, NORTH, SOUTH, WEST, EAST, OPPOSITE, DX, DY, DZ, HORIZONTALS, isHorizontal, rotateCW, rotateCCW,
} from '../../world/direction';

const AIR = 0;

export function waterAt(level: LevelAccess, x: number, y: number, z: number): boolean {
  const s = level.getBlockState(x, y, z);
  const b = blockOf(s);
  return (b.name === 'water' && (tryGetValue(s, P.level15) ?? 1) === 0) || (stateFlags[s]! & F.WATERLOGGED) !== 0;
}

export function withWater(state: number, ctx: PlaceContext): number {
  return blockOf(state).hasProp(P.waterlogged) ? setValue(state, P.waterlogged, ctx.inWater()) : state;
}

/** Keep water flowing when a waterlogged block's shape updates. */
export function tickWaterIfLogged(state: number, level: LevelAccess, x: number, y: number, z: number): void {
  if (blockOf(state).hasProp(P.waterlogged) && getValue(state, P.waterlogged)) level.scheduleFluidTick(x, y, z, 'water', 5);
}

function sturdy(level: LevelAccess, x: number, y: number, z: number, face: Direction): boolean {
  return isFaceSturdy(level.getBlockState(x, y, z), face);
}

// ---------------------------------------------------------------------------------------------
// Orientation behaviours
// ---------------------------------------------------------------------------------------------

export class PillarBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const axis = ctx.face === UP || ctx.face === DOWN ? 'y' : ctx.face === NORTH || ctx.face === SOUTH ? 'z' : 'x';
    return withWater(setValue(ctx.block.defaultState, P.axis, axis), ctx);
  }
  override rotate(state: number, q: number): number {
    if (q % 2 === 0) return state;
    const a = getValue(state, P.axis);
    return a === 'x' ? setValue(state, P.axis, 'z') : a === 'z' ? setValue(state, P.axis, 'x') : state;
  }
}

/** Faces the player (furnaces, chests, pumpkins, looms…). */
export class FacingPlayerBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return withWater(setValue(ctx.block.defaultState, P.facing, OPPOSITE[ctx.horizontalDirection()]!), ctx);
  }
  override rotate(state: number, q: number): number {
    let f = getValue(state, P.facing);
    for (let i = 0; i < q; i++) f = rotateCW(f);
    return setValue(state, P.facing, f);
  }
}

/** Faces the direction the player looks (fence gates, campfires, stairs direction logic separate). */
export class FacingAwayBehavior extends FacingPlayerBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return withWater(setValue(ctx.block.defaultState, P.facing, ctx.horizontalDirection()), ctx);
  }
}

/** Anvils face clockwise of player look. */
export class AnvilBehavior extends FacingPlayerBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return setValue(ctx.block.defaultState, P.facing, rotateCW(ctx.horizontalDirection()));
  }
}

/** Six-way facing toward the player (pistons, dispensers, droppers, barrels). */
export class Facing6Behavior extends BlockBehavior {
  constructor(private readonly towardLook = false) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const d = ctx.nearestLookingDirections()[0]!;
    return setValue(ctx.block.defaultState, P.facing6, this.towardLook ? d : OPPOSITE[d]!);
  }
}

/** Faces the clicked face (end rods, amethyst, lightning rods). */
export class ClickedFaceBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    let f = ctx.face;
    const b = ctx.block;
    if (b.name === 'verge_rod') {
      const behind = ctx.level.getBlockState(ctx.x - DX[f]!, ctx.y - DY[f]!, ctx.z - DZ[f]!);
      if (isBlock(behind, b) && getValue(behind, P.facing6) === f) f = OPPOSITE[f]!;
    }
    if (b.name.includes('amethyst') && b.name !== 'amethyst_block' && b.name !== 'budding_amethyst') {
      if (!sturdy(ctx.level, ctx.x - DX[f]!, ctx.y - DY[f]!, ctx.z - DZ[f]!, f)) return null;
    }
    return withWater(setValue(b.defaultState, P.facing6, f), ctx);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    const b = blockOf(state);
    if (b.name.includes('amethyst_bud') || b.name === 'amethyst_cluster') {
      const f = getValue(state, P.facing6);
      if (dir === OPPOSITE[f] && !sturdy(level, x - DX[f]!, y - DY[f]!, z - DZ[f]!, f)) return AIR;
    }
    return state;
  }
}

export class ChainBehavior extends PillarBehavior {}

export class HopperBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const d = OPPOSITE[ctx.face]!;
    return setValue(ctx.block.defaultState, P.hopperFacing, d === UP ? DOWN : d);
  }
}

export class ObserverBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return setValue(ctx.block.defaultState, P.facing6, ctx.nearestLookingDirections()[0]!);
  }
}

export class CrafterBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const d = OPPOSITE[ctx.nearestLookingDirections()[0]!]!;
    const top = d === UP || d === DOWN ? OPPOSITE[ctx.horizontalDirection()]! : UP;
    const names = ['down', 'up', 'north', 'south', 'west', 'east'];
    const o = `${names[d]}_${names[top]}`;
    const valid = P.orientation.names.includes(o) ? o : `${names[d]}_up`;
    const idx = P.orientation.indexOfName(valid);
    return idx >= 0 ? setValue(ctx.block.defaultState, P.orientation, P.orientation.values[idx]!) : ctx.block.defaultState;
  }
}

// ---------------------------------------------------------------------------------------------
// Slabs & stairs
// ---------------------------------------------------------------------------------------------

export class SlabBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const cur = ctx.level.getBlockState(ctx.x, ctx.y, ctx.z);
    if (isBlock(cur, ctx.block)) {
      return setValue(setValue(cur, P.slabType, 'double'), P.waterlogged, false);
    }
    const s = withWater(ctx.block.defaultState, ctx);
    const top = ctx.face !== UP && (ctx.face === DOWN || ctx.hitY > 0.5);
    return setValue(s, P.slabType, top ? 'top' : 'bottom');
  }
  override updateShape(state: number, _d: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    return state;
  }
}

export class StairsBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    let s = withWater(ctx.block.defaultState, ctx);
    s = setValue(s, P.facing, ctx.horizontalDirection());
    const top = ctx.face !== UP && (ctx.face === DOWN || ctx.hitY > 0.5);
    s = setValue(s, P.half, top ? 'top' : 'bottom');
    return setValue(s, P.stairShape, stairsShape(s, ctx.level, ctx.x, ctx.y, ctx.z));
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (!isHorizontal(dir)) return state;
    return setValue(state, P.stairShape, stairsShape(state, level, x, y, z));
  }
  override rotate(state: number, q: number): number {
    let f = getValue(state, P.facing);
    for (let i = 0; i < q; i++) f = rotateCW(f);
    return setValue(state, P.facing, f);
  }
}

function isStairs(s: number): boolean {
  return hasTag(s, 'stairs_any') || blockOf(s).name.endsWith('_stairs');
}

function stairsShape(state: number, level: LevelAccess, x: number, y: number, z: number): 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right' {
  const facing = getValue(state, P.facing);
  const half = getValue(state, P.half);
  const front = level.getBlockState(x + DX[facing]!, y, z + DZ[facing]!);
  if (isStairs(front) && getValue(front, P.half) === half) {
    const f2 = getValue(front, P.facing);
    if (isHorizontal(f2) && f2 !== facing && f2 !== OPPOSITE[facing] && canTakeShape(state, level, x, y, z, OPPOSITE[f2]!)) {
      return f2 === rotateCCW(facing) ? 'outer_left' : 'outer_right';
    }
  }
  const back = level.getBlockState(x - DX[facing]!, y, z - DZ[facing]!);
  if (isStairs(back) && getValue(back, P.half) === half) {
    const f3 = getValue(back, P.facing);
    if (isHorizontal(f3) && f3 !== facing && f3 !== OPPOSITE[facing] && canTakeShape(state, level, x, y, z, f3)) {
      return f3 === rotateCCW(facing) ? 'inner_left' : 'inner_right';
    }
  }
  return 'straight';
}

function canTakeShape(state: number, level: LevelAccess, x: number, y: number, z: number, d: Direction): boolean {
  const n = level.getBlockState(x + DX[d]!, y, z + DZ[d]!);
  return !isStairs(n) || getValue(n, P.facing) !== getValue(state, P.facing) || getValue(n, P.half) !== getValue(state, P.half);
}

// ---------------------------------------------------------------------------------------------
// Connections: fences, walls, panes
// ---------------------------------------------------------------------------------------------

const H_PROPS = [P.north, P.south, P.west, P.east];
const H_DIRS: Direction[] = [NORTH, SOUTH, WEST, EAST];

export class FenceBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    let s = withWater(ctx.block.defaultState, ctx);
    for (let i = 0; i < 4; i++) {
      const d = H_DIRS[i]!;
      s = setValue(s, H_PROPS[i]!, this.connectsTo(s, ctx.level.getBlockState(ctx.x + DX[d]!, ctx.y, ctx.z + DZ[d]!), OPPOSITE[d]!));
    }
    return s;
  }
  connectsTo(self: number, n: number, faceOfN: Direction): boolean {
    const nb = blockOf(n);
    const selfB = blockOf(self);
    if (hasTag(n, 'fences')) {
      const woodSelf = hasTag(self, 'wooden_fences');
      const woodN = hasTag(n, 'wooden_fences');
      return woodSelf === woodN || nb === selfB;
    }
    if (hasTag(n, 'fence_gates')) {
      const f = getValue(n, P.facing);
      return f === rotateCW(faceOfN) || f === rotateCCW(faceOfN);
    }
    return isFaceSturdy(n, faceOfN) && !isExceptionForConnection(n);
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    const i = H_DIRS.indexOf(dir);
    if (i < 0) return state;
    return setValue(state, H_PROPS[i]!, this.connectsTo(state, n, OPPOSITE[dir]!));
  }
}

function isExceptionForConnection(s: number): boolean {
  const n = blockOf(s).name;
  return hasTag(s, 'leaves') || n === 'barrier' || n === 'carved_pumpkin' || n === 'jack_o_lantern' || n === 'melon' || n === 'pumpkin' || hasTag(s, 'shell_boxes');
}

export class PaneBehavior extends FenceBehavior {
  override connectsTo(_self: number, n: number, faceOfN: Direction): boolean {
    if (hasTag(n, 'panes') || hasTag(n, 'walls')) return true;
    return isFaceSturdy(n, faceOfN) && !isExceptionForConnection(n);
  }
}

const WALL_PROPS = [P.wallNorth, P.wallSouth, P.wallWest, P.wallEast];

export class WallBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return this.compute(withWater(ctx.block.defaultState, ctx), ctx.level, ctx.x, ctx.y, ctx.z);
  }
  private connects(n: number, faceOfN: Direction): boolean {
    if (hasTag(n, 'walls') || hasTag(n, 'panes')) return true;
    if (hasTag(n, 'fence_gates')) {
      const f = getValue(n, P.facing);
      return f === rotateCW(faceOfN) || f === rotateCCW(faceOfN);
    }
    return isFaceSturdy(n, faceOfN) && !isExceptionForConnection(n);
  }
  compute(state: number, level: LevelAccess, x: number, y: number, z: number): number {
    const above = level.getBlockState(x, y + 1, z);
    const conn: boolean[] = [];
    let s = state;
    for (let i = 0; i < 4; i++) {
      const d = H_DIRS[i]!;
      const c = this.connects(level.getBlockState(x + DX[d]!, y, z + DZ[d]!), OPPOSITE[d]!);
      conn.push(c);
      // tall if the block above covers that side
      const tall = c && (isFaceSturdy(above, DOWN) || (hasTag(above, 'walls') && getValue(above, WALL_PROPS[i]!) !== 'none'));
      s = setValue(s, WALL_PROPS[i]!, c ? (tall ? 'tall' : 'low') : 'none');
    }
    const [n, so, w, e] = conn as [boolean, boolean, boolean, boolean];
    const straight = (n && so && !w && !e) || (!n && !so && w && e);
    const aboveWallPost = hasTag(above, 'walls') && getValue(above, P.up);
    const up = !straight || aboveWallPost || isBlock(above, getBlockSafe('torch')) || hasTag(above, 'fence_gates') || (!n && !so && !w && !e);
    return setValue(s, P.up, up);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === DOWN) return state;
    return this.compute(state, level, x, y, z);
  }
}

function getBlockSafe(name: string): Block {
  return getBlock(name);
}

// ---------------------------------------------------------------------------------------------
// Doors, trapdoors, fence gates
// ---------------------------------------------------------------------------------------------

export class DoorBehavior extends BlockBehavior {
  constructor(private readonly handOpenable: boolean) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const { level, x, y, z } = ctx;
    if (y >= level.maxY - 1) return null;
    if (!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.REPLACEABLE)) return null;
    if (!sturdy(level, x, y - 1, z, UP)) return null;
    const facing = ctx.horizontalDirection();
    const powered = !!level.hasNeighborSignal(x, y, z) || !!level.hasNeighborSignal(x, y + 1, z);
    let s = setValue(ctx.block.defaultState, P.facing, facing);
    s = setValue(s, P.hinge, this.hinge(ctx, facing));
    s = setValue(s, P.powered, powered);
    s = setValue(s, P.open, powered);
    return setValue(s, P.doubleHalf, 'lower');
  }
  private hinge(ctx: PlaceContext, facing: Direction): 'left' | 'right' {
    const { level, x, y, z } = ctx;
    const ccw = rotateCCW(facing), cw = rotateCW(facing);
    const lx = x + DX[ccw]!, lz = z + DZ[ccw]!;
    const rx = x + DX[cw]!, rz = z + DZ[cw]!;
    const leftS = level.getBlockState(lx, y, lz), leftUp = level.getBlockState(lx, y + 1, lz);
    const rightS = level.getBlockState(rx, y, rz), rightUp = level.getBlockState(rx, y + 1, rz);
    const i = (isFull(leftS) ? -1 : 0) + (isFull(leftUp) ? -1 : 0) + (isFull(rightS) ? 1 : 0) + (isFull(rightUp) ? 1 : 0);
    const leftDoor = hasTag(leftS, 'doors') && getValue(leftS, P.doubleHalf) === 'lower';
    const rightDoor = hasTag(rightS, 'doors') && getValue(rightS, P.doubleHalf) === 'lower';
    if ((!leftDoor || rightDoor) && i <= 0) {
      if ((!rightDoor || leftDoor) && i >= 0) {
        const hx = ctx.hitX - 0.5, hz = ctx.hitZ - 0.5;
        const sx = DX[facing]!, sz = DZ[facing]!;
        return (sx < 0 && hz < 0) || (sx > 0 && hz > 0) || (sz < 0 && hx > 0) || (sz > 0 && hx < 0) ? 'right' : 'left';
      }
      return 'left';
    }
    return 'right';
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number, old: number, moved: boolean): void {
    if (moved || isBlock(old, blockOf(state))) return;
    if (getValue(state, P.doubleHalf) === 'lower') {
      const up = level.getBlockState(x, y + 1, z);
      if (!isBlock(up, blockOf(state))) level.setBlock(x, y + 1, z, setValue(state, P.doubleHalf, 'upper'), UPDATE_ALL);
    }
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    const half = getValue(state, P.doubleHalf);
    if ((dir === UP && half === 'lower') || (dir === DOWN && half === 'upper')) {
      if (isBlock(n, blockOf(state)) && getValue(n, P.doubleHalf) !== half) {
        return setValue(n, P.doubleHalf, half);
      }
      return AIR;
    }
    if (half === 'lower' && dir === DOWN && !sturdy(level, x, y - 1, z, UP)) return AIR;
    return state;
  }
  override use(state: number, level: LevelAccess, x: number, y: number, z: number, _ctx: UseContext): InteractionResult {
    if (!this.handOpenable) return 'pass';
    const open = !getValue(state, P.open);
    level.setBlock(x, y, z, setValue(state, P.open, open), UPDATE_CLIENTS | 8);
    // Keep the other half in sync
    const oy = getValue(state, P.doubleHalf) === 'lower' ? y + 1 : y - 1;
    const other = level.getBlockState(x, oy, z);
    if (isBlock(other, blockOf(state))) level.setBlock(x, oy, z, setValue(other, P.open, open), UPDATE_CLIENTS | 8);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, open ? `block.${soundFamily(state)}_door.open` : `block.${soundFamily(state)}_door.close`);
    level.gameEvent(open ? 'block_open' : 'block_close', x, y, z);
    return 'success';
  }
  override neighborChanged(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    const oy = getValue(state, P.doubleHalf) === 'lower' ? y + 1 : y - 1;
    const powered = !!level.hasNeighborSignal(x, y, z) || !!level.hasNeighborSignal(x, oy, z);
    if (powered !== getValue(state, P.powered)) {
      const opened = powered !== getValue(state, P.open);
      level.setBlock(x, y, z, setValue(setValue(state, P.powered, powered), P.open, powered), UPDATE_CLIENTS);
      if (opened) level.playSound(x + 0.5, y + 0.5, z + 0.5, powered ? `block.${soundFamily(state)}_door.open` : `block.${soundFamily(state)}_door.close`);
    }
  }
}

function soundFamily(state: number): string {
  const n = blockOf(state).name;
  if (n.startsWith('iron')) return 'iron';
  if (n.includes('copper')) return 'copper';
  if (n.includes('bamboo')) return 'bamboo_wood';
  if (n.includes('cherry')) return 'cherry_wood';
  if (n.includes('crimson') || n.includes('warped')) return 'nether_wood';
  return 'wooden';
}

function isFull(s: number): boolean {
  return (stateFlags[s]! & F.FULL_COLLISION) !== 0;
}

export class TrapdoorBehavior extends BlockBehavior {
  constructor(private readonly handOpenable: boolean) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    let s = withWater(ctx.block.defaultState, ctx);
    const f = ctx.face;
    if (!ctx.replacingClicked && isHorizontal(f)) {
      s = setValue(s, P.facing, f);
      s = setValue(s, P.half, ctx.hitY > 0.5 ? 'top' : 'bottom');
    } else {
      s = setValue(s, P.facing, OPPOSITE[ctx.horizontalDirection()]!);
      s = setValue(s, P.half, f === UP ? 'bottom' : 'top');
    }
    if (ctx.level.hasNeighborSignal(ctx.x, ctx.y, ctx.z)) s = setValue(setValue(s, P.open, true), P.powered, true);
    return s;
  }
  override use(state: number, level: LevelAccess, x: number, y: number, z: number): InteractionResult {
    if (!this.handOpenable) return 'pass';
    const open = !getValue(state, P.open);
    level.setBlock(x, y, z, setValue(state, P.open, open), UPDATE_CLIENTS);
    tickWaterIfLogged(state, level, x, y, z);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, open ? `block.${soundFamily(state)}_trapdoor.open` : `block.${soundFamily(state)}_trapdoor.close`);
    level.gameEvent(open ? 'block_open' : 'block_close', x, y, z);
    return 'success';
  }
  override neighborChanged(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    const powered = !!level.hasNeighborSignal(x, y, z);
    if (powered !== getValue(state, P.powered)) {
      let s = setValue(state, P.powered, powered);
      if (getValue(state, P.open) !== powered) {
        s = setValue(s, P.open, powered);
        level.playSound(x + 0.5, y + 0.5, z + 0.5, powered ? `block.${soundFamily(state)}_trapdoor.open` : `block.${soundFamily(state)}_trapdoor.close`);
      }
      level.setBlock(x, y, z, s, UPDATE_CLIENTS);
    }
  }
  override updateShape(state: number, _d: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    return state;
  }
}

export class FenceGateBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const f = ctx.horizontalDirection();
    let s = setValue(ctx.block.defaultState, P.facing, f);
    const powered = !!ctx.level.hasNeighborSignal(ctx.x, ctx.y, ctx.z);
    s = setValue(setValue(s, P.powered, powered), P.open, powered);
    return setValue(s, P.inWall, this.inWall(s, ctx.level, ctx.x, ctx.y, ctx.z));
  }
  private inWall(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const f = getValue(state, P.facing);
    const a = rotateCW(f), b = rotateCCW(f);
    return hasTag(level.getBlockState(x + DX[a]!, y, z + DZ[a]!), 'walls') || hasTag(level.getBlockState(x + DX[b]!, y, z + DZ[b]!), 'walls');
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (!isHorizontal(dir)) return state;
    return setValue(state, P.inWall, this.inWall(state, level, x, y, z));
  }
  override use(state: number, level: LevelAccess, x: number, y: number, z: number, ctx: UseContext): InteractionResult {
    let s = state;
    if (getValue(s, P.open)) s = setValue(s, P.open, false);
    else {
      const yaw = (ctx.player.transform?.yaw ?? 0);
      const pdir = HORIZONTALS[Math.floor(yaw / 90 + 0.5) & 3]!;
      if (getValue(s, P.facing) === OPPOSITE[pdir]) s = setValue(s, P.facing, pdir);
      s = setValue(s, P.open, true);
    }
    level.setBlock(x, y, z, s, UPDATE_CLIENTS | 8);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, getValue(s, P.open) ? 'block.fence_gate.open' : 'block.fence_gate.close');
    level.gameEvent(getValue(s, P.open) ? 'block_open' : 'block_close', x, y, z);
    return 'success';
  }
  override neighborChanged(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    const powered = !!level.hasNeighborSignal(x, y, z);
    if (powered !== getValue(state, P.powered)) {
      let s = setValue(state, P.powered, powered);
      if (getValue(state, P.open) !== powered) s = setValue(s, P.open, powered);
      level.setBlock(x, y, z, s, UPDATE_CLIENTS);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Face-attached blocks (buttons, levers, grindstones), torches, ladders, signs
// ---------------------------------------------------------------------------------------------

export class FaceAttachedBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    for (const d of ctx.nearestLookingDirections()) {
      let s: number;
      if (d === UP || d === DOWN) {
        s = setValue(ctx.block.defaultState, P.attachFace, d === UP ? 'ceiling' : 'floor');
        s = setValue(s, P.facing, ctx.horizontalDirection());
      } else {
        s = setValue(ctx.block.defaultState, P.attachFace, 'wall');
        s = setValue(s, P.facing, OPPOSITE[d]!);
      }
      if (this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z)) return s;
    }
    return null;
  }
  static connectedDir(state: number): Direction {
    const face = getValue(state, P.attachFace);
    if (face === 'ceiling') return DOWN;
    if (face === 'floor') return UP;
    return getValue(state, P.facing);
  }
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    if (blockOf(state).name === 'grindstone') return true;
    const d = OPPOSITE[FaceAttachedBehavior.connectedDir(state)]!;
    return sturdy(level, x + DX[d]!, y + DY[d]!, z + DZ[d]!, OPPOSITE[d]!);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    const d = OPPOSITE[FaceAttachedBehavior.connectedDir(state)]!;
    if (dir === d && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

/** Torch placement picks the standing or wall variant. */
export class TorchBehavior extends BlockBehavior {
  constructor(private readonly wallBlock: string) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    for (const d of ctx.nearestLookingDirections()) {
      if (d === UP) continue;
      if (d === DOWN) {
        if (sturdyForTorch(ctx.level, ctx.x, ctx.y - 1, ctx.z)) return ctx.block.defaultState;
      } else {
        const wall = getBlock(this.wallBlock);
        const facing = OPPOSITE[d]!;
        if (sturdy(ctx.level, ctx.x + DX[d]!, ctx.y, ctx.z + DZ[d]!, facing)) return setValue(wall.defaultState, P.facing, facing);
      }
    }
    return null;
  }
  override canSurvive(_s: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return sturdyForTorch(level, x, y - 1, z);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === DOWN && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

/** Torches can stand on fences/walls/glass (center support). */
function sturdyForTorch(level: LevelAccess, x: number, y: number, z: number): boolean {
  const s = level.getBlockState(x, y, z);
  if (isFaceSturdy(s, UP)) return true;
  return hasTag(s, 'fences') || hasTag(s, 'walls') || hasTag(s, 'panes') || blockOf(s).name.endsWith('glass') || blockOf(s).name === 'scaffolding' || blockOf(s).name === 'hopper';
}

export class WallTorchBehavior extends BlockBehavior {
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const f = getValue(state, P.facing);
    return sturdy(level, x - DX[f]!, y, z - DZ[f]!, f);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === OPPOSITE[getValue(state, P.facing)] && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

export class LadderBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const tryFacing = (f: Direction) => {
      if (!isHorizontal(f)) return null;
      const s = setValue(withWater(ctx.block.defaultState, ctx), P.facing, f);
      return this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z) ? s : null;
    };
    if (!ctx.replacingClicked) {
      const r = tryFacing(ctx.face);
      if (r !== null) return r;
    }
    for (const d of ctx.nearestLookingDirections()) {
      const r = tryFacing(OPPOSITE[d]!);
      if (r !== null) return r;
    }
    return null;
  }
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const f = getValue(state, P.facing);
    return sturdy(level, x - DX[f]!, y, z - DZ[f]!, f);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === OPPOSITE[getValue(state, P.facing)] && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

/** Standing signs/banners/skulls rotate with the player; wall variants attach to clicked face. */
export class RotatableStandingBehavior extends BlockBehavior {
  constructor(private readonly wallBlock: string | null, private readonly needsSupport: boolean) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    if (this.wallBlock && !ctx.replacingClicked && isHorizontal(ctx.face)) {
      const wall = getBlock(this.wallBlock);
      const s = withWater(setValue(wall.defaultState, P.facing, ctx.face), ctx);
      if (!this.needsSupport || sturdy(ctx.level, ctx.x - DX[ctx.face]!, ctx.y, ctx.z - DZ[ctx.face]!, ctx.face) || !wall.name.includes('sign')) return s;
    }
    if (ctx.face === DOWN && this.wallBlock?.includes('hanging')) return null;
    const rot = Math.floor(((180 + ctx.yaw) * 16) / 360 + 0.5) & 15;
    let s = withWater(ctx.block.defaultState, ctx);
    s = setValue(s, P.rotation16, rot);
    if (this.needsSupport && !isSolidBelow(ctx.level, ctx.x, ctx.y, ctx.z)) return null;
    return s;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (this.needsSupport && dir === DOWN && !isSolidBelow(level, x, y, z)) return AIR;
    return state;
  }
}

function isSolidBelow(level: LevelAccess, x: number, y: number, z: number): boolean {
  const s = level.getBlockState(x, y - 1, z);
  return (stateFlags[s]! & F.NO_COLLISION) === 0;
}

export class WallAttachedBehavior extends BlockBehavior {
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const f = getValue(state, P.facing);
    const s = level.getBlockState(x - DX[f]!, y, z - DZ[f]!);
    return (stateFlags[s]! & F.NO_COLLISION) === 0;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === OPPOSITE[getValue(state, P.facing)] && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

export class HangingSignBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    if (isHorizontal(ctx.face) && !ctx.replacingClicked) {
      const wall = getBlock(ctx.block.name.replace('_hanging_sign', '_wall_hanging_sign'));
      return withWater(setValue(wall.defaultState, P.facing, rotateCW(ctx.face)), ctx);
    }
    const above = ctx.level.getBlockState(ctx.x, ctx.y + 1, ctx.z);
    if (!isFaceSturdy(above, DOWN) && (stateFlags[above]! & F.NO_COLLISION)) return null;
    const rot = Math.floor(((180 + ctx.yaw) * 16) / 360 + 0.5) & 15;
    let s = withWater(ctx.block.defaultState, ctx);
    s = setValue(s, P.rotation16, rot);
    return setValue(s, P.attached, !isFaceSturdy(above, DOWN) || ctx.sneaking);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === UP && (stateFlags[level.getBlockState(x, y + 1, z)]! & F.NO_COLLISION)) return AIR;
    return state;
  }
}

// ---------------------------------------------------------------------------------------------
// Lanterns, bells, pointed dripstone, snow, stacking blocks
// ---------------------------------------------------------------------------------------------

export class LanternBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const tryHanging = (hanging: boolean) => {
      const s = withWater(setValue(ctx.block.defaultState, P.hanging, hanging), ctx);
      return this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z) ? s : null;
    };
    for (const d of ctx.nearestLookingDirections()) {
      if (d !== UP && d !== DOWN) continue;
      const r = tryHanging(d === UP);
      if (r !== null) return r;
    }
    return null;
  }
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    if (getValue(state, P.hanging)) {
      const above = level.getBlockState(x, y + 1, z);
      return isFaceSturdy(above, DOWN) || blockOf(above).name.includes('chain') || hasTag(above, 'fences') || hasTag(above, 'walls');
    }
    return sturdyForTorch(level, x, y - 1, z);
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    const need = getValue(state, P.hanging) ? UP : DOWN;
    if (dir === need && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

export class SnowLayerBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const cur = ctx.level.getBlockState(ctx.x, ctx.y, ctx.z);
    if (isBlock(cur, ctx.block)) {
      const n = getValue(cur, P.layers);
      return setValue(cur, P.layers, Math.min(8, n + 1));
    }
    return this.canSurvive(ctx.block.defaultState, ctx.level, ctx.x, ctx.y, ctx.z) ? ctx.block.defaultState : null;
  }
  override canSurvive(_s: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const below = level.getBlockState(x, y - 1, z);
    const n = blockOf(below).name;
    if (n === 'ice' || n === 'packed_ice' || n === 'barrier') return false;
    if (n === 'honey_block' || n === 'soul_sand' || n === 'mud') return true;
    if (n === 'snow') return getValue(below, P.layers) === 8;
    return isFaceSturdy(below, UP) || hasTag(below, 'leaves');
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === DOWN && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

/** Count-stacking blocks: candles, sea pickles, turtle eggs, petals. */
export class StackingBehavior extends BlockBehavior {
  constructor(private readonly prop: typeof P.candles, private readonly needsSturdy = true) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const cur = ctx.level.getBlockState(ctx.x, ctx.y, ctx.z);
    if (isBlock(cur, ctx.block)) {
      const n = getValue(cur, this.prop);
      if (n >= this.prop.max) return null;
      return setValue(cur, this.prop, n + 1);
    }
    let s = withWater(ctx.block.defaultState, ctx);
    if (ctx.block.hasProp(P.facing)) s = setValue(s, P.facing, OPPOSITE[ctx.horizontalDirection()]!);
    if (this.needsSturdy && !sturdy(ctx.level, ctx.x, ctx.y - 1, ctx.z, UP)) return null;
    return s;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === DOWN && this.needsSturdy && !sturdy(level, x, y - 1, z, UP)) return AIR;
    return state;
  }
}

export class CarpetBehavior extends BlockBehavior {
  override canSurvive(_s: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return !(stateFlags[level.getBlockState(x, y - 1, z)]! & F.AIR);
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return this.canSurvive(0, ctx.level, ctx.x, ctx.y, ctx.z) ? ctx.block.defaultState : null;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === DOWN && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

/** Grass/podzol/mycelium: snowy when snow is on top. */
export class SnowyDirtBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return setValue(ctx.block.defaultState, P.snowy, isSnow(ctx.level.getBlockState(ctx.x, ctx.y + 1, ctx.z)));
  }
  override updateShape(state: number, dir: Direction, n: number): number {
    if (dir === UP) return setValue(state, P.snowy, isSnow(n));
    return state;
  }
}

function isSnow(s: number): boolean {
  const n = blockOf(s).name;
  return n === 'snow' || n === 'snow_block' || n === 'powder_snow';
}

/** Chests: connect to an adjacent chest facing the same way. */
export class ChestBehavior extends FacingPlayerBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const facing = OPPOSITE[ctx.horizontalDirection()]!;
    let s = withWater(setValue(ctx.block.defaultState, P.facing, facing), ctx);
    if (!ctx.block.hasProp(P.chestType)) return s;
    if (ctx.sneaking) return s;
    const tryDir = (d: Direction, type: 'left' | 'right'): number | null => {
      const n = ctx.level.getBlockState(ctx.x + DX[d]!, ctx.y, ctx.z + DZ[d]!);
      if (isBlock(n, ctx.block) && getValue(n, P.chestType) === 'single' && getValue(n, P.facing) === facing) return setValue(s, P.chestType, type);
      return null;
    };
    const clicked = ctx.face;
    if (isHorizontal(clicked) && !ctx.replacingClicked) {
      const d = OPPOSITE[clicked]!;
      const n = ctx.level.getBlockState(ctx.x + DX[d]!, ctx.y, ctx.z + DZ[d]!);
      if (isBlock(n, ctx.block) && getValue(n, P.chestType) === 'single') {
        const nf = getValue(n, P.facing);
        if (nf !== clicked && nf !== OPPOSITE[clicked]) {
          s = setValue(s, P.facing, nf);
          return setValue(s, P.chestType, rotateCCW(nf) === d ? 'right' : 'left');
        }
      }
    }
    return tryDir(rotateCCW(facing), 'right') ?? tryDir(rotateCW(facing), 'left') ?? s;
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (!blockOf(state).hasProp(P.chestType) || !isHorizontal(dir)) return state;
    const facing = getValue(state, P.facing);
    const type = getValue(state, P.chestType);
    const connDir = type === 'left' ? rotateCW(facing) : type === 'right' ? rotateCCW(facing) : null;
    if (isBlock(n, blockOf(state)) && type === 'single' && getValue(n, P.facing) === facing) {
      const nt = getValue(n, P.chestType);
      if (nt !== 'single' && dir === (nt === 'left' ? rotateCCW(facing) : rotateCW(facing))) {
        return setValue(state, P.chestType, nt === 'left' ? 'right' : 'left');
      }
    } else if (connDir === dir) {
      return setValue(state, P.chestType, 'single');
    }
    return state;
  }
}

export class BedBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const f = ctx.horizontalDirection();
    const hx = ctx.x + DX[f]!, hz = ctx.z + DZ[f]!;
    if (!(stateFlags[ctx.level.getBlockState(hx, ctx.y, hz)]! & F.REPLACEABLE)) return null;
    return setValue(setValue(ctx.block.defaultState, P.facing, f), P.bedPart, 'foot');
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number, old: number, moved: boolean): void {
    if (moved || isBlock(old, blockOf(state))) return;
    if (getValue(state, P.bedPart) === 'foot') {
      const f = getValue(state, P.facing);
      level.setBlock(x + DX[f]!, y, z + DZ[f]!, setValue(state, P.bedPart, 'head'), UPDATE_ALL);
    }
  }
  override updateShape(state: number, dir: Direction, n: number): number {
    const f = getValue(state, P.facing);
    const part = getValue(state, P.bedPart);
    const toOther = part === 'foot' ? f : OPPOSITE[f]!;
    if (dir === toOther) {
      if (isBlock(n, blockOf(state)) && getValue(n, P.bedPart) !== part) return setValue(state, P.occupied, getValue(n, P.occupied));
      return AIR;
    }
    return state;
  }
}

export class TallBlockBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    if (ctx.y >= ctx.level.maxY - 1) return null;
    if (!(stateFlags[ctx.level.getBlockState(ctx.x, ctx.y + 1, ctx.z)]! & F.REPLACEABLE)) return null;
    let s = withWater(ctx.block.defaultState, ctx);
    if (ctx.block.hasProp(P.facing)) s = setValue(s, P.facing, OPPOSITE[ctx.horizontalDirection()]!);
    return setValue(s, P.doubleHalf, 'lower');
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number, old: number, moved: boolean): void {
    if (moved || isBlock(old, blockOf(state))) return;
    if (getValue(state, P.doubleHalf) === 'lower') {
      let up = setValue(state, P.doubleHalf, 'upper');
      if (blockOf(state).hasProp(P.waterlogged)) up = setValue(up, P.waterlogged, waterAt(level, x, y + 1, z));
      level.setBlock(x, y + 1, z, up, UPDATE_ALL);
    }
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    const half = getValue(state, P.doubleHalf);
    if ((dir === UP && half === 'lower') || (dir === DOWN && half === 'upper')) {
      if (!(isBlock(n, blockOf(state)) && getValue(n, P.doubleHalf) !== half)) return AIR;
    }
    if (half === 'lower' && dir === DOWN && !this.canSurvive(state, level, x, y, z)) return AIR;
    return state;
  }
}

export { HORIZONTALS, H_DIRS };
