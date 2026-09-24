/**
 * Overworld climate model: six parameters sampled from noise (temperature, humidity,
 * continentalness, erosion, weirdness and the folded "peaks & valleys" value), the terrain
 * shaper that turns them into a smooth height field, and the biome selector.
 *
 * All thresholds and curves are STRATA's own; only the multi-parameter approach is shared
 * with the reference game.
 */
import { NormalNoise, NoiseStack } from '../../math/noise';
import { Random, WorldSeed, subSeed } from '../../math/random';
import { biomeId } from '../biomes';

export const SEA_LEVEL = 63;

export function seededRandom(seed: WorldSeed, name: string): Random {
  return new Random(subSeed(seed, name), seed.hi);
}

export function smooth(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise cubic (monotone Hermite) curve through sorted points. */
export class Curve {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly ms: Float64Array;

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    const n = points.length;
    this.xs = new Float64Array(points.map((p) => p[0]));
    this.ys = new Float64Array(points.map((p) => p[1]));
    this.ms = new Float64Array(n);
    const d = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) d[i] = (this.ys[i + 1]! - this.ys[i]!) / (this.xs[i + 1]! - this.xs[i]!);
    for (let i = 0; i < n; i++) {
      if (i === 0) this.ms[i] = d[0]!;
      else if (i === n - 1) this.ms[i] = d[n - 2]!;
      else this.ms[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
    }
    // Fritsch–Carlson monotonicity fix
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { this.ms[i] = 0; this.ms[i + 1] = 0; continue; }
      const a = this.ms[i]! / d[i]!, b = this.ms[i + 1]! / d[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        this.ms[i] = t * a * d[i]!;
        this.ms[i + 1] = t * b * d[i]!;
      }
    }
  }

  at(x: number): number {
    const xs = this.xs, n = xs.length;
    if (x <= xs[0]!) return this.ys[0]!;
    if (x >= xs[n - 1]!) return this.ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * this.ys[i]! + (t3 - 2 * t2 + t) * h * this.ms[i]! + (-2 * t3 + 3 * t2) * this.ys[i + 1]! + (t3 - t2) * h * this.ms[i + 1]!;
  }
}

/** Fold weirdness into peaks (1) and valleys (-1). */
export function peaksValleys(w: number): number {
  return -(Math.abs(Math.abs(w) - 0.6666667) - 0.33333334) * 3;
}

export interface ClimateOptions {
  largeBiomes: boolean;
}

/** Column climate + derived terrain parameters. */
export interface Column {
  t: number;
  h: number;
  c: number;
  e: number;
  w: number;
  pv: number;
  /** Smooth terrain height (blocks). */
  height: number;
  /** Vertical scale of the 3D detail noise (blocks per density unit). */
  scale: number;
  /** Amplitude of jagged peaks. */
  jag: number;
  /** Mountain factor 0..1. */
  mountain: number;
  /** River factor 0..1. */
  river: number;
}

export function newColumn(): Column {
  return { t: 0, h: 0, c: 0, e: 0, w: 0, pv: 0, height: 64, scale: 4, jag: 0, mountain: 0, river: 0 };
}

const CONTINENT = new Curve([
  [-1.2, 70], [-0.96, 67], [-0.9, 35], [-0.62, 31], [-0.46, 37], [-0.3, 46], [-0.2, 51],
  [-0.15, 60], [-0.11, 64], [0.0, 66], [0.25, 70], [0.55, 77], [1.0, 86],
]);

export class Climate {
  readonly temperature: NoiseStack;
  readonly humidity: NoiseStack;
  readonly continentalness: NoiseStack;
  readonly erosion: NoiseStack;
  readonly weirdness: NoiseStack;
  readonly shift: NoiseStack;
  /** Terrain height multiplier (amplified worlds). */
  amplify = 1;

