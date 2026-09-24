/**
 * Cave decoration: glow lichen, lush caves (moss, azalea, cave vines, spore blossoms,
 * dripleaf in clay pools, rooted azalea trees), dripstone caves (dripstone patches, stalactites
 * and stalagmites, large columns) and deep dark echo moss with sensors and shriekers.
 */
import { P } from '../../block/properties';
import { hasTag, setValue, isFaceSturdy } from '../../block/registry';
import { Direction } from '../../world/direction';
import { B } from './blocks';
import { Feature, FeatureContext, isAir, isWaterBlock } from './api';
import { TREES } from './trees';

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const FACE_PROPS = [P.down, P.up, P.north, P.south, P.west, P.east];
const H4: Array<[number, number, Direction]> = [[0, -1, 2], [0, 1, 3], [-1, 0, 4], [1, 0, 5]];

function inside(ctx: FeatureContext, x: number, z: number): boolean {
  return !ctx.world.isInside || ctx.world.isInside(x, z);
}

function caveStone(s: number): boolean {
  return hasTag(s, 'base_stone_overworld') || s === B('dripstone_block') || s === B('moss_block') || s === B('clay');
}

function isCaveAir(s: number): boolean {
  return isAir(s);
}

/** Find floor (dir -1) or ceiling (dir 1) within `max` blocks from an air position. */
function findSurface(ctx: FeatureContext, x: number, y: number, z: number, dir: 1 | -1, max: number): number | null {
  const w = ctx.world;
  if (!isCaveAir(w.getBlock(x, y, z))) return null;
  for (let i = 0; i < max; i++) {
    const ny = y + dir * (i + 1);
    if (ny <= w.minY || ny >= w.maxY) return null;
    const s = w.getBlock(x, ny, z);
    if (!isCaveAir(s)) return caveStone(s) || isFaceSturdy(s, dir === 1 ? 0 : 1) ? y + dir * i : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Glow lichen / multiface growth
// ---------------------------------------------------------------------------------------------

export function multifaceGrowth(name: string, canAttach: (s: number) => boolean, spread = 20): Feature {
  return (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    let placed = 0;
    for (let i = 0; i < spread; i++) {
      const px = x + (i === 0 ? 0 : r.nextIntBetween(-2, 2)), py = y + (i === 0 ? 0 : r.nextIntBetween(-2, 2)), pz = z + (i === 0 ? 0 : r.nextIntBetween(-2, 2));
      if (!inside(ctx, px, pz)) continue;
      const cur = w.getBlock(px, py, pz);
      const water = isWaterBlock(cur);
      if (!isAir(cur) && !water) continue;
      let st = B(name);
      let any = false;
      for (let d = 0; d < 6; d++) {
        const s = w.getBlock(px + DX[d]!, py + DY[d]!, pz + DZ[d]!);
        if (canAttach(s) && isFaceSturdy(s, d ^ 1) && r.nextFloat() < 0.6) {
          st = setValue(st, FACE_PROPS[d]!, true);
          any = true;
        }
      }
      if (!any) continue;
      if (water) st = setValue(st, P.waterlogged, true);
      w.setBlock(px, py, pz, st);
      placed++;
    }
    return placed > 0;
  };
}

export const glowLichen = multifaceGrowth('glow_lichen', (s) => hasTag(s, 'base_stone_overworld'), 20);

// ---------------------------------------------------------------------------------------------
// Lush caves
// ---------------------------------------------------------------------------------------------

/** Vegetation patch: replace ground with `ground` in a blob and scatter plants on it. */
function vegetationPatch(ctx: FeatureContext, x: number, y: number, z: number, ceiling: boolean, radius: number, ground: number, plant: (ctx: FeatureContext, x: number, y: number, z: number) => void, plantChance: number): boolean {
  const w = ctx.world, r = ctx.rng;
  let placed = 0;
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const edge = Math.abs(dx) === radius || Math.abs(dz) === radius;
    if (edge && r.nextFloat() < 0.6) continue;
    if (dx * dx + dz * dz > radius * radius + 1) continue;
    const px = x + dx, pz = z + dz;
    if (!inside(ctx, px, pz)) continue;
    // find the matching surface near y
    let sy: number | null = null;
    for (let k = -3; k <= 3 && sy === null; k++) {
      const yy = y + k;
      const here = w.getBlock(px, yy, pz);
      const beyond = w.getBlock(px, yy + (ceiling ? 1 : -1), pz);
      if (isCaveAir(here) && caveStone(beyond)) sy = yy;
    }
    if (sy === null) continue;
    const gy = sy + (ceiling ? 1 : -1);
    const depth = r.nextIntBetween(1, 2);
    for (let k = 0; k < depth; k++) {
      const yy = gy + (ceiling ? k : -k);
      if (caveStone(w.getBlock(px, yy, pz))) w.setBlock(px, yy, pz, ground);
    }
    placed++;
    if (r.nextFloat() < plantChance) plant(ctx, px, sy, pz);
  }
  return placed > 0;
}

function lushFloorPlant(ctx: FeatureContext, x: number, y: number, z: number): void {
  const w = ctx.world, r = ctx.rng;
  if (!isCaveAir(w.getBlock(x, y, z))) return;
  const p = r.nextFloat();
  if (p < 0.08) {
    if (isCaveAir(w.getBlock(x, y + 1, z))) {
      w.setBlock(x, y, z, B('tall_grass[half=lower]'));
      w.setBlock(x, y + 1, z, B('tall_grass[half=upper]'));
    }
  } else if (p < 0.2) w.setBlock(x, y, z, B(r.nextFloat() < 0.33 ? 'flowering_azalea' : 'azalea'));
  else if (p < 0.45) w.setBlock(x, y, z, B('moss_carpet'));
  else if (p < 0.8) w.setBlock(x, y, z, B('short_grass'));
}

function caveVine(ctx: FeatureContext, x: number, y: number, z: number): void {
  const w = ctx.world, r = ctx.rng;
  const len = r.nextIntBetween(1, 4) + (r.nextFloat() < 0.33 ? r.nextIntBetween(1, 8) : 0);
  let bottom = y;
  for (let i = 0; i < len; i++) {
    if (!isCaveAir(w.getBlock(x, y - i, z))) break;
    bottom = y - i;
  }
  for (let py = y; py >= bottom; py--) {
    const berries = r.nextFloat() < 0.11;
    const st = py === bottom ? setValue(setValue(B('cave_vines'), P.berries, berries), P.age25, r.nextIntBetween(18, 25)) : setValue(B('cave_vines_plant'), P.berries, berries);
    w.setBlock(x, py, z, st);
  }
}

export const mossFloor: Feature = (ctx, x, y, z) => {
  const floor = findSurface(ctx, x, y, z, -1, 12);
  if (floor === null) return false;
  return vegetationPatch(ctx, x, floor, z, false, ctx.rng.nextIntBetween(4, 7), B('moss_block'), lushFloorPlant, 0.8);
};

export const mossCeiling: Feature = (ctx, x, y, z) => {
  const ceil = findSurface(ctx, x, y, z, 1, 12);
  if (ceil === null) return false;
  return vegetationPatch(ctx, x, ceil, z, true, ctx.rng.nextIntBetween(4, 7), B('moss_block'), (c, px, py, pz) => caveVine(c, px, py, pz), 0.08);
};

export const caveVines: Feature = (ctx, x, y, z) => {
  const ceil = findSurface(ctx, x, y, z, 1, 12);
  if (ceil === null) return false;
  caveVine(ctx, x, ceil, z);
  return true;
};

export const sporeBlossom: Feature = (ctx, x, y, z) => {
  const ceil = findSurface(ctx, x, y, z, 1, 12);
  if (ceil === null) return false;
  ctx.world.setBlock(x, ceil, z, B('spore_blossom'));
  return true;
};

/** Shallow clay pool with big and small dripleaf. */
export const clayPoolWithDripleaf: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const floor = findSurface(ctx, x, y, z, -1, 12);
  if (floor === null) return false;
  const radius = r.nextIntBetween(4, 7);
  const clay = B('clay'), water = B('water');
  let placed = 0;
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (dx * dx + dz * dz > radius * radius) continue;
    const px = x + dx, pz = z + dz;
    if (!inside(ctx, px, pz)) continue;
    const gy = floor - 1;
    if (!caveStone(w.getBlock(px, gy, pz))) continue;
    // The rim stays clay so the water of the inner cells cannot leak.
    const inner = dx * dx + dz * dz < (radius - 1) * (radius - 1);
    w.setBlock(px, gy - 1, pz, clay);
    if (inner && r.nextFloat() < 0.8) {
      w.setBlock(px, gy, pz, water);
      if (r.nextFloat() < 0.1 && isCaveAir(w.getBlock(px, floor, pz))) {
        const dir = H4[r.nextInt(4)]![2];
        const h = r.nextIntBetween(1, 4);
        let top = floor;
        for (let k = 0; k < h - 1 && isCaveAir(w.getBlock(px, floor + k + 1, pz)); k++) top = floor + k + 1;
        w.setBlock(px, gy, pz, setValue(B('big_dripleaf_stem[waterlogged=true]'), P.facing, dir));
        for (let py = floor; py < top; py++) w.setBlock(px, py, pz, setValue(B('big_dripleaf_stem'), P.facing, dir));
        w.setBlock(px, top, pz, setValue(B('big_dripleaf'), P.facing, dir));
      }
    } else {
      w.setBlock(px, gy, pz, clay);
      if (r.nextFloat() < 0.05 && isCaveAir(w.getBlock(px, floor, pz)) && isCaveAir(w.getBlock(px, floor + 1, pz))) {
        const dir = H4[r.nextInt(4)]![2];
        w.setBlock(px, floor, pz, setValue(B('small_dripleaf[half=lower]'), P.facing, dir));
        w.setBlock(px, floor + 1, pz, setValue(B('small_dripleaf[half=upper]'), P.facing, dir));
      }
    }
    placed++;
  }
  return placed > 0;
};

