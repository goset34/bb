/**
 * Terrain features that are not plants: snow & ice top layer, springs, lakes, geodes, monster
 * rooms, fossils, ice spikes, icebergs, desert wells and mossy boulders.
 */
import { P } from '../../block/properties';
import { stateFlags, F, hasTag, tryGetValue, setValue, isFaceSturdy } from '../../block/registry';
import { Direction } from '../../world/direction';
import { BIOMES, temperatureAt, fuzzyQuart } from '../biomes';
import { hashString } from '../../math/random';
import { B } from './blocks';
import { Feature, FeatureContext, isAir, isSolid } from './api';

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];

function inside(ctx: FeatureContext, x: number, z: number): boolean {
  return !ctx.world.isInside || ctx.world.isInside(x, z);
}

function isLiquid(s: number): boolean {
  return (stateFlags[s]! & F.FLUID_BLOCK) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Snow and ice
// ---------------------------------------------------------------------------------------------

export function canHoldSnow(below: number): boolean {
  if (hasTag(below, 'ice') || below === B('ice') || below === B('packed_ice') || below === B('barrier')) return false;
  if (hasTag(below, 'leaves')) return true;
  return isFaceSturdy(below, 1);
}

/** Freeze the top water block and lay snow wherever it is cold enough (one pass per chunk). */
export const freezeTopLayer: Feature = (ctx) => {
  const w = ctx.world;
  const bx = ctx.cx << 4, bz = ctx.cz << 4;
  const water = B('water'), ice = B('ice'), snow = B('snow');
  const q: [number, number] = [0, 0];
  const fuzz = hashString(ctx.seed.text + '/freeze');
  for (let dz = 0; dz < 16; dz++) {
    for (let dx = 0; dx < 16; dx++) {
      const x = bx + dx, z = bz + dz;
      const top = w.getHeight('motion', x, z);
      if (top <= w.minY || top >= w.maxY) continue;
      fuzzyQuart(fuzz, x, z, q);
      const biome = BIOMES[w.getBiome(q[0] * 4 + 2, top, q[1] * 4 + 2)]!;
      const noise = ctx.climate ? ctx.climate.temperatureNoise(x, z) : 0;
      if (temperatureAt(biome, top, noise) >= 0.15) continue;
      const below = w.getBlock(x, top - 1, z);
      if (below === water) {
        w.setBlock(x, top - 1, z, ice);
        continue;
      }
      if (biome.precipitation === 'none') continue;
      if (!isAir(w.getBlock(x, top, z)) || !canHoldSnow(below)) continue;
      w.setBlock(x, top, z, snow);
      if (tryGetValue(below, P.snowy) === false) w.setBlock(x, top - 1, z, setValue(below, P.snowy, true));
    }
  }
  return true;
};

// ---------------------------------------------------------------------------------------------
// Springs and lakes
// ---------------------------------------------------------------------------------------------

const SPRING_ROCK = ['stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'calcite', 'dirt', 'snow_block', 'powder_snow', 'packed_ice'];

export function spring(fluid: 'water' | 'lava'): Feature {
  let rock: Set<number> | null = null;
  return (ctx, x, y, z) => {
    rock ??= new Set(SPRING_ROCK.map((n) => B(n)));
    const w = ctx.world;
    if (!rock.has(w.getBlock(x, y + 1, z)) || !rock.has(w.getBlock(x, y - 1, z))) return false;
    const cur = w.getBlock(x, y, z);
    if (!isAir(cur) && !rock.has(cur)) return false;
    let solid = 0, holes = 0;
    for (let d = 2; d < 6; d++) {
      const s = w.getBlock(x + DX[d]!, y, z + DZ[d]!);
      if (rock.has(s)) solid++;
      else if (isAir(s)) holes++;
    }
    if (solid !== 3 || holes !== 1) return false;
    w.setBlock(x, y, z, B(fluid));
    w.scheduleTick?.(x, y, z, 0);
    return true;
  };
}

/** Blob-shaped basin half filled with `fluid` (lava lakes). */
export function lake(fluid: string, barrier: string): Feature {
  return (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    if (y <= w.minY + 4) return false;
    const fluidState = B(fluid), barrierState = B(barrier), air = B('air');
    const oy = y - 4, ox = x - 8, oz = z - 8;
    const mask = new Uint8Array(16 * 16 * 8);
    const idx = (ix: number, iy: number, iz: number) => (ix * 16 + iz) * 8 + iy;
    const blobs = r.nextInt(4) + 4;
    for (let i = 0; i < blobs; i++) {
      const sx = r.nextDouble() * 6 + 3, sy = r.nextDouble() * 4 + 2, sz = r.nextDouble() * 6 + 3;
      const px = r.nextDouble() * (16 - sx - 2) + 1 + sx / 2;
      const py = r.nextDouble() * (8 - sy - 4) + 2 + sy / 2;
      const pz = r.nextDouble() * (16 - sz - 2) + 1 + sz / 2;
      for (let ix = 1; ix < 15; ix++) for (let iz = 1; iz < 15; iz++) for (let iy = 1; iy < 7; iy++) {
        const a = (ix - px) / (sx / 2), b = (iy - py) / (sy / 2), c = (iz - pz) / (sz / 2);
        if (a * a + b * b + c * c < 1) mask[idx(ix, iy, iz)] = 1;
      }
    }
    const isEdge = (ix: number, iy: number, iz: number) => !mask[idx(ix, iy, iz)] && (
      (ix < 15 && mask[idx(ix + 1, iy, iz)]) || (ix > 0 && mask[idx(ix - 1, iy, iz)]) ||
      (iz < 15 && mask[idx(ix, iy, iz + 1)]) || (iz > 0 && mask[idx(ix, iy, iz - 1)]) ||
      (iy < 7 && mask[idx(ix, iy + 1, iz)]) || (iy > 0 && mask[idx(ix, iy - 1, iz)]));
    for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 16; iz++) for (let iy = 0; iy < 8; iy++) {
      if (!isEdge(ix, iy, iz)) continue;
      const s = w.getBlock(ox + ix, oy + iy, oz + iz);
      if (iy >= 4 && isLiquid(s)) return false;
      if (iy < 4 && !isSolid(s) && s !== fluidState) return false;
      if (!inside(ctx, ox + ix, oz + iz)) return false;
    }
    for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 16; iz++) for (let iy = 0; iy < 8; iy++) {
      if (mask[idx(ix, iy, iz)]) w.setBlock(ox + ix, oy + iy, oz + iz, iy >= 4 ? air : fluidState);
    }
    // Lava lakes get a stone rim where the basin touches soft ground.
    for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 16; iz++) for (let iy = 0; iy < 8; iy++) {
      if (!isEdge(ix, iy, iz) || iy >= 4) continue;
      const s = w.getBlock(ox + ix, oy + iy, oz + iz);
      if (isSolid(s) && !hasTag(s, 'base_stone_overworld') && s !== barrierState) {
        if (r.nextInt(2) === 0) w.setBlock(ox + ix, oy + iy, oz + iz, barrierState);
      }
    }
    return true;
  };
}

