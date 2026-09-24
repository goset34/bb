/**
 * Ground vegetation and water plants: grass, ferns, flowers (noise-selected per biome), tall
 * plants, cacti, sugar cane, bamboo, berries, pumpkins and melons, lily pads, seagrass, kelp,
 * sea pickles, coral reefs, petals, leaf litter, bushes and dry grass.
 */
import { P } from '../../block/properties';
import { hasTag, setValue, stateFlags, F, isFaceSturdy } from '../../block/registry';
import { Direction } from '../../world/direction';
import { OctaveNoise } from '../../math/noise';
import { seededRandom } from '../overworld/climate';
import { B } from './blocks';
import { Feature, FeatureContext, isAir, isWaterBlock } from './api';

const H4: Array<[number, number, Direction]> = [[0, -1, 2], [0, 1, 3], [-1, 0, 4], [1, 0, 5]];

function inside(ctx: FeatureContext, x: number, z: number): boolean {
  return !ctx.world.isInside || ctx.world.isInside(x, z);
}

// ---------------------------------------------------------------------------------------------
// Survival predicates
// ---------------------------------------------------------------------------------------------

export function isGrassSoil(s: number): boolean {
  return hasTag(s, 'dirt') || s === B('farmland');
}

function isSandSoil(s: number): boolean {
  return hasTag(s, 'sand') || hasTag(s, 'terracotta') || hasTag(s, 'dirt');
}

type Soil = (below: number) => boolean;

/** Place `state` (a 1-block plant) at (x,y,z) when the spot is air and the soil fits. */
function plantAt(ctx: FeatureContext, x: number, y: number, z: number, state: number, soil: Soil): boolean {
  const w = ctx.world;
  if (!inside(ctx, x, z)) return false;
  if (!isAir(w.getBlock(x, y, z))) return false;
  if (!soil(w.getBlock(x, y - 1, z))) return false;
  w.setBlock(x, y, z, state);
  return true;
}

function tallAt(ctx: FeatureContext, x: number, y: number, z: number, name: string, soil: Soil): boolean {
  const w = ctx.world;
  if (!inside(ctx, x, z)) return false;
  if (!isAir(w.getBlock(x, y, z)) || !isAir(w.getBlock(x, y + 1, z))) return false;
  if (!soil(w.getBlock(x, y - 1, z))) return false;
  w.setBlock(x, y, z, B(`${name}[half=lower]`));
  w.setBlock(x, y + 1, z, B(`${name}[half=upper]`));
  return true;
}

/**
 * Random patch: `tries` attempts spread ±xz horizontally and ±ySpread vertically around the
 * origin, each calling `place`.
 */
export function patch(tries: number, xz: number, ySpread: number, place: (ctx: FeatureContext, x: number, y: number, z: number) => boolean): Feature {
  return (ctx, x, y, z) => {
    const r = ctx.rng;
    let n = 0;
    for (let i = 0; i < tries; i++) {
      const px = x + r.nextInt(xz + 1) - r.nextInt(xz + 1);
      const py = y + r.nextInt(ySpread + 1) - r.nextInt(ySpread + 1);
      const pz = z + r.nextInt(xz + 1) - r.nextInt(xz + 1);
      if (place(ctx, px, py, pz)) n++;
    }
    return n > 0;
  };
}

// ---------------------------------------------------------------------------------------------
// Simple plants
// ---------------------------------------------------------------------------------------------

export function simplePlant(name: string, soil: Soil = isGrassSoil): (ctx: FeatureContext, x: number, y: number, z: number) => boolean {
  return (ctx, x, y, z) => plantAt(ctx, x, y, z, B(name), soil);
}

export function tallPlant(name: string, soil: Soil = isGrassSoil): (ctx: FeatureContext, x: number, y: number, z: number) => boolean {
  return (ctx, x, y, z) => tallAt(ctx, x, y, z, name, soil);
}

/** Weighted choice between placers. */
export function weighted(options: Array<[(ctx: FeatureContext, x: number, y: number, z: number) => boolean, number]>): (ctx: FeatureContext, x: number, y: number, z: number) => boolean {
  let total = 0;
  for (const [, w] of options) total += w;
  return (ctx, x, y, z) => {
    let t = ctx.rng.nextFloat() * total;
    for (const [f, w] of options) {
      t -= w;
      if (t < 0) return f(ctx, x, y, z);
    }
    return options[options.length - 1]![0](ctx, x, y, z);
  };
}

