/**
 * Mob pathfinding.
 *
 * Blocks are classified once per block state into small tables (path type, the type contributed
 * as a floor, the danger radiated to neighbours, collision top). A search works on a
 * `PathRegion`: a box around the mob whose columns are copied lazily from the world into flat
 * byte arrays. Node evaluators (walking, amphibious, swimming, flying) and the A* search only
 * read those arrays, so the same algorithm runs in TypeScript and in the WebAssembly kernel
 * (native/src/path.rs) with identical results.
 */
import {
  STATE_COUNT, stateFlags, F, blockOf, getCollisionShape, blockHasTag, tryGetValue,
} from '../../common/block/registry';
import { P } from '../../common/block/properties';
import type { Chunk } from '../../common/world/chunk';

export const enum PathType {
  BLOCKED, OPEN, WALKABLE, WALKABLE_DOOR, TRAPDOOR, POWDER_SNOW, DANGER_POWDER_SNOW, FENCE, LAVA, WATER, WATER_BORDER, RAIL,
  UNPASSABLE_RAIL, DANGER_FIRE, DAMAGE_FIRE, DANGER_OTHER, DAMAGE_OTHER, DOOR_OPEN, DOOR_WOOD_CLOSED, DOOR_IRON_CLOSED,
  BREACH, LEAVES, STICKY_HONEY, COCOA, DAMAGE_CAUTIOUS, DANGER_TRAPDOOR,
}
export const PATH_TYPE_COUNT = 26;
const NONE = 255;

/** Default malus per type (negative = impassable). */
export const DEFAULT_MALUS = new Float64Array([
  -1, 0, 0, 0, 0, -1, 0, -1, -1, 8, 8, 0, -1, 8, 16, 8, -1, 0, -1, -1, 0, -1, 8, 0, 0, 0,
]);

/** Build a mob's malus table from overrides. */
export function malusTable(overrides: Partial<Record<PathType, number>> = {}): Float64Array {
  const m = DEFAULT_MALUS.slice();
  for (const [k, v] of Object.entries(overrides)) m[Number(k)] = v as number;
  return m;
}

export const enum PathMode { WALK = 0, SWIM = 1, FLY = 2, AMPHIBIOUS = 3 }

/** Mob properties the evaluators need. */
export interface PathMob {
  mode: PathMode;
  width: number;
  height: number;
  stepHeight: number;
  maxFall: number;
  canOpenDoors: boolean;
  canPassDoors: boolean;
  canFloat: boolean;
  /** Swimmers may leave the water surface (dolphins). */
  canBreach: boolean;
  malus: Float64Array;
}

// ---------------------------------------------------------------------------------------------
// Per-state classification
// ---------------------------------------------------------------------------------------------

/** Cell flag bits. */
export const CELL_WATER = 1, CELL_AIR = 2, CELL_WATER_SOURCE_BLOCK = 4, CELL_RAIL = 8;

export interface PathTables {
  raw: Uint8Array;
  below: Uint8Array;
  danger: Uint8Array;
  top: Uint8Array;
  flags: Uint8Array;
}

let tables: PathTables | null = null;

const OPEN_PARTIAL = new Set(['farmland', 'dirt_path', 'soul_sand', 'mud', 'scaffolding']);
const SOLID_PARTIAL = new Set([
  'cake', 'brewing_stand', 'enchanting_table', 'lectern', 'stonecutter', 'grindstone', 'bell', 'hopper', 'cauldron', 'water_cauldron',
  'lava_cauldron', 'powder_snow_cauldron', 'composter', 'lantern', 'soul_lantern', 'bamboo', 'azalea', 'flowering_azalea', 'conduit',
  'decorated_pot', 'end_portal_frame', 'daylight_detector', 'chain', 'sniffer_egg',
]);

function isBurning(name: string, s: number): boolean {
  return name === 'fire' || name === 'soul_fire' || name === 'lava_cauldron' || name === 'magma_block'
    || ((name === 'campfire' || name === 'soul_campfire') && tryGetValue(s, P.lit) === true);
}

/** Collision top (in 1/16 block, 0 = no collision). */
function topOf(s: number): number {
  const shape = getCollisionShape(s);
  let top = 0;
  for (let i = 0; i < shape.length; i += 6) top = Math.max(top, shape[i + 4]!);
  return Math.max(0, Math.min(24, Math.round(top * 16)));
}

/** Raw type of a block state (reference getPathTypeFromState). */
function rawType(s: number): PathType {
  const f = stateFlags[s]!;
  if (f & F.AIR) return PathType.OPEN;
  const b = blockOf(s);
  const n = b.name;
  if (blockHasTag(b, 'trapdoors') || n === 'lily_pad' || n === 'big_dripleaf') return PathType.TRAPDOOR;
  if (n === 'powder_snow') return PathType.POWDER_SNOW;
  if (n === 'cactus' || n === 'sweet_berry_bush') return PathType.DAMAGE_OTHER;
  if (n === 'cocoa') return PathType.COCOA;
  if (n === 'blight_rose' || n === 'pointed_dripstone') return PathType.DAMAGE_CAUTIOUS;
  if (f & F.LAVA) return PathType.LAVA;
  // Solid burning blocks (magma) are walls; they burn as floors (see belowType)
  if (isBurning(n, s) && n !== 'magma_block') return PathType.DAMAGE_FIRE;
  if (blockHasTag(b, 'doors')) {
    if (tryGetValue(s, P.open)) return PathType.DOOR_OPEN;
    return n.startsWith('iron') ? PathType.DOOR_IRON_CLOSED : PathType.DOOR_WOOD_CLOSED;
  }
  if (blockHasTag(b, 'rails')) return PathType.RAIL;
  if (blockHasTag(b, 'leaves')) return PathType.LEAVES;
  if (blockHasTag(b, 'fences') || blockHasTag(b, 'walls') || (blockHasTag(b, 'fence_gates') && !tryGetValue(s, P.open))) return PathType.FENCE;
  // Pathfindable on land: no collision, thin collision or walkable partial blocks
  const top = topOf(s);
  let pathfindable: boolean;
  if (f & F.FULL_COLLISION) pathfindable = false;
  else if (top === 0 || OPEN_PARTIAL.has(n)) pathfindable = true;
  else if (n === 'snow') pathfindable = (tryGetValue(s, P.layers) ?? 1) < 5;
  else if (blockHasTag(b, 'slabs') || blockHasTag(b, 'stairs_any') || blockHasTag(b, 'anvil') || blockHasTag(b, 'chests')
    || blockHasTag(b, 'panes') || blockHasTag(b, 'shell_boxes') || SOLID_PARTIAL.has(n) || n === 'honey_block') pathfindable = false;
  else pathfindable = top <= 3;
  if (!pathfindable) return PathType.BLOCKED;
  return f & F.WATER ? PathType.WATER : PathType.OPEN;
}