  constructor(seed: WorldSeed, opts: ClimateOptions) {
    const big = opts.largeBiomes ? -2 : 0;
    this.temperature = new NormalNoise(seededRandom(seed, 'climate/temperature'), -12 + big, [1.5, 0, 1, 0, 0, 0]);
    this.humidity = new NormalNoise(seededRandom(seed, 'climate/humidity'), -10 + big, [1, 1, 0, 0, 0, 0]);
    this.continentalness = new NormalNoise(seededRandom(seed, 'climate/continentalness'), -11 + big, [1, 1, 2, 2, 2, 1, 1, 1, 1]);
    this.erosion = new NormalNoise(seededRandom(seed, 'climate/erosion'), -11 + big, [1, 1, 0, 1, 1]);
    this.weirdness = new NormalNoise(seededRandom(seed, 'climate/weirdness'), -9, [1, 2, 1, 0, 0, 0]);
    this.shift = new NormalNoise(seededRandom(seed, 'climate/shift'), -5, [1, 1, 1, 0]);
  }

  /** Sample the climate and derived terrain parameters of one column. */
  column(x: number, z: number, out: Column = newColumn()): Column {
    const sx = x + this.shift.sample(x, 0, z) * 16;
    const sz = z + this.shift.sample(z, x, 0) * 16;
    out.t = this.temperature.sample(sx, 0, sz);
    out.h = this.humidity.sample(sx, 0, sz);
    out.c = this.continentalness.sample(sx, 0, sz);
    out.e = this.erosion.sample(sx, 0, sz);
    out.w = this.weirdness.sample(sx, 0, sz);
    this.shape(out);
    return out;
  }

  /** Batch variant over a grid of columns (x0 + i·step, z0 + j·step), i < nx, j < nz. */
  grid(x0: number, z0: number, step: number, nx: number, nz: number, out: Column[]): void {
    const n = nx * nz;
    const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      xs[j * nx + i] = x0 + i * step;
      zs[j * nx + i] = z0 + j * step;
    }
    const shX = new Float64Array(n), shZ = new Float64Array(n);
    this.shift.sampleBatch(xs, ys, zs, n, shX);
    this.shift.sampleBatch(zs, xs, ys, n, shZ);
    const sx = new Float64Array(n), sz = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      sx[k] = xs[k]! + shX[k]! * 16;
      sz[k] = zs[k]! + shZ[k]! * 16;
    }
    const t = new Float64Array(n), h = new Float64Array(n), c = new Float64Array(n), e = new Float64Array(n), w = new Float64Array(n);
    this.temperature.sampleBatch(sx, ys, sz, n, t);
    this.humidity.sampleBatch(sx, ys, sz, n, h);
    this.continentalness.sampleBatch(sx, ys, sz, n, c);
    this.erosion.sampleBatch(sx, ys, sz, n, e);
    this.weirdness.sampleBatch(sx, ys, sz, n, w);
    for (let k = 0; k < n; k++) {
      const col = out[k] ?? (out[k] = newColumn());
      col.t = t[k]!; col.h = h[k]!; col.c = c[k]!; col.e = e[k]!; col.w = w[k]!;
      this.shape(col);
    }
  }

  /** Terrain shaper: climate → smooth height, detail scale, jaggedness. */
  shape(col: Column): void {
    const { c, e } = col;
    const pv = peaksValleys(col.w);
    col.pv = pv;
    let height = CONTINENT.at(c);
    const inland = smooth(-0.15, 0.0, c);
    const mountain = smooth(0.12, -0.55, e) * smooth(-0.1, 0.3, c);
    const peaks = pv > 0 ? pv : 0;
    // Rolling hills outside mountains; flatter where erosion is high.
    const hillAmp = lerp(2, 16, smooth(0.75, -0.1, e));
    height += inland * (1 - mountain) * hillAmp * pv;
    // Mountain ranges: raised valleys, towering peaks.
    height += mountain * (22 + 16 * (pv + 1) + 125 * Math.pow(peaks, 1.5)) * this.amplify;
    // Plateaus in the mid-erosion band on the rising side of weirdness.
    const plateau = smooth(-0.42, -0.3, e) * smooth(0.02, -0.1, e) * smooth(0.1, 0.3, c) * smooth(0.1, 0.3, col.w);
    height += plateau * 32 * this.amplify;
    // Rivers along weirdness valleys; they fade out inside high mountains.
    const river = smooth(-0.8, -0.94, pv) * smooth(-0.17, -0.1, c) * (1 - 0.75 * mountain) * (1 - plateau);
    height = lerp(height, 57.5, river);
    // Wetlands: very eroded ground near the coast settles at sea level.
    const wet = smooth(0.42, 0.62, e) * smooth(-0.12, -0.04, c) * smooth(0.35, 0.15, c);
    height = lerp(height, 62.2, wet * 0.85);
    if (this.amplify > 1) height = 64 + (height - 64) * (height > 64 ? this.amplify : 1);
    col.height = height;
    const flatScale = lerp(2.5, 7, smooth(0.8, -0.05, e));
    col.scale = lerp(lerp(flatScale, 5, 1 - inland), 24, mountain) * (1 - 0.6 * plateau) * (this.amplify > 1 ? 1.6 : 1);
    col.jag = mountain * peaks * 26 * this.amplify;
    col.mountain = mountain;
    col.river = river;
  }
}

