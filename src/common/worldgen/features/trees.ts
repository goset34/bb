/**
 * Trees and huge fungi-like shapes. A {@link TreeBuilder} collects logs and leaves, validates
 * the space, then writes everything with correct leaf distances (so leaves do not decay).
 * The same features are reused by saplings (bone meal / random growth).
 */
import { P } from '../../block/properties';
import { hasTag, setValue, stateFlags, F, tryGetValue } from '../../block/registry';
import { Direction } from '../../world/direction';
import { Random } from '../../math/random';
import { B } from './blocks';
import { Feature, FeatureContext, WorldAccess, isAir } from './api';

type Axis = 'x' | 'y' | 'z';

const HORIZ: Array<[number, number, Direction]> = [[0, -1, 2], [0, 1, 3], [-1, 0, 4], [1, 0, 5]];

function key(dx: number, dy: number, dz: number): number {
  return ((dx + 512) * 1024 + (dy + 512)) * 1024 + (dz + 512);
}

function unkey(k: number): [number, number, number] {
  const dz = (k % 1024) - 512;
  const r = Math.floor(k / 1024);
  return [Math.floor(r / 1024) - 512, (r % 1024) - 512, dz];
}

/** Blocks a growing tree may overwrite. */
export function treeCanReplace(s: number, allowWater = false): boolean {
  const f = stateFlags[s]!;
  if (f & F.AIR) return true;
  if (hasTag(s, 'leaves') || hasTag(s, 'saplings')) return true;
  if (allowWater && (f & F.FLUID_BLOCK) && (f & F.WATER)) return true;
  if ((f & F.REPLACEABLE) && !(f & F.FLUID_BLOCK)) return true;
  return s === B('vine') || s === B('snow') || s === B('moss_carpet') || s === B('hanging_roots') || s === B('glow_lichen');
}

function isSoil(s: number): boolean {
  return hasTag(s, 'dirt') || s === B('farmland');
}

export class TreeBuilder {
  readonly logs = new Map<number, number>();
  readonly leaves = new Map<number, number>();
  readonly decor = new Map<number, number>();
  /** Block entities for decorations (bee nests). */
  readonly entities: Array<{ x: number; y: number; z: number; type: string; data: Record<string, unknown> }> = [];
  allowWater = false;

  constructor(readonly ctx: FeatureContext, readonly ox: number, readonly oy: number, readonly oz: number) {}

  get w(): WorldAccess {
    return this.ctx.world;
  }

  get r(): Random {
    return this.ctx.rng;
  }

  free(x: number, y: number, z: number): boolean {
    if (y < this.w.minY || y >= this.w.maxY) return false;
    if (this.w.isInside && !this.w.isInside(x, z)) return false;
    const k = key(x - this.ox, y - this.oy, z - this.oz);
    if (this.logs.has(k)) return false;
    return treeCanReplace(this.w.getBlock(x, y, z), this.allowWater);
  }

  log(x: number, y: number, z: number, state: number, axis: Axis = 'y'): boolean {
    if (!this.free(x, y, z) && !this.logs.has(key(x - this.ox, y - this.oy, z - this.oz))) return false;
    const st = tryGetValue(state, P.axis) !== undefined ? setValue(state, P.axis, axis) : state;
    const k = key(x - this.ox, y - this.oy, z - this.oz);
    this.logs.set(k, st);
    this.leaves.delete(k);
    return true;
  }

  leaf(x: number, y: number, z: number, state: number): void {
    const k = key(x - this.ox, y - this.oy, z - this.oz);
    if (this.logs.has(k) || this.leaves.has(k)) return;
    if (!this.free(x, y, z)) return;
    this.leaves.set(k, state);
  }

  hasLeaf(x: number, y: number, z: number): boolean {
    return this.leaves.has(key(x - this.ox, y - this.oy, z - this.oz));
  }

  hasLog(x: number, y: number, z: number): boolean {
    return this.logs.has(key(x - this.ox, y - this.oy, z - this.oz));
  }

  /** Decoration block (vines, cocoa, propagules…): only into free space. */
  deco(x: number, y: number, z: number, state: number): void {
    const k = key(x - this.ox, y - this.oy, z - this.oz);
    if (this.logs.has(k) || this.leaves.has(k)) return;
    if (y < this.w.minY || y >= this.w.maxY || (this.w.isInside && !this.w.isInside(x, z))) return;
    if (!isAir(this.w.getBlock(x, y, z)) && !this.decor.has(k)) return;
    this.decor.set(k, state);
  }

