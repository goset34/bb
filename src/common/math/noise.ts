/**
 * Gradient noise used by world generation.
 *
 * IMPORTANT (determinism): the evaluation path uses only +, -, *, / and Math.floor on
 * IEEE-754 doubles. The Rust/WASM port in /native performs the exact same operations in the
 * same order, so both produce bit-identical results (validated by tests/unit/noise.test.ts).
 */
import { Random } from './random';

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];

const GX = new Float64Array(16);
const GY = new Float64Array(16);
const GZ = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  GX[i] = GRAD3[i]![0];
  GY[i] = GRAD3[i]![1];
  GZ[i] = GRAD3[i]![2];
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

/** Wrap huge coordinates to keep precision (period 2^25). */
export function wrapCoord(v: number): number {
  return v - Math.floor(v / 33554432 + 0.5) * 33554432;
}

/** Single octave of improved Perlin noise with random offsets. Output ≈ [-1, 1]. */
export class ImprovedNoise {
  readonly p = new Uint8Array(512);
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;

  constructor(rng: Random) {
    this.xo = rng.nextDouble() * 256;
    this.yo = rng.nextDouble() * 256;
    this.zo = rng.nextDouble() * 256;
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = i + rng.nextInt(256 - i);
      const t = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255]!;
  }

  noise(x: number, y: number, z: number): number {
    const dx = x + this.xo;
    const dy = y + this.yo;
    const dz = z + this.zo;
    const fx = Math.floor(dx);
    const fy = Math.floor(dy);
    const fz = Math.floor(dz);
    const rx = dx - fx;
    const ry = dy - fy;
    const rz = dz - fz;
    return this.sampleAndLerp(fx & 255, fy & 255, fz & 255, rx, ry, rz);
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    return GX[h]! * x + GY[h]! * y + GZ[h]! * z;
  }

  private sampleAndLerp(X: number, Y: number, Z: number, x: number, y: number, z: number): number {
    const p = this.p;
    const a = p[X]! + Y;
    const aa = p[a]! + Z;
    const ab = p[a + 1]! + Z;
    const b = p[X + 1]! + Y;
    const ba = p[b]! + Z;
    const bb = p[b + 1]! + Z;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const g000 = this.grad(p[aa]!, x, y, z);
    const g100 = this.grad(p[ba]!, x - 1, y, z);
    const g010 = this.grad(p[ab]!, x, y - 1, z);
    const g110 = this.grad(p[bb]!, x - 1, y - 1, z);
    const g001 = this.grad(p[aa + 1]!, x, y, z - 1);
    const g101 = this.grad(p[ba + 1]!, x - 1, y, z - 1);
    const g011 = this.grad(p[ab + 1]!, x, y - 1, z - 1);
    const g111 = this.grad(p[bb + 1]!, x - 1, y - 1, z - 1);
    return lerp(w,
      lerp(v, lerp(u, g000, g100), lerp(u, g010, g110)),
      lerp(v, lerp(u, g001, g101), lerp(u, g011, g111)));
  }
}

/** One octave inside a {@link NoiseStack}: value += amp * noise(wrap(x·freq), wrap(y·freq), wrap(z·freq)). */
export interface NoiseOctave {
  readonly noise: ImprovedNoise;
  readonly freq: number;
  readonly amp: number;
}

/**
 * Batch evaluation backend (the WASM kernel). Implementations must reproduce
 * {@link NoiseStack.sample} bit for bit.
 */
export interface NoiseKernel {
  readonly name: string;
  register(stack: NoiseStack): number;
  batch(handle: number, xs: Float64Array, ys: Float64Array, zs: Float64Array, n: number, out: Float64Array): void;
}

let kernel: NoiseKernel | null = null;
let kernelEpoch = 0;

/** Install (or remove) the batch noise backend for this thread. */
export function setNoiseKernel(k: NoiseKernel | null): void {
  kernel = k;
  kernelEpoch++;
}

export function getNoiseKernel(): NoiseKernel | null {
  return kernel;
}

/** Minimum batch size worth sending to the native kernel. */
const KERNEL_MIN_BATCH = 16;

/**
 * Flattened list of Perlin octaves. This is the canonical evaluation order shared with the
 * native kernel: octaves are accumulated in list order as total = total + amp * v.
 */
export class NoiseStack {
  readonly octaves: NoiseOctave[];
  /** Upper bound of |sample|. */
  readonly maxValue: number;
  private handle = -1;
  private handleEpoch = -1;

  constructor(octaves: NoiseOctave[]) {
    this.octaves = octaves;
    let m = 0;
    for (const o of octaves) m += Math.abs(o.amp);
    this.maxValue = m;
  }

