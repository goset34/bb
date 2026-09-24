/**
 * Growth and farming behaviours driven by random ticks and bone meal: crops, stems, saplings,
 * grass and mycelium spread, leaf decay, farmland moisture, sugar cane, cactus, bamboo, vines,
 * cocoa, berries, kelp, cave vines, mushrooms, snow and ice melting, budding amethyst and
 * dripstone growth. Also block contact damage (cactus, berry bush, magma, campfire, fire).
 */
import { BlockBehavior } from '../behavior';
import {
  Block, blockOf, blockHasTag, hasTag, isFaceSturdy, stateFlags, F, tryGetValue, getValue, setValue, isBlock, BLOCK_BY_NAME, S,
} from '../registry';
import { P, Property } from '../properties';
import type { LevelAccess, PlaceContext } from '../../world/level';
import { Direction, DOWN, UP, DX, DY, DZ, HORIZONTALS } from '../../world/direction';
import type { Random } from '../../math/random';
import type { Entity } from '../../entity/ecs';
import { PlantBehavior, HangingPlantBehavior, CocoaBehavior, VineBehavior, SUPPORT, SupportRule } from './plants';
import { SnowyDirtBehavior } from './placement';
import { registerBehaviorResolver } from './index';
import { saplingTree, TREES } from '../../worldgen/features/trees';
import type { FeatureContext, WorldAccess } from '../../worldgen/features/api';

const name = (s: number) => blockOf(s).name;
const light = (level: LevelAccess, x: number, y: number, z: number) => level.getMaxLocalRawBrightness(x, y, z);

function featureCtx(world: WorldAccess, rng: Random, x: number, z: number): FeatureContext {
  return { world, rng, seed: { text: 'runtime', lo: 0, hi: 0 }, climate: null, cx: x >> 4, cz: z >> 4 };
}

// ---------------------------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------------------------

/** Growth speed from surrounding farmland (reference getGrowthSpeed). */
export function cropGrowthSpeed(block: Block, level: LevelAccess, x: number, y: number, z: number): number {
  let f = 1;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const s = level.getBlockState(x + dx, y - 1, z + dz);
      let g = 0;
      if (name(s) === 'farmland') {
        g = 1;
        if ((tryGetValue(s, P.moisture) ?? 0) > 0) g = 3;
      }
      if (dx !== 0 || dz !== 0) g /= 4;
      f += g;
    }
  }
  const same = (dx: number, dz: number) => isBlock(level.getBlockState(x + dx, y, z + dz), block);
  const rowsX = same(-1, 0) || same(1, 0), rowsZ = same(0, -1) || same(0, 1);
  const diag = same(-1, -1) || same(1, -1) || same(1, 1) || same(-1, 1);
  if (diag || (rowsX && rowsZ)) f /= 2;
  return f;
}

export class CropBehavior extends PlantBehavior {
  constructor(rule: SupportRule, readonly ageProp: typeof P.age7 | typeof P.age3 | typeof P.age1 | typeof P.age4, readonly maxAge: number, readonly bonus: [number, number] = [2, 5]) {
    super(rule);
  }
  age(state: number): number {
    return getValue(state, this.ageProp);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (light(level, x, y + 1, z) < 9) return;
    const age = this.age(state);
    if (age >= this.maxAge) return;
    const f = cropGrowthSpeed(blockOf(state), level, x, y, z);
    const divisor = this.maxAge === 3 ? 2 : 1; // beetroots grow slower but in fewer stages
    if (rng.nextInt(Math.floor(25 / f / divisor) + 1) === 0) level.setBlock(x, y, z, setValue(state, this.ageProp, age + 1), 2);
  }
  override isBonemealTarget(state: number): boolean {
    return this.age(state) < this.maxAge;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const add = this.maxAge === 3 ? 1 : rng.nextIntBetween(this.bonus[0], this.bonus[1]);
    level.setBlock(x, y, z, setValue(state, this.ageProp, Math.min(this.maxAge, this.age(state) + add)), 2);
  }
}

