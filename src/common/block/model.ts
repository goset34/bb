/**
 * Block models expressed as lists of elements (boxes in 1/16 units) with per-face textures.
 * The same data drives rendering (baked by the mesher) and collision/outline shapes.
 */
import { Axis, Direction, DOWN, UP, NORTH, SOUTH, WEST, EAST } from '../world/direction';

/** Tint sources resolved by the mesher. */
export const Tint = {
  None: 0,
  Grass: 1,
  Foliage: 2,
  Water: 3,
  Birch: 4,
  Spruce: 5,
  Wire: 6,
  Stem: 7,
  LilyPad: 8,
  Mangrove: 9,
  AttachedStem: 10,
  DryFoliage: 11,
} as const;
export type Tint = (typeof Tint)[keyof typeof Tint];

export interface Face {
  tex: string;
  /** UV rect in texels (0..16): u0, v0, u1, v1. Defaults to the element projection. */
  uv?: [number, number, number, number];
  /** Face is culled if the neighbour in this direction occludes it. */
  cull?: Direction;
  tint?: Tint;
  /** UV rotation in degrees. */
  rot?: 0 | 90 | 180 | 270;
  emissive?: boolean;
}

export interface ElementRotation {
  axis: Axis;
  angle: number;
  origin: [number, number, number];
  rescale?: boolean;
}

export interface Element {
  from: [number, number, number];
  to: [number, number, number];
  faces: Partial<Record<Direction, Face>>;
  rot?: ElementRotation;
  shade?: boolean;
}

export type RenderLayer = 'solid' | 'cutout' | 'translucent';

/** Waving animation class for foliage (vertex shader). */
export const Wave = {
  None: 0,
  Leaves: 1,
  PlantBottom: 2,
  PlantTop: 3,
  Hanging: 4,
  Water: 5,
  Lava: 6,
} as const;
export type Wave = (typeof Wave)[keyof typeof Wave];

export type RenderShape =
  | { kind: 'none' }
  | { kind: 'cube'; tex: [string, string, string, string, string, string]; tint?: Tint[]; emissive?: boolean[]; rot?: number[] }
  | { kind: 'model'; elements: Element[]; ao?: boolean }
  | { kind: 'liquid'; still: string; flow: string; lava: boolean };

// ---------------------------------------------------------------------------------------------
// Face texture helpers
// ---------------------------------------------------------------------------------------------

/** Cube face textures in DIR order (down, up, north, south, west, east). */
export function cubeTex(all: string): RenderShape {
  return { kind: 'cube', tex: [all, all, all, all, all, all] };
}

export function cubeBottomTop(bottom: string, top: string, side: string): RenderShape {
  return { kind: 'cube', tex: [bottom, top, side, side, side, side] };
}

export function cubeColumn(end: string, side: string, axis: 'x' | 'y' | 'z' = 'y'): RenderShape {
  if (axis === 'y') return { kind: 'cube', tex: [end, end, side, side, side, side] };
  if (axis === 'x') return { kind: 'cube', tex: [side, side, side, side, end, end], rot: [90, 90, 90, 90, 0, 0] };
  return { kind: 'cube', tex: [side, side, end, end, side, side], rot: [0, 0, 0, 0, 90, 90] };
}

/** Front-facing block (furnace, dispenser…) with horizontal facing. */
export function cubeOrientable(facing: Direction, front: string, side: string, top: string, bottom = top): RenderShape {
  const t: [string, string, string, string, string, string] = [bottom, top, side, side, side, side];
  t[facing] = front;
  return { kind: 'cube', tex: t };
}

/** Six-way facing block (observer, dispenser up/down, piston body). */
export function cubeDirectional(facing: Direction, front: string, back: string, side: string, sideVert?: string): RenderShape {
  const t: [string, string, string, string, string, string] = [side, side, side, side, side, side];
  const rot = [0, 0, 0, 0, 0, 0];
  t[facing] = front;
  const opp = facing ^ 1;
  t[opp] = back;
  if (facing === UP || facing === DOWN) {
    if (sideVert) for (const d of [NORTH, SOUTH, WEST, EAST]) t[d] = sideVert;
    for (const d of [NORTH, SOUTH, WEST, EAST]) rot[d] = facing === UP ? 0 : 180;
  } else {
    // rotate top/bottom texture so that it points toward facing
    const r = facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270;
    rot[UP] = r;
    rot[DOWN] = (360 - r) % 360;
  }
  return { kind: 'cube', tex: t, rot };
}

// ---------------------------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------------------------

