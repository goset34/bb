/**
 * Feature framework: features are functions that try to place something at a position;
 * placed features combine a feature with placement modifiers (count, rarity, spread in the
 * chunk, height providers, heightmaps, filters). Decoration runs them per biome and step.
 */
import { Random, WorldSeed } from '../../math/random';
import { stateFlags, F } from '../../block/registry';

/** Block access used by features: the generation region or a live server level. */
export interface WorldAccess {
  readonly minY: number;
  readonly maxY: number;
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  getHeight(kind: HeightKind, x: number, z: number): number;
  getBiome(x: number, y: number, z: number): number;
  setBlockEntity(x: number, y: number, z: number, type: string, data: Record<string, unknown>): void;
  addEntity?(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): void;
  scheduleTick?(x: number, y: number, z: number, delay: number): void;
  /** Whether (x, z) can be written (inside the decoration region). */
  isInside?(x: number, z: number): boolean;
}

export type HeightKind = 'surface' | 'motion' | 'ocean_floor' | 'opaque';

/** Climate helpers exposed by the generator to features. */
export interface ClimateAccess {
  /** Temperature noise used for frozen oceans and snow lines. */
  temperatureNoise(x: number, z: number): number;
  readonly seaLevel: number;
}

export interface FeatureContext {
  world: WorldAccess;
  rng: Random;
  seed: WorldSeed;
  climate: ClimateAccess | null;
  /** Decorated chunk (features are placed from here). */
  cx: number;
  cz: number;
}

export type Feature = (ctx: FeatureContext, x: number, y: number, z: number) => boolean;

export type Pos = [number, number, number];

/** A placement modifier maps each position to zero or more positions. */
export type Modifier = (ctx: FeatureContext, p: Pos, out: Pos[]) => void;

export const Step = {
  RAW: 0,
  LAKES: 1,
  LOCAL_MODIFICATIONS: 2,
  UNDERGROUND_STRUCTURES: 3,
  SURFACE_STRUCTURES: 4,
  STRONGHOLDS: 5,
  UNDERGROUND_ORES: 6,
  UNDERGROUND_DECORATION: 7,
  FLUID_SPRINGS: 8,
  VEGETAL_DECORATION: 9,
  TOP_LAYER_MODIFICATION: 10,
} as const;
export type Step = (typeof Step)[keyof typeof Step];
export const STEP_COUNT = 11;

export interface PlacedFeature {
  readonly name: string;
  readonly step: Step;
  readonly feature: Feature;
  readonly modifiers: Modifier[];
  /** Global order index (assigned on registration). */
  index: number;
}

const PLACED = new Map<string, PlacedFeature>();
const ORDER: PlacedFeature[] = [];

export function placed(name: string, step: Step, feature: Feature, ...modifiers: Modifier[]): PlacedFeature {
  const existing = PLACED.get(name);
  if (existing) return existing;
  const pf: PlacedFeature = { name, step, feature, modifiers, index: ORDER.length };
  PLACED.set(name, pf);
  ORDER.push(pf);
  return pf;
}

export function placedFeature(name: string): PlacedFeature {
  const p = PLACED.get(name);
  if (!p) throw new Error('Unknown placed feature ' + name);
  return p;
}

export function allPlacedFeatures(): readonly PlacedFeature[] {
  return ORDER;
}