  sample(x: number, y: number, z: number): number {
    let total = 0;
    const oct = this.octaves;
    for (let i = 0; i < oct.length; i++) {
      const o = oct[i]!;
      total = total + o.amp * o.noise.noise(wrapCoord(x * o.freq), wrapCoord(y * o.freq), wrapCoord(z * o.freq));
    }
    return total;
  }

  /** Evaluate n points (xs[i], ys[i], zs[i]) into out[i]. */
  sampleBatch(xs: Float64Array, ys: Float64Array, zs: Float64Array, n: number, out: Float64Array): void {
    const k = kernel;
    if (k && n >= KERNEL_MIN_BATCH) {
      if (this.handleEpoch !== kernelEpoch) {
        this.handle = k.register(this);
        this.handleEpoch = kernelEpoch;
      }
      k.batch(this.handle, xs, ys, zs, n, out);
      return;
    }
    for (let i = 0; i < n; i++) out[i] = this.sample(xs[i]!, ys[i]!, zs[i]!);
  }
}

function octaveFactors(firstOctave: number, count: number): { inF: number; vF: number } {
  let f = 1;
  for (let i = 0; i < -firstOctave; i++) f /= 2;
  for (let i = 0; i < firstOctave; i++) f *= 2;
  let v = 1;
  for (let i = 0; i < count - 1; i++) v *= 2;
  let denom = 1;
  for (let i = 0; i < count; i++) denom *= 2;
  // value factor = 2^(n-1) / (2^n - 1): the lowest octave weighs most, the sum stays ≈ [-1, 1]
  return { inF: f, vF: v / (denom - 1) };
}

function buildOctaves(rng: Random, firstOctave: number, amplitudes: readonly number[], freqMul: number, ampMul: number): NoiseOctave[] {
  const out: NoiseOctave[] = [];
  let { inF, vF } = octaveFactors(firstOctave, amplitudes.length);
  for (let i = 0; i < amplitudes.length; i++) {
    const r = rng.fork(firstOctave + i + 1000);
    if (amplitudes[i] !== 0) out.push({ noise: new ImprovedNoise(r), freq: inF * freqMul, amp: amplitudes[i]! * vF * ampMul });
    inF *= 2;
    vF /= 2;
  }
  return out;
}

/**
 * Sum of octaves. `firstOctave` is negative for low frequencies (e.g. -7 means the lowest
 * octave has a frequency of 2^-7). `amplitudes[i]` weights octave i (0 disables it).
 */
export class OctaveNoise extends NoiseStack {
  constructor(rng: Random, firstOctave: number, amplitudes: readonly number[], scale = 1) {
    super(buildOctaves(rng, firstOctave, amplitudes, 1, scale));
  }
}

/**
 * "Normal" noise: two octave sets sampled at slightly different scales and summed, then
 * normalised so the output roughly spans [-1, 1] with a gaussian-like distribution.
 * Used for climate parameters and caves.
 */
export class NormalNoise extends NoiseStack {
  constructor(rng: Random, firstOctave: number, amplitudes: readonly number[]) {
    let minI = Number.MAX_SAFE_INTEGER;
    let maxI = Number.MIN_SAFE_INTEGER;
    for (let i = 0; i < amplitudes.length; i++) {
      if (amplitudes[i] !== 0) {
        minI = Math.min(minI, i);
        maxI = Math.max(maxI, i);
      }
    }
    const span = maxI - minI;
    const valueFactor = 0.16666666666666666 / (0.1 * (1 + 1 / (span + 1)));
    const k = 1.0181268882175227;
    super([
      ...buildOctaves(rng.fork('a'), firstOctave, amplitudes, 1, valueFactor),
      ...buildOctaves(rng.fork('b'), firstOctave, amplitudes, k, valueFactor),
    ]);
  }
}

/** 2D simplex noise (for surface detail, clouds, textures). Output ≈ [-1, 1]. */
export class Simplex2 {
  private readonly perm = new Uint8Array(512);
  private readonly xo: number;
  private readonly yo: number;
  constructor(rng: Random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    this.xo = rng.nextDouble() * 256;
    this.yo = rng.nextDouble() * 256;
  }

  noise(xin: number, yin: number): number {
    const F2 = 0.3660254037844386;
    const G2 = 0.21132486540518713;
    xin += this.xo;
    yin += this.yo;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const p = this.perm;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = p[ii + p[jj]!]! % 12;
      t0 *= t0;
      n0 = t0 * t0 * (GX[g]! * x0 + GY[g]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = p[ii + i1 + p[jj + j1]!]! % 12;
      t1 *= t1;
      n1 = t1 * t1 * (GX[g]! * x1 + GY[g]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = p[ii + 1 + p[jj + 1]!]! % 12;
      t2 *= t2;
      n2 = t2 * t2 * (GX[g]! * x2 + GY[g]! * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal sum. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** Cheap value noise on integer lattice with smooth interpolation (2D), hash-based. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const h = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 144269504);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