/** Melon and pumpkin stems: grow, then place the fruit beside them. */
export class StemBehavior extends PlantBehavior {
  constructor(readonly fruit: string, readonly attached: string) {
    super(SUPPORT.crop!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (light(level, x, y + 1, z) < 9) return;
    const f = cropGrowthSpeed(blockOf(state), level, x, y, z);
    if (rng.nextInt(Math.floor(25 / f) + 1) !== 0) return;
    const age = getValue(state, P.age7);
    if (age < 7) {
      level.setBlock(x, y, z, setValue(state, P.age7, age + 1), 2);
      return;
    }
    const dir = HORIZONTALS[rng.nextInt(4)]!;
    const fx = x + DX[dir]!, fz = z + DZ[dir]!;
    const below = level.getBlockState(fx, y - 1, fz);
    if (!(stateFlags[level.getBlockState(fx, y, fz)]! & F.AIR)) return;
    if (!(name(below) === 'farmland' || hasTag(below, 'dirt'))) return;
    level.setBlock(fx, y, fz, S(this.fruit), 3);
    level.setBlock(x, y, z, setValue(S(this.attached), P.facing, dir), 3);
  }
  override isBonemealTarget(state: number): boolean {
    return getValue(state, P.age7) < 7;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    level.setBlock(x, y, z, setValue(state, P.age7, Math.min(7, getValue(state, P.age7) + rng.nextIntBetween(2, 5))), 2);
  }
}

/** Attached stems revert when their fruit is removed. */
export class AttachedStemBehavior extends PlantBehavior {
  constructor(readonly fruit: string, readonly stem: string) {
    super(SUPPORT.crop!);
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === getValue(state, P.facing) && name(n) !== this.fruit) return setValue(S(this.stem), P.age7, 7);
    return super.updateShape(state, dir, n, level, x, y, z);
  }
}

// ---------------------------------------------------------------------------------------------
// Saplings and mushrooms
// ---------------------------------------------------------------------------------------------

