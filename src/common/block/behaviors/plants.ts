/** Support rules for plants (break when the supporting block is removed). */
import { BlockBehavior } from '../behavior';
import { blockOf, hasTag, isFaceSturdy, stateFlags, F, tryGetValue, getValue, setValue, isBlock } from '../registry';
import { P } from '../properties';
import type { LevelAccess, PlaceContext } from '../../world/level';
import { Direction, DOWN, UP, DX, DZ } from '../../world/direction';
import { tickWaterIfLogged, withWater } from './placement';

export type SupportRule = (below: number, level: LevelAccess, x: number, y: number, z: number, self: number) => boolean;

const name = (s: number) => blockOf(s).name;

export const isDirtLike = (s: number): boolean => hasTag(s, 'dirt') || name(s) === 'farmland' || name(s) === 'mud' || name(s) === 'muddy_mangrove_roots';

export const SUPPORT: Record<string, SupportRule> = {
  bush: (b) => isDirtLike(b),
  dry: (b) => isDirtLike(b) || hasTag(b, 'sand') || hasTag(b, 'terracotta'),
  crop: (b) => name(b) === 'farmland',
  wart: (b) => name(b) === 'soul_sand',
  mushroom: (b, level, x, y, z) => {
    const n = name(b);
    if (n === 'mycelium' || n === 'podzol' || hasTag(b, 'nylium')) return true;
    return level.getBlockLight(x, y, z) < 13 && isFaceSturdy(b, UP);
  },
  fungus: (b) => hasTag(b, 'nylium') || name(b) === 'soul_soil' || isDirtLike(b),
  sprouts: (b) => hasTag(b, 'nylium') || name(b) === 'soul_soil',
  sugarCane: (b, level, x, y, z) => {
    if (name(b) === 'sugar_cane') return true;
    if (!isDirtLike(b) && !hasTag(b, 'sand')) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = level.getBlockState(x + dx, y - 1, z + dz);
      if ((stateFlags[n]! & F.WATER) || name(n) === 'frosted_ice') return true;
    }
    return false;
  },
  cactus: (b, level, x, y, z) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = level.getBlockState(x + dx, y, z + dz);
      if (!(stateFlags[n]! & F.NO_COLLISION) || (stateFlags[n]! & F.LAVA)) return false;
    }
    const n = name(b);
    return (n === 'cactus' || hasTag(b, 'sand')) && !(stateFlags[level.getBlockState(x, y + 1, z)]! & F.LAVA);
  },
  lilyPad: (b) => (name(b) === 'water' && (tryGetValue(b, P.level15) ?? 1) === 0) || name(b) === 'ice',
  underwater: (b, level, x, y, z) => isFaceSturdy(b, UP) && name(b) !== 'magma_block' && (stateFlags[level.getBlockState(x, y, z)]! & F.WATER) !== 0,
  kelp: (b) => name(b) === 'kelp_plant' || (isFaceSturdy(b, UP) && name(b) !== 'magma_block'),
  sturdy: (b) => isFaceSturdy(b, UP),
  berry: (b) => isDirtLike(b),
  bamboo: (b) => isDirtLike(b) || hasTag(b, 'sand') || name(b) === 'gravel' || name(b) === 'bamboo' || name(b) === 'bamboo_sapling' || name(b) === 'suspicious_sand' || name(b) === 'suspicious_gravel',
  azalea: (b) => isDirtLike(b) || name(b) === 'clay',
  dripleaf: (b) => isDirtLike(b) || name(b) === 'clay' || name(b) === 'moss_block' || name(b) === 'big_dripleaf_stem' || name(b) === 'big_dripleaf',
  smallDripleaf: (b) => name(b) === 'clay' || name(b) === 'moss_block' || isDirtLike(b),
  firefly: (b) => isDirtLike(b) || hasTag(b, 'sand'),
  cocoa: () => true,
};

/** Plants supported from below. */
export class PlantBehavior extends BlockBehavior {
  constructor(readonly rule: SupportRule) {
    super();
  }
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return this.rule(level.getBlockState(x, y - 1, z), level, x, y, z, state);
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const s = withWater(ctx.block.defaultState, ctx);
    return this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z) ? s : null;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    if (dir === DOWN && !this.canSurvive(state, level, x, y, z)) return 0;
    if (blockOf(state).name === 'cactus' && dir !== UP && dir !== DOWN && !this.canSurvive(state, level, x, y, z)) {
      level.scheduleTick(x, y, z, blockOf(state), 1);
    }
    return state;
  }
  override tick(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (!this.canSurvive(state, level, x, y, z)) level.destroyBlock(x, y, z, true);
  }
}

/** Double-tall plants (tall grass, sunflowers…): lower half supported like a bush. */
export class TallPlantBehavior extends PlantBehavior {
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    if (blockOf(state).hasProp(P.doubleHalf) && getValue(state, P.doubleHalf) === 'upper') {
      const below = level.getBlockState(x, y - 1, z);
      return isBlock(below, blockOf(state)) && getValue(below, P.doubleHalf) === 'lower';
    }
    return super.canSurvive(state, level, x, y, z);
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    if (ctx.y >= ctx.level.maxY - 1) return null;
    if (!(stateFlags[ctx.level.getBlockState(ctx.x, ctx.y + 1, ctx.z)]! & F.REPLACEABLE)) return null;
    const s = setValue(withWater(ctx.block.defaultState, ctx), P.doubleHalf, 'lower');
    return this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z) ? s : null;
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number, old: number, moved: boolean): void {
    if (moved || isBlock(old, blockOf(state))) return;
    if (getValue(state, P.doubleHalf) === 'lower') level.setBlock(x, y + 1, z, setValue(state, P.doubleHalf, 'upper'), 3);
  }
  override updateShape(state: number, dir: Direction, n: number, level: LevelAccess, x: number, y: number, z: number): number {
    const half = getValue(state, P.doubleHalf);
    if ((dir === UP && half === 'lower') || (dir === DOWN && half === 'upper')) {
      if (!(isBlock(n, blockOf(state)) && getValue(n, P.doubleHalf) !== half)) return 0;
    }
    if (half === 'lower' && dir === DOWN && !this.canSurvive(state, level, x, y, z)) return 0;
    return state;
  }
}

