/**
 * Texture array builder. Produces albedo / normal / material layer stacks (with CPU mipmaps)
 * for every block texture. Animated textures occupy consecutive layers; the encoded layer id
 * packs (frames - 1) in the top 4 bits.
 */
import { Painter, finalize } from './painter';
import { paintBlockTexture, ANIMATED } from './blocktex';

export interface AtlasData {
  size: number;
  layers: number;
  mips: number;
  /** Per mip level, concatenated layers (RGBA8). */
  albedo: Uint8Array[];
  normal: Uint8Array[];
  material: Uint8Array[];
  /** name → encoded layer (layer | (frames-1) << 12). */
  index: Record<string, number>;
  /** Names that had no recipe (rendered as magenta checker). */
  missing: string[];
}

export function encodeLayer(layer: number, frames: number): number {
  return (layer & 0xfff) | (((frames - 1) & 15) << 12);
}

function missingTexture(p: Painter): void {
  p.each((x, y, u, v) => {
    const c = (Math.floor(u / 8) + Math.floor(v / 8)) % 2 ? [248, 0, 248] : [0, 0, 0];
    p.set(x, y, [c[0]!, c[1]!, c[2]!, 255]);
  });
}

/** Alpha-coverage-preserving box downsample. */
function downsample(src: Uint8Array, size: number, layers: number, alphaAware: boolean): Uint8Array {
  const ns = Math.max(1, size >> 1);
  const out = new Uint8Array(ns * ns * 4 * layers);
  for (let l = 0; l < layers; l++) {
    const so = l * size * size * 4, doff = l * ns * ns * 4;
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        let r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(size - 1, x * 2 + dx), sy = Math.min(size - 1, y * 2 + dy);
          const i = so + (sy * size + sx) * 4;
          const w = alphaAware ? src[i + 3]! / 255 : 1;
          r += src[i]! * w; g += src[i + 1]! * w; b += src[i + 2]! * w;
          a += src[i + 3]!;
          wsum += w;
        }
        const o = doff + (y * ns + x) * 4;
        if (wsum > 0) {
          out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum;
        }
        // keep cutout coverage: max-ish alpha to avoid foliage thinning at distance
        const avgA = a / 4;
        out[o + 3] = alphaAware ? Math.min(255, avgA * 1.15) : avgA;
      }
    }
  }
  return out;
}

export interface BuildProgress {
  (done: number, total: number): void;
}

export function buildAtlas(names: string[], size: number, progress?: BuildProgress): AtlasData {
  const list = [...new Set(names)].sort();
  // Assign layers
  const index: Record<string, number> = {};
  let layer = 0;
  const plan: Array<{ name: string; first: number; frames: number }> = [];
  for (const n of list) {
    const frames = Math.min(16, ANIMATED[n] ?? 1);
    plan.push({ name: n, first: layer, frames });
    index[n] = encodeLayer(layer, frames);
    layer += frames;
  }
  const layers = layer;
  const px = size * size * 4;
  const albedo0 = new Uint8Array(px * layers);
  const normal0 = new Uint8Array(px * layers);
  const material0 = new Uint8Array(px * layers);
  const missing: string[] = [];
  let done = 0;
  for (const item of plan) {
    for (let f = 0; f < item.frames; f++) {
      const p = new Painter(size, item.name, f);
      if (!paintBlockTexture(p, item.name)) {
        if (f === 0) missing.push(item.name);
        missingTexture(p);
      }
      const out = finalize(p);
      const o = (item.first + f) * px;
      albedo0.set(out.rgba, o);
      normal0.set(out.normal, o);
      material0.set(out.material, o);
    }
    done++;
    if (progress && done % 32 === 0) progress(done, plan.length);
  }
  const albedo = [albedo0], normal = [normal0], material = [material0];
  let s = size;
  while (s > 1) {
    albedo.push(downsample(albedo[albedo.length - 1]!, s, layers, true));
    normal.push(downsample(normal[normal.length - 1]!, s, layers, false));
    material.push(downsample(material[material.length - 1]!, s, layers, false));
    s >>= 1;
  }
  return { size, layers, mips: albedo.length, albedo, normal, material, index, missing };
}

/** GPU-side layout: when the device cannot hold one tile per array layer, tiles are packed in grid×grid pages. */
export interface PackedAtlas {
  /** Tiles per page edge (1 = one tile per layer). */
  grid: number;
  pages: number;
  pageSize: number;
  mips: number;
  albedo: Uint8Array[];
  normal: Uint8Array[];
  material: Uint8Array[];
}

export function packAtlas(a: AtlasData, maxLayers: number, maxSize: number): PackedAtlas {
  let grid = 1;
  while (Math.ceil(a.layers / (grid * grid)) > maxLayers && a.size * grid * 2 <= maxSize) grid *= 2;
  if (grid === 1) return { grid, pages: a.layers, pageSize: a.size, mips: a.mips, albedo: a.albedo, normal: a.normal, material: a.material };
  const tpp = grid * grid;
  const pages = Math.ceil(a.layers / tpp);
  const pack = (levels: Uint8Array[]) => levels.map((src, m) => {
    const ts = Math.max(1, a.size >> m);
    const ps = ts * grid;
    const out = new Uint8Array(ps * ps * 4 * pages);
    for (let l = 0; l < a.layers; l++) {
      const page = Math.floor(l / tpp), t = l % tpp;
      const ox = (t % grid) * ts, oy = Math.floor(t / grid) * ts;
      for (let y = 0; y < ts; y++) {
        const so = (l * ts * ts + y * ts) * 4;
        out.set(src.subarray(so, so + ts * 4), ((page * ps + oy + y) * ps + ox) * 4);
      }
    }
    return out;
  });
  return { grid, pages, pageSize: a.size * grid, mips: a.mips, albedo: pack(a.albedo), normal: pack(a.normal), material: pack(a.material) };
}