export class SaplingBehavior extends PlantBehavior {
  constructor() {
    super(SUPPORT.bush!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (light(level, x, y + 1, z) >= 9 && rng.nextInt(7) === 0) this.advance(state, level, x, y, z, rng);
  }
  override isBonemealTarget(): boolean {
    return true;
  }
  override bonemealChance(): number {
    return 0.45;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    this.advance(state, level, x, y, z, rng);
  }
  private advance(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (tryGetValue(state, P.stage) === 0) {
      level.setBlock(x, y, z, setValue(state, P.stage, 1), 4);
      return;
    }
    growTree(state, level, x, y, z, rng);
  }
}

/** Find a 2×2 sapling square containing (x, z); returns its north-west corner. */
function square(level: LevelAccess, block: Block, x: number, y: number, z: number): [number, number] | null {
  for (let ox = 0; ox >= -1; ox--) {
    for (let oz = 0; oz >= -1; oz--) {
      let ok = true;
      for (let dx = 0; dx < 2 && ok; dx++) for (let dz = 0; dz < 2 && ok; dz++) if (!isBlock(level.getBlockState(x + ox + dx, y, z + oz + dz), block)) ok = false;
      if (ok) return [x + ox, z + oz];
    }
  }
  return null;
}

export function growTree(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): boolean {
  const b = blockOf(state);
  const giantCapable = ['spruce_sapling', 'jungle_sapling', 'dark_oak_sapling', 'pale_oak_sapling'].includes(b.name);
  const sq = giantCapable ? square(level, b, x, y, z) : null;
  const feature = saplingTree(b.name, rng, !!sq);
  if (!feature) return false;
  const [tx, tz] = sq ?? [x, z];
  const cells: Array<[number, number]> = sq ? [[tx, tz], [tx + 1, tz], [tx, tz + 1], [tx + 1, tz + 1]] : [[x, z]];
  const saved = cells.map(([cx, cz]) => level.getBlockState(cx, y, cz));
  for (const [cx, cz] of cells) level.setBlock(cx, y, cz, 0, 4);
  const ok = level.placeFeature((world, r) => feature(featureCtx(world, r, tx, tz), tx, y, tz));
  if (!ok) cells.forEach(([cx, cz], i) => level.setBlock(cx, y, cz, saved[i]!, 4));
  return ok;
}

export class MushroomBehavior extends PlantBehavior {
  constructor(readonly huge: 'red' | 'brown') {
    super(SUPPORT.mushroom!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (rng.nextInt(25) !== 0) return;
    let count = 5;
    for (let dx = -4; dx <= 4; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) {
      if (isBlock(level.getBlockState(x + dx, y + dy, z + dz), blockOf(state)) && --count <= 0) return;
    }
    let tx = x + rng.nextInt(3) - 1, ty = y + rng.nextInt(2) - rng.nextInt(2), tz = z + rng.nextInt(3) - 1;
    for (let i = 0; i < 4; i++) {
      if ((stateFlags[level.getBlockState(tx, ty, tz)]! & F.AIR) && this.canSurvive(state, level, tx, ty, tz)) { x = tx; y = ty; z = tz; }
      tx = x + rng.nextInt(3) - 1; ty = y + rng.nextInt(2) - rng.nextInt(2); tz = z + rng.nextInt(3) - 1;
    }
    if ((stateFlags[level.getBlockState(tx, ty, tz)]! & F.AIR) && this.canSurvive(state, level, tx, ty, tz)) level.setBlock(tx, ty, tz, state, 2);
  }
  override isBonemealTarget(): boolean {
    return true;
  }
  override bonemealChance(): number {
    return 0.4;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.setBlock(x, y, z, 0, 4);
    const f = this.huge === 'red' ? TREES.hugeRedMushroom() : TREES.hugeBrownMushroom();
    if (!level.placeFeature((world, r) => f(featureCtx(world, r, x, z), x, y, z))) level.setBlock(x, y, z, state, 4);
  }
}

// ---------------------------------------------------------------------------------------------
// Soil
// ---------------------------------------------------------------------------------------------

/** Grass and mycelium: die in darkness, spread to nearby dirt in light. */
export class SpreadingSoilBehavior extends SnowyDirtBehavior {
  private survives(level: LevelAccess, x: number, y: number, z: number): boolean {
    const above = level.getBlockState(x, y + 1, z);
    if (name(above) === 'snow' && getValue(above, P.layers) === 1) return true;
    if (stateFlags[above]! & F.FLUID_BLOCK) return false;
    return !(stateFlags[above]! & F.OPAQUE_CUBE) || level.getBlockLight(x, y + 1, z) >= 4;
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (!this.survives(level, x, y, z)) {
      level.setBlock(x, y, z, S('dirt'), 3);
      return;
    }
    if (light(level, x, y + 1, z) < 9) return;
    for (let i = 0; i < 4; i++) {
      const tx = x + rng.nextInt(3) - 1, ty = y + rng.nextInt(5) - 3, tz = z + rng.nextInt(3) - 1;
      if (name(level.getBlockState(tx, ty, tz)) !== 'dirt') continue;
      const above = level.getBlockState(tx, ty + 1, tz);
      if ((stateFlags[above]! & F.OPAQUE_CUBE) || (stateFlags[above]! & F.FLUID_BLOCK)) continue;
      if (level.getMaxLocalRawBrightness(tx, ty + 1, tz) < 4) continue;
      const snowy = name(above) === 'snow';
      level.setBlock(tx, ty, tz, setValue(blockOf(state).defaultState, P.snowy, snowy), 3);
    }
  }
  override isBonemealTarget(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return name(state) === 'grass_block' && (stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR) !== 0;
  }
  override performBonemeal(_state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const grass = S('short_grass');
    outer: for (let i = 0; i < 128; i++) {
      let px = x, py = y + 1, pz = z;
      for (let j = 0; j < Math.floor(i / 16); j++) {
        px += rng.nextInt(3) - 1;
        py += Math.floor(((rng.nextInt(3) - 1) * rng.nextInt(3)) / 2);
        pz += rng.nextInt(3) - 1;
        if (name(level.getBlockState(px, py - 1, pz)) !== 'grass_block' || (stateFlags[level.getBlockState(px, py, pz)]! & F.OPAQUE_CUBE)) continue outer;
      }
      if (!(stateFlags[level.getBlockState(px, py, pz)]! & F.AIR)) continue;
      if (rng.nextInt(8) === 0) {
        const flowers = ['dandelion', 'poppy', 'dandelion', 'azure_bluet', 'oxeye_daisy', 'cornflower'];
        level.setBlock(px, py, pz, S(flowers[rng.nextInt(flowers.length)]!), 3);
      } else level.setBlock(px, py, pz, grass, 3);
    }
  }
}

export class FarmlandBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return (stateFlags[ctx.level.getBlockState(ctx.x, ctx.y + 1, ctx.z)]! & F.OPAQUE_CUBE) ? S('dirt') : ctx.block.defaultState;
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === UP && (stateFlags[n]! & F.SOLID) && !hasTag(n, 'crops') && name(n) !== 'melon_stem' && name(n) !== 'pumpkin_stem' && !name(n).startsWith('attached_')) {
      level.scheduleTick(x, y, z, blockOf(state), 1);
    }
    return state;
  }
  override tick(_state: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (stateFlags[level.getBlockState(x, y + 1, z)]! & F.SOLID) level.setBlock(x, y, z, S('dirt'), 3);
  }
  private nearWater(level: LevelAccess, x: number, y: number, z: number): boolean {
    for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) {
      if (stateFlags[level.getBlockState(x + dx, y + dy, z + dz)]! & F.WATER) return true;
    }
    return level.isRainingAt(x, y + 1, z);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    const m = getValue(state, P.moisture);
    if (this.nearWater(level, x, y, z)) {
      if (m < 7) level.setBlock(x, y, z, setValue(state, P.moisture, 7), 2);
    } else if (m > 0) level.setBlock(x, y, z, setValue(state, P.moisture, m - 1), 2);
    else {
      const above = level.getBlockState(x, y + 1, z);
      if (!hasTag(above, 'crops') && !/stem$/.test(name(above))) level.setBlock(x, y, z, S('dirt'), 3);
    }
  }
  override fallOn(_state: number, level: LevelAccess, x: number, y: number, z: number, e: Entity, fall: number): number {
    const w = e.physics?.width ?? 0.6, h = e.physics?.height ?? 1.8;
    if (fall > 0.5 && level.random.nextFloat() < fall - 0.5 && w * w * h > 0.512 && level.getGameRule('mobGriefing') !== false) {
      level.setBlock(x, y, z, S('dirt'), 3);
      if (e.transform) e.transform.y = Math.max(e.transform.y, y + 1);
    }
    return 1;
  }
}