// ---------------------------------------------------------------------------------------------
// Amethyst geodes
// ---------------------------------------------------------------------------------------------

export const geode: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const points: Array<[number, number, number]> = [];
  const n = r.nextIntBetween(3, 4);
  for (let i = 0; i < n; i++) points.push([x + r.nextIntBetween(-2, 2), y + r.nextIntBetween(-2, 2), z + r.nextIntBetween(-2, 2)]);
  const scale = r.nextDouble() * 0.5 + 0.9;
  const rFill = 1.7 * scale, rInner = 2.3 * scale, rMid = 3.2 * scale, rOuter = 4.2 * scale;
  const crack = r.nextFloat() < 0.95;
  const crackDir = r.nextFloat() * Math.PI * 2;
  const cdx = Math.cos(crackDir), cdz = Math.sin(crackDir);
  const dist = (bx: number, by: number, bz: number) => {
    let d = Infinity;
    for (const p of points) {
      const a = bx - p[0], b = by - p[1], c = bz - p[2];
      const dd = Math.sqrt(a * a + b * b + c * c);
      if (dd < d) d = dd;
    }
    return d + (((bx * 73856093) ^ (by * 19349663) ^ (bz * 83492791)) & 255) / 255 * 0.6;
  };
  // Reject geodes that would open into caves or water.
  let exposed = 0;
  for (let bx = x - 7; bx <= x + 7; bx++) for (let by = y - 7; by <= y + 7; by++) for (let bz = z - 7; bz <= z + 7; bz++) {
    const d = dist(bx, by, bz);
    if (d < rOuter && d >= rMid) {
      const s = w.getBlock(bx, by, bz);
      if (isAir(s) || isLiquid(s)) exposed++;
      if (s === B('bedrock')) return false;
    }
  }
  if (exposed > 8) return false;
  const air = B('air'), amethyst = B('amethyst_block'), budding = B('budding_amethyst'), calcite = B('calcite'), basalt = B('smooth_basalt');
  const buddingAt: Array<[number, number, number]> = [];
  for (let bx = x - 7; bx <= x + 7; bx++) for (let by = y - 7; by <= y + 7; by++) for (let bz = z - 7; bz <= z + 7; bz++) {
    if (by <= w.minY || !inside(ctx, bx, bz)) continue;
    const d = dist(bx, by, bz);
    if (d >= rOuter) continue;
    if (crack) {
      // crack: a slot from the centre along crackDir through the shell
      const rx = bx - x, rz = bz - z;
      const along = rx * cdx + rz * cdz;
      const across = Math.abs(rx * cdz - rz * cdx);
      if (along > 0 && across < 1.2 && Math.abs(by - y) < 2.2 && d >= rFill) {
        w.setBlock(bx, by, bz, air);
        continue;
      }
    }
    if (d < rFill) w.setBlock(bx, by, bz, air);
    else if (d < rInner) {
      if (r.nextFloat() < 0.083) {
        w.setBlock(bx, by, bz, budding);
        buddingAt.push([bx, by, bz]);
      } else w.setBlock(bx, by, bz, amethyst);
    } else if (d < rMid) w.setBlock(bx, by, bz, calcite);
    else w.setBlock(bx, by, bz, basalt);
  }
  const buds = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'];
  for (const [bx, by, bz] of buddingAt) {
    for (let d = 0; d < 6; d++) {
      const nx = bx + DX[d]!, ny = by + DY[d]!, nz = bz + DZ[d]!;
      if (!isAir(w.getBlock(nx, ny, nz)) || r.nextFloat() > 0.35) continue;
      w.setBlock(nx, ny, nz, setValue(B(buds[r.nextInt(4)]!), P.facing6, d as Direction));
    }
  }
  return true;
};