/** Type of an open cell standing on this state (reference getPathTypeStatic floor rule). */
function belowType(s: number, raw: PathType): PathType {
  const n = blockOf(s).name;
  if (n === 'magma_block' || raw === PathType.DAMAGE_FIRE) return PathType.DAMAGE_FIRE;
  if (n === 'honey_block') return PathType.STICKY_HONEY;
  if (raw === PathType.DAMAGE_OTHER) return PathType.DAMAGE_OTHER;
  if (raw === PathType.POWDER_SNOW) return PathType.DANGER_POWDER_SNOW;
  if (raw === PathType.DAMAGE_CAUTIOUS) return PathType.DAMAGE_CAUTIOUS;
  return raw !== PathType.WALKABLE && raw !== PathType.OPEN && raw !== PathType.WATER && raw !== PathType.LAVA ? PathType.WALKABLE : PathType.OPEN;
}

/** Danger this state radiates to walkable neighbours (reference checkNeighbourBlocks). */
function dangerType(s: number, raw: PathType): number {
  if (raw === PathType.DAMAGE_OTHER) return PathType.DANGER_OTHER;
  if (raw === PathType.DAMAGE_FIRE || raw === PathType.LAVA || blockOf(s).name === 'magma_block') return PathType.DANGER_FIRE;
  if (raw === PathType.WATER) return PathType.WATER_BORDER;
  if (raw === PathType.DAMAGE_CAUTIOUS) return PathType.DAMAGE_CAUTIOUS;
  return NONE;
}

export function pathTables(): PathTables {
  if (tables && tables.raw.length === STATE_COUNT) return tables;
  const n = STATE_COUNT;
  const t: PathTables = { raw: new Uint8Array(n), below: new Uint8Array(n), danger: new Uint8Array(n), top: new Uint8Array(n), flags: new Uint8Array(n) };
  for (let s = 0; s < n; s++) {
    const raw = rawType(s);
    const f = stateFlags[s]!;
    t.raw[s] = raw;
    t.below[s] = belowType(s, raw);
    t.danger[s] = dangerType(s, raw);
    t.top[s] = topOf(s);
    const name = blockOf(s).name;
    t.flags[s] = (f & F.WATER ? CELL_WATER : 0) | (f & F.AIR ? CELL_AIR : 0) | (name === 'water' ? CELL_WATER_SOURCE_BLOCK : 0) | (raw === PathType.RAIL ? CELL_RAIL : 0);
  }
  tables = t;
  return t;
}

/** Static walking type of a single position read directly from the world (strafing, random targets). */
export function staticPathType(w: PathWorld, x: number, y: number, z: number): PathType {
  const t = pathTables();
  let r: PathType = t.raw[w.getBlockState(x, y, z)]!;
  if (r === PathType.OPEN && y >= w.minY + 1) r = t.below[w.getBlockState(x, y - 1, z)]!;
  if (r === PathType.WALKABLE) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          if (i === 0 && k === 0) continue;
          const d = t.danger[w.getBlockState(x + i, y + j, z + k)]!;
          if (d !== NONE) return d;
        }
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------------------------

export interface PathWorld {
  readonly minY: number;
  readonly maxY: number;
  getBlockState(x: number, y: number, z: number): number;
  /** Loaded chunk containing block x/z (unloaded chunks block paths). */
  getChunkAt?(x: number, z: number): Chunk | undefined;
}

/**
 * Box of cells copied from the world column by column on first access. Cells outside the box or
 * in unloaded chunks read as solid walls.
 */
export class PathRegion {
  ox = 0; oy = 0; oz = 0;
  sx = 0; sy = 0; sz = 0;
  raw = new Uint8Array(0);
  below = new Uint8Array(0);
  danger = new Uint8Array(0);
  top = new Uint8Array(0);
  flags = new Uint8Array(0);
  colStamp = new Uint32Array(0);
  stamp = 0;
  private world: PathWorld | null = null;