  /** Blob of leaves: layer radius r at height y (corners randomly trimmed). */
  leafLayer(cx: number, y: number, cz: number, radius: number, state: number, trimCorners = true, cornerChance = 0.5): void {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const corner = Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0;
      if (corner && trimCorners && (this.r.nextFloat() < cornerChance || radius === 0)) continue;
      this.leaf(cx + dx, y, cz + dz, state);
    }
  }

  leafDisc(cx: number, y: number, cz: number, radius: number, state: number): void {
    const r2 = radius * radius + radius * 0.6;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz <= r2) this.leaf(cx + dx, y, cz + dz, state);
    }
  }

  leafSphere(cx: number, cy: number, cz: number, radius: number, state: number, yScale = 1): void {
    const rc = Math.ceil(radius);
    for (let dx = -rc; dx <= rc; dx++) for (let dy = -rc; dy <= rc; dy++) for (let dz = -rc; dz <= rc; dz++) {
      const ey = dy / yScale;
      if (dx * dx + ey * ey + dz * dz <= radius * radius + 0.5) this.leaf(cx + dx, cy + dy, cz + dz, state);
    }
  }

  /** Straight line of logs (branches) with the axis of the dominant direction. */
  logLine(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): void {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const axis: Axis = Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= Math.abs(dz) ? 'y' : Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.log(Math.round(x0 + dx * t), Math.round(y0 + dy * t), Math.round(z0 + dz * t), state, axis);
    }
  }

  /** Write the tree. Leaves get their distance to the nearest log (1..7). */
  commit(): void {
    const w = this.w;
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (const k of this.logs.keys()) { dist.set(k, 0); queue.push(k); }
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi]!;
      const d = dist.get(k)!;
      if (d >= 6) continue;
      const [x, y, z] = unkey(k);
      for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const nk = key(x + ax, y + ay, z + az);
        if (!this.leaves.has(nk) || dist.has(nk)) continue;
        dist.set(nk, d + 1);
        queue.push(nk);
      }
    }
    for (const [k, st] of this.logs) {
      const [x, y, z] = unkey(k);
      w.setBlock(this.ox + x, this.oy + y, this.oz + z, st);
    }
    for (const [k, st] of this.leaves) {
      const [x, y, z] = unkey(k);
      const wx = this.ox + x, wy = this.oy + y, wz = this.oz + z;
      let s = st;
      if (tryGetValue(s, P.distance7) !== undefined) s = setValue(s, P.distance7, Math.min(7, dist.get(k) ?? 7));
      const cur = w.getBlock(wx, wy, wz);
      if (tryGetValue(s, P.waterlogged) !== undefined && (stateFlags[cur]! & F.WATER)) s = setValue(s, P.waterlogged, true);
      w.setBlock(wx, wy, wz, s);
    }
    for (const [k, st] of this.decor) {
      const [x, y, z] = unkey(k);
      w.setBlock(this.ox + x, this.oy + y, this.oz + z, st);
    }
    for (const e of this.entities) w.setBlockEntity(e.x, e.y, e.z, e.type, e.data);
  }
}

// ---------------------------------------------------------------------------------------------
// Tree definitions
// ---------------------------------------------------------------------------------------------

export interface TreeOptions {
  /** Bee nest probability. */
  bees?: number;
  /** Vines on trunk/leaves (jungle, swamp). */
  vines?: boolean;
  /** Cocoa on trunk (jungle). */
  cocoa?: boolean;
  /** Allow water around the trunk base (swamp oaks, mangroves). */
  water?: boolean;
  /** Place leaf litter around the tree base. */
  litter?: boolean;
  /** Allowed soil check. */
  soil?: (s: number) => boolean;
}

type Shape = (t: TreeBuilder, x: number, y: number, z: number) => boolean;

function prepareGround(ctx: FeatureContext, x: number, y: number, z: number, opts: TreeOptions, size = 1): boolean {
  const w = ctx.world;
  const soil = opts.soil ?? isSoil;
  for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    const below = w.getBlock(x + dx, y - 1, z + dz);
    if (!soil(below)) return false;
  }
  return true;
}

function setDirt(ctx: FeatureContext, x: number, y: number, z: number): void {
  const w = ctx.world;
  const s = w.getBlock(x, y, z);
  if (s === B('grass_block') || s === B('mycelium') || s === B('podzol') || s === B('farmland') || s === B('dirt_path')) w.setBlock(x, y, z, B('dirt'));
  else if (tryGetValue(s, P.snowy) === true) w.setBlock(x, y, z, B('dirt'));
}

function trunkClear(t: TreeBuilder, x: number, y: number, z: number, h: number, size = 1): boolean {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    if (!t.free(x + dx, y + dy, z + dz)) return false;
  }
  return true;
}

function makeTree(shape: Shape, opts: TreeOptions = {}, size = 1): Feature {
  return (ctx, x, y, z) => {
    if (!prepareGround(ctx, x, y, z, opts, size)) return false;
    const t = new TreeBuilder(ctx, x, y, z);
    t.allowWater = !!opts.water;
    if (!shape(t, x, y, z)) return false;
    decorate(t, x, y, z, opts);
    t.commit();
    for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) setDirt(ctx, x + dx, y - 1, z + dz);
    return true;
  };
}

