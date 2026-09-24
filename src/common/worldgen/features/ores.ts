/** Ore blobs, stone variety blobs, scattered ores and disks. */
import { S, hasTag, stateFlags, F, STATE_COUNT } from '../../block/registry';
import { Feature, FeatureContext, isAir } from './api';

type Replace = (state: number) => number;

/** Precomputed state → replacement table (-1 = keep). */
function table(rule: (s: number) => number): Replace {
  let t: Int32Array | null = null;
  return (s) => {
    if (!t) {
      t = new Int32Array(STATE_COUNT);
      for (let i = 0; i < STATE_COUNT; i++) t[i] = rule(i);
    }
    return t[s]!;
  };
}

/** Target rule: stone-type blocks → `stone`, deepslate-type → `deep`. */
export function oreTargets(stone: string, deep: string | null): Replace {
  return table((s) => {
    if (hasTag(s, 'stone_ore_replaceables')) return S(stone);
    if (deep && hasTag(s, 'deepslate_ore_replaceables')) return S(deep);
    return -1;
  });
}

/** Replace any base stone (stone, deepslate, granite…) with `block`. */
export function baseStoneTarget(block: string): Replace {
  return table((s) => (hasTag(s, 'base_stone_overworld') ? S(block) : -1));
}

/** Replace a fixed set of blocks. */
export function blocksTarget(from: string[], to: string): Replace {
  return table((s) => (from.some((n) => S(n) === s) ? S(to) : -1));
}

function exposedToAir(ctx: FeatureContext, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  return isAir(w.getBlock(x + 1, y, z)) || isAir(w.getBlock(x - 1, y, z)) || isAir(w.getBlock(x, y + 1, z)) ||
    isAir(w.getBlock(x, y - 1, z)) || isAir(w.getBlock(x, y, z + 1)) || isAir(w.getBlock(x, y, z - 1));
}

/**
 * Ore blob: spheres swept along a short random segment. `airDiscard` is the probability of
 * skipping a block that touches air (keeps valuable ores mostly buried).
 */