/** Leaves keep their distance to the nearest log up to date and decay at distance 7. */
export class LeavesBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    let s = setValue(ctx.block.defaultState, P.persistent, true);
    if (ctx.inWater()) s = setValue(s, P.waterlogged, true);
    return setValue(s, P.distance7, this.distanceAt(ctx.level, ctx.x, ctx.y, ctx.z));
  }
  distanceAt(level: LevelAccess, x: number, y: number, z: number): number {
    let d = 7;
    for (let k = 0; k < 6; k++) {
      const n = level.getBlockState(x + DX[k]!, y + DY[k]!, z + DZ[k]!);
      if (hasTag(n, 'logs')) return 1;
      const nd = tryGetValue(n, P.distance7);
      if (nd !== undefined && hasTag(n, 'leaves')) d = Math.min(d, nd + 1);
    }
    return d;
  }
  override updateShape(state: number, _dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    const d = this.distanceAt(level, x, y, z);
    if (d !== 1 || getValue(state, P.distance7) !== 1) level.scheduleTick(x, y, z, blockOf(state), 1);
    return state;
  }
  override tick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    const d = this.distanceAt(level, x, y, z);
    if (d !== getValue(state, P.distance7)) level.setBlock(x, y, z, setValue(state, P.distance7, d), 3);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (!getValue(state, P.persistent) && getValue(state, P.distance7) === 7) {
      level.dropBlockLoot(x, y, z, state);
      level.setBlock(x, y, z, (stateFlags[state]! & F.WATERLOGGED) ? S('water') : 0, 3);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

/** Sugar cane and cactus grow up to three blocks. */
export class ColumnPlantBehavior extends PlantBehavior {
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR)) return;
    let h = 1;
    while (isBlock(level.getBlockState(x, y - h, z), blockOf(state))) h++;
    if (h >= 3) return;
    const age = getValue(state, P.age15);
    if (age === 15) {
      level.setBlock(x, y + 1, z, blockOf(state).defaultState, 3);
      level.setBlock(x, y, z, setValue(state, P.age15, 0), 4);
    } else level.setBlock(x, y, z, setValue(state, P.age15, age + 1), 4);
  }
  override entityInside(state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    if (name(state) === 'cactus') level.hurtEntity(e, 'cactus', 1);
  }
}