function decorate(t: TreeBuilder, x: number, y: number, z: number, opts: TreeOptions): void {
  const r = t.r;
  if (opts.vines) {
    const vine = B('vine');
    for (const [k] of t.logs) {
      const [dx, dy, dz] = unkey(k);
      for (const [ax, az, dir] of HORIZ) {
        if (r.nextInt(3) === 0) continue;
        const px = t.ox + dx + ax, py = t.oy + dy, pz = t.oz + dz + az;
        // vine faces the log it clings to
        const face = dir === 2 ? P.south : dir === 3 ? P.north : dir === 4 ? P.east : P.west;
        t.deco(px, py, pz, setValue(vine, face, true));
      }
    }
    for (const [k] of [...t.leaves]) {
      if (r.nextInt(4) !== 0) continue;
      const [dx, dy, dz] = unkey(k);
      const [ax, az, dir] = HORIZ[r.nextInt(4)]!;
      const face = dir === 2 ? P.south : dir === 3 ? P.north : dir === 4 ? P.east : P.west;
      const len = r.nextIntBetween(1, 4);
      for (let i = 0; i < len; i++) t.deco(t.ox + dx + ax, t.oy + dy - i, t.oz + dz + az, setValue(vine, face, true));
    }
  }
  if (opts.cocoa && r.nextInt(5) === 0) {
    for (const [k] of t.logs) {
      const [dx, dy, dz] = unkey(k);
      if (dy > 4 || dy < 1 || r.nextInt(4) !== 0) continue;
      const [ax, az, dir] = HORIZ[r.nextInt(4)]!;
      const toward = (dir ^ 1) as Direction;
      t.deco(t.ox + dx + ax, t.oy + dy, t.oz + dz + az, setValue(setValue(B('cocoa'), P.facing, toward), P.age2, r.nextInt(3)));
    }
  }
  if (opts.bees && r.nextFloat() < opts.bees) {
    // nest under the lowest leaves, on the south side of the trunk when possible
    let lowest = Infinity;
    for (const k of t.leaves.keys()) lowest = Math.min(lowest, unkey(k)[1]);
    const ny = Math.max(1, Math.min(lowest - 1, 4));
    for (const [ax, az, dir] of [HORIZ[1]!, HORIZ[3]!, HORIZ[2]!, HORIZ[0]!]) {
      const px = x + ax, py = y + ny, pz = z + az;
      if (!t.hasLog(x, py, z) || !t.free(px, py, pz) || t.hasLeaf(px, py, pz)) continue;
      t.deco(px, py, pz, setValue(B('bee_nest'), P.facing, dir));
      const bees = Array.from({ length: r.nextIntBetween(2, 3) }, () => ({ entity: 'bee', ticksInHive: 0 }));
      t.entities.push({ x: px, y: py, z: pz, type: 'beehive', data: { bees } });
      break;
    }
  }
  if (opts.litter) {
    const litter = B('leaf_litter');
    for (let i = 0; i < 24; i++) {
      const px = x + r.nextIntBetween(-4, 4), pz = z + r.nextIntBetween(-4, 4);
      for (let py = y + 2; py >= y - 3; py--) {
        const below = t.w.getBlock(px, py - 1, pz);
        if (isAir(t.w.getBlock(px, py, pz)) && isSoil(below)) {
          t.deco(px, py, pz, setValue(setValue(litter, P.segmentAmount, r.nextIntBetween(1, 4)), P.facing, HORIZ[r.nextInt(4)]![2]));
          break;
        }
      }
    }
  }
}

// ---- oak / birch / swamp ---------------------------------------------------------------------

function blobTree(wood: string, minH: number, maxH: number, radius = 2, leafName = `${wood}_leaves`): Shape {
  return (t, x, y, z) => {
    const h = t.r.nextIntBetween(minH, maxH);
    if (!trunkClear(t, x, y, z, h + 1)) return false;
    const log = B(`${wood}_log`), leaf = B(leafName);
    for (let dy = 0; dy < h; dy++) t.log(x, y + dy, z, log);
    const top = y + h;
    for (let dy = -3; dy <= 0; dy++) {
      const rr = dy >= -1 ? radius - 1 : radius;
      t.leafLayer(x, top + dy, z, rr, leaf, true, dy === 0 ? 1 : 0.5);
    }
    return true;
  };
}