export const grassPatch = (tries: number) => patch(tries, 7, 3, weighted([[simplePlant('short_grass'), 4], [simplePlant('fern'), 0]]));
export const grassFernPatch = (tries: number) => patch(tries, 7, 3, weighted([[simplePlant('short_grass'), 1], [simplePlant('fern'), 4]]));
export const tallGrassPatch = (tries: number) => patch(tries, 7, 3, tallPlant('tall_grass'));
export const largeFernPatch = (tries: number) => patch(tries, 7, 3, tallPlant('large_fern'));
export const deadBushPatch = (tries: number) => patch(tries, 7, 3, simplePlant('dead_bush', isSandSoil));
export const dryGrassPatch = (tries: number) => patch(tries, 7, 3, weighted([[simplePlant('short_dry_grass', isSandSoil), 3], [tallPlant('tall_dry_grass', isSandSoil), 1]]));
export const bushPatch = (tries: number) => patch(tries, 5, 3, simplePlant('bush'));
export const berryPatch = patch(96, 7, 3, (ctx, x, y, z) => plantAt(ctx, x, y, z, B('sweet_berry_bush[age=3]'), (s) => s === B('grass_block') || s === B('podzol')));
export const pumpkinPatch = patch(96, 7, 3, simplePlant('pumpkin', (s) => s === B('grass_block')));
export const melonPatch = patch(64, 7, 3, simplePlant('melon', (s) => s === B('grass_block')));
export const brownMushroomPatch = patch(64, 7, 3, simplePlant('brown_mushroom', (s) => isFaceSturdy(s, 1)));
export const redMushroomPatch = patch(64, 7, 3, simplePlant('red_mushroom', (s) => isFaceSturdy(s, 1)));

/** Firefly bushes near water in swamps. */
export const fireflyBushPatch = patch(20, 4, 3, (ctx, x, y, z) => {
  const w = ctx.world;
  let water = false;
  for (const [ax, az] of H4) if (isWaterBlock(w.getBlock(x + ax, y - 1, z + az))) water = true;
  return water && plantAt(ctx, x, y, z, B('firefly_bush'), isGrassSoil);
});

// ---------------------------------------------------------------------------------------------
// Flowers
// ---------------------------------------------------------------------------------------------

const flowerNoises = new Map<string, OctaveNoise>();
function flowerSelector(ctx: FeatureContext, x: number, z: number): number {
  let n = flowerNoises.get(ctx.seed.text);
  if (!n) {
    n = new OctaveNoise(seededRandom(ctx.seed, 'features/flowers'), -5, [1]);
    flowerNoises.set(ctx.seed.text, n);
  }
  return n.sample(x, 0, z);
}

export function flowerPatch(tries: number, pick: (ctx: FeatureContext, x: number, z: number) => string): Feature {
  return patch(tries, 7, 3, (ctx, x, y, z) => {
    const name = pick(ctx, x, z);
    return name.startsWith('tall:') ? tallAt(ctx, x, y, z, name.slice(5), isGrassSoil) : plantAt(ctx, x, y, z, B(name), isGrassSoil);
  });
}

export const FLOWERS = {
  default: (ctx: FeatureContext) => (ctx.rng.nextInt(3) === 0 ? 'poppy' : 'dandelion'),
  plains: (ctx: FeatureContext, x: number, z: number) => {
    const n = flowerSelector(ctx, x, z);
    if (n < -0.8) return ['orange_tulip', 'red_tulip', 'pink_tulip', 'white_tulip'][ctx.rng.nextInt(4)]!;
    if (n < -0.3) return ['azure_bluet', 'oxeye_daisy', 'cornflower'][ctx.rng.nextInt(3)]!;
    return ctx.rng.nextInt(3) === 0 ? 'poppy' : 'dandelion';
  },
  forest: (ctx: FeatureContext) => ['dandelion', 'poppy', 'lily_of_the_valley', 'tall:lilac', 'tall:rose_bush', 'tall:peony'][ctx.rng.nextInt(6)]!,
  flowerForest: (ctx: FeatureContext, x: number, z: number) => {
    const all = ['dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'];
    const n = flowerSelector(ctx, x, z);
    return all[Math.max(0, Math.min(all.length - 1, Math.floor(((n + 1) / 2) * all.length)))]!;
  },
  swamp: () => 'blue_orchid',
  meadow: (ctx: FeatureContext) => ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'tall:tall_grass'][ctx.rng.nextInt(7)]!,
  sunflower: () => 'tall:sunflower',
  paleGarden: () => 'closed_gazebloom',
};