/** Default UV for a face of a box (mirrors the reference projection). */
export function defaultUV(d: Direction, f: readonly number[], t: readonly number[]): [number, number, number, number] {
  switch (d) {
    case DOWN: return [f[0]!, 16 - t[2]!, t[0]!, 16 - f[2]!];
    case UP: return [f[0]!, f[2]!, t[0]!, t[2]!];
    case NORTH: return [16 - t[0]!, 16 - t[1]!, 16 - f[0]!, 16 - f[1]!];
    case SOUTH: return [f[0]!, 16 - t[1]!, t[0]!, 16 - f[1]!];
    case WEST: return [f[2]!, 16 - t[1]!, t[2]!, 16 - f[1]!];
    case EAST: return [16 - t[2]!, 16 - t[1]!, 16 - f[2]!, 16 - f[1]!];
  }
  return [0, 0, 16, 16];
}

/** Box with the same texture on every face; faces touching the block boundary get cull flags. */
export function box(from: [number, number, number], to: [number, number, number], tex: string | Partial<Record<Direction, string>>, opts: { tint?: Tint; cullEdges?: boolean; skip?: Direction[]; emissive?: boolean } = {}): Element {
  const faces: Partial<Record<Direction, Face>> = {};
  const cullEdges = opts.cullEdges ?? true;
  for (let d = 0 as Direction; d < 6; d = (d + 1) as Direction) {
    if (opts.skip?.includes(d)) continue;
    const t = typeof tex === 'string' ? tex : tex[d];
    if (!t) continue;
    const face: Face = { tex: t, uv: defaultUV(d, from, to) };
    if (opts.tint) face.tint = opts.tint;
    if (opts.emissive) face.emissive = true;
    if (cullEdges) {
      if (d === DOWN && from[1] === 0) face.cull = DOWN;
      if (d === UP && to[1] === 16) face.cull = UP;
      if (d === NORTH && from[2] === 0) face.cull = NORTH;
      if (d === SOUTH && to[2] === 16) face.cull = SOUTH;
      if (d === WEST && from[0] === 0) face.cull = WEST;
      if (d === EAST && to[0] === 16) face.cull = EAST;
    }
    faces[d] = face;
  }
  return { from, to, faces };
}

/** Two crossed planes (flowers, saplings, grass). */
export function crossElements(tex: string, tint: Tint = Tint.None, height = 16, emissive = false): Element[] {
  const mk = (a: [number, number, number], b: [number, number, number], angle: number): Element => {
    const face: Face = { tex, uv: [0, 16 - height, 16, 16] };
    if (tint) face.tint = tint;
    if (emissive) face.emissive = true;
    return {
      from: a, to: b,
      rot: { axis: 1, angle, origin: [8, 8, 8], rescale: true },
      shade: false,
      faces: { [NORTH]: { ...face }, [SOUTH]: { ...face } },
    };
  };
  const e1 = mk([0.8, 0, 8], [15.2, height, 8], 45);
  const e2 = mk([8, 0, 0.8], [8, height, 15.2], 45);
  e2.faces = { [WEST]: { ...e1.faces[NORTH]! }, [EAST]: { ...e1.faces[SOUTH]! } };
  return [e1, e2];
}

/** "#"-shaped crop model (four planes). */
export function cropElements(tex: string, height = 16, tint: Tint = Tint.None): Element[] {
  const f = (t: string): Face => (tint ? { tex: t, tint, uv: [0, 16 - height, 16, 16] } : { tex: t, uv: [0, 16 - height, 16, 16] });
  return [
    { from: [4, -1, 0], to: [4, height - 1, 16], shade: false, faces: { [WEST]: f(tex), [EAST]: f(tex) } },
    { from: [12, -1, 0], to: [12, height - 1, 16], shade: false, faces: { [WEST]: f(tex), [EAST]: f(tex) } },
    { from: [0, -1, 4], to: [16, height - 1, 4], shade: false, faces: { [NORTH]: f(tex), [SOUTH]: f(tex) } },
    { from: [0, -1, 12], to: [16, height - 1, 12], shade: false, faces: { [NORTH]: f(tex), [SOUTH]: f(tex) } },
  ];
}