/** Large branching oak with round leaf clusters. */
function fancyTree(wood: string): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(6, 13);
    if (!trunkClear(t, x, y, z, 5)) return false;
    const log = B(`${wood}_log`), leaf = B(`${wood}_leaves`);
    let trunkTop = h;
    for (let dy = 0; dy < h; dy++) {
      if (!t.log(x, y + dy, z, log)) { trunkTop = dy; break; }
    }
    if (trunkTop < 4) return false;
    const clusters: Array<[number, number, number]> = [[x, y + trunkTop, z]];
    const levels = Math.max(1, trunkTop - 4);
    for (let i = 0; i < levels; i++) {
      const ly = y + Math.floor(trunkTop * 0.35) + i;
      if (r.nextInt(2) === 0 && i < levels - 1) continue;
      const ang = r.nextFloat() * Math.PI * 2;
      const len = r.nextIntBetween(2, 4);
      const cxp = x + Math.round(Math.cos(ang) * len), czp = z + Math.round(Math.sin(ang) * len);
      const cyp = ly + r.nextIntBetween(1, 2);
      t.logLine(x, ly, z, cxp, cyp, czp, log);
      clusters.push([cxp, cyp, czp]);
    }
    for (const [cx, cy, cz] of clusters) {
      for (let dy = 0; dy < 4; dy++) {
        const rr = dy === 0 || dy === 3 ? 1.6 : 2.6;
        const rc = Math.ceil(rr);
        for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
          if (dx * dx + dz * dz <= rr * rr) t.leaf(cx + dx, cy + dy - 1, cz + dz, leaf);
        }
      }
    }
    return true;
  };
}

// ---- spruce / pine ---------------------------------------------------------------------------

function spruceTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(6, 9);
    const bare = r.nextIntBetween(1, 2);
    if (!trunkClear(t, x, y, z, h)) return false;
    const log = B('spruce_log'), leaf = B('spruce_leaves');
    for (let dy = 0; dy < h - 1; dy++) t.log(x, y + dy, z, log);
    const maxR = r.nextIntBetween(2, 3);
    let radius = r.nextInt(2);
    let limit = 1;
    let start = 0;
    const top = y + h;
    t.leaf(x, top, z, leaf);
    for (let yy = top; yy >= y + bare; yy--) {
      t.leafLayer(x, yy, z, radius, leaf, true, 1);
      if (radius >= limit) {
        radius = start;
        start = 1;
        limit = Math.min(limit + 1, maxR);
      } else radius++;
    }
    return true;
  };
}

function pineTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(7, 11);
    if (!trunkClear(t, x, y, z, h)) return false;
    const log = B('spruce_log'), leaf = B('spruce_leaves');
    for (let dy = 0; dy < h; dy++) t.log(x, y + dy, z, log);
    const leafH = r.nextIntBetween(3, 5);
    const top = y + h;
    t.leaf(x, top, z, leaf);
    let radius = 0;
    for (let yy = top; yy >= top - leafH; yy--) {
      t.leafLayer(x, yy, z, radius, leaf, true, 1);
      if (radius < 1 || (radius < 2 && yy < top - 2)) radius++;
    }
    return true;
  };
}

function megaSpruce(pine: boolean): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(13, 28);
    if (!trunkClear(t, x, y, z, 6, 2)) return false;
    const log = B('spruce_log'), leaf = B('spruce_leaves');
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) t.log(x + dx, y + dy, z + dz, log);
    const leafH = pine ? r.nextIntBetween(5, 8) : r.nextIntBetween(13, 17);
    const top = y + h;
    for (let yy = top + 1; yy >= top + 1 - leafH; yy--) {
      const depth = top + 1 - yy;
      const rr = pine ? Math.min(2, Math.floor(depth / 2) + 1) : Math.floor((depth / leafH) * 5 + 0.5) + (depth % 2);
      for (let dx = -rr; dx <= rr + 1; dx++) for (let dz = -rr; dz <= rr + 1; dz++) {
        const ex = dx <= 0 ? -dx : dx - 1, ez = dz <= 0 ? -dz : dz - 1;
        if (ex * ex + ez * ez <= rr * rr) t.leaf(x + dx, yy, z + dz, leaf);
      }
    }
    return true;
  };
}

// ---- jungle -----------------------------------------------------------------------------------

function jungleTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(4, 9);
    if (!trunkClear(t, x, y, z, h + 1)) return false;
    const log = B('jungle_log'), leaf = B('jungle_leaves');
    for (let dy = 0; dy < h; dy++) t.log(x, y + dy, z, log);
    const top = y + h;
    for (let dy = -3; dy <= 0; dy++) t.leafLayer(x, top + dy, z, dy >= -1 ? 1 : 2, leaf, true, dy === 0 ? 1 : 0.5);
    return true;
  };
}

function megaJungle(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(10, 30);
    if (!trunkClear(t, x, y, z, 8, 2)) return false;
    const log = B('jungle_log'), leaf = B('jungle_leaves');
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) t.log(x + dx, y + dy, z + dz, log);
    // side branches with small canopies
    for (let by = y + h - 2 - r.nextInt(4); by > y + h / 2; by -= 2 + r.nextInt(4)) {
      const ang = r.nextFloat() * Math.PI * 2;
      const len = r.nextIntBetween(3, 5);
      const ex = x + Math.round(Math.cos(ang) * len), ez = z + Math.round(Math.sin(ang) * len);
      t.logLine(x, by, z, ex, by + 2, ez, log);
      for (let dy = 0; dy < 2; dy++) t.leafDisc(ex, by + 2 + dy, ez, dy === 0 ? 2 : 1, leaf);
    }
    const top = y + h;
    for (let dy = -2; dy <= 1; dy++) t.leafDisc(x, top + dy, z, dy === 1 ? 2 : dy === 0 ? 3 : 4, leaf);
    return true;
  };
}