/** Petal-type ground cover (pink petals, wildflowers, leaf litter). */
export function petalsPatch(name: string, tries: number, amountProp: 'flower' | 'segment' = 'flower'): Feature {
  return patch(tries, 6, 2, (ctx, x, y, z) => {
    let st = setValue(B(name), P.facing, H4[ctx.rng.nextInt(4)]![2]);
    st = amountProp === 'flower' ? setValue(st, P.flowerAmount, ctx.rng.nextIntBetween(1, 4)) : setValue(st, P.segmentAmount, ctx.rng.nextIntBetween(1, 4));
    return plantAt(ctx, x, y, z, st, isGrassSoil);
  });
}

// ---------------------------------------------------------------------------------------------
// Columns: cactus, sugar cane, bamboo
// ---------------------------------------------------------------------------------------------

export const cactusPatch = patch(10, 7, 3, (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!inside(ctx, x, z) || !isAir(w.getBlock(x, y, z))) return false;
  const below = w.getBlock(x, y - 1, z);
  if (!hasTag(below, 'sand')) return false;
  const h = 1 + r.nextInt(r.nextInt(3) + 1);
  const cactus = B('cactus');
  let placed = 0;
  for (let i = 0; i < h; i++) {
    const py = y + i;
    if (!isAir(w.getBlock(x, py, z))) break;
    let blocked = false;
    for (const [ax, az] of H4) if (!isAir(w.getBlock(x + ax, py, z + az))) blocked = true;
    if (blocked) break;
    w.setBlock(x, py, z, cactus);
    placed++;
  }
  if (placed > 0 && r.nextInt(8) === 0 && isAir(w.getBlock(x, y + placed, z))) w.setBlock(x, y + placed, z, B('cactus_flower'));
  return placed > 0;
});

export const sugarCanePatch = patch(20, 4, 0, (ctx, x, y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!inside(ctx, x, z) || !isAir(w.getBlock(x, y, z))) return false;
  const below = w.getBlock(x, y - 1, z);
  if (!(isGrassSoil(below) || hasTag(below, 'sand'))) return false;
  let water = false;
  for (const [ax, az] of H4) {
    const s = w.getBlock(x + ax, y - 1, z + az);
    if ((stateFlags[s]! & F.WATER) || s === B('frosted_ice')) water = true;
  }
  if (!water) return false;
  const h = 2 + r.nextInt(r.nextInt(3) + 1);
  const cane = B('sugar_cane');
  for (let i = 0; i < h && isAir(w.getBlock(x, y + i, z)); i++) w.setBlock(x, y + i, z, cane);
  return true;
});