/** Flat plane on a face (vines, lichen, ladders, rails on ground). */
export function planeOn(dir: Direction, tex: string, inset = 0.1, tint: Tint = Tint.None): Element {
  const face = (): Face => (tint ? { tex, tint } : { tex });
  const two = (a: Direction, b: Direction) => ({ [a]: face(), [b]: face() });
  switch (dir) {
    case DOWN: return { from: [0, inset, 0], to: [16, inset, 16], shade: false, faces: two(DOWN, UP) };
    case UP: return { from: [0, 16 - inset, 0], to: [16, 16 - inset, 16], shade: false, faces: two(DOWN, UP) };
    case NORTH: return { from: [0, 0, inset], to: [16, 16, inset], shade: false, faces: two(NORTH, SOUTH) };
    case SOUTH: return { from: [0, 0, 16 - inset], to: [16, 16, 16 - inset], shade: false, faces: two(NORTH, SOUTH) };
    case WEST: return { from: [inset, 0, 0], to: [inset, 16, 16], shade: false, faces: two(WEST, EAST) };
    default: return { from: [16 - inset, 0, 0], to: [16 - inset, 16, 16], shade: false, faces: two(WEST, EAST) };
  }
}

// ---------------------------------------------------------------------------------------------
// Rotation of whole models (blockstate-style x/y rotation)
// ---------------------------------------------------------------------------------------------

const ROT_Y_DIR: Record<number, Direction> = { [DOWN]: DOWN, [UP]: UP, [NORTH]: EAST, [EAST]: SOUTH, [SOUTH]: WEST, [WEST]: NORTH };
const ROT_X_DIR: Record<number, Direction> = { [UP]: NORTH, [NORTH]: DOWN, [DOWN]: SOUTH, [SOUTH]: UP, [WEST]: WEST, [EAST]: EAST };

function rotPointY(p: readonly number[]): [number, number, number] {
  // 90° clockwise seen from above: (x, z) -> (16 - z, x)
  return [16 - p[2]!, p[1]!, p[0]!];
}

function rotPointX(p: readonly number[]): [number, number, number] {
  // 90° around X: (y, z) -> (z, 16 - y)  (up -> north, north -> down)
  return [p[0]!, p[2]!, 16 - p[1]!];
}