/** Azalea tree on the surface, with rooted dirt and hanging roots below into the cave. */
export const rootedAzaleaTree: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const ceil = findSurface(ctx, x, y, z, 1, 12);
  if (ceil === null) return false;
  // Walk up through the rock to the surface
  let sy = ceil + 1;
  let limit = 40;
  while (sy < w.maxY - 1 && limit-- > 0 && !isAir(w.getBlock(x, sy, z))) sy++;
  if (limit <= 0 || !isAir(w.getBlock(x, sy, z))) return false;
  const ground = w.getBlock(x, sy - 1, z);
  if (!hasTag(ground, 'dirt')) return false;
  for (let py = ceil + 1; py < sy; py++) {
    const s = w.getBlock(x, py, z);
    if (hasTag(s, 'base_stone_overworld') || hasTag(s, 'dirt')) w.setBlock(x, py, z, B('rooted_dirt'));
  }
  for (let i = 0; i < 20; i++) {
    const px = x + r.nextIntBetween(-3, 3), pz = z + r.nextIntBetween(-3, 3);
    if (!inside(ctx, px, pz)) continue;
    for (let py = ceil + 3; py >= ceil - 1; py--) {
      if (isCaveAir(w.getBlock(px, py, pz)) && hasTag(w.getBlock(px, py + 1, pz), 'base_stone_overworld')) {
        w.setBlock(px, py, pz, B('hanging_roots'));
        break;
      }
    }
  }
  if (!TREES.azalea()(ctx, x, sy, z)) w.setBlock(x, sy - 1, z, B('rooted_dirt'));
  return true;
};