function jungleBush(): Shape {
  return (t, x, y, z) => {
    if (!t.free(x, y, z)) return false;
    const log = B('jungle_log'), leaf = B('oak_leaves');
    t.log(x, y, z, log);
    for (let dy = 0; dy <= 2; dy++) t.leafLayer(x, y + dy, z, 2 - dy, leaf, true, 0.5);
    return true;
  };
}

// ---- acacia -----------------------------------------------------------------------------------

function acaciaTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(5, 8);
    if (!trunkClear(t, x, y, z, 4)) return false;
    const log = B('acacia_log'), leaf = B('acacia_leaves');
    const dir = HORIZ[r.nextInt(4)]!;
    const bendAt = h - r.nextInt(4) - 1;
    let bends = 3 - r.nextInt(3);
    let cx = x, cz = z, top = y;
    for (let dy = 0; dy < h; dy++) {
      if (dy >= bendAt && bends > 0) {
        cx += dir[0];
        cz += dir[1];
        bends--;
      }
      if (t.log(cx, y + dy, cz, log)) top = y + dy;
    }
    const heads: Array<[number, number, number]> = [[cx, top, cz]];
    const dir2 = HORIZ[r.nextInt(4)]!;
    if (dir2 !== dir) {
      const start = bendAt - r.nextInt(2) - 1;
      let bx = x, bz = z, by = y + start;
      const len = 1 + r.nextInt(3);
      for (let i = 0; i < len; i++) {
        bx += dir2[0];
        bz += dir2[1];
        by++;
        t.log(bx, by, bz, log);
      }
      if (len > 0) heads.push([bx, by, bz]);
    }
    for (const [hx, hy, hz] of heads) {
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
        if ((Math.abs(dx) === 3 || Math.abs(dz) === 3) && Math.abs(dx) + Math.abs(dz) > 4) continue;
        t.leaf(hx + dx, hy, hz + dz, leaf);
      }
      t.leafLayer(hx, hy + 1, hz, 1, leaf, false);
      t.leaf(hx + 2, hy + 1, hz, leaf); t.leaf(hx - 2, hy + 1, hz, leaf); t.leaf(hx, hy + 1, hz + 2, leaf); t.leaf(hx, hy + 1, hz - 2, leaf);
    }
    return true;
  };
}

// ---- dark oak / pale oak ----------------------------------------------------------------------

function darkOakTree(wood: 'dark_oak' | 'pale_oak'): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(6, 9);
    if (!trunkClear(t, x, y, z, h, 2)) return false;
    const log = B(`${wood}_log`), leaf = B(`${wood}_leaves`);
    const dir = HORIZ[r.nextInt(4)]!;
    const bendAt = h - r.nextInt(4);
    let bend = 2 - r.nextInt(3);
    let cx = x, cz = z;
    for (let dy = 0; dy < h; dy++) {
      if (dy >= bendAt && bend > 0) { cx += dir[0]; cz += dir[1]; bend--; }
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) t.log(cx + dx, y + dy, cz + dz, log);
    }
    const top = y + h - 1;
    for (let dy = -2; dy <= 1; dy++) {
      const rr = dy === 1 ? 2 : dy === -2 ? 3 : 4;
      for (let dx = -rr; dx <= rr + 1; dx++) for (let dz = -rr; dz <= rr + 1; dz++) {
        const ex = dx <= 0 ? -dx : dx - 1, ez = dz <= 0 ? -dz : dz - 1;
        if (ex + ez > rr + 1 || (ex === rr && ez === rr)) continue;
        t.leaf(cx + dx, top + dy, cz + dz, leaf);
      }
    }
    // random branch stubs under the canopy
    for (let i = 0; i < 4; i++) {
      if (r.nextInt(3) !== 0) continue;
      const bx = cx + r.nextIntBetween(-1, 2), bz = cz + r.nextIntBetween(-1, 2);
      const by = top - r.nextIntBetween(1, 3);
      t.log(bx, by, bz, log);
      t.leafLayer(bx, by + 1, bz, 1, leaf, true);
    }
    if (wood === 'pale_oak') {
      const moss = B('pale_hanging_moss');
      for (const k of [...t.leaves.keys()]) {
        const [dx, dy, dz] = unkey(k);
        if (t.hasLeaf(t.ox + dx, t.oy + dy - 1, t.oz + dz) || r.nextInt(7) !== 0) continue;
        const len = r.nextIntBetween(1, 3);
        for (let i = 1; i <= len; i++) t.deco(t.ox + dx, t.oy + dy - i, t.oz + dz, setValue(moss, P.tip, i === len));
      }
      if (r.nextInt(10) === 0) {
        const hy = y + r.nextIntBetween(2, Math.max(2, h - 3));
        const k = key(cx - t.ox, hy - t.oy, cz - t.oz);
        if (t.logs.has(k)) t.logs.set(k, B('groaner_heart[natural=true]'));
      }
    }
    return true;
  };
}

