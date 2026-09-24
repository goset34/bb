/**
 * Procedural texture painter. Textures are authored in a canonical 16×16 texel space and
 * rasterised at the target resolution (16 for the default pack, 128 for the HD pack), producing
 * albedo (RGBA), height (for normal maps) and PBR material channels.
 */
import { hashString, fmix32 } from '../../../common/math/random';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function add(c: RGB, d: number): RGB {
  return [c[0] + d, c[1] + d, c[2] + d];
}

export function lum(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

export function saturate(c: RGB, s: number): RGB {
  const l = lum(c) * 255;
  return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
}

export function gray(v: number): RGB {
  return [v, v, v];
}

/** Material channel defaults for a texture. */
export interface MaterialDefaults {
  /** 0 = rough, 1 = mirror-smooth. */
  smooth: number;
  /** 0 dielectric, 1 metal. */
  metal: number;
  emit: number;
  /** Tint mask (1 = tintable). */
  tint: number;
  /** Height/normal strength multiplier. */
  bump: number;
}

export class Painter {
  readonly n: number;
  /** canonical-to-native scale (n / 16). */
  readonly s: number;
  readonly rgba: Uint8ClampedArray;
  readonly height: Float32Array;
  readonly smooth: Float32Array;
  readonly metal: Float32Array;
  readonly emit: Float32Array;
  readonly tint: Float32Array;
  bump = 1;
  private seed: number;

  constructor(n: number, readonly name: string, readonly frame = 0) {
    this.n = n;
    this.s = n / 16;
    this.rgba = new Uint8ClampedArray(n * n * 4);
    this.height = new Float32Array(n * n).fill(0.5);
    this.smooth = new Float32Array(n * n).fill(0.1);
    this.metal = new Float32Array(n * n);
    this.emit = new Float32Array(n * n);
    this.tint = new Float32Array(n * n).fill(1);
    this.seed = hashString(name);
  }

  reseed(salt: string): void {
    this.seed = hashString(this.name + ':' + salt);
  }

  // ---- random helpers ---------------------------------------------------------------------
  /** Hash noise at integer native pixel coordinates (0..1). */
  rnd(x: number, y: number, salt = 0): number {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(this.seed + salt, 0x9e3779b1);
    h = fmix32(h >>> 0);
    return h / 4294967296;
  }

  /** Hash noise at canonical texel coordinates (constant within a canonical texel). */
  rndC(u: number, v: number, salt = 0): number {
    return this.rnd(Math.floor(u) & 15, Math.floor(v) & 15, salt + 7919);
  }

  /** Tileable smooth value noise over canonical coords; `freq` lattice cells per 16 texels. */
  vnoise(u: number, v: number, freq: number, salt = 0): number {
    const period = Math.max(1, Math.round(freq));
    const fx = (u * period) / 16, fy = (v * period) / 16;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (ix: number, iy: number) => {
      const wx = ((ix % period) + period) % period, wy = ((iy % period) + period) % period;
      return this.rnd(wx + 1000, wy + 1000, salt + 31);
    };
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Tileable fractal noise (0..1). Adds finer octaves automatically for HD resolutions. */
  fbm(u: number, v: number, baseFreq = 4, octaves = 3, salt = 0): number {
    let sum = 0, amp = 1, norm = 0, f = baseFreq;
    const extra = Math.round(Math.log2(Math.max(1, this.s)));
    for (let i = 0; i < octaves + extra; i++) {
      sum += amp * this.vnoise(u, v, f, salt + i * 101);
      norm += amp;
      amp *= 0.5;
      f *= 2;
      if (f > 16 * this.s) break;
    }
    return sum / norm;
  }

  /**
   * "Grain" noise: at 16×16 it is per-pixel white noise (pixel-art look); at HD it blends
   * canonical-texel noise with fine noise so structure is preserved.
   */
  grain(x: number, y: number, salt = 0): number {
    if (this.s <= 1) return this.rnd(x, y, salt);
    const u = x / this.s, v = y / this.s;
    const coarse = this.rndC(u, v, salt);
    const fine = this.rnd(x, y, salt + 3);
    const smooth = this.fbm(u, v, 8, 2, salt + 9);
    return coarse * 0.45 + smooth * 0.35 + fine * 0.2;
  }

  // ---- pixel access ------------------------------------------------------------------------
  idx(x: number, y: number): number {
    x = ((x % this.n) + this.n) % this.n;
    y = ((y % this.n) + this.n) % this.n;
    return y * this.n + x;
  }

  set(x: number, y: number, c: RGB | RGBA, h?: number): void {
    const i = this.idx(x, y);
    this.rgba[i * 4] = c[0];
    this.rgba[i * 4 + 1] = c[1];
    this.rgba[i * 4 + 2] = c[2];
    this.rgba[i * 4 + 3] = c.length === 4 ? c[3] : 255;
    if (h !== undefined) this.height[i] = h;
  }

  get(x: number, y: number): RGBA {
    const i = this.idx(x, y) * 4;
    return [this.rgba[i]!, this.rgba[i + 1]!, this.rgba[i + 2]!, this.rgba[i + 3]!];
  }

  alpha(x: number, y: number): number {
    return this.rgba[this.idx(x, y) * 4 + 3]!;
  }

  setAlpha(x: number, y: number, a: number): void {
    this.rgba[this.idx(x, y) * 4 + 3] = a;
  }

  /** Iterate over all native pixels with canonical coordinates. */
  each(fn: (x: number, y: number, u: number, v: number) => void): void {
    const n = this.n, s = this.s;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) fn(x, y, (x + 0.5) / s, (y + 0.5) / s);
  }

  /** Fill a canonical rectangle [u0,u1)×[v0,v1). */
  rect(u0: number, v0: number, u1: number, v1: number, fn: (x: number, y: number, u: number, v: number) => void): void {
    const s = this.s;
    const x0 = Math.round(u0 * s), x1 = Math.round(u1 * s), y0 = Math.round(v0 * s), y1 = Math.round(v1 * s);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(x, y, (x + 0.5) / s, (y + 0.5) / s);
  }

  fillRect(u0: number, v0: number, u1: number, v1: number, c: RGB | RGBA, h?: number): void {
    this.rect(u0, v0, u1, v1, (x, y) => this.set(x, y, c, h));
  }

  /** Canonical-texel pixel (size 1×1 canonical). */
  px(u: number, v: number, c: RGB | RGBA, h?: number): void {
    this.fillRect(u, v, u + 1, v + 1, c, h);
  }

  clear(): void {
    this.rgba.fill(0);
  }

  /** Set material channels over the whole texture. */
  material(m: Partial<MaterialDefaults>): void {
    if (m.smooth !== undefined) this.smooth.fill(m.smooth);
    if (m.metal !== undefined) this.metal.fill(m.metal);
    if (m.emit !== undefined) this.emit.fill(m.emit);
    if (m.tint !== undefined) this.tint.fill(m.tint);
    if (m.bump !== undefined) this.bump = m.bump;
  }

  setMat(x: number, y: number, m: Partial<MaterialDefaults>): void {
    const i = this.idx(x, y);
    if (m.smooth !== undefined) this.smooth[i] = m.smooth;
    if (m.metal !== undefined) this.metal[i] = m.metal;
    if (m.emit !== undefined) this.emit[i] = m.emit;
    if (m.tint !== undefined) this.tint[i] = m.tint;
  }

  /** Derive height from luminance where not explicitly painted. */
  heightFromLuma(strength = 1): void {
    for (let i = 0; i < this.n * this.n; i++) {
      const l = (0.299 * this.rgba[i * 4]! + 0.587 * this.rgba[i * 4 + 1]! + 0.114 * this.rgba[i * 4 + 2]!) / 255;
      this.height[i] = 0.5 + (l - 0.5) * strength;
    }
  }

  // ---- drawing primitives (canonical space) --------------------------------------------------
  line(u0: number, v0: number, u1: number, v1: number, c: RGB | RGBA, width = 1): void {
    const steps = Math.ceil(Math.max(Math.abs(u1 - u0), Math.abs(v1 - v0)) * this.s * 2) + 1;
    const w = Math.max(1, Math.round(width * this.s));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.floor((u0 + (u1 - u0) * t) * this.s);
      const y = Math.floor((v0 + (v1 - v0) * t) * this.s);
      for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, c);
    }
  }

  disc(cu: number, cv: number, r: number, fn: (x: number, y: number, d: number) => void): void {
    const s = this.s;
    const x0 = Math.floor((cu - r) * s), x1 = Math.ceil((cu + r) * s);
    const y0 = Math.floor((cv - r) * s), y1 = Math.ceil((cv + r) * s);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const du = (x + 0.5) / s - cu, dv = (y + 0.5) / s - cv;
      const d = Math.sqrt(du * du + dv * dv) / r;
      if (d <= 1) fn(x, y, d);
    }
  }
}