// ---------------------------------------------------------------------------------------------
// Dripstone
// ---------------------------------------------------------------------------------------------


function dripstoneColumn(ctx: FeatureContext, x: number, y: number, z: number, dir: 1 | -1, len: number): number {
  const w = ctx.world;
  let placed = 0;
  for (let i = 0; i < len; i++) {
    const py = y + dir * i;
    const cur = w.getBlock(x, py, z);
    if (!isCaveAir(cur) && !isWaterBlock(cur)) break;
    placed++;
  }
  for (let i = 0; i < placed; i++) {
    const py = y + dir * i;
    const fromTip = placed - 1 - i;
    const t = fromTip === 0 ? 'tip' : fromTip === 1 ? 'frustum' : i === 0 && placed > 3 ? 'base' : 'middle';
    let st = B(`pointed_dripstone[vertical_direction=${dir === 1 ? 'up' : 'down'},thickness=${t}]`);
    if (isWaterBlock(w.getBlock(x, py, z))) st = setValue(st, P.waterlogged, true);
    w.setBlock(x, py, z, st);
  }
  return placed;
}

/** Patch of dripstone blocks on floor/ceiling with stalactites and stalagmites. */
export const dripstoneCluster: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!isCaveAir(w.getBlock(x, y, z))) return false;
  const radius = r.nextIntBetween(2, 8);
  const drip = B('dripstone_block');
  let placed = 0;
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (dx * dx + dz * dz > radius * radius) continue;
    const px = x + dx, pz = z + dz;
    if (!inside(ctx, px, pz)) continue;
    const floor = findSurface(ctx, px, y, pz, -1, 16);
    const ceil = findSurface(ctx, px, y, pz, 1, 16);
    if (floor === null || ceil === null) continue;
    const gap = ceil - floor + 1;
    if (caveStone(w.getBlock(px, floor - 1, pz))) w.setBlock(px, floor - 1, pz, drip);
    if (caveStone(w.getBlock(px, ceil + 1, pz))) w.setBlock(px, ceil + 1, pz, drip);
    const centre = 1 - Math.sqrt(dx * dx + dz * dz) / (radius + 1);
    if (r.nextFloat() < 0.35 * centre + 0.1 && gap > 2) {
      const up = r.nextIntBetween(1, Math.max(1, Math.floor(gap * 0.45 * centre + 1)));
      const down = r.nextIntBetween(1, Math.max(1, Math.floor(gap * 0.45 * centre + 1)));
      if (up + down >= gap - 1 && gap < 10) {
        // join into a column
        dripstoneColumn(ctx, px, floor, pz, 1, Math.ceil(gap / 2));
        dripstoneColumn(ctx, px, ceil, pz, -1, Math.floor(gap / 2));
      } else {
        dripstoneColumn(ctx, px, floor, pz, 1, Math.min(up, gap - 2));
        dripstoneColumn(ctx, px, ceil, pz, -1, Math.min(down, gap - 2 - Math.min(up, gap - 2)));
      }
    }
    placed++;
  }
  return placed > 0;
};

