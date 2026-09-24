/**
 * Directions follow the reference convention:
 *   DOWN=-Y, UP=+Y, NORTH=-Z, SOUTH=+Z, WEST=-X, EAST=+X.
 * Yaw 0 looks towards +Z (south), yaw 90 towards -X (west).
 */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export const DOWN = 0 as Direction;
export const UP = 1 as Direction;
export const NORTH = 2 as Direction;
export const SOUTH = 3 as Direction;
export const WEST = 4 as Direction;
export const EAST = 5 as Direction;

export const DIRS: readonly Direction[] = [DOWN, UP, NORTH, SOUTH, WEST, EAST];
/** Horizontal directions in clockwise order starting at south (2D data value order). */
export const HORIZONTALS: readonly Direction[] = [SOUTH, WEST, NORTH, EAST];
export const DIR_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
export type DirName = (typeof DIR_NAMES)[number];

export const DX: readonly number[] = [0, 0, 0, 0, -1, 1];
export const DY: readonly number[] = [-1, 1, 0, 0, 0, 0];
export const DZ: readonly number[] = [0, 0, -1, 1, 0, 0];
export const OPPOSITE: readonly Direction[] = [UP, DOWN, SOUTH, NORTH, EAST, WEST];

export type Axis = 0 | 1 | 2;
export const AXIS_X = 0 as Axis;
export const AXIS_Y = 1 as Axis;
export const AXIS_Z = 2 as Axis;
export const DIR_AXIS: readonly Axis[] = [1, 1, 2, 2, 0, 0];
export const AXIS_NAMES = ['x', 'y', 'z'] as const;

export function dirFromName(n: string): Direction {
  const i = DIR_NAMES.indexOf(n as DirName);
  if (i < 0) throw new Error('bad direction ' + n);
  return i as Direction;
}

export function isHorizontal(d: Direction): boolean {
  return d >= 2;
}

/** Rotate a horizontal direction clockwise (seen from above). */
export function rotateCW(d: Direction): Direction {
  switch (d) {
    case NORTH: return EAST;
    case EAST: return SOUTH;
    case SOUTH: return WEST;
    case WEST: return NORTH;
    default: return d;
  }
}

export function rotateCCW(d: Direction): Direction {
  switch (d) {
    case NORTH: return WEST;
    case WEST: return SOUTH;
    case SOUTH: return EAST;
    case EAST: return NORTH;
    default: return d;
  }
}

/** Horizontal direction from yaw (degrees). */
export function dirFromYaw(yaw: number): Direction {
  const i = Math.floor(yaw / 90 + 0.5) & 3;
  return HORIZONTALS[i]!;
}

/** Yaw (degrees) that faces the given horizontal direction. */
export function yawOf(d: Direction): number {
  switch (d) {
    case SOUTH: return 0;
    case WEST: return 90;
    case NORTH: return 180;
    case EAST: return 270;
    default: return 0;
  }
}

/** Directions ordered by how closely they match a look vector (nearest first). */
export function orderedByNearest(yaw: number, pitch: number): Direction[] {
  const yr = (yaw * Math.PI) / 180;
  const pr = (pitch * Math.PI) / 180;
  const sinP = Math.sin(pr), cosP = Math.cos(pr);
  const sinY = Math.sin(yr), cosY = Math.cos(yr);
  const ax = Math.abs(sinY) * cosP;
  const ay = Math.abs(sinP);
  const az = Math.abs(cosY) * cosP;
  // Look vector x = -sin(yaw); negative pitch means looking up.
  const dx: Direction = -sinY > 0 ? EAST : WEST;
  const dy: Direction = pitch < 0 ? UP : DOWN;
  const dz: Direction = cosY > 0 ? SOUTH : NORTH;
  const list: Array<[Direction, number]> = [[dx, ax], [dy, ay], [dz, az]];
  list.sort((a, b) => b[1] - a[1]);
  const first = list.map((l) => l[0]);
  return [first[0]!, first[1]!, first[2]!, OPPOSITE[first[2]!], OPPOSITE[first[1]!], OPPOSITE[first[0]!]];
}

/** Pack block coordinates into a single safe integer key (x,z in ±2^21, y in ±2^10). */
export function packPos(x: number, y: number, z: number): number {
  return ((x + 2097152) * 4194304 + (z + 2097152)) * 2048 + (y + 1024);
}

export function unpackPos(k: number): [number, number, number] {
  const y = (k % 2048) - 1024;
  const r = Math.floor(k / 2048);
  const z = (r % 4194304) - 2097152;
  const x = Math.floor(r / 4194304) - 2097152;
  return [x, y, z];
}

/** Chunk key for (cx, cz). */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 1048576) * 2097152 + (cz + 1048576);
}

export function chunkKeyX(k: number): number {
  return Math.floor(k / 2097152) - 1048576;
}

export function chunkKeyZ(k: number): number {
  return (k % 2097152) - 1048576;
}

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}