function rotateElementOnce(e: Element, axis: 'x' | 'y', uvlock: boolean): Element {
  const rp = axis === 'y' ? rotPointY : rotPointX;
  const dmap = axis === 'y' ? ROT_Y_DIR : ROT_X_DIR;
  const a = rp(e.from);
  const b = rp(e.to);
  const from: [number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const to: [number, number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const faces: Partial<Record<Direction, Face>> = {};
  for (const k of Object.keys(e.faces)) {
    const d = Number(k) as Direction;
    const f = e.faces[d]!;
    const nd = dmap[d]!;
    const nf: Face = { ...f };
    if (f.cull !== undefined) nf.cull = dmap[f.cull]!;
    if (axis === 'y' && (d === UP || d === DOWN)) {
      if (!uvlock) {
        const r = ((f.rot ?? 0) + (d === UP ? 90 : 270)) % 360;
        nf.rot = r as Face['rot'];
      } else if (!f.uv) {
        nf.uv = defaultUV(nd, from, to);
      }
    } else if (axis === 'x' && (d === WEST || d === EAST)) {
      if (!uvlock) nf.rot = (((f.rot ?? 0) + (d === EAST ? 90 : 270)) % 360) as Face['rot'];
    } else if (axis === 'x' && !uvlock) {
      // faces moving to/from top/bottom keep their UVs (texture follows the face)
    }
    if (uvlock && axis === 'y' && d !== UP && d !== DOWN) nf.uv = defaultUV(nd, from, to);
    faces[nd] = nf;
  }
  let rot = e.rot;
  if (rot) {
    const o = rp(rot.origin);
    let nAxis: Axis = rot.axis;
    let angle = rot.angle;
    if (axis === 'y') {
      if (rot.axis === 0) { nAxis = 2; }
      else if (rot.axis === 2) { nAxis = 0; angle = -angle; }
    } else {
      if (rot.axis === 1) { nAxis = 2; angle = -angle; }
      else if (rot.axis === 2) { nAxis = 1; }
    }
    rot = { ...rot, axis: nAxis, angle, origin: o };
  }
  const out: Element = { from, to, faces };
  if (rot) out.rot = rot;
  if (e.shade !== undefined) out.shade = e.shade;
  return out;
}

/** Rotate elements by x then y degrees (multiples of 90), like blockstate variants. */
export function rotateModel(elements: Element[], x: number, y: number, uvlock = false): Element[] {
  let els = elements;
  const xs = (((x % 360) + 360) % 360) / 90;
  const ys = (((y % 360) + 360) % 360) / 90;
  for (let i = 0; i < xs; i++) els = els.map((e) => rotateElementOnce(e, 'x', uvlock));
  for (let i = 0; i < ys; i++) els = els.map((e) => rotateElementOnce(e, 'y', uvlock));
  return els;
}

/** Y rotation (degrees) that turns a model authored facing north to face `d`. */
export function yRotFor(d: Direction): number {
  switch (d) {
    case EAST: return 90;
    case SOUTH: return 180;
    case WEST: return 270;
    default: return 0;
  }
}

/** Y rotation for a model authored facing south. */
export function yRotForSouth(d: Direction): number {
  switch (d) {
    case WEST: return 90;
    case NORTH: return 180;
    case EAST: return 270;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes (collision / outline)
// ---------------------------------------------------------------------------------------------

/** A shape is a flat array of boxes [x0,y0,z0,x1,y1,z1, ...] in block units (0..1+). */
export type Shape = Float32Array;

export const EMPTY_SHAPE: Shape = new Float32Array(0);
export const FULL_SHAPE: Shape = new Float32Array([0, 0, 0, 1, 1, 1]);

export function shapeOf(...boxes16: number[][]): Shape {
  const out = new Float32Array(boxes16.length * 6);
  boxes16.forEach((b, i) => {
    for (let k = 0; k < 6; k++) out[i * 6 + k] = b[k]! / 16;
  });
  return out;
}

export function shapeFromElements(els: Element[]): Shape {
  const boxes: number[][] = [];
  for (const e of els) {
    if (e.rot && e.rot.angle % 90 !== 0) continue; // rotated planes (plants) have no collision
    const f = e.from, t = e.to;
    if (t[0]! - f[0]! <= 0.001 || t[1]! - f[1]! <= 0.001 || t[2]! - f[2]! <= 0.001) continue;
    boxes.push([f[0]!, f[1]!, f[2]!, t[0]!, t[1]!, t[2]!]);
  }
  return shapeOf(...boxes);
}

/** Bounding box of all elements (used for outlines of non-colliding blocks). */
export function boundsOfElements(els: Element[]): Shape {
  if (els.length === 0) return EMPTY_SHAPE;
  let x0 = 16, y0 = 16, z0 = 16, x1 = 0, y1 = 0, z1 = 0;
  for (const e of els) {
    x0 = Math.min(x0, e.from[0], e.to[0]); y0 = Math.min(y0, e.from[1], e.to[1]); z0 = Math.min(z0, e.from[2], e.to[2]);
    x1 = Math.max(x1, e.from[0], e.to[0]); y1 = Math.max(y1, e.from[1], e.to[1]); z1 = Math.max(z1, e.from[2], e.to[2]);
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
  x1 = Math.min(16, x1); y1 = Math.min(16, y1); z1 = Math.min(16, z1);
  if (x1 - x0 < 1) { x0 = Math.max(0, x0 - 1); x1 = Math.min(16, x1 + 1); }
  if (y1 - y0 < 1) { y1 = Math.min(16, y1 + 1); }
  if (z1 - z0 < 1) { z0 = Math.max(0, z0 - 1); z1 = Math.min(16, z1 + 1); }
  return shapeOf([x0, y0, z0, x1, y1, z1]);
}

/** Compute which of the six faces are fully covered by the shape (for occlusion culling). */
const faceMaskCache = new Map<string, number>();

export function fullFaceMask(shape: Shape): number {
  if (shape.length === 0) return 0;
  const key = shape.join(',');
  const cached = faceMaskCache.get(key);
  if (cached !== undefined) return cached;
  const m = computeFullFaceMask(shape);
  faceMaskCache.set(key, m);
  return m;
}

function computeFullFaceMask(shape: Shape): number {
  let mask = 0;
  const grid = new Uint8Array(256);
  for (let d = 0; d < 6; d++) {
    grid.fill(0);
    const axis = d >> 1; // 0:y,1:z,2:x
    const positive = (d & 1) === 1;
    for (let i = 0; i < shape.length; i += 6) {
      const mn = [shape[i]!, shape[i + 1]!, shape[i + 2]!];
      const mx = [shape[i + 3]!, shape[i + 4]!, shape[i + 5]!];
      const ai = axis === 0 ? 1 : axis === 1 ? 2 : 0;
      if (positive ? mx[ai]! < 0.999 : mn[ai]! > 0.001) continue;
      const [ui, vi] = ai === 1 ? [0, 2] : ai === 2 ? [0, 1] : [2, 1];
      const u0 = Math.round(mn[ui]! * 16), u1 = Math.round(mx[ui]! * 16);
      const v0 = Math.round(mn[vi]! * 16), v1 = Math.round(mx[vi]! * 16);
      for (let u = Math.max(0, u0); u < Math.min(16, u1); u++) for (let v = Math.max(0, v0); v < Math.min(16, v1); v++) grid[u * 16 + v] = 1;
    }
    let full = true;
    for (let k = 0; k < 256; k++) if (!grid[k]) { full = false; break; }
    if (full) mask |= 1 << d;
  }
  return mask;
}