// ---- mangrove ---------------------------------------------------------------------------------

function mangroveTree(tall: boolean): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = tall ? r.nextIntBetween(4, 9) : r.nextIntBetween(2, 5);
    const log = B('mangrove_log'), leaf = B('mangrove_leaves'), roots = B('mangrove_roots'), muddy = B('muddy_mangrove_roots');
    const mud = B('mud'), water = B('water');
    // lift the trunk above the roots
    const base = y + r.nextIntBetween(1, 3);
    if (!trunkClear(t, x, base, z, h)) return false;
    for (let dy = y; dy < base + h; dy++) t.log(x, dy, z, log);
    const heads: Array<[number, number, number]> = [[x, base + h, z]];
    const branches = r.nextIntBetween(1, 3);
    for (let i = 0; i < branches; i++) {
      const [ax, az] = HORIZ[r.nextInt(4)]!;
      const by = base + h - r.nextIntBetween(1, 3);
      const len = r.nextIntBetween(1, 3);
      let bx = x, bz = z, yy = by;
      for (let k = 0; k < len; k++) {
        bx += ax; bz += az; yy += r.nextInt(2);
        t.log(bx, yy, bz, log, ax !== 0 ? 'x' : 'z');
      }
      heads.push([bx, yy + 1, bz]);
    }
    for (const [hx, hy, hz] of heads) {
      for (let n = 0; n < 70; n++) {
        const px = hx + r.nextIntBetween(-3, 3), py = hy + r.nextIntBetween(-2, 1), pz = hz + r.nextIntBetween(-3, 3);
        if ((px - hx) ** 2 + (pz - hz) ** 2 > 10) continue;
        t.leaf(px, py, pz, leaf);
      }
    }
    // hanging propagules
    for (const k of [...t.leaves.keys()]) {
      if (r.nextFloat() > 0.14) continue;
      const [dx, dy, dz] = unkey(k);
      if (!t.free(t.ox + dx, t.oy + dy - 1, t.oz + dz) || t.hasLeaf(t.ox + dx, t.oy + dy - 1, t.oz + dz)) continue;
      t.deco(t.ox + dx, t.oy + dy - 1, t.oz + dz, setValue(setValue(B('mangrove_propagule'), P.hanging, true), P.age4, r.nextInt(5)));
    }
    // arching roots into mud and water
    const rootCount = r.nextIntBetween(3, 6);
    for (let i = 0; i < rootCount; i++) {
      const [ax, az] = HORIZ[i % 4]!;
      let rx = x, rz = z, ry = base;
      const len = r.nextIntBetween(2, 5);
      for (let k = 0; k < len + 6; k++) {
        if (k < len) { rx += ax; rz += az; }
        ry -= k < 1 ? 0 : 1;
        if (ry < t.w.minY + 1) break;
        const cur = t.w.getBlock(rx, ry, rz);
        const k2 = key(rx - t.ox, ry - t.oy, rz - t.oz);
        if (cur === mud) { t.logs.set(k2, muddy); break; }
        if (!(isAir(cur) || cur === water || treeCanReplace(cur, true))) break;
        t.logs.set(k2, cur === water ? setValue(roots, P.waterlogged, true) : roots);
      }
    }
    return true;
  };
}

// ---- cherry -----------------------------------------------------------------------------------

function cherryTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(7, 9);
    if (!trunkClear(t, x, y, z, 5)) return false;
    const log = B('cherry_log'), leaf = B('cherry_leaves');
    const trunkH = h - 3;
    for (let dy = 0; dy < trunkH; dy++) t.log(x, y + dy, z, log);
    const heads: Array<[number, number, number]> = [[x, y + trunkH, z]];
    const branches = r.nextIntBetween(1, 2);
    const used = new Set<number>();
    for (let i = 0; i < branches; i++) {
      let d = r.nextInt(4);
      while (used.has(d)) d = (d + 1) % 4;
      used.add(d);
      const [ax, az] = HORIZ[d]!;
      const sy = y + trunkH - r.nextIntBetween(1, 2);
      const len = r.nextIntBetween(2, 4);
      let bx = x, bz = z, by = sy;
      for (let k = 0; k < len; k++) { bx += ax; bz += az; t.log(bx, by, bz, log, ax !== 0 ? 'x' : 'z'); }
      for (let k = 0; k < r.nextIntBetween(2, 4); k++) { by++; t.log(bx, by, bz, log); }
      heads.push([bx, by + 1, bz]);
    }
    for (const [hx, hy, hz] of heads) {
      for (let dy = -2; dy <= 2; dy++) {
        const rr = dy === 2 ? 2 : dy === -2 ? 3 : 4;
        t.leafDisc(hx, hy + dy, hz, rr, leaf);
      }
    }
    // hanging leaf fringes
    for (const k of [...t.leaves.keys()]) {
      const [dx, dy, dz] = unkey(k);
      if (t.hasLeaf(t.ox + dx, t.oy + dy - 1, t.oz + dz) || r.nextFloat() > 0.16) continue;
      t.leaf(t.ox + dx, t.oy + dy - 1, t.oz + dz, leaf);
      if (r.nextFloat() < 0.33) t.leaf(t.ox + dx, t.oy + dy - 2, t.oz + dz, leaf);
    }
    return true;
  };
}