export class BambooBehavior extends PlantBehavior {
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (name(state) === 'bamboo_sapling') {
      if (rng.nextInt(3) === 0 && (stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR) && light(level, x, y + 1, z) >= 9) {
        level.setBlock(x, y + 1, z, S('bamboo[leaves=small]'), 3);
      }
      return;
    }
    if (getValue(state, P.bambooStage) !== 0 || rng.nextInt(3) !== 0) return;
    if (!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR) || light(level, x, y + 1, z) < 9) return;
    let h = 1;
    while (name(level.getBlockState(x, y - h, z)) === 'bamboo') h++;
    if (h >= 16) return;
    this.grow(state, level, x, y, z, h, rng);
  }
  grow(state: number, level: LevelAccess, x: number, y: number, z: number, h: number, rng: Random): void {
    const thick = h >= 4 ? 1 : 0;
    const top = setValue(setValue(setValue(state, P.bambooAge, thick), P.leaves, h >= 1 ? 'large' : 'small'), P.bambooStage, h >= 11 || rng.nextFloat() < 0.25 ? 1 : 0);
    level.setBlock(x, y + 1, z, top, 3);
    level.setBlock(x, y, z, setValue(setValue(state, P.leaves, h >= 2 ? 'large' : 'small'), P.bambooAge, thick), 3);
    if (h >= 2) {
      const below = level.getBlockState(x, y - 1, z);
      if (name(below) === 'bamboo') level.setBlock(x, y - 1, z, setValue(below, P.leaves, 'small'), 3);
    }
  }
  override isBonemealTarget(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    let top = y;
    while (name(level.getBlockState(x, top + 1, z)) === 'bamboo') top++;
    return name(state) === 'bamboo' && (stateFlags[level.getBlockState(x, top + 1, z)]! & F.AIR) !== 0 && top - y < 15;
  }
  override performBonemeal(_state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    let top = y;
    while (name(level.getBlockState(x, top + 1, z)) === 'bamboo') top++;
    let h = 1;
    while (name(level.getBlockState(x, top - h, z)) === 'bamboo') h++;
    const n = rng.nextIntBetween(1, 2);
    for (let i = 0; i < n && h < 16; i++, top++, h++) this.grow(level.getBlockState(x, top, z), level, x, top, z, h, rng);
  }
}

// ---------------------------------------------------------------------------------------------
// Misc plants
// ---------------------------------------------------------------------------------------------

export class GrowingCocoaBehavior extends CocoaBehavior {
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const age = getValue(state, P.age2);
    if (age < 2 && rng.nextInt(5) === 0) level.setBlock(x, y, z, setValue(state, P.age2, age + 1), 2);
  }
  override isBonemealTarget(state: number): boolean {
    return getValue(state, P.age2) < 2;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.setBlock(x, y, z, setValue(state, P.age2, getValue(state, P.age2) + 1), 2);
  }
}

