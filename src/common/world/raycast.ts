/** Voxel ray casting against block outline shapes (DDA traversal). */
import { getOutlineShape, getCollisionShape, stateFlags, F, tryGetValue } from '../block/registry';
import { P } from '../block/properties';
import type { BlockGetter } from './level';
import type { Direction } from './direction';

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  face: Direction;
  /** Exact hit point. */
  px: number;
  py: number;
  pz: number;
  distance: number;
  state: number;
}

export type RayMode = 'outline' | 'collision';

/**
 * Cast a ray from (ox,oy,oz) along normalised (dx,dy,dz) up to `maxDist`.
 * `fluids`: 'none' ignores liquids, 'source' hits source blocks, 'any' hits all fluid blocks.
 */
export function raycastBlocks(world: BlockGetter, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, mode: RayMode = 'outline', fluids: 'none' | 'source' | 'any' = 'none'): BlockHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
  const out = { face: 0 };
  for (let i = 0; i < 512; i++) {
    const st = world.getBlockState(x, y, z);
    const f = stateFlags[st]!;
    if (!(f & F.AIR)) {
      let shape = mode === 'outline' ? getOutlineShape(st) : getCollisionShape(st);
      const isFluid = (f & F.FLUID_BLOCK) !== 0;
      if (isFluid && fluids !== 'none') {
        const lv = tryGetValue(st, P.level15) ?? 0;
        if (fluids === 'any' || lv === 0) shape = FULL;
      }
      let best = Infinity, bestFace = 0;
      for (let k = 0; k < shape.length; k += 6) {
        const bx0 = x + shape[k]!, by0 = y + shape[k + 1]!, bz0 = z + shape[k + 2]!;
        const bx1 = x + shape[k + 3]!, by1 = y + shape[k + 4]!, bz1 = z + shape[k + 5]!;
        const t = rayBox(ox, oy, oz, dx, dy, dz, bx0, by0, bz0, bx1, by1, bz1, out);
        if (t >= 0 && t < best) { best = t; bestFace = out.face; }
      }
      if (best <= maxDist && best < Infinity) {
        return { x, y, z, face: bestFace as Direction, px: ox + dx * best, py: oy + dy * best, pz: oz + dz * best, distance: best, state: st };
      }
    }
    // advance
    let t: number;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { t = tMaxX; x += stepX; tMaxX += tDeltaX; }
    else if (tMaxY < tMaxZ) { t = tMaxY; y += stepY; tMaxY += tDeltaY; }
    else { t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; }
    if (t > maxDist) return null;
  }
  return null;
}

const FULL = new Float32Array([0, 0, 0, 1, 1, 1]);

/** Slab ray/box test; returns entry t (0 if inside) or -1. Writes face (0..5). */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: { face: number }): number {
  let tmin = -Infinity, tmax = Infinity, face = 0;
  const axis = (o: number, d: number, mn: number, mx: number, negFace: number, posFace: number): boolean => {
    if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    let f = negFace;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; f = posFace; }
    if (t1 > tmin) { tmin = t1; face = f; }
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  // face ids: entering through min side of X means hitting WEST face (4), etc.
  if (!axis(ox, dx, x0, x1, 4, 5)) return -1;
  if (!axis(oy, dy, y0, y1, 0, 1)) return -1;
  if (!axis(oz, dz, z0, z1, 2, 3)) return -1;
  if (tmax < 0) return -1;
  out.face = face;
  return Math.max(0, tmin);
}