// ---- azalea -----------------------------------------------------------------------------------

function azaleaTree(): Shape {
  return (t, x, y, z) => {
    const r = t.r;
    const h = r.nextIntBetween(4, 6);
    if (!trunkClear(t, x, y, z, h)) return false;
    const log = B('oak_log'), leafA = B('azalea_leaves'), leafF = B('flowering_azalea_leaves');
    const [ax, az] = HORIZ[r.nextInt(4)]!;
    let cx = x, cz = z;
    const bendAt = r.nextIntBetween(2, 3);
    for (let dy = 0; dy < h; dy++) {
      if (dy === bendAt && r.nextBool()) { cx += ax; cz += az; }
      t.log(cx, y + dy, cz, log);
    }
    const top = y + h - 1;
    for (let dy = -1; dy <= 1; dy++) {
      const rr = dy === 1 ? 2 : 3;
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (dx * dx + dz * dz > rr * rr - (dy === 1 ? 1 : 0) || r.nextFloat() < 0.12) continue;
        t.leaf(cx + dx, top + dy, cz + dz, r.nextFloat() < 0.25 ? leafF : leafA);
      }
    }
    return true;
  };
}

// ---- mushrooms -------------------------------------------------------------------------------

function hugeMushroom(red: boolean): Feature {
  return (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    const below = w.getBlock(x, y - 1, z);
    if (!(hasTag(below, 'dirt') || below === B('mycelium') || below === B('podzol'))) return false;
    const h = r.nextIntBetween(4, 7) * (r.nextInt(12) === 0 ? 2 : 1);
    const t = new TreeBuilder(ctx, x, y, z);
    if (!trunkClear(t, x, y, z, h + 1)) return false;
    const stem = B('mushroom_stem[up=false,down=false]');
    const capBlock = B(red ? 'red_mushroom_block' : 'brown_mushroom_block');
    for (let dy = 0; dy < h; dy++) t.log(x, y + dy, z, stem);
    const cap = new Map<number, [number, number, number]>();
    const add = (px: number, py: number, pz: number) => { if (t.free(px, py, pz)) cap.set(key(px - x, py - y, pz - z), [px, py, pz]); };
    if (red) {
      for (let dy = h - 3; dy <= h; dy++) {
        const rr = dy < h ? 2 : 1;
        for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
          const edgeX = Math.abs(dx) === rr, edgeZ = Math.abs(dz) === rr;
          if (dy < h && !(edgeX || edgeZ)) continue;
          if (edgeX && edgeZ) continue;
          add(x + dx, y + dy, z + dz);
        }
      }
    } else {
      const rr = 3;
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
        add(x + dx, y + h, z + dz);
      }
    }
    for (const [k, [px, py, pz]] of cap) {
      let st = capBlock;
      const faces: Array<[typeof P.down, number, number, number]> = [[P.down, 0, -1, 0], [P.up, 0, 1, 0], [P.north, 0, 0, -1], [P.south, 0, 0, 1], [P.west, -1, 0, 0], [P.east, 1, 0, 0]];
      for (const [prop, ax, ay, az] of faces) {
        const nk = key(px + ax - x, py + ay - y, pz + az - z);
        const inner = cap.has(nk) || t.logs.has(nk) || (prop === P.down && red);
        st = setValue(st, prop, !inner);
      }
      t.leaves.set(k, st);
    }
    t.commit();
    return true;
  };
}

// ---- fallen trees ------------------------------------------------------------------------------