// ---------------------------------------------------------------------------------------------
// Monster rooms
// ---------------------------------------------------------------------------------------------

const DUNGEON_MOBS = ['skeleton', 'zombie', 'zombie', 'spider'];

export const monsterRoom: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const rx = r.nextInt(2) + 2, rz = r.nextInt(2) + 2;
  const x0 = -rx - 1, x1 = rx + 1, z0 = -rz - 1, z1 = rz + 1;
  let openings = 0;
  for (let dx = x0; dx <= x1; dx++) for (let dz = z0; dz <= z1; dz++) {
    if (!inside(ctx, x + dx, z + dz)) return false;
    for (let dy = -1; dy <= 4; dy++) {
      const s = w.getBlock(x + dx, y + dy, z + dz);
      const solid = isSolid(s);
      if ((dy === -1 || dy === 4) && !solid) return false;
      const edge = dx === x0 || dx === x1 || dz === z0 || dz === z1;
      if (edge && dy === 0 && isAir(s) && isAir(w.getBlock(x + dx, y + 1, z + dz))) openings++;
    }
  }
  if (openings < 1 || openings > 5) return false;
  const air = B('cave_air'), cobble = B('cobblestone'), mossy = B('mossy_cobblestone');
  for (let dx = x0; dx <= x1; dx++) for (let dy = 3; dy >= -1; dy--) for (let dz = z0; dz <= z1; dz++) {
    const edge = dx === x0 || dx === x1 || dz === z0 || dz === z1;
    const px = x + dx, py = y + dy, pz = z + dz;
    const cur = w.getBlock(px, py, pz);
    if (!edge && dy >= 0) w.setBlock(px, py, pz, air);
    else if (isSolid(cur)) w.setBlock(px, py, pz, dy === -1 && r.nextInt(4) !== 0 ? mossy : cobble);
  }
  // Two chests against the walls
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let t = 0; t < 3; t++) {
      const cx = x + r.nextInt(rx * 2 + 1) - rx, cz = z + r.nextInt(rz * 2 + 1) - rz;
      if (!isAir(w.getBlock(cx, y, cz))) continue;
      let walls = 0, wallDir = -1;
      for (let d = 2; d < 6; d++) {
        if (isSolid(w.getBlock(cx + DX[d]!, y, cz + DZ[d]!))) { walls++; wallDir = d; }
      }
      if (walls !== 1) continue;
      const facing = (wallDir ^ 1) as Direction;
      w.setBlock(cx, y, cz, setValue(B('chest'), P.facing, facing));
      w.setBlockEntity(cx, y, cz, 'chest', { lootTable: 'chests/simple_dungeon', lootSeed: r.nextU32() });
      break;
    }
  }
  w.setBlock(x, y, z, B('spawner'));
  w.setBlockEntity(x, y, z, 'spawner', { entity: DUNGEON_MOBS[r.nextInt(DUNGEON_MOBS.length)], delay: 20 });
  return true;
};