// ---------------------------------------------------------------------------------------------
// Biome selection
// ---------------------------------------------------------------------------------------------

const B = (n: string) => biomeId(n);

function tempIndex(t: number): number {
  return t < -0.45 ? 0 : t < -0.15 ? 1 : t < 0.2 ? 2 : t < 0.55 ? 3 : 4;
}

function humIndex(h: number): number {
  return h < -0.35 ? 0 : h < -0.1 ? 1 : h < 0.1 ? 2 : h < 0.3 ? 3 : 4;
}

let tables: {
  ocean: number[]; deepOcean: number[]; middle: number[][]; variant: (number | null)[][];
  mushroom: number; river: number; frozenRiver: number; beach: number; snowyBeach: number; stonyShore: number; desert: number;
  jagged: number; frozenPeaks: number; stonyPeaks: number; snowySlopes: number; grove: number; meadow: number; cherry: number;
  windswept: number; windsweptForest: number; windsweptGravelly: number; windsweptSavanna: number; savannaPlateau: number;
  badlands: number; eroded: number; wooded: number; swamp: number; mangrove: number;
  lush: number; dripstone: number; deepDark: number;
} | null = null;

function biomeTables() {
  if (tables) return tables;
  tables = {
    ocean: [B('frozen_ocean'), B('cold_ocean'), B('ocean'), B('lukewarm_ocean'), B('warm_ocean')],
    deepOcean: [B('deep_frozen_ocean'), B('deep_cold_ocean'), B('deep_ocean'), B('deep_lukewarm_ocean'), B('warm_ocean')],
    middle: [
      [B('snowy_plains'), B('snowy_plains'), B('snowy_plains'), B('snowy_taiga'), B('taiga')],
      [B('plains'), B('plains'), B('forest'), B('taiga'), B('old_growth_spruce_taiga')],
      [B('flower_forest'), B('plains'), B('forest'), B('birch_forest'), B('dark_forest')],
      [B('savanna'), B('savanna'), B('forest'), B('sparse_jungle'), B('jungle')],
      [B('desert'), B('desert'), B('desert'), B('desert'), B('desert')],
    ],
    variant: [
      [B('ice_spikes'), null, B('snowy_taiga'), null, null],
      [null, null, null, null, B('old_growth_pine_taiga')],
      [B('sunflower_plains'), null, null, B('old_growth_birch_forest'), B('pale_garden')],
      [null, null, B('plains'), B('jungle'), B('bamboo_jungle')],
      [null, null, null, null, null],
    ],
    mushroom: B('mushroom_fields'), river: B('river'), frozenRiver: B('frozen_river'), beach: B('beach'), snowyBeach: B('snowy_beach'),
    stonyShore: B('stony_shore'), desert: B('desert'), jagged: B('jagged_peaks'), frozenPeaks: B('frozen_peaks'), stonyPeaks: B('stony_peaks'),
    snowySlopes: B('snowy_slopes'), grove: B('grove'), meadow: B('meadow'), cherry: B('cherry_grove'), windswept: B('windswept_hills'),
    windsweptForest: B('windswept_forest'), windsweptGravelly: B('windswept_gravelly_hills'), windsweptSavanna: B('windswept_savanna'),
    savannaPlateau: B('savanna_plateau'), badlands: B('badlands'), eroded: B('eroded_badlands'), wooded: B('wooded_badlands'),
    swamp: B('swamp'), mangrove: B('mangrove_swamp'), lush: B('lush_caves'), dripstone: B('dripstone_caves'), deepDark: B('deep_dark'),
  };
  return tables;
}