function fallenTree(wood: string): Feature {
  return (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    if (!isSoil(w.getBlock(x, y - 1, z))) return false;
    const log = B(`${wood}_log`);
    const [ax, az] = HORIZ[r.nextInt(4)]!;
    const len = r.nextIntBetween(4, 7);
    const start = 2;
    for (let i = start; i < start + len; i++) {
      const px = x + ax * i, pz = z + az * i;
      if (!treeCanReplace(w.getBlock(px, y, pz)) || !isSoil(w.getBlock(px, y - 1, pz)) && !hasTag(w.getBlock(px, y - 1, pz), 'base_stone_overworld')) return false;
    }
    const t = new TreeBuilder(ctx, x, y, z);
    t.log(x, y, z, log);
    for (let i = start; i < start + len; i++) {
      const px = x + ax * i, pz = z + az * i;
      t.log(px, y, pz, log, ax !== 0 ? 'x' : 'z');
      if (r.nextInt(5) === 0) t.deco(px, y + 1, pz, B(r.nextBool() ? 'brown_mushroom' : 'red_mushroom'));
    }
    t.commit();
    return true;
  };
}

// ---------------------------------------------------------------------------------------------
// Exported features
// ---------------------------------------------------------------------------------------------

export const TREES = {
  oak: () => makeTree(blobTree('oak', 4, 6)),
  oakBees: (p: number) => makeTree(blobTree('oak', 4, 6), { bees: p }),
  fancyOak: () => makeTree(fancyTree('oak')),
  fancyOakBees: (p: number) => makeTree(fancyTree('oak'), { bees: p }),
  swampOak: () => makeTree(blobTree('oak', 5, 7, 3), { vines: true, water: true }),
  birch: () => makeTree(blobTree('birch', 5, 7)),
  birchBees: (p: number) => makeTree(blobTree('birch', 5, 7), { bees: p }),
  tallBirch: () => makeTree(blobTree('birch', 9, 12)),
  spruce: () => makeTree(spruceTree()),
  pine: () => makeTree(pineTree()),
  megaSpruce: () => makeTree(megaSpruce(false), { soil: (s) => isSoil(s) }, 2),
  megaPine: () => makeTree(megaSpruce(true), {}, 2),
  jungle: () => makeTree(jungleTree(), { vines: true, cocoa: true }),
  megaJungle: () => makeTree(megaJungle(), { vines: true }, 2),
  jungleBush: () => makeTree(jungleBush()),
  acacia: () => makeTree(acaciaTree()),
  darkOak: () => makeTree(darkOakTree('dark_oak'), { litter: true }, 2),
  paleOak: () => makeTree(darkOakTree('pale_oak'), {}, 2),
  mangrove: () => makeTree(mangroveTree(false), { water: true, soil: (s) => isSoil(s) || s === B('mud') || s === B('mangrove_roots') || s === B('muddy_mangrove_roots') }),
  tallMangrove: () => makeTree(mangroveTree(true), { water: true, soil: (s) => isSoil(s) || s === B('mud') || s === B('mangrove_roots') || s === B('muddy_mangrove_roots') }),
  cherry: () => makeTree(cherryTree()),
  cherryBees: (p: number) => makeTree(cherryTree(), { bees: p }),
  azalea: () => makeTree(azaleaTree(), { soil: (s) => isSoil(s) || s === B('moss_block') || s === B('rooted_dirt') }),
  hugeRedMushroom: () => hugeMushroom(true),
  hugeBrownMushroom: () => hugeMushroom(false),
  fallenOak: () => fallenTree('oak'),
  fallenBirch: () => fallenTree('birch'),
  fallenSpruce: () => fallenTree('spruce'),
  fallenJungle: () => fallenTree('jungle'),
};

/** Pick one of several features by weight (falls back to `fallback`). */
export function selector(options: Array<[Feature, number]>, fallback: Feature): Feature {
  return (ctx, x, y, z) => {
    for (const [f, chance] of options) {
      if (ctx.rng.nextFloat() < chance) return f(ctx, x, y, z);
    }
    return fallback(ctx, x, y, z);
  };
}

/** Sapling growth entry point: tree feature for a sapling block name. */
export function saplingTree(sapling: string, r: Random, big: boolean): Feature | null {
  switch (sapling) {
    case 'oak_sapling': return r.nextInt(10) === 0 ? TREES.fancyOak() : TREES.oak();
    case 'birch_sapling': return TREES.birch();
    case 'spruce_sapling': return big ? (r.nextBool() ? TREES.megaSpruce() : TREES.megaPine()) : TREES.spruce();
    case 'jungle_sapling': return big ? TREES.megaJungle() : TREES.jungle();
    case 'acacia_sapling': return TREES.acacia();
    case 'dark_oak_sapling': return big ? TREES.darkOak() : null;
    case 'pale_oak_sapling': return big ? TREES.paleOak() : null;
    case 'cherry_sapling': return TREES.cherry();
    case 'mangrove_propagule': return r.nextInt(5) === 0 ? TREES.tallMangrove() : TREES.mangrove();
    case 'azalea': case 'flowering_azalea': return TREES.azalea();
    case 'red_mushroom': return TREES.hugeRedMushroom();
    case 'brown_mushroom': return TREES.hugeBrownMushroom();
    default: return null;
  }
}