// ---------------------------------------------------------------------------------------------
// Fossils
// ---------------------------------------------------------------------------------------------

/** Buried bone skeleton: a spine with ribs, or a skull. Deep fossils carry diamond ore. */
export function fossil(deep: boolean): Feature {
  return (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    const cells: Array<[number, number, number, number]> = [];
    const axisX = r.nextBool();
    const boneAxis = (a: 'x' | 'y' | 'z') => setValue(B('bone_block'), P.axis, a);
    if (r.nextInt(3) === 0) {
      // skull: hollow 4×4×4 box with eye holes
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
        const shell = a === 0 || a === 3 || b === 0 || b === 3 || c === 0 || c === 3;
        const eye = c === 0 && b === 2 && (a === 1 || a === 2);
        if (shell && !eye) cells.push([a, b, c, boneAxis('y')]);
      }
    } else {
      const len = r.nextIntBetween(8, 13);
      for (let i = 0; i < len; i++) {
        cells.push([axisX ? i : 2, 0, axisX ? 2 : i, boneAxis(axisX ? 'x' : 'z')]);
        if (i % 2 === 1 && i > 1 && i < len - 1) {
          const h = r.nextIntBetween(2, 4);
          for (let s = -1; s <= 1; s += 2) {
            for (let k = 1; k <= 2; k++) cells.push([axisX ? i : 2 + s * k, 0, axisX ? 2 + s * k : i, boneAxis(axisX ? 'z' : 'x')]);
            for (let k = 1; k <= h; k++) cells.push([axisX ? i : 2 + s * 3, k, axisX ? 2 + s * 3 : i, boneAxis('y')]);
          }
        }
      }
    }
    let exposed = 0;
    for (const [a, b, c] of cells) {
      const s = w.getBlock(x + a, y + b, z + c);
      if (!isSolid(s)) exposed++;
      if (!inside(ctx, x + a, z + c)) return false;
    }
    if (exposed > 4) return false;
    const oreState = deep ? B('deepslate_diamond_ore') : B('coal_ore');
    for (const [a, b, c, st] of cells) {
      const p = r.nextFloat();
      w.setBlock(x + a, y + b, z + c, p < (deep ? 0.08 : 0.1) ? oreState : p < 0.9 ? st : w.getBlock(x + a, y + b, z + c));
    }
    return true;
  };
}

// ---------------------------------------------------------------------------------------------
// Ice
// ---------------------------------------------------------------------------------------------