  setup(world: PathWorld, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number): void {
    this.world = world;
    this.ox = ox; this.oy = oy; this.oz = oz;
    this.sx = sx; this.sy = sy; this.sz = sz;
    const cells = sx * sy * sz;
    if (this.raw.length < cells) {
      const cap = Math.max(cells, this.raw.length * 2);
      this.raw = new Uint8Array(cap);
      this.below = new Uint8Array(cap);
      this.danger = new Uint8Array(cap);
      this.top = new Uint8Array(cap);
      this.flags = new Uint8Array(cap);
    }
    if (this.colStamp.length < sx * sz) {
      this.colStamp = new Uint32Array(Math.max(sx * sz, this.colStamp.length * 2));
      this.stamp = 0;
    }
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.colStamp.fill(0);
      this.stamp = 1;
    }
  }

  /** Copy one column (all cells of region-local lx/lz). */
  loadColumn(lx: number, lz: number): void {
    const w = this.world!;
    const t = pathTables();
    const x = this.ox + lx, z = this.oz + lz;
    const chunk = w.getChunkAt ? w.getChunkAt(x, z) : undefined;
    const base = (lx * this.sz + lz) * this.sy;
    for (let ly = 0; ly < this.sy; ly++) {
      const y = this.oy + ly;
      const i = base + ly;
      let s: number;
      if (w.getChunkAt && !chunk) s = -1;
      else if (y < w.minY || y >= w.maxY) s = y < w.minY ? -1 : 0;
      else s = chunk ? chunk.getBlock(x & 15, y, z & 15) : w.getBlockState(x, y, z);
      if (s < 0) {
        this.raw[i] = PathType.BLOCKED; this.below[i] = PathType.WALKABLE; this.danger[i] = NONE; this.top[i] = 16; this.flags[i] = 0;
      } else {
        this.raw[i] = t.raw[s]!; this.below[i] = t.below[s]!; this.danger[i] = t.danger[s]!; this.top[i] = t.top[s]!; this.flags[i] = t.flags[s]!;
      }
    }
  }

  /** Cell index of a world position, or -1 outside the region. */
  cell(x: number, y: number, z: number): number {
    const lx = x - this.ox, ly = y - this.oy, lz = z - this.oz;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.sx || ly >= this.sy || lz >= this.sz) return -1;
    const c = lx * this.sz + lz;
    if (this.colStamp[c] !== this.stamp) {
      this.colStamp[c] = this.stamp;
      this.loadColumn(lx, lz);
    }
    return c * this.sy + ly;
  }

  rawAt(x: number, y: number, z: number): PathType {
    const i = this.cell(x, y, z);
    return i < 0 ? PathType.BLOCKED : this.raw[i]!;
  }
  belowAt(x: number, y: number, z: number): PathType {
    const i = this.cell(x, y, z);
    return i < 0 ? PathType.WALKABLE : this.below[i]!;
  }
  dangerAt(x: number, y: number, z: number): number {
    const i = this.cell(x, y, z);
    return i < 0 ? NONE : this.danger[i]!;
  }
  topAt(x: number, y: number, z: number): number {
    const i = this.cell(x, y, z);
    return i < 0 ? 16 : this.top[i]!;
  }
  flagsAt(x: number, y: number, z: number): number {
    const i = this.cell(x, y, z);
    return i < 0 ? 0 : this.flags[i]!;
  }
}

// ---------------------------------------------------------------------------------------------
// Path result
// ---------------------------------------------------------------------------------------------

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  type: PathType;
}

export class Path {
  index = 0;
  constructor(readonly nodes: PathPoint[], readonly target: [number, number, number], readonly reached: boolean) {}
  get done(): boolean {
    return this.index >= this.nodes.length;
  }
  get next(): PathPoint | undefined {
    return this.nodes[this.index];
  }
  get end(): PathPoint | undefined {
    return this.nodes[this.nodes.length - 1];
  }
  advance(): void {
    this.index++;
  }
  sameAs(o: Path | null): boolean {
    if (!o || o.nodes.length !== this.nodes.length) return false;
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i]!, b = o.nodes[i]!;
      if (a.x !== b.x || a.y !== b.y || a.z !== b.z) return false;
    }
    return true;
  }
}

export interface PathQuery {
  targets: Array<[number, number, number]>;
  /** A target counts as reached within this Manhattan distance. */
  reach: number;
  maxVisited: number;
  /** Maximum walked distance and distance from the start. */
  maxRange: number;
}

/** Start position of a search (mob feet position and state). */
export interface PathStart {
  x: number;
  y: number;
  z: number;
  onGround: boolean;
  inWater: boolean;
}

/** Budget accounting (pathfinding is the most expensive AI step). */
export const pathStats = { searches: 0, visited: 0, native: 0 };

// ---------------------------------------------------------------------------------------------
// Search (node evaluators + A*). Mirrored by native/src/path.rs; keep both in sync.
// ---------------------------------------------------------------------------------------------

// Horizontal directions in reference order (north, east, south, west); d+1 turns clockwise.
const HX = [0, 1, 0, -1], HZ = [-1, 0, 1, 0];
// All six directions (down, up, north, south, west, east)
const AX = [0, 0, 0, 0, -1, 1], AY = [-1, 1, 0, 0, 0, 0], AZ = [0, 0, -1, 1, 0, 0];

export class PathSearch {
  readonly region = new PathRegion();
  private mob!: PathMob;
  private bw = 1;
  private bh = 2;
  private minY = 0;
  // Origin (mob block position) for rail and fence rules
  private ox = 0; private oy = 0; private oz = 0;
  // Per-cell type cache
  private typeCache = new Uint8Array(0);
  private typeStamp = new Uint32Array(0);
  private stamp = 0;
  // Nodes
  private readonly nodeOf = new Map<number, number>();
  private count = 0;
  private nx = new Int32Array(256);
  private ny = new Int32Array(256);
  private nz = new Int32Array(256);
  private g = new Float64Array(256);
  private h = new Float64Array(256);
  private f = new Float64Array(256);
  private walked = new Float64Array(256);
  private malus = new Float64Array(256);
  private type = new Uint8Array(256);
  private closed = new Uint8Array(256);
  private heapIdx = new Int32Array(256);
  private parent = new Int32Array(256);
  private heap = new Int32Array(256);
  private heapSize = 0;
  private readonly out: number[] = new Array(32).fill(-1);

  // ---- nodes ----------------------------------------------------------------------------------