export class BerryBushBehavior extends PlantBehavior {
  constructor() {
    super(SUPPORT.berry!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const age = getValue(state, P.age3);
    if (age < 3 && rng.nextInt(5) === 0 && light(level, x, y + 1, z) >= 9) level.setBlock(x, y, z, setValue(state, P.age3, age + 1), 2);
  }
  override isBonemealTarget(state: number): boolean {
    return getValue(state, P.age3) < 3;
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.setBlock(x, y, z, setValue(state, P.age3, Math.min(3, getValue(state, P.age3) + 1)), 2);
  }
  override entityInside(state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    if (e.type === 'fox' || e.type === 'bee' || !e.transform) return;
    const t = e.transform;
    const moved = Math.abs(t.x - t.px) + Math.abs(t.z - t.pz);
    if (getValue(state, P.age3) > 0 && moved > 0.003 && !e.input?.sneaking) level.hurtEntity(e, 'sweet_berry_bush', 1);
  }
}

export class GrowingKelpBehavior extends PlantBehavior {
  constructor() {
    super(SUPPORT.kelp!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (name(state) !== 'kelp') return;
    const age = getValue(state, P.age25);
    if (age >= 25 || rng.nextFloat() >= 0.14) return;
    const up = level.getBlockState(x, y + 1, z);
    if (name(up) !== 'water' || (tryGetValue(up, P.level15) ?? 0) !== 0) return;
    level.setBlock(x, y + 1, z, setValue(state, P.age25, age + 1), 3);
    level.setBlock(x, y, z, S('kelp_plant'), 3);
  }
  override isBonemealTarget(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return name(state) === 'kelp' && name(level.getBlockState(x, y + 1, z)) === 'water';
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.setBlock(x, y + 1, z, setValue(state, P.age25, Math.min(25, getValue(state, P.age25) + 1)), 3);
    level.setBlock(x, y, z, S('kelp_plant'), 3);
  }
}

export class CaveVinesBehavior extends HangingPlantBehavior {
  constructor() {
    super((a) => isFaceSturdy(a, DOWN) || blockOf(a).name.startsWith('cave_vines'));
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (name(state) !== 'cave_vines') return;
    const age = getValue(state, P.age25);
    if (age >= 25 || rng.nextFloat() >= 0.1 || !(stateFlags[level.getBlockState(x, y - 1, z)]! & F.AIR)) return;
    level.setBlock(x, y - 1, z, setValue(setValue(state, P.age25, age + 1), P.berries, rng.nextFloat() < 0.11), 3);
    level.setBlock(x, y, z, setValue(S('cave_vines_plant'), P.berries, getValue(state, P.berries)), 3);
  }
  override isBonemealTarget(state: number): boolean {
    return !getValue(state, P.berries);
  }
  override performBonemeal(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.setBlock(x, y, z, setValue(state, P.berries, true), 2);
  }
  override use(state: number, level: LevelAccess, x: number, y: number, z: number): 'success' | 'pass' {
    if (!getValue(state, P.berries)) return 'pass';
    level.dropBlockLoot(x, y, z, state);
    level.setBlock(x, y, z, setValue(state, P.berries, false), 2);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.cave_vines.pick_berries');
    return 'success';
  }
}

export class GrowingVineBehavior extends VineBehavior {
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (level.getGameRule('doVinesSpread') === false || rng.nextInt(4) !== 0) return;
    const below = level.getBlockState(x, y - 1, z);
    if ((stateFlags[below]! & F.AIR) && y - 1 > level.minY) {
      const props = [P.north, P.south, P.west, P.east];
      let s = blockOf(state).defaultState;
      let any = false;
      for (const p of props) if (getValue(state, p) && rng.nextBool()) { s = setValue(s, p, true); any = true; }
      if (any) level.setBlock(x, y - 1, z, s, 2);
    }
  }
}

export class NetherWartBehavior extends PlantBehavior {
  constructor() {
    super(SUPPORT.wart!);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const age = getValue(state, P.age3);
    if (age < 3 && rng.nextInt(10) === 0) level.setBlock(x, y, z, setValue(state, P.age3, age + 1), 2);
  }
}

/** Snow layers and ice melt near bright block light. */
export class MeltingBehavior extends BlockBehavior {
  constructor(private readonly inner: BlockBehavior) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null { return this.inner.getStateForPlacement(ctx); }
  override canSurvive(s: number, l: LevelAccess, x: number, y: number, z: number): boolean { return this.inner.canSurvive(s, l, x, y, z); }
  override updateShape(s: number, d: Direction, n: number, l: LevelAccess, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    return this.inner.updateShape(s, d, n, l, x, y, z, nx, ny, nz);
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (level.getBlockLight(x, y, z) <= 11) return;
    const n = name(state);
    if (n === 'ice') {
      const below = level.getBlockState(x, y - 1, z);
      level.setBlock(x, y, z, (stateFlags[below]! & F.SOLID) || (stateFlags[below]! & F.FLUID_BLOCK) ? S('water') : 0, 3);
    } else level.setBlock(x, y, z, 0, 3);
  }
}

export class BuddingAmethystBehavior extends BlockBehavior {
  override randomTick(_state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (rng.nextInt(5) !== 0) return;
    const d = rng.nextInt(6) as Direction;
    const tx = x + DX[d]!, ty = y + DY[d]!, tz = z + DZ[d]!;
    const cur = level.getBlockState(tx, ty, tz);
    const stages = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'];
    let next: string | null = null;
    if (stateFlags[cur]! & F.AIR || (name(cur) === 'water' && (tryGetValue(cur, P.level15) ?? 0) === 0)) next = stages[0]!;
    else {
      const i = stages.indexOf(name(cur));
      if (i >= 0 && i < 3 && getValue(cur, P.facing6) === d) next = stages[i + 1]!;
    }
    if (!next) return;
    const water = name(cur) === 'water' || tryGetValue(cur, P.waterlogged) === true;
    level.setBlock(tx, ty, tz, setValue(setValue(S(next), P.facing6, d), P.waterlogged, water), 3);
  }
}

// ---------------------------------------------------------------------------------------------
// Contact damage
// ---------------------------------------------------------------------------------------------

export class MagmaBehavior extends BlockBehavior {
  override stepOn(_state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    if (e.input?.sneaking) return;
    level.hurtEntity(e, 'hot_floor', 1);
  }
}

export class CampfireDamageBehavior extends BlockBehavior {
  constructor(private readonly inner: BlockBehavior, private readonly soul: boolean) {
    super();
  }
  override getStateForPlacement(ctx: PlaceContext): number | null { return this.inner.getStateForPlacement(ctx); }
  override use(s: number, l: LevelAccess, x: number, y: number, z: number, c: Parameters<BlockBehavior['use']>[5]) { return this.inner.use(s, l, x, y, z, c); }
  override entityInside(state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    if (tryGetValue(state, P.lit)) level.hurtEntity(e, 'campfire', this.soul ? 2 : 1);
  }
}

export class FireBehavior extends BlockBehavior {
  constructor(private readonly soul: boolean) {
    super();
  }