export const iceSpike: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  while (isAir(w.getBlock(x, y, z)) && y > w.minY + 2) y--;
  if (w.getBlock(x, y, z) !== B('snow_block')) return false;
  const ice = B('packed_ice');
  const soft = (s: number) => isAir(s) || s === B('snow_block') || s === B('snow') || s === B('ice') || s === B('dirt');
  y += r.nextInt(4);
  const height = r.nextInt(4) + 7;
  const radius = Math.floor(height / 4) + r.nextInt(2);
  if (radius > 1 && r.nextInt(60) === 0) y += 10 + r.nextInt(30);
  for (let dy = 0; dy < height; dy++) {
    const f = (1 - dy / height) * radius;
    const fr = Math.ceil(f);
    for (let dx = -fr; dx <= fr; dx++) {
      const fdx = Math.abs(dx) - 0.25;
      for (let dz = -fr; dz <= fr; dz++) {
        const fdz = Math.abs(dz) - 0.25;
        if (!((dx === 0 && dz === 0) || fdx * fdx + fdz * fdz <= f * f)) continue;
        if ((dx === -fr || dx === fr || dz === -fr || dz === fr) && r.nextFloat() > 0.75) continue;
        if (soft(w.getBlock(x + dx, y + dy, z + dz))) w.setBlock(x + dx, y + dy, z + dz, ice);
        if (dy !== 0 && fr > 1 && soft(w.getBlock(x + dx, y - dy, z + dz))) w.setBlock(x + dx, y - dy, z + dz, ice);
      }
    }
  }
  // Root: extend the trunk down to solid ground.
  const trunk = Math.max(0, Math.min(radius - 1, 1));
  for (let dx = -trunk; dx <= trunk; dx++) for (let dz = -trunk; dz <= trunk; dz++) {
    let yy = y - 1;
    let limit = 50;
    while (yy > w.minY + 1 && limit-- > 0) {
      const s = w.getBlock(x + dx, yy, z + dz);
      if (!soft(s) && s !== ice) break;
      w.setBlock(x + dx, yy, z + dz, ice);
      yy--;
    }
  }
  return true;
};

export function iceberg(core: 'packed_ice' | 'blue_ice'): Feature {
  return (ctx, x, _y, z) => {
    const w = ctx.world, r = ctx.rng;
    const sea = ctx.climate ? ctx.climate.seaLevel : 63;
    const water = B('water');
    if (w.getBlock(x, sea - 1, z) !== water) return false;
    const snowy = r.nextDouble() > 0.7;
    const above = r.nextIntBetween(4, 11) + (r.nextInt(6) === 0 ? r.nextIntBetween(4, 10) : 0);
    const below = Math.floor(above * (1.2 + r.nextDouble()));
    const radius = r.nextIntBetween(4, 8);
    const packed = B('packed_ice'), blue = B('blue_ice'), snow = B('snow_block');
    const wob = [r.nextDouble(), r.nextDouble(), r.nextDouble()];
    for (let dy = -below; dy <= above; dy++) {
      const t = dy >= 0 ? dy / above : -dy / below;
      const rr = radius * (dy >= 0 ? Math.pow(1 - t, 1.4) : Math.pow(1 - t, 0.7)) + 0.5;
      const rc = Math.ceil(rr);
      for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
        const ang = Math.atan2(dz, dx);
        const edge = rr * (0.85 + 0.15 * Math.sin(ang * 3 + wob[0]! * 6) + 0.1 * Math.sin(ang * 5 + wob[1]! * 6));
        if (dx * dx + dz * dz > edge * edge) continue;
        const px = x + dx, py = sea - 1 + dy, pz = z + dz;
        if (!inside(ctx, px, pz) || py <= w.minY) continue;
        const cur = w.getBlock(px, py, pz);
        if (!(isAir(cur) || cur === water || cur === B('ice'))) continue;
        const interior = dx * dx + dz * dz < (edge - 2) * (edge - 2);
        let st = interior && core === 'blue_ice' && r.nextInt(3) === 0 ? blue : packed;
        if (snowy && dy === above && !interior) st = snow;
        w.setBlock(px, py, pz, st);
      }
    }
    return true;
  };
}