export function ore(target: Replace, size: number, airDiscard = 0): Feature {
  return (ctx, x, y, z) => {
    const r = ctx.rng;
    const angle = r.nextFloat() * Math.PI;
    const len = size / 8;
    const sx = Math.sin(angle) * len, sz = Math.cos(angle) * len;
    const x0 = x + 0.5 + sx, x1 = x + 0.5 - sx;
    const z0 = z + 0.5 + sz, z1 = z + 0.5 - sz;
    const y0 = y + r.nextInt(3) - 1.5, y1 = y + r.nextInt(3) - 1.5;
    // Sphere list and its bounding box
    const spheres = new Float64Array(size * 4);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < size; i++) {
      const t = i / size;
      const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t, cz = z0 + (z1 - z0) * t;
      const radius = ((Math.sin(Math.PI * t) + 1) * (r.nextFloat() * size / 16) + 1) / 2;
      spheres[i * 4] = cx; spheres[i * 4 + 1] = cy; spheres[i * 4 + 2] = cz; spheres[i * 4 + 3] = radius;
      minX = Math.min(minX, Math.floor(cx - radius)); maxX = Math.max(maxX, Math.floor(cx + radius));
      minY = Math.min(minY, Math.floor(cy - radius)); maxY = Math.max(maxY, Math.floor(cy + radius));
      minZ = Math.min(minZ, Math.floor(cz - radius)); maxZ = Math.max(maxZ, Math.floor(cz + radius));
    }
    const w = ctx.world;
    minY = Math.max(minY, w.minY + 1);
    maxY = Math.min(maxY, w.maxY - 1);
    if (minY > maxY) return false;
    const bw = maxX - minX + 1, bh = maxY - minY + 1, bd = maxZ - minZ + 1;
    const mask = new Uint8Array(bw * bh * bd);
    for (let i = 0; i < size; i++) {
      const cx = spheres[i * 4]!, cy = spheres[i * 4 + 1]!, cz = spheres[i * 4 + 2]!, radius = spheres[i * 4 + 3]!;
      const r2 = radius * radius;
      const ax = Math.max(minX, Math.floor(cx - radius)), bx = Math.min(maxX, Math.floor(cx + radius));
      const ay = Math.max(minY, Math.floor(cy - radius)), by = Math.min(maxY, Math.floor(cy + radius));
      const az = Math.max(minZ, Math.floor(cz - radius)), bz = Math.min(maxZ, Math.floor(cz + radius));
      for (let px = ax; px <= bx; px++) {
        const dx = px + 0.5 - cx, dx2 = dx * dx;
        if (dx2 >= r2) continue;
        for (let py = ay; py <= by; py++) {
          const dy = py + 0.5 - cy, dxy = dx2 + dy * dy;
          if (dxy >= r2) continue;
          const row = ((px - minX) * bh + (py - minY)) * bd;
          for (let pz = az; pz <= bz; pz++) {
            const dz = pz + 0.5 - cz;
            if (dxy + dz * dz < r2) mask[row + pz - minZ] = 1;
          }
        }
      }
    }
    let placed = 0;
    for (let px = minX; px <= maxX; px++) {
      if (w.isInside && !w.isInside(px, minZ) && !w.isInside(px, maxZ)) continue;
      for (let py = minY; py <= maxY; py++) {
        const row = ((px - minX) * bh + (py - minY)) * bd;
        for (let pz = minZ; pz <= maxZ; pz++) {
          if (!mask[row + pz - minZ]) continue;
          if (w.isInside && !w.isInside(px, pz)) continue;
          const to = target(w.getBlock(px, py, pz));
          if (to < 0) continue;
          if (airDiscard > 0 && r.nextFloat() < airDiscard && exposedToAir(ctx, px, py, pz)) continue;
          w.setBlock(px, py, pz, to);
          placed++;
        }
      }
    }
    return placed > 0;
  };
}

/** Scattered single ores (like ancient debris or buried gems): `count` tries around the origin. */
export function scatteredOre(target: Replace, count: number, airDiscard = 0): Feature {
  return (ctx, x, y, z) => {
    const r = ctx.rng, w = ctx.world;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const s = Math.min(i, 7);
      const px = x + Math.round((r.nextFloat() - r.nextFloat()) * s);
      const py = y + Math.round((r.nextFloat() - r.nextFloat()) * s);
      const pz = z + Math.round((r.nextFloat() - r.nextFloat()) * s);
      if (w.isInside && !w.isInside(px, pz)) continue;
      const to = target(w.getBlock(px, py, pz));
      if (to < 0) continue;
      if (airDiscard > 0 && r.nextFloat() < airDiscard && exposedToAir(ctx, px, py, pz)) continue;
      w.setBlock(px, py, pz, to);
      placed++;
    }
    return placed > 0;
  };
}

/**
 * Disk of `block` replacing soft ground (sand/gravel/clay patches on river and lake beds).
 * `radius` [min, max], vertical half height `half`.
 */
export function disk(block: string, targets: string[], radius: [number, number], half: number, requireWater = true): Feature {
  const st = S(block);
  const tset = new Set(targets.map((n) => S(n)));
  return (ctx, x, y, z) => {
    const w = ctx.world;
    if (requireWater && !(stateFlags[w.getBlock(x, y, z)]! & F.WATER)) return false;
    const r = ctx.rng.nextIntBetween(radius[0], radius[1]);
    let placed = 0;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      for (let dy = -half; dy <= half; dy++) {
        const bx = x + dx, by = y - 1 + dy, bz = z + dz;
        if (w.isInside && !w.isInside(bx, bz)) continue;
        if (tset.has(w.getBlock(bx, by, bz))) {
          w.setBlock(bx, by, bz, st);
          placed++;
        }
      }
    }
    return placed > 0;
  };
}