  /**
   * State of a fire placed at (x,y,z): soul fire on soul blocks, floor fire on a sturdy top face,
   * otherwise side fire clinging to flammable neighbours. Returns 0 (air) if it cannot exist.
   */
  static stateAt(level: LevelAccess, x: number, y: number, z: number): number {
    const below = level.getBlockState(x, y - 1, z);
    if (blockHasTag(blockOf(below), 'soul_fire_base_blocks')) return BLOCK_BY_NAME.get('soul_fire')!.defaultState;
    const fire = BLOCK_BY_NAME.get('fire')!;
    if (isFaceSturdy(below, UP) || stateFlags[below]! & F.FLAMMABLE) return fire.defaultState;
    let st = fire.defaultState, any = false;
    const sides: Array<[Property<boolean>, number, number, number]> = [[P.north, 0, 0, -1], [P.south, 0, 0, 1], [P.west, -1, 0, 0], [P.east, 1, 0, 0], [P.up, 0, 1, 0]];
    for (const [prop, dx, dy, dz] of sides) {
      if (stateFlags[level.getBlockState(x + dx, y + dy, z + dz)]! & F.FLAMMABLE) {
        st = setValue(st, prop, true);
        any = true;
      }
    }
    return any ? st : 0;
  }
  override entityInside(_state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    level.igniteEntity(e, 8);
    level.hurtEntity(e, 'in_fire', this.soul ? 2 : 1);
  }
}

export class BlightRoseBehavior extends PlantBehavior {
  override entityInside(_state: number, level: LevelAccess, _x: number, _y: number, _z: number, e: Entity): void {
    level.addEntityEffect(e, 'withering', 40, 0);
  }
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

export function registerGrowthBehaviors(): void {
  registerBehaviorResolver((b) => {
    const n = b.name;
    const tags = b.settings.tags ?? [];
    switch (n) {
      case 'wheat': case 'carrots': case 'potatoes': return new CropBehavior(SUPPORT.crop!, P.age7, 7);
      case 'beetroots': return new CropBehavior(SUPPORT.crop!, P.age3, 3);
      case 'torchflower_crop': return new CropBehavior(SUPPORT.crop!, P.age1, 1);
      case 'melon_stem': return new StemBehavior('melon', 'attached_melon_stem');
      case 'pumpkin_stem': return new StemBehavior('pumpkin', 'attached_pumpkin_stem');
      case 'attached_melon_stem': return new AttachedStemBehavior('melon', 'melon_stem');
      case 'attached_pumpkin_stem': return new AttachedStemBehavior('pumpkin', 'pumpkin_stem');
      case 'brown_mushroom': return new MushroomBehavior('brown');
      case 'red_mushroom': return new MushroomBehavior('red');
      case 'grass_block': case 'mycelium': return new SpreadingSoilBehavior();
      case 'farmland': return new FarmlandBehavior();
      case 'sugar_cane': return new ColumnPlantBehavior(SUPPORT.sugarCane!);
      case 'cactus': return new ColumnPlantBehavior(SUPPORT.cactus!);
      case 'bamboo': case 'bamboo_sapling': return new BambooBehavior(SUPPORT.bamboo!);
      case 'cocoa': return new GrowingCocoaBehavior();
      case 'sweet_berry_bush': return new BerryBushBehavior();
      case 'kelp': case 'kelp_plant': return new GrowingKelpBehavior();
      case 'cave_vines': case 'cave_vines_plant': return new CaveVinesBehavior();
      case 'vine': return new GrowingVineBehavior();
      case 'ember_wart': return new NetherWartBehavior();
      case 'budding_amethyst': return new BuddingAmethystBehavior();
      case 'magma_block': return new MagmaBehavior();
      case 'fire': return new FireBehavior(false);
      case 'soul_fire': return new FireBehavior(true);
      case 'blight_rose': return new BlightRoseBehavior(SUPPORT.bush!);
    }
    if (tags.includes('saplings') && n !== 'mangrove_propagule') return new SaplingBehavior();
    if (tags.includes('leaves')) return new LeavesBehavior();
    return null;
  });
}

/** Wrap behaviours that need composition after the default resolution (snow, ice, campfire). */
export function wrapGrowthBehaviors(): void {
  for (const n of ['snow', 'ice']) {
    const b = BLOCK_BY_NAME.get(n);
    if (b) b.behavior = new MeltingBehavior(b.behavior);
  }
  for (const n of ['campfire', 'soul_campfire']) {
    const b = BLOCK_BY_NAME.get(n);
    if (b) b.behavior = new CampfireDamageBehavior(b.behavior, n === 'soul_campfire');
  }
}