/** Surface biome of a column. */
export function surfaceBiome(col: Column): number {
  const T = biomeTables();
  const ti = tempIndex(col.t), hi = humIndex(col.h);
  const { c, e, w, pv, height, mountain } = col;
  if (c < -0.93) return T.mushroom;
  if (c < -0.19) return (c < -0.455 ? T.deepOcean : T.ocean)[ti]!;
  if (col.river > 0.55 && height < 63.5) return ti === 0 ? T.frozenRiver : T.river;
  if (c < -0.145 && height < 67) {
    if (e < -0.25) return T.stonyShore;
    if (ti === 0) return T.snowyBeach;
    return ti === 4 && hi <= 1 ? T.desert : T.beach;
  }
  // Peaks and slopes
  if (mountain > 0.45 && height > 185 && pv > 0.35) {
    if (ti <= 2) return w < 0 ? T.jagged : T.frozenPeaks;
    return T.stonyPeaks;
  }
  if (mountain > 0.45 && height > 140) {
    if (ti <= 2) return hi <= 1 ? T.snowySlopes : T.grove;
    return w > 0.25 && ti === 3 ? T.cherry : T.meadow;
  }
  if (mountain > 0.3 && height > 96) {
    if (ti <= 1) return hi >= 3 ? T.windsweptForest : w < -0.3 ? T.windsweptGravelly : T.windswept;
    if (ti === 2) return w > 0.3 ? T.cherry : T.meadow;
    if (ti === 3) return hi <= 1 ? T.savannaPlateau : T.windsweptForest;
    return hi <= 1 ? (w < 0 ? T.eroded : T.badlands) : T.wooded;
  }
  // Plateaus and hot dry uplands
  if (height > 82 && ti === 4 && e < 0.1) return hi <= 1 ? (w < -0.2 ? T.eroded : T.badlands) : T.wooded;
  if (height > 82 && ti === 3 && hi <= 1 && e < 0.1) return w > 0.35 ? T.windsweptSavanna : T.savannaPlateau;
  // Hot, dry, eroded uplands
  if (ti === 4 && e < -0.08) return hi <= 1 ? (w < -0.2 ? T.eroded : T.badlands) : T.wooded;
  // Wetlands
  if (e > 0.42 && height < 67 && c < 0.35 && ti >= 1) {
    if (ti === 4) return T.mangrove;
    if (hi >= 2) return T.swamp;
  }
  const v = T.variant[ti]![hi];
  if (v !== null && v !== undefined && w > 0.3) return v;
  return T.middle[ti]![hi]!;
}

/** Cave biome (or -1 to keep the surface biome) at depth below the smooth surface. */
export function caveBiome(col: Column, y: number): number {
  const depth = col.height - y;
  if (depth < 24) return -1;
  const T = biomeTables();
  if (y < -4 && col.e < -0.3 && depth > 64) return T.deepDark;
  if (col.h > 0.55) return T.lush;
  if (col.c > 0.7) return T.dripstone;
  return -1;
}