/** Single pointed dripstone (common in all caves). */
export const pointedDripstone: Feature = (ctx, x, y, z) => {
  const r = ctx.rng;
  const up = r.nextBool();
  const s = findSurface(ctx, x, y, z, up ? 1 : -1, 6);
  if (s === null) return false;
  const w = ctx.world;
  const base = up ? s + 1 : s - 1;
  if (caveStone(w.getBlock(x, base, z)) && r.nextBool()) w.setBlock(x, base, z, B('dripstone_block'));
  return dripstoneColumn(ctx, x, s, z, up ? -1 : 1, r.nextIntBetween(1, 3)) > 0;
};

/** Large dripstone: thick tapering cone of dripstone blocks from ceiling or floor. */
export const largeDripstone: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!isCaveAir(w.getBlock(x, y, z))) return false;
  const floor = findSurface(ctx, x, y, z, -1, 30), ceil = findSurface(ctx, x, y, z, 1, 30);
  if (floor === null || ceil === null) return false;
  const gap = ceil - floor;
  if (gap < 6) return false;
  const radius = r.nextIntBetween(2, Math.min(6, Math.floor(gap / 3)));
  const drip = B('dripstone_block');
  for (const [from, dir] of [[ceil, -1], [floor, 1]] as const) {
    const h = Math.floor(gap * r.nextDouble() * 0.5) + 2;
    for (let k = 0; k < h; k++) {
      const rr = radius * (1 - k / h);
      if (rr < 0.4) break;
      const rc = Math.ceil(rr);
      for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
        if (dx * dx + dz * dz > rr * rr) continue;
        const px = x + dx, py = from + dir * k, pz = z + dz;
        if (!inside(ctx, px, pz)) continue;
        if (isCaveAir(w.getBlock(px, py, pz)) || caveStone(w.getBlock(px, py, pz))) w.setBlock(px, py, pz, drip);
      }
    }
  }
  return true;
};