/** Plants hanging from the block above (cave vines, weeping vines, roots, spore blossom). */
export class HangingPlantBehavior extends BlockBehavior {
  constructor(private readonly accepts: (above: number) => boolean) {
    super();
  }
  override canSurvive(_s: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    return this.accepts(level.getBlockState(x, y + 1, z));
  }
  override getStateForPlacement(ctx: PlaceContext): number | null {
    return this.canSurvive(0, ctx.level, ctx.x, ctx.y, ctx.z) ? withWater(ctx.block.defaultState, ctx) : null;
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === UP && !this.canSurvive(state, level, x, y, z)) return 0;
    return state;
  }
}

/** Upward-growing vine (twisting vines, kelp stems handled by PlantBehavior). */
export class UpwardVineBehavior extends PlantBehavior {}

/** Cocoa attaches to jungle logs on its facing side. */
export class CocoaBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    for (const d of ctx.nearestLookingDirections()) {
      if (d === UP || d === DOWN) continue;
      const s = setValue(ctx.block.defaultState, P.facing, d);
      if (this.canSurvive(s, ctx.level, ctx.x, ctx.y, ctx.z)) return s;
    }
    return null;
  }
  override canSurvive(state: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const f = getValue(state, P.facing);
    return hasTag(level.getBlockState(x + DX[f]!, y, z + DZ[f]!), 'jungle_logs');
  }
  override updateShape(state: number, dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    if (dir === getValue(state, P.facing) && !this.canSurvive(state, level, x, y, z)) return 0;
    return state;
  }
}

/** Vines attach to sturdy faces around them (or above). */
export class VineBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const cur = ctx.level.getBlockState(ctx.x, ctx.y, ctx.z);
    const base = isBlock(cur, ctx.block) ? cur : ctx.block.defaultState;
    const props = [P.up, P.north, P.south, P.west, P.east];
    const dirs: Direction[] = [UP, 2, 3, 4, 5];
    for (const d of ctx.nearestLookingDirections()) {
      if (d === DOWN) continue;
      const i = dirs.indexOf(d);
      if (i < 0 || getValue(base, props[i]!)) continue;
      if (this.canAttach(ctx.level, ctx.x, ctx.y, ctx.z, d)) return setValue(base, props[i]!, true);
    }
    return null;
  }
  private canAttach(level: LevelAccess, x: number, y: number, z: number, d: Direction): boolean {
    const DXv = [0, 0, 0, 0, -1, 1], DYv = [-1, 1, 0, 0, 0, 0], DZv = [0, 0, -1, 1, 0, 0];
    const s = level.getBlockState(x + DXv[d]!, y + DYv[d]!, z + DZv[d]!);
    return isFaceSturdy(s, d ^ 1) || hasTag(s, 'leaves');
  }
  override updateShape(state: number, _dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    const props = [P.up, P.north, P.south, P.west, P.east];
    const dirs: Direction[] = [UP, 2, 3, 4, 5];
    let s = state;
    let any = false;
    for (let i = 0; i < 5; i++) {
      if (!getValue(s, props[i]!)) continue;
      let ok = this.canAttach(level, x, y, z, dirs[i]!);
      if (!ok && i > 0) {
        // supported by a vine above with the same face
        const above = level.getBlockState(x, y + 1, z);
        ok = isBlock(above, blockOf(state)) && getValue(above, props[i]!);
      }
      if (!ok) s = setValue(s, props[i]!, false);
      else any = true;
    }
    return any ? s : 0;
  }
}

/** Multiface blocks (glow lichen, echo veins, resin clumps). */
export class MultifaceBehavior extends BlockBehavior {
  override getStateForPlacement(ctx: PlaceContext): number | null {
    const props = [P.down, P.up, P.north, P.south, P.west, P.east];
    const cur = ctx.level.getBlockState(ctx.x, ctx.y, ctx.z);
    const base = isBlock(cur, ctx.block) ? cur : withWater(ctx.block.defaultState, ctx);
    for (const d of ctx.nearestLookingDirections()) {
      if (getValue(base, props[d]!)) continue;
      const DXv = [0, 0, 0, 0, -1, 1], DYv = [-1, 1, 0, 0, 0, 0], DZv = [0, 0, -1, 1, 0, 0];
      if (isFaceSturdy(ctx.level.getBlockState(ctx.x + DXv[d]!, ctx.y + DYv[d]!, ctx.z + DZv[d]!), d ^ 1)) return setValue(base, props[d]!, true);
    }
    return null;
  }
  override updateShape(state: number, _dir: Direction, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    tickWaterIfLogged(state, level, x, y, z);
    const props = [P.down, P.up, P.north, P.south, P.west, P.east];
    const DXv = [0, 0, 0, 0, -1, 1], DYv = [-1, 1, 0, 0, 0, 0], DZv = [0, 0, -1, 1, 0, 0];
    let s = state;
    let any = false;
    for (let d = 0; d < 6; d++) {
      if (!getValue(s, props[d]!)) continue;
      if (!isFaceSturdy(level.getBlockState(x + DXv[d]!, y + DYv[d]!, z + DZv[d]!), d ^ 1)) s = setValue(s, props[d]!, false);
      else any = true;
    }
    if (!any) return 0;
    return s;
  }
}