  private grow(): void {
    const cap = this.nx.length * 2;
    const g32 = (a: Int32Array) => { const b = new Int32Array(cap); b.set(a); return b; };
    const g64 = (a: Float64Array) => { const b = new Float64Array(cap); b.set(a); return b; };
    const g8 = (a: Uint8Array) => { const b = new Uint8Array(cap); b.set(a); return b; };
    this.nx = g32(this.nx); this.ny = g32(this.ny); this.nz = g32(this.nz);
    this.g = g64(this.g); this.h = g64(this.h); this.f = g64(this.f); this.walked = g64(this.walked); this.malus = g64(this.malus);
    this.type = g8(this.type); this.closed = g8(this.closed);
    this.heapIdx = g32(this.heapIdx); this.parent = g32(this.parent); this.heap = g32(this.heap);
  }

  /** Node at a position (created on first use). Returns -1 outside the region. */
  private node(x: number, y: number, z: number): number {
    const c = this.region.cell(x, y, z);
    if (c < 0) return -1;
    const known = this.nodeOf.get(c);
    if (known !== undefined) return known;
    if (this.count === this.nx.length) this.grow();
    const n = this.count++;
    this.nx[n] = x; this.ny[n] = y; this.nz[n] = z;
    this.g[n] = 0; this.h[n] = 0; this.f[n] = 0; this.walked[n] = 0; this.malus[n] = 0;
    this.type[n] = PathType.BLOCKED; this.closed[n] = 0; this.heapIdx[n] = -1; this.parent[n] = -1;
    this.nodeOf.set(c, n);
    return n;
  }

  /** Reference getNodeAndUpdateCostToMax. */
  private nodeWith(x: number, y: number, z: number, t: PathType, m: number): number {
    const n = this.node(x, y, z);
    if (n < 0) return -1;
    this.type[n] = t;
    this.malus[n] = Math.max(this.malus[n]!, m);
    return n;
  }

  private blockedNode(x: number, y: number, z: number): number {
    const n = this.node(x, y, z);
    if (n < 0) return -1;
    this.type[n] = PathType.BLOCKED;
    this.malus[n] = -1;
    return n;
  }

  private closedNode(x: number, y: number, z: number, t: PathType): number {
    const n = this.node(x, y, z);
    if (n < 0) return -1;
    this.closed[n] = 1;
    this.type[n] = t;
    this.malus[n] = DEFAULT_MALUS[t]!;
    return n;
  }

  // ---- classification ---------------------------------------------------------------------------

  private m(t: PathType): number {
    return this.mob.malus[t]!;
  }