export function bambooPatch(tries: number, podzol: boolean): Feature {
  return patch(tries, 5, 2, (ctx, x, y, z) => {
    const w = ctx.world, r = ctx.rng;
    if (!inside(ctx, x, z) || !isAir(w.getBlock(x, y, z))) return false;
    const below = w.getBlock(x, y - 1, z);
    if (!(isGrassSoil(below) || hasTag(below, 'sand') || below === B('gravel'))) return false;
    if (podzol && r.nextInt(3) === 0) {
      const rad = r.nextIntBetween(1, 3);
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz > rad * rad) continue;
        for (let dy = -2; dy <= 1; dy++) {
          const s = w.getBlock(x + dx, y - 1 + dy, z + dz);
          if (s === B('grass_block') || s === B('dirt')) { w.setBlock(x + dx, y - 1 + dy, z + dz, B('podzol')); break; }
        }
      }
    }
    const h = r.nextIntBetween(5, 16);
    let top = 0;
    for (let i = 0; i < h && isAir(w.getBlock(x, y + i, z)); i++) {
      w.setBlock(x, y + i, z, B('bamboo[age=1,leaves=none,stage=0]'));
      top = i;
    }
    if (top >= 2) {
      w.setBlock(x, y + top, z, B('bamboo[age=1,leaves=large,stage=0]'));
      w.setBlock(x, y + top - 1, z, B('bamboo[age=1,leaves=large,stage=0]'));
      w.setBlock(x, y + top - 2, z, B('bamboo[age=1,leaves=small,stage=0]'));
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Water plants
// ---------------------------------------------------------------------------------------------

export const lilyPadPatch = patch(10, 7, 3, (ctx, x, y, z) => {
  const w = ctx.world;
  if (!inside(ctx, x, z) || !isAir(w.getBlock(x, y, z))) return false;
  if (!isWaterBlock(w.getBlock(x, y - 1, z))) return false;
  w.setBlock(x, y, z, B('lily_pad'));
  return true;
});

/** Seagrass on the sea floor; `tallChance` makes some two blocks high. */
export function seagrass(tallChance: number): Feature {
  return patch(32, 7, 0, (ctx, x, _y, z) => {
    const w = ctx.world;
    if (!inside(ctx, x, z)) return false;
    const y = w.getHeight('ocean_floor', x, z);
    const water = B('water');
    if (w.getBlock(x, y, z) !== water) return false;
    const below = w.getBlock(x, y - 1, z);
    if (!isFaceSturdy(below, 1) || hasTag(below, 'ice')) return false;
    if (ctx.rng.nextFloat() < tallChance && w.getBlock(x, y + 1, z) === water) {
      w.setBlock(x, y, z, B('tall_seagrass[half=lower]'));
      w.setBlock(x, y + 1, z, B('tall_seagrass[half=upper]'));
    } else w.setBlock(x, y, z, B('seagrass'));
    return true;
  });
}

export const kelpFeature: Feature = (ctx, x, _y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!inside(ctx, x, z)) return false;
  const y = w.getHeight('ocean_floor', x, z);
  const water = B('water');
  if (w.getBlock(x, y, z) !== water || !isFaceSturdy(w.getBlock(x, y - 1, z), 1)) return false;
  const h = 1 + r.nextInt(10);
  let top = -1;
  for (let i = 0; i <= h; i++) {
    const py = y + i;
    if (w.getBlock(x, py, z) !== water || w.getBlock(x, py + 1, z) !== water) break;
    top = py;
  }
  if (top < 0) return false;
  for (let py = y; py < top; py++) w.setBlock(x, py, z, B('kelp_plant'));
  w.setBlock(x, top, z, setValue(B('kelp'), P.age25, r.nextIntBetween(20, 25)));
  return true;
};

export const seaPickle: Feature = (ctx, x, _y, z) => {
  const w = ctx.world, r = ctx.rng;
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const px = x + r.nextInt(8) - r.nextInt(8), pz = z + r.nextInt(8) - r.nextInt(8);
    if (!inside(ctx, px, pz)) continue;
    const py = w.getHeight('ocean_floor', px, pz);
    if (w.getBlock(px, py, pz) !== B('water') || !isFaceSturdy(w.getBlock(px, py - 1, pz), 1)) continue;
    w.setBlock(px, py, pz, setValue(B('sea_pickle[waterlogged=true]'), P.pickles, r.nextIntBetween(1, 4)));
    n++;
  }
  return n > 0;
};

const CORALS = ['tube', 'brain', 'bubble', 'fire', 'horn'];