/** Run a placed feature for chunk (cx, cz); returns the number of successful placements. */
export function runPlaced(ctx: FeatureContext, pf: PlacedFeature, biomeAllows: (x: number, y: number, z: number) => boolean): number {
  let list: Pos[] = [[ctx.cx << 4, 0, ctx.cz << 4]];
  for (const m of pf.modifiers) {
    const next: Pos[] = [];
    for (const p of list) m(ctx, p, next);
    list = next;
    if (!list.length) return 0;
  }
  let n = 0;
  for (const p of list) {
    if (p[1] < ctx.world.minY || p[1] >= ctx.world.maxY) continue;
    if (!biomeAllows(p[0], p[1], p[2])) continue;
    if (pf.feature(ctx, p[0], p[1], p[2])) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Placement modifiers
// ---------------------------------------------------------------------------------------------

/** Repeat n times (n may be a function of the random). */
export function count(n: number | ((r: Random) => number)): Modifier {
  return (ctx, p, out) => {
    const k = typeof n === 'number' ? n : n(ctx.rng);
    for (let i = 0; i < k; i++) out.push([p[0], p[1], p[2]]);
  };
}

export function countRange(min: number, max: number): Modifier {
  return count((r) => r.nextIntBetween(min, max));
}

/** Weighted count: `weights` [[count, weight]…]. */
export function countWeighted(weights: Array<[number, number]>): Modifier {
  return count((r) => r.pickWeighted(weights, (w) => w[1])![0]);
}

/** Keep with probability 1/n. */
export function rarity(n: number): Modifier {
  return (ctx, p, out) => {
    if (ctx.rng.nextFloat() < 1 / n) out.push(p);
  };
}

/** Spread randomly over the chunk (x, z). */
export function inSquare(): Modifier {
  return (ctx, p, out) => {
    out.push([p[0] + ctx.rng.nextInt(16), p[1], p[2] + ctx.rng.nextInt(16)]);
  };
}

/** Move to the heightmap (y = first free block above). */
export function heightmap(kind: HeightKind): Modifier {
  return (ctx, p, out) => {
    const y = ctx.world.getHeight(kind, p[0], p[2]);
    if (y > ctx.world.minY) out.push([p[0], y, p[2]]);
  };
}

/** Uniform height in [min, max] (absolute, or relative to the bottom/top with 'b+'/'t-'). */
export function uniformY(min: number, max: number): Modifier {
  return (ctx, p, out) => out.push([p[0], ctx.rng.nextIntBetween(min, max), p[2]]);
}

/** Triangular distribution between min and max (peak in the middle). */
export function triangleY(min: number, max: number, plateau = 0): Modifier {
  return (ctx, p, out) => {
    const span = max - min;
    if (plateau >= span) {
      out.push([p[0], ctx.rng.nextIntBetween(min, max), p[2]]);
      return;
    }
    const side = (span - plateau) / 2;
    const y = min + ctx.rng.nextIntBetween(0, Math.floor(side)) + ctx.rng.nextIntBetween(0, Math.ceil(side + plateau));
    out.push([p[0], y, p[2]]);
  };
}

/** Height biased toward the bottom of [min, max]. */
export function biasedY(min: number, max: number): Modifier {
  return (ctx, p, out) => {
    const r = ctx.rng;
    const y = min + r.nextInt(r.nextInt(max - min + 1 - 8) + 8);
    out.push([p[0], y, p[2]]);
  };
}

/** Only where the water above the surface is at most `max` blocks deep. */
export function surfaceWaterDepth(max: number): Modifier {
  return (ctx, p, out) => {
    const floor = ctx.world.getHeight('ocean_floor', p[0], p[2]);
    const surface = ctx.world.getHeight('surface', p[0], p[2]);
    if (surface - floor <= max) out.push(p);
  };
}

export function filter(pred: (ctx: FeatureContext, x: number, y: number, z: number) => boolean): Modifier {
  return (ctx, p, out) => {
    if (pred(ctx, p[0], p[1], p[2])) out.push(p);
  };
}

// ---------------------------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------------------------

export function isAir(s: number): boolean {
  return (stateFlags[s]! & F.AIR) !== 0;
}

export function isWaterBlock(s: number): boolean {
  return (stateFlags[s]! & F.FLUID_BLOCK) !== 0 && (stateFlags[s]! & F.WATER) !== 0;
}

export function isSolid(s: number): boolean {
  return (stateFlags[s]! & F.SOLID) !== 0;
}