  private neighbourDanger(x: number, y: number, z: number, t: PathType): PathType {
    const r = this.region;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          if (i === 0 && k === 0) continue;
          const d = r.dangerAt(x + i, y + j, z + k);
          if (d !== NONE) return d;
        }
      }
    }
    return t;
  }

  /** Reference getPathTypeStatic (walkers). */
  private staticType(x: number, y: number, z: number): PathType {
    let t = this.region.rawAt(x, y, z);
    if (t === PathType.OPEN && y >= this.minY + 1) t = this.region.belowAt(x, y - 1, z);
    if (t === PathType.WALKABLE) t = this.neighbourDanger(x, y, z, t);
    return t;
  }

  /** Reference FlyNodeEvaluator.getPathType. */
  private flyStaticType(x: number, y: number, z: number): PathType {
    const r = this.region;
    let t = r.rawAt(x, y, z);
    if (t === PathType.OPEN && y >= this.minY + 1) {
      const b = r.rawAt(x, y - 1, z);
      const bf = r.belowAt(x, y - 1, z);
      if (bf === PathType.DAMAGE_FIRE || b === PathType.LAVA) t = PathType.DAMAGE_FIRE;
      else if (b === PathType.DAMAGE_OTHER) t = PathType.DAMAGE_OTHER;
      else if (b === PathType.COCOA) t = PathType.COCOA;
      else if (b === PathType.FENCE) {
        if (x !== this.ox || y !== this.oy || z !== this.oz) t = PathType.FENCE;
      } else t = b !== PathType.WALKABLE && b !== PathType.OPEN && b !== PathType.WATER ? PathType.WALKABLE : PathType.OPEN;
    }
    if (t === PathType.WALKABLE || t === PathType.OPEN) t = this.neighbourDanger(x, y, z, t);
    return t;
  }

  /** Reference AmphibiousNodeEvaluator.getPathType. */
  private amphibiousStaticType(x: number, y: number, z: number): PathType {
    const r = this.region;
    if (r.rawAt(x, y, z) === PathType.WATER) {
      for (let d = 0; d < 6; d++) if (r.rawAt(x + AX[d]!, y + AY[d]!, z + AZ[d]!) === PathType.BLOCKED) return PathType.WATER_BORDER;
      return PathType.WATER;
    }
    return this.staticType(x, y, z);
  }

  /** Reference evaluateBlockPathType (doors and rails). */
  private evaluate(t: PathType): PathType {
    const mob = this.mob;
    if (t === PathType.DOOR_WOOD_CLOSED && mob.canOpenDoors && mob.canPassDoors) return PathType.WALKABLE_DOOR;
    if (t === PathType.DOOR_OPEN && !mob.canPassDoors) return PathType.BLOCKED;
    if (t === PathType.RAIL && this.staticType(this.ox, this.oy, this.oz) !== PathType.RAIL && this.staticType(this.ox, this.oy - 1, this.oz) !== PathType.RAIL) return PathType.UNPASSABLE_RAIL;
    return t;
  }

  private cellStatic(x: number, y: number, z: number): PathType {
    const mode = this.mob.mode;
    if (mode === PathMode.FLY) return this.flyStaticType(x, y, z);
    if (mode === PathMode.AMPHIBIOUS) return this.amphibiousStaticType(x, y, z);
    return this.staticType(x, y, z);
  }

  /** Reference getPathTypeOfMob: worst type over the mob's footprint (cached per cell). */
  typeAt(x: number, y: number, z: number): PathType {
    const c = this.region.cell(x, y, z);
    if (c >= 0 && this.typeStamp[c] === this.stamp) return this.typeCache[c]!;
    const t = this.computeType(x, y, z);
    if (c >= 0) {
      this.typeStamp[c] = this.stamp;
      this.typeCache[c] = t;
    }
    return t;
  }

  private computeType(x: number, y: number, z: number): PathType {
    if (this.mob.mode === PathMode.SWIM) return this.swimType(x, y, z);
    let set = 0;
    for (let i = 0; i < this.bw; i++) {
      for (let j = 0; j < this.bh; j++) {
        for (let k = 0; k < this.bw; k++) {
          set |= 1 << this.evaluate(this.cellStatic(x + i, y + j, z + k));
        }
      }
    }
    if (set & (1 << PathType.FENCE)) return PathType.FENCE;
    if (set & (1 << PathType.UNPASSABLE_RAIL)) return PathType.UNPASSABLE_RAIL;
    let best: PathType = PathType.BLOCKED;
    for (let t = 0; t < PATH_TYPE_COUNT; t++) {
      if (!(set & (1 << t))) continue;
      const mt = this.m(t);
      if (mt < 0) return t;
      if (mt >= this.m(best)) best = t;
    }
    if (this.bw <= 1 && best !== PathType.OPEN && this.m(best) === 0 && this.cellStatic(x, y, z) === PathType.OPEN) return PathType.OPEN;
    return best;
  }

  /** Reference SwimNodeEvaluator.getPathType. */
  private swimType(x: number, y: number, z: number): PathType {
    const r = this.region;
    for (let i = 0; i < this.bw; i++) {
      for (let j = 0; j < this.bh; j++) {
        for (let k = 0; k < this.bw; k++) {
          const fl = r.flagsAt(x + i, y + j, z + k);
          if (!(fl & CELL_WATER) && (fl & CELL_AIR)) return PathType.BREACH;
          if (!(fl & CELL_WATER)) return PathType.BLOCKED;
        }
      }
    }
    return r.rawAt(x, y, z) === PathType.WATER ? PathType.WATER : PathType.BLOCKED;
  }

  private floorLevel(x: number, y: number, z: number): number {
    if ((this.mob.canFloat || this.mob.mode === PathMode.AMPHIBIOUS) && (this.region.flagsAt(x, y, z) & CELL_WATER)) return y + 0.5;
    return y - 1 + this.region.topAt(x, y - 1, z) / 16;
  }

  // ---- walking ------------------------------------------------------------------------------

  private static partial(t: PathType): boolean {
    return t === PathType.FENCE || t === PathType.DOOR_WOOD_CLOSED || t === PathType.DOOR_IRON_CLOSED;
  }

  /** Reference findAcceptedNode (walk / amphibious). */
  private accepted(x: number, y: number, z: number, vlimit: number, nodeFloor: number, dx: number, dz: number, cur: PathType): number {
    if (this.floorLevel(x, y, z) - nodeFloor > Math.max(1.125, this.mob.stepHeight)) return -1;
    const t = this.typeAt(x, y, z);
    const f = this.m(t);
    let n = -1;
    if (f >= 0) n = this.nodeWith(x, y, z, t, f);
    if (PathSearch.partial(cur) && n >= 0 && this.malus[n]! >= 0 && !this.canReachWithoutCollision(n)) n = -1;
    const amphibious = this.mob.mode === PathMode.AMPHIBIOUS;
    if (t === PathType.WALKABLE || (amphibious && t === PathType.WATER)) return n;
    if ((n < 0 || this.malus[n]! < 0) && vlimit > 0 && t !== PathType.FENCE && t !== PathType.UNPASSABLE_RAIL && t !== PathType.TRAPDOOR && t !== PathType.POWDER_SNOW) {
      return this.tryJumpOn(x, y, z, vlimit, nodeFloor, dx, dz, cur);
    }
    if (!amphibious && t === PathType.WATER && !this.mob.canFloat) return this.firstNonWaterBelow(x, y, z, n);
    if (t === PathType.OPEN) return this.firstGroundBelow(x, y, z);
    if (PathSearch.partial(t) && n < 0) return this.closedNode(x, y, z, t);
    return n;
  }

  /** Mobs next to a fence or door must fit through the gap. */
  private canReachWithoutCollision(n: number): boolean {
    const x = this.nx[n]!, y = this.ny[n]!, z = this.nz[n]!;
    for (let j = 0; j < this.bh; j++) {
      const t = this.region.rawAt(x, y + j, z);
      if (t === PathType.BLOCKED || t === PathType.FENCE || t === PathType.LEAVES) return false;
    }
    return true;
  }

  private tryJumpOn(x: number, y: number, z: number, vlimit: number, nodeFloor: number, dx: number, dz: number, cur: PathType): number {
    const n = this.accepted(x, y + 1, z, vlimit - 1, nodeFloor, dx, dz, cur);
    if (n < 0) return -1;
    if (this.mob.width >= 1) return n;
    const t = this.type[n]!;
    if (t !== PathType.OPEN && t !== PathType.WALKABLE) return n;
    // Head room above the current position for the jump
    const cx = x - dx, cz = z - dz;
    const y0 = this.floorLevel(x, y + 1, z) + 0.001;
    const y1 = this.mob.height + this.floorLevel(this.nx[n]!, this.ny[n]!, this.nz[n]!) - 0.002;
    for (let yy = Math.floor(y0); yy <= Math.floor(y1); yy++) {
      const top = this.region.topAt(cx, yy, cz);
      if (top > 0 && yy + top / 16 > y0 && this.region.rawAt(cx, yy, cz) !== PathType.OPEN) return -1;
    }
    return n;
  }

  private firstNonWaterBelow(x: number, y: number, z: number, n: number): number {
    for (y--; y > this.minY; y--) {
      const t = this.typeAt(x, y, z);
      if (t !== PathType.WATER) return n;
      n = this.nodeWith(x, y, z, t, this.m(t));
    }
    return n;
  }

  private firstGroundBelow(x: number, y: number, z: number): number {
    for (let i = y - 1; i >= this.minY; i--) {
      if (y - i > this.mob.maxFall) return this.blockedNode(x, i, z);
      const t = this.typeAt(x, i, z);
      const f = this.m(t);
      if (t !== PathType.OPEN) {
        if (f >= 0) return this.nodeWith(x, i, z, t, f);
        return this.blockedNode(x, i, z);
      }
    }
    return this.blockedNode(x, y, z);
  }

  private neighborValid(n: number, cur: number): boolean {
    return n >= 0 && !this.closed[n] && (this.malus[n]! >= 0 || this.malus[cur]! < 0);
  }

  private diagonalValid(root: number, a: number, b: number): boolean {
    if (b < 0 || a < 0 || this.ny[b]! > this.ny[root]! || this.ny[a]! > this.ny[root]!) return false;
    if (this.type[a] === PathType.WALKABLE_DOOR || this.type[b] === PathType.WALKABLE_DOOR) return false;
    const fence = this.type[b] === PathType.FENCE && this.type[a] === PathType.FENCE && this.mob.width < 0.5;
    return (this.ny[b]! < this.ny[root]! || this.malus[b]! >= 0) && (this.ny[a]! < this.ny[root]! || this.malus[a]! >= 0 || fence);
  }

  private walkNeighbors(cur: number, out: number[]): number {
    let count = 0;
    const x = this.nx[cur]!, y = this.ny[cur]!, z = this.nz[cur]!;
    const above = this.typeAt(x, y + 1, z);
    const here = this.typeAt(x, y, z);
    const vlimit = this.m(above) >= 0 && here !== PathType.STICKY_HONEY ? Math.floor(Math.max(1, this.mob.stepHeight)) : 0;
    const floor = this.floorLevel(x, y, z);
    const side = [-1, -1, -1, -1];
    for (let d = 0; d < 4; d++) {
      const n = this.accepted(x + HX[d]!, y, z + HZ[d]!, vlimit, floor, HX[d]!, HZ[d]!, here);
      side[d] = n;
      if (this.neighborValid(n, cur)) out[count++] = n;
    }
    for (let d = 0; d < 4; d++) {
      const d2 = (d + 1) & 3;
      if (!this.diagonalValid(cur, side[d]!, side[d2]!)) continue;
      const n = this.accepted(x + HX[d]! + HX[d2]!, y, z + HZ[d]! + HZ[d2]!, vlimit, floor, HX[d]!, HZ[d]!, here);
      if (n >= 0 && !this.closed[n] && this.malus[n]! >= 0 && this.type[n] !== PathType.WALKABLE_DOOR) out[count++] = n;
    }
    if (this.mob.mode === PathMode.AMPHIBIOUS) {
      const up = this.accepted(x, y + 1, z, Math.max(0, vlimit - 1), floor, 0, 0, here);
      const down = this.accepted(x, y - 1, z, vlimit, floor, 0, 0, here);
      if (this.neighborValid(up, cur) && this.type[up] === PathType.WATER) out[count++] = up;
      if (this.neighborValid(down, cur) && this.type[down] === PathType.WATER && here !== PathType.TRAPDOOR) out[count++] = down;
    }
    return count;
  }

  // ---- swimming -----------------------------------------------------------------------------

  private swimAccepted(x: number, y: number, z: number): number {
    const t = this.typeAt(x, y, z);
    if (!((this.mob.canBreach && t === PathType.BREACH) || t === PathType.WATER)) return -1;
    const f = this.m(t);
    if (f < 0) return -1;
    const n = this.nodeWith(x, y, z, t, f);
    if (n >= 0 && !(this.region.flagsAt(x, y, z) & CELL_WATER)) this.malus[n] = this.malus[n]! + 8;
    return n;
  }

  private swimNeighbors(cur: number, out: number[]): number {
    let count = 0;
    const x = this.nx[cur]!, y = this.ny[cur]!, z = this.nz[cur]!;
    const dirNode = [-1, -1, -1, -1, -1, -1];
    for (let d = 0; d < 6; d++) {
      const n = this.swimAccepted(x + AX[d]!, y + AY[d]!, z + AZ[d]!);
      dirNode[d] = n;
      if (n >= 0 && !this.closed[n]) out[count++] = n;
    }
    // Horizontal diagonals (north→east, east→south, south→west, west→north)
    const hIdx = [2, 5, 3, 4]; // N, E, S, W in the six-direction list
    for (let d = 0; d < 4; d++) {
      const d2 = (d + 1) & 3;
      const a = dirNode[hIdx[d]!]!, b = dirNode[hIdx[d2]!]!;
      if (a < 0 || this.malus[a]! < 0 || b < 0 || this.malus[b]! < 0) continue;
      const n = this.swimAccepted(x + HX[d]! + HX[d2]!, y, z + HZ[d]! + HZ[d2]!);
      if (n >= 0 && !this.closed[n]) out[count++] = n;
    }
    return count;
  }

  // ---- flying -------------------------------------------------------------------------------

  private flyAccepted(x: number, y: number, z: number): number {
    const t = this.typeAt(x, y, z);
    const f = this.m(t);
    if (f < 0) return -1;
    const n = this.nodeWith(x, y, z, t, f);
    if (n >= 0 && t === PathType.WALKABLE) this.malus[n] = this.malus[n]! + 1;
    return n;
  }

  private readonly cube = new Int32Array(27);

  private cubeOk(dx: number, dy: number, dz: number): boolean {
    const n = this.cube[(dx + 1) * 9 + (dy + 1) * 3 + (dz + 1)]!;
    return n >= 0 && this.malus[n]! >= 0;
  }

  private flyNeighbors(cur: number, out: number[]): number {
    let count = 0;
    const x = this.nx[cur]!, y = this.ny[cur]!, z = this.nz[cur]!;
    const cube = this.cube;
    cube.fill(-1);
    for (let d = 0; d < 6; d++) {
      const n = this.flyAccepted(x + AX[d]!, y + AY[d]!, z + AZ[d]!);
      cube[(AX[d]! + 1) * 9 + (AY[d]! + 1) * 3 + (AZ[d]! + 1)] = n;
      if (n >= 0 && !this.closed[n]) out[count++] = n;
    }
    // Edges need both faces; corners need all three edges
    for (let pass = 2; pass <= 3; pass++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if ((dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) + (dz !== 0 ? 1 : 0) !== pass) continue;
            const valid = pass === 2
              ? (dx === 0 || this.cubeOk(dx, 0, 0)) && (dy === 0 || this.cubeOk(0, dy, 0)) && (dz === 0 || this.cubeOk(0, 0, dz))
              : this.cubeOk(dx, dy, 0) && this.cubeOk(dx, 0, dz) && this.cubeOk(0, dy, dz);
            if (!valid) continue;
            const n = this.flyAccepted(x + dx, y + dy, z + dz);
            cube[(dx + 1) * 9 + (dy + 1) * 3 + (dz + 1)] = n;
            if (n >= 0 && !this.closed[n]) out[count++] = n;
          }
        }
      }
    }
    return count;
  }

  // ---- start --------------------------------------------------------------------------------

  private startNode(s: PathStart): number {
    const mob = this.mob, r = this.region;
    const bx = Math.floor(s.x), bz = Math.floor(s.z);
    if (mob.mode === PathMode.SWIM || mob.mode === PathMode.FLY) {
      const x = mob.mode === PathMode.SWIM ? Math.floor(s.x - mob.width / 2) : bx;
      const z = mob.mode === PathMode.SWIM ? Math.floor(s.z - mob.width / 2) : bz;
      const y = Math.floor(s.y + 0.5);
      const n = this.node(x, y, z);
      if (n < 0) return -1;
      this.type[n] = this.typeAt(x, y, z);
      this.malus[n] = Math.max(0, this.m(this.type[n]!));
      return n;
    }
    let y: number;
    if (mob.mode === PathMode.AMPHIBIOUS && !s.inWater) {
      y = Math.floor(s.y + 0.5);
    } else if (mob.canFloat && s.inWater) {
      y = Math.floor(s.y);
      while (r.flagsAt(bx, y, bz) & CELL_WATER_SOURCE_BLOCK) y++;
      y--;
    } else if (s.onGround) {
      y = Math.floor(s.y + 0.5);
    } else {
      y = Math.floor(s.y);
      while (y > this.minY) {
        const t = r.rawAt(bx, y, bz);
        if (t !== PathType.OPEN && t !== PathType.WATER && t !== PathType.TRAPDOOR && t !== PathType.RAIL) break;
        y--;
      }
      y++;
    }
    let sx = bx, sz = bz;
    const canStartAt = (x: number, z: number): boolean => {
      const t = this.typeAt(x, y, z);
      return t !== PathType.OPEN && this.m(t) >= 0;
    };
    if (!canStartAt(bx, bz)) {
      const hw = mob.width / 2;
      const corners = [[s.x - hw, s.z - hw], [s.x - hw, s.z + hw], [s.x + hw, s.z - hw], [s.x + hw, s.z + hw]];
      for (const [cx, cz] of corners) {
        if (canStartAt(Math.floor(cx!), Math.floor(cz!))) { sx = Math.floor(cx!); sz = Math.floor(cz!); break; }
      }
    }
    const t = this.typeAt(sx, y, sz);
    const n = this.node(sx, y, sz);
    if (n < 0) return -1;
    this.type[n] = t;
    this.malus[n] = this.m(t);
    return n;
  }

  // ---- heap (reference BinaryHeap) ------------------------------------------------------------

  private heapInsert(n: number): void {
    this.heap[this.heapSize] = n;
    this.heapIdx[n] = this.heapSize;
    this.upHeap(this.heapSize++);
  }

  private heapPop(): number {
    const top = this.heap[0]!;
    this.heap[0] = this.heap[--this.heapSize]!;
    if (this.heapSize > 0) this.downHeap(0);
    this.heapIdx[top] = -1;
    return top;
  }

  private changeCost(n: number, f: number): void {
    const old = this.f[n]!;
    this.f[n] = f;
    if (f < old) this.upHeap(this.heapIdx[n]!);
    else this.downHeap(this.heapIdx[n]!);
  }

  private upHeap(index: number): void {
    const node = this.heap[index]!;
    const f = this.f[node]!;
    while (index > 0) {
      const i = (index - 1) >> 1;
      const p = this.heap[i]!;
      if (!(f < this.f[p]!)) break;
      this.heap[index] = p;
      this.heapIdx[p] = index;
      index = i;
    }
    this.heap[index] = node;
    this.heapIdx[node] = index;
  }

  private downHeap(index: number): void {
    const node = this.heap[index]!;
    const f = this.f[node]!;
    while (true) {
      const i = 1 + (index << 1), j = i + 1;
      if (i >= this.heapSize) break;
      const a = this.heap[i]!, fa = this.f[a]!;
      const b = j >= this.heapSize ? -1 : this.heap[j]!;
      const fb = b < 0 ? Infinity : this.f[b]!;
      if (fa < fb) {
        if (fa >= f) break;
        this.heap[index] = a;
        this.heapIdx[a] = index;
        index = i;
      } else {
        if (fb >= f) break;
        this.heap[index] = b;
        this.heapIdx[b] = index;
        index = j;
      }
    }
    this.heap[index] = node;
    this.heapIdx[node] = index;
  }

  // ---- search -------------------------------------------------------------------------------

  private dist(a: number, b: number): number {
    const dx = this.nx[b]! - this.nx[a]!, dy = this.ny[b]! - this.ny[a]!, dz = this.nz[b]! - this.nz[a]!;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Region bounds for a search: horizontal radius maxRange + 8, vertical span what the mob can climb or fall. */
  static regionBounds(world: PathWorld, mob: PathMob, s: PathStart, q: PathQuery): [number, number, number, number, number, number] {
    const bw = Math.max(1, Math.floor(mob.width + 1)), bh = Math.max(1, Math.ceil(mob.height));
    const ox = Math.floor(s.x), oy = Math.floor(s.y), oz = Math.floor(s.z);
    const rh = Math.ceil(q.maxRange) + 8 + bw;
    const rv = Math.min(Math.ceil(q.maxRange), 24) + 4;
    const y0 = Math.max(world.minY - 1, oy - rv - Math.min(mob.maxFall, 64) - 1);
    const y1 = Math.min(world.maxY + 1, oy + rv + bh + 2);
    return [ox - rh, y0, oz - rh, rh * 2 + 1, y1 - y0 + 1, rh * 2 + 1];
  }

  private prepare(world: PathWorld, mob: PathMob, s: PathStart, q: PathQuery): void {
    this.mob = mob;
    this.bw = Math.max(1, Math.floor(mob.width + 1));
    this.bh = Math.max(1, Math.ceil(mob.height));
    this.minY = world.minY;
    this.ox = Math.floor(s.x); this.oy = Math.floor(s.y); this.oz = Math.floor(s.z);
    const [rx, ry, rz, sx, sy, sz] = PathSearch.regionBounds(world, mob, s, q);
    this.region.setup(world, rx, ry, rz, sx, sy, sz);
    const cells = sx * sy * sz;
    if (this.typeCache.length < cells) {
      this.typeCache = new Uint8Array(cells);
      this.typeStamp = new Uint32Array(cells);
      this.stamp = 0;
    }
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.typeStamp.fill(0);
      this.stamp = 1;
    }
    this.nodeOf.clear();
    this.count = 0;
    this.heapSize = 0;
  }

  find(world: PathWorld, mob: PathMob, s: PathStart, q: PathQuery): Path | null {
    this.prepare(world, mob, s, q);
    pathStats.searches++;
    const start = this.startNode(s);
    if (start < 0 || q.targets.length === 0) return null;
    const nt = q.targets.length;
    const tx = q.targets.map((t) => Math.floor(t[0])), ty = q.targets.map((t) => Math.floor(t[1])), tz = q.targets.map((t) => Math.floor(t[2]));
    const bestNode: number[] = new Array(nt).fill(-1), bestDist: number[] = new Array(nt).fill(Infinity);
    const bestH = (n: number): number => {
      let best = Infinity;
      for (let i = 0; i < nt; i++) {
        const dx = tx[i]! - this.nx[n]!, dy = ty[i]! - this.ny[n]!, dz = tz[i]! - this.nz[n]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < bestDist[i]!) { bestDist[i] = d; bestNode[i] = n; }
        if (d < best) best = d;
      }
      return best;
    };
    const reachedTarget = (n: number): number => {
      for (let i = 0; i < nt; i++) {
        if (Math.abs(this.nx[n]! - tx[i]!) + Math.abs(this.ny[n]! - ty[i]!) + Math.abs(this.nz[n]! - tz[i]!) <= q.reach) return i;
      }
      return -1;
    };
    this.g[start] = 0;
    this.h[start] = bestH(start);
    this.f[start] = this.h[start]!;
    this.heapInsert(start);
    const out = this.out;
    let visited = 0;
    let reached = -1, target = -1;
    while (this.heapSize > 0) {
      if (++visited >= q.maxVisited) break;
      const cur = this.heapPop();
      this.closed[cur] = 1;
      target = reachedTarget(cur);
      if (target >= 0) { reached = cur; break; }
      if (this.dist(cur, start) >= q.maxRange) continue;
      const mode = mob.mode;
      const k = mode === PathMode.SWIM ? this.swimNeighbors(cur, out) : mode === PathMode.FLY ? this.flyNeighbors(cur, out) : this.walkNeighbors(cur, out);
      for (let l = 0; l < k; l++) {
        const n = out[l]!;
        const d = this.dist(cur, n);
        this.walked[n] = this.walked[cur]! + d;
        const g = this.g[cur]! + d + this.malus[n]!;
        const inOpen = this.heapIdx[n]! >= 0;
        if (this.walked[n]! < q.maxRange && (!inOpen || g < this.g[n]!)) {
          this.parent[n] = cur;
          this.g[n] = g;
          this.h[n] = bestH(n) * 1.5;
          if (inOpen) this.changeCost(n, g + this.h[n]!);
          else {
            this.f[n] = g + this.h[n]!;
            this.heapInsert(n);
          }
        }
      }
    }
    pathStats.visited += visited;
    let end = reached;
    if (end < 0) {
      let bd = Infinity;
      for (let i = 0; i < nt; i++) if (bestNode[i]! >= 0 && bestDist[i]! < bd) { bd = bestDist[i]!; end = bestNode[i]!; target = i; }
    }
    if (end < 0) return null;
    return new Path(this.collect(end), [tx[target]!, ty[target]!, tz[target]!], reached >= 0);
  }

  private collect(end: number): PathPoint[] {
    const pts: PathPoint[] = [];
    for (let n = end; n >= 0 && pts.length <= 4096; n = this.parent[n]!) pts.push({ x: this.nx[n]!, y: this.ny[n]!, z: this.nz[n]!, type: this.type[n]! });
    return pts.reverse();
  }
}

/** Shared search instance (the server simulation is single threaded). */
export const PATH_SEARCH = new PathSearch();

export function findPath(world: PathWorld, mob: PathMob, start: PathStart, q: PathQuery): Path | null {
  return PATH_SEARCH.find(world, mob, start, q);
}