/** Clusters of blue ice hanging under packed ice (frozen oceans and peaks). */
export const blueIce: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const packed = B('packed_ice'), blue = B('blue_ice');
  if (y > (ctx.climate?.seaLevel ?? 63) - 1) return false;
  if (!isAir(w.getBlock(x, y, z)) && w.getBlock(x, y, z) !== B('water')) return false;
  let ok = false;
  for (let d = 0; d < 6; d++) if (w.getBlock(x + DX[d]!, y + DY[d]!, z + DZ[d]!) === packed) ok = true;
  if (!ok) return false;
  w.setBlock(x, y, z, blue);
  for (let i = 0; i < 200; i++) {
    const px = x + r.nextIntBetween(-3, 3), py = y - r.nextInt(5), pz = z + r.nextIntBetween(-3, 3);
    const s = w.getBlock(px, py, pz);
    if (!isAir(s) && s !== B('water') && s !== packed && s !== B('ice')) continue;
    for (let d = 0; d < 6; d++) {
      if (w.getBlock(px + DX[d]!, py + DY[d]!, pz + DZ[d]!) === blue) {
        w.setBlock(px, py, pz, blue);
        break;
      }
    }
  }
  return true;
};

// ---------------------------------------------------------------------------------------------
// Surface structures
// ---------------------------------------------------------------------------------------------

export const desertWell: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  while (isAir(w.getBlock(x, y, z)) && y > w.minY + 2) y--;
  const sand = B('sand');
  if (w.getBlock(x, y, z) !== sand) return false;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (isAir(w.getBlock(x + dx, y - 1, z + dz)) && isAir(w.getBlock(x + dx, y - 2, z + dz))) return false;
  }
  const sandstone = B('sandstone'), slab = B('sandstone_slab'), water = B('water');
  for (let dy = -1; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) w.setBlock(x + dx, y + dy, z + dz, sandstone);
  w.setBlock(x, y, z, water);
  for (let d = 2; d < 6; d++) w.setBlock(x + DX[d]!, y, z + DZ[d]!, water);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (dx === -2 || dx === 2 || dz === -2 || dz === 2) w.setBlock(x + dx, y + 1, z + dz, sandstone);
  }
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) w.setBlock(x + dx!, y + 1, z + dz!, slab);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(x + dx, y + 4, z + dz, dx === 0 && dz === 0 ? sandstone : slab);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    w.setBlock(x + dx!, y + 1, z + dz!, sandstone);
    w.setBlock(x + dx!, y + 2, z + dz!, sandstone);
    w.setBlock(x + dx!, y + 3, z + dz!, sandstone);
  }
  // Buried treasure for archaeology
  const sx = x + r.nextIntBetween(-1, 1), sz = z + r.nextIntBetween(-1, 1);
  w.setBlock(sx, y - 2, sz, B('suspicious_sand'));
  w.setBlockEntity(sx, y - 2, sz, 'brushable', { lootTable: 'archaeology/desert_well', lootSeed: r.nextU32() });
  return true;
};

/** Mossy cobblestone boulder (old growth taiga). */
export const forestRock: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  while (y > w.minY + 3) {
    const s = w.getBlock(x, y - 1, z);
    if (!isAir(s) && (hasTag(s, 'dirt') || hasTag(s, 'base_stone_overworld'))) break;
    y--;
  }
  if (y <= w.minY + 3) return false;
  const mossy = B('mossy_cobblestone');
  for (let i = 0; i < 3; i++) {
    const a = r.nextInt(2), b = r.nextInt(2), c = r.nextInt(2);
    const radius = (a + b + c) * 0.333 + 0.5;
    const rc = Math.ceil(radius);
    for (let dx = -rc; dx <= rc; dx++) for (let dy = -rc; dy <= rc; dy++) for (let dz = -rc; dz <= rc; dz++) {
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      if (inside(ctx, x + dx, z + dz)) w.setBlock(x + dx, y + dy, z + dz, mossy);
    }
    x += r.nextIntBetween(-1, 1);
    y -= r.nextInt(2);
    z += r.nextIntBetween(-1, 1);
  }
  return true;
};