/** One coral block with plants on top and fans on the sides. */
function coralBlock(ctx: FeatureContext, x: number, y: number, z: number, color: string): boolean {
  const w = ctx.world, r = ctx.rng;
  const water = B('water');
  const cur = w.getBlock(x, y, z);
  if (cur !== water && !hasTag(cur, 'coral_blocks')) return false;
  if (w.getBlock(x, y + 1, z) !== water && !hasTag(w.getBlock(x, y + 1, z), 'coral_blocks')) return false;
  w.setBlock(x, y, z, B(`${color}_coral_block`));
  if (w.getBlock(x, y + 1, z) === water && r.nextFloat() < 0.25) {
    const top = r.nextBool() ? `${CORALS[r.nextInt(5)]}_coral` : `${CORALS[r.nextInt(5)]}_coral_fan`;
    w.setBlock(x, y + 1, z, B(`${top}[waterlogged=true]`));
  } else if (w.getBlock(x, y + 1, z) === water && r.nextFloat() < 0.05) {
    w.setBlock(x, y + 1, z, setValue(B('sea_pickle[waterlogged=true]'), P.pickles, r.nextIntBetween(1, 4)));
  }
  for (const [ax, az, dir] of H4) {
    if (r.nextFloat() < 0.2 && w.getBlock(x + ax, y, z + az) === water) {
      w.setBlock(x + ax, y, z + az, setValue(B(`${CORALS[r.nextInt(5)]}_coral_wall_fan[waterlogged=true]`), P.facing, dir));
    }
  }
  return true;
}

/** Coral reefs: tree, claw and mushroom shapes. */
export const coralReef: Feature = (ctx, x, _y, z) => {
  const w = ctx.world, r = ctx.rng;
  if (!inside(ctx, x, z)) return false;
  const y = w.getHeight('ocean_floor', x, z);
  if (w.getBlock(x, y, z) !== B('water')) return false;
  const color = CORALS[r.nextInt(5)]!;
  const kind = r.nextInt(3);
  if (kind === 0) {
    // tree: trunk then branches
    const h = r.nextIntBetween(1, 3);
    let py = y;
    for (let i = 0; i < h; i++, py++) if (!coralBlock(ctx, x, py, z, color)) return i > 0;
    const branches = r.nextIntBetween(2, 4);
    for (let b = 0; b < branches; b++) {
      const [ax, az] = H4[r.nextInt(4)]!;
      let bx = x + ax, bz = z + az, by = py;
      const len = r.nextIntBetween(2, 5);
      for (let i = 0; i < len; i++) {
        if (!coralBlock(ctx, bx, by, bz, color)) break;
        by++;
        if (i === 0 || r.nextFloat() < 0.25) { bx += ax; bz += az; }
      }
    }
  } else if (kind === 1) {
    // claw: spreading arms
    coralBlock(ctx, x, y, z, color);
    for (let a = 0; a < r.nextIntBetween(2, 3); a++) {
      const [ax, az] = H4[r.nextInt(4)]!;
      let bx = x, by = y, bz = z;
      const len = r.nextIntBetween(2, 4);
      for (let i = 0; i < len; i++) {
        bx += ax; bz += az;
        if (i > 0) by++;
        coralBlock(ctx, bx, by, bz, color);
      }
    }
  } else {
    // mushroom: hollow box
    const hx = r.nextIntBetween(3, 4), hy = r.nextIntBetween(3, 4), hz = r.nextIntBetween(3, 4);
    const lift = r.nextInt(3);
    for (let dx = 0; dx < hx; dx++) for (let dy = 0; dy < hy; dy++) for (let dz = 0; dz < hz; dz++) {
      const edges = (dx === 0 || dx === hx - 1 ? 1 : 0) + (dy === 0 || dy === hy - 1 ? 1 : 0) + (dz === 0 || dz === hz - 1 ? 1 : 0);
      if (edges >= 2 && r.nextFloat() < 0.9) coralBlock(ctx, x + dx - 1, y + dy + lift - 1, z + dz - 1, color);
    }
  }
  return true;
};

// ---------------------------------------------------------------------------------------------
// Pale garden ground cover
// ---------------------------------------------------------------------------------------------

export const paleMossPatch = patch(48, 5, 2, (ctx, x, y, z) => {
  const w = ctx.world;
  if (!inside(ctx, x, z)) return false;
  const below = w.getBlock(x, y - 1, z);
  if (!(below === B('grass_block') || below === B('dirt'))) return false;
  w.setBlock(x, y - 1, z, B('pale_moss_block'));
  if (isAir(w.getBlock(x, y, z)) && ctx.rng.nextFloat() < 0.4) w.setBlock(x, y, z, B('pale_moss_carpet[bottom=true]'));
  return true;
});