/** Texture output bundle. */
export interface TextureData {
  name: string;
  size: number;
  rgba: Uint8ClampedArray;
  /** Normal (xy, 0..255), AO/height (z). */
  normal: Uint8ClampedArray;
  /** R smoothness, G metal, B emissive, A tint mask. */
  material: Uint8ClampedArray;
  frames: number;
}

/** Convert painter channels to output arrays (normal map from height gradients). */
export function finalize(p: Painter): { rgba: Uint8ClampedArray; normal: Uint8ClampedArray; material: Uint8ClampedArray } {
  const n = p.n;
  const normal = new Uint8ClampedArray(n * n * 4);
  const material = new Uint8ClampedArray(n * n * 4);
  const k = 2.0 * p.bump * p.s;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const hl = p.height[p.idx(x - 1, y)]!, hr = p.height[p.idx(x + 1, y)]!;
      const hu = p.height[p.idx(x, y - 1)]!, hd = p.height[p.idx(x, y + 1)]!;
      let nx = (hl - hr) * k, ny = (hu - hd) * k;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      normal[i * 4] = (nx * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = p.height[i]! * 255;
      normal[i * 4 + 3] = 255;
      material[i * 4] = p.smooth[i]! * 255;
      material[i * 4 + 1] = p.metal[i]! * 255;
      material[i * 4 + 2] = p.emit[i]! * 255;
      material[i * 4 + 3] = p.tint[i]! * 255;
    }
  }
  return { rgba: p.rgba, normal, material };
}
