/**
 * Deterministic pseudo-random generators and positional hashing.
 * Everything here uses 32-bit integer math (Math.imul, >>>) so results are identical
 * across JS engines, Node and the Rust/WASM port.
 */

/** 32-bit finalizer (murmur3 fmix32). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a string to a 32-bit unsigned int (FNV-1a followed by fmix). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h >>> 0);
}

/** Combine two 32-bit values into one hash. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  return fmix32(h >>> 0);
}

/** Positional hash of (seed, x, y, z). */
export function hash4(seed: number, x: number, y: number, z: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (z | 0), 0x9e3779b1);
  return fmix32(h >>> 0);
}

/** Positional hash of (seed, x, z). */
export function hash3(seed: number, x: number, z: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (z | 0), 0x165667b1);
  return fmix32(h >>> 0);
}

/** Uniform float in [0,1) from a 32-bit hash. */
export function hashToFloat(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** splitmix32 step used for seeding. */
function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/**
 * xoshiro128** generator. Fast, 128-bit state, good statistical quality.
 */
export class Random {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  private haveGaussian = false;
  private nextGaussianVal = 0;

  constructor(seed: number = (Math.random() * 0xffffffff) >>> 0, seed2 = 0) {
    this.setSeed(seed, seed2);
  }

  setSeed(seed: number, seed2 = 0): void {
    const st = { s: (seed ^ Math.imul(seed2 | 0, 0x632be5ab)) | 0 };
    this.a = splitmix32(st);
    this.b = splitmix32(st);
    this.c = splitmix32(st);
    this.d = splitmix32(st);
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
    this.haveGaussian = false;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9);
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result >>> 0;
  }

  /** Signed 32-bit integer. */
  nextInt32(): number {
    return this.nextU32() | 0;
  }

  /** Integer in [0, bound). */
  nextInt(bound: number): number {
    if (bound <= 0) return 0;
    if ((bound & (bound - 1)) === 0) return this.nextU32() & (bound - 1);
    // Lemire-style rejection to avoid bias.
    const limit = 4294967296 - (4294967296 % bound);
    let r = this.nextU32();
    while (r >= limit) r = this.nextU32();
    return r % bound;
  }

  /** Integer in [min, max] inclusive. */
  nextIntBetween(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** Float in [0,1) with 24 bits of precision (like a Java float). */
  nextFloat(): number {
    return (this.nextU32() >>> 8) / 16777216;
  }

  /** Double in [0,1) with 53 bits of precision. */
  nextDouble(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  nextBool(): boolean {
    return (this.nextU32() & 1) === 1;
  }

  /** Standard normal distribution (Box–Muller, polar form). */
  nextGaussian(): number {
    if (this.haveGaussian) {
      this.haveGaussian = false;
      return this.nextGaussianVal;
    }
    let v1 = 0, v2 = 0, s = 0;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.nextGaussianVal = v2 * mul;
    this.haveGaussian = true;
    return v1 * mul;
  }

  /** Triangular distribution centred on `mode` with the given spread. */
  triangle(mode: number, deviation: number): number {
    return mode + deviation * (this.nextDouble() - this.nextDouble());
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)]!;
  }

  /** Pick using weights. */
  pickWeighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += weight(it);
    if (total <= 0) return undefined;
    let r = this.nextDouble() * total;
    for (const it of items) {
      r -= weight(it);
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  /** Derive an independent generator from this one plus a salt. */
  fork(salt: number | string = 0): Random {
    const s = typeof salt === 'string' ? hashString(salt) : salt >>> 0;
    return new Random(this.nextU32() ^ s, this.nextU32());
  }

  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(s: readonly number[]): void {
    this.a = s[0]! | 0;
    this.b = s[1]! | 0;
    this.c = s[2]! | 0;
    this.d = s[3]! | 0;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * World seed handling. Seeds are strings or numbers; we derive a pair of 32-bit words.
 */
export interface WorldSeed {
  readonly text: string;
  readonly lo: number;
  readonly hi: number;
}

export function parseSeed(input: string | number | undefined): WorldSeed {
  let text: string;
  if (input === undefined || input === '') {
    const n = Math.floor(Math.random() * 2 ** 52) - 2 ** 51;
    text = String(n);
  } else {
    text = String(input).trim();
  }
  let lo: number;
  let hi: number;
  if (/^-?\d+$/.test(text)) {
    // Numeric seed: split the (possibly 64-bit) integer into two words using BigInt.
    const big = BigInt.asUintN(64, BigInt(text));
    lo = Number(big & 0xffffffffn) >>> 0;
    hi = Number((big >> 32n) & 0xffffffffn) >>> 0;
  } else {
    lo = hashString(text);
    hi = hashString('strata:' + text);
  }
  return { text, lo, hi };
}

/** Derive a stable 32-bit sub-seed for a named generator component. */
export function subSeed(seed: WorldSeed, name: string): number {
  return fmix32((seed.lo ^ Math.imul(hashString(name), 0x9e3779b1) ^ Math.imul(seed.hi, 0x85ebca6b)) >>> 0);
}

/** Random for a chunk-local decoration step (like "population seed"). */
export function chunkRandom(seed: WorldSeed, cx: number, cz: number, salt: number): Random {
  const h = hash4(seed.lo ^ salt, cx, seed.hi, cz);
  return new Random(h, hash2(cx, cz) ^ salt);
}