// ---------------------------------------------------------------------------------------------
// Deep dark
// ---------------------------------------------------------------------------------------------

/** Echo moss patch spreading over cave surfaces, with veins, sensors and shriekers. */
export const echoPatch: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  const floor = findSurface(ctx, x, y, z, -1, 10);
  if (floor === null) return false;
  const moss = B('echo_moss'), vein = B('echo_vein');
  const radius = r.nextIntBetween(3, 7);
  const surfaces: Array<[number, number, number]> = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -3; dy <= 3; dy++) {
    const d2 = dx * dx + dz * dz + dy * dy * 2;
    if (d2 > radius * radius) continue;
    const px = x + dx, py = floor - 1 + dy, pz = z + dz;
    if (!inside(ctx, px, pz)) continue;
    const s = w.getBlock(px, py, pz);
    if (!caveStone(s) && !hasTag(s, 'dirt')) continue;
    let exposed = false;
    for (let d = 0; d < 6; d++) if (isCaveAir(w.getBlock(px + DX[d]!, py + DY[d]!, pz + DZ[d]!))) exposed = true;
    if (!exposed) continue;
    if (d2 > (radius - 1) * (radius - 1) && r.nextFloat() < 0.5) continue;
    w.setBlock(px, py, pz, moss);
    surfaces.push([px, py, pz]);
  }
  // veins on the rim
  for (const [px, py, pz] of surfaces) {
    for (let d = 0; d < 6; d++) {
      const nx = px + DX[d]!, ny = py + DY[d]!, nz = pz + DZ[d]!;
      const s = w.getBlock(nx, ny, nz);
      if (!isCaveAir(s) || r.nextFloat() > 0.15) continue;
      w.setBlock(nx, ny, nz, setValue(vein, FACE_PROPS[d ^ 1]!, true));
    }
  }
  // features on top of floor moss
  for (const [px, py, pz] of surfaces) {
    if (!isCaveAir(w.getBlock(px, py + 1, pz)) && w.getBlock(px, py + 1, pz) !== vein) continue;
    const p = r.nextFloat();
    if (p < 0.03) w.setBlock(px, py + 1, pz, B('echo_sensor'));
    else if (p < 0.035) w.setBlock(px, py + 1, pz, B('echo_shrieker[can_summon=true]'));
    else if (p < 0.037) w.setBlock(px, py, pz, B('echo_catalyst'));
  }
  return surfaces.length > 0;
};

export const echoVeins = multifaceGrowth('echo_vein', (s) => caveStone(s), 30);

/** Magma blocks under deep water. */
export const underwaterMagma: Feature = (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  let n = 0;
  for (let i = 0; i < 44; i++) {
    const px = x + r.nextIntBetween(-8, 8), py = y + r.nextIntBetween(-8, 8), pz = z + r.nextIntBetween(-8, 8);
    if (!inside(ctx, px, pz)) continue;
    const s = w.getBlock(px, py, pz);
    if (!hasTag(s, 'base_stone_overworld') && s !== B('gravel') && s !== B('sand')) continue;
    if (!isWaterBlock(w.getBlock(px, py + 1, pz))) continue;
    w.setBlock(px, py, pz, B('magma_block'));
    n++;
  }
  return n > 0;
};
