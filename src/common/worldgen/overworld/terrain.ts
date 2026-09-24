/**
 * Overworld terrain: 3D density on a 4×8×4 cell grid (trilinear interpolation), caves
 * (cheese caverns with pillars, spaghetti tunnels, noodles, surface entrances), aquifers
 * (local water tables, sea-level flooding, deep lava), large ore veins, deepslate and bedrock.
 *
 * Noise is evaluated in batches so the WebAssembly SIMD kernel can take over when present.
 */
import { NoiseStack, NormalNoise, OctaveNoise } from '../../math/noise';
import { WorldSeed, hash4, subSeed } from '../../math/random';
import { S } from '../../block/registry';
import { Climate, Column, SEA_LEVEL, seededRandom, smooth } from './climate';

export const CELL_W = 4;
export const CELL_H = 8;
/** Deep caves below this level fill with lava. */
export const LAVA_LEVEL = -54;

const NONE = -1e9;

export interface TerrainBlocks {
  air: number; stone: number; deepslate: number; bedrock: number; water: number; lava: number;
  granite: number; tuff: number; copperOre: number; rawCopper: number; ironOre: number; deepIronOre: number; rawIron: number;
}

export function terrainBlocks(): TerrainBlocks {
  return {
    air: S('air'), stone: S('stone'), deepslate: S('deepslate'), bedrock: S('bedrock'), water: S('water'), lava: S('lava'),
    granite: S('granite'), tuff: S('tuff'), copperOre: S('copper_ore'), rawCopper: S('raw_copper_block'),
    ironOre: S('deepslate_iron_ore'), deepIronOre: S('deepslate_iron_ore'), rawIron: S('raw_iron_block'),
  };
}

export class TerrainNoises {
  readonly detail: NoiseStack;
  readonly jagged: NoiseStack;
  readonly cheese: NoiseStack;
  readonly pillar: NoiseStack;
  readonly pillarRarity: NoiseStack;
  readonly spagA: NoiseStack;
  readonly spagB: NoiseStack;
  readonly spagMod: NoiseStack;
  readonly noodleA: NoiseStack;
  readonly noodleB: NoiseStack;
  readonly noodleToggle: NoiseStack;
  readonly entrance: NoiseStack;
  readonly veinToggle: NoiseStack;
  readonly veinA: NoiseStack;
  readonly veinB: NoiseStack;
  readonly flood: NoiseStack;
  readonly spread: NoiseStack;
  readonly islands: NoiseStack;
  readonly seedA: number;

  constructor(seed: WorldSeed) {
    const r = (n: string) => seededRandom(seed, 'terrain/' + n);
    this.detail = new OctaveNoise(r('detail'), -6, [1, 0.6, 0.35, 0.2]);
    this.jagged = new OctaveNoise(r('jagged'), -4, [1, 0.5]);
    this.cheese = new NormalNoise(r('cheese'), -7, [0.6, 1, 0.8, 0.5]);
    this.pillar = new OctaveNoise(r('pillar'), -5, [1, 0.5]);
    this.pillarRarity = new OctaveNoise(r('pillar_rarity'), -8, [1]);
    this.spagA = new OctaveNoise(r('spaghetti_a'), -6, [1]);
    this.spagB = new OctaveNoise(r('spaghetti_b'), -6, [1]);
    this.spagMod = new OctaveNoise(r('spaghetti_mod'), -7, [1]);
    this.noodleA = new OctaveNoise(r('noodle_a'), -5, [1]);
    this.noodleB = new OctaveNoise(r('noodle_b'), -5, [1]);
    this.noodleToggle = new OctaveNoise(r('noodle_toggle'), -7, [1]);
    this.entrance = new OctaveNoise(r('entrance'), -7, [1, 0.5]);
    this.veinToggle = new OctaveNoise(r('vein_toggle'), -8, [1]);
    this.veinA = new OctaveNoise(r('vein_a'), -7, [1]);
    this.veinB = new OctaveNoise(r('vein_b'), -7, [1]);
    this.flood = new NormalNoise(r('aquifer_flood'), -7, [1]);
    this.spread = new OctaveNoise(r('aquifer_spread'), -6, [1]);
    this.islands = new OctaveNoise(r('islands'), -6, [1, 0.5, 0.25, 0.12]);
    this.seedA = subSeed(seed, 'terrain/hash');
  }
}

/** Reusable batch of sample points for one noise pass. */
class PointBatch {
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  idx: Int32Array;
  n = 0;
  constructor(cap: number) {
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
    this.zs = new Float64Array(cap);
    this.idx = new Int32Array(cap);
  }
  reset(): void {
    this.n = 0;
  }
  push(i: number, x: number, y: number, z: number): void {
    const k = this.n++;
    this.idx[k] = i; this.xs[k] = x; this.ys[k] = y; this.zs[k] = z;
  }
}

/** Per-chunk density evaluation and block fill. */
export class TerrainFiller {
  readonly minY: number;
  readonly height: number;
  readonly ny: number;
  /** Corner densities: final (with caves) and terrain-only, index (k*5 + j)*5 + i. */
  private readonly dFinal: Float64Array;
  private readonly dTerrain: Float64Array;
  private readonly vToggle: Float64Array;
  private readonly vRidge: Float64Array;
  private readonly batch: PointBatch;
  private readonly tmp: Float64Array;
  private readonly tmp2: Float64Array;
  private readonly tmp3: Float64Array;
  private readonly aquifer: Aquifer;
  /** Floating-islands mode: no continents, no sea, islands between y≈60 and y≈170. */
  floating = false;
  seaLevel = SEA_LEVEL;

  constructor(private readonly noises: TerrainNoises, private readonly climate: Climate, readonly blocks: TerrainBlocks, minY: number, height: number) {
    this.minY = minY;
    this.height = height;
    this.ny = height / CELL_H + 1;
    const corners = 25 * this.ny;
    this.dFinal = new Float64Array(corners);
    this.dTerrain = new Float64Array(corners);
    this.vToggle = new Float64Array(corners);
    this.vRidge = new Float64Array(corners);
    this.batch = new PointBatch(corners);
    this.tmp = new Float64Array(corners);
    this.tmp2 = new Float64Array(corners);
    this.tmp3 = new Float64Array(corners);
    this.aquifer = new Aquifer(noises, climate, blocks);
  }

  /**
   * Fill `out` (index ((y-minY)<<8)|(z<<4)|x) for chunk (cx, cz). `cols` is the 7×7 column grid
   * starting one cell outside the chunk (x = bx - 4 + 4i).
   */
  fill(cx: number, cz: number, cols: Column[], out: Uint16Array): void {
    const bx = cx << 4, bz = cz << 4;
    this.computeCorners(bx, bz, cols);
    this.aquifer.prepare(bx, bz, this.minY, this.height);
    this.interpolate(bx, bz, out);
  }

  private computeIslands(bx: number, bz: number): void {
    const { ny, minY, noises, batch, tmp, dFinal, dTerrain, vToggle, vRidge } = this;
    batch.reset();
    for (let k = 0; k < ny; k++) {
      const y = minY + k * CELL_H;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
        const ci = (k * 5 + j) * 5 + i;
        dTerrain[ci] = -10;
        vToggle[ci] = 0;
        vRidge[ci] = 1;
        if (y > 48 && y < 184) batch.push(ci, bx + i * 4, y * 1.6, bz + j * 4);
      }
    }
    noises.islands.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp);
    for (let q = 0; q < batch.n; q++) {
      const y = batch.ys[q]! / 1.6;
      const v = (y - 112) / 58;
      const profile = 1 - v * v;
      dTerrain[batch.idx[q]!] = tmp[q]! * 4 + profile * 1.6 - 1.7;
    }
    dFinal.set(dTerrain);
  }

  private computeCorners(bx: number, bz: number, cols: Column[]): void {
    if (this.floating) {
      this.computeIslands(bx, bz);
      return;
    }
    const { ny, minY, noises, batch, tmp, tmp2, tmp3, dFinal, dTerrain, vToggle, vRidge } = this;
    const maxY = minY + this.height;
    // Jagged peaks: 2D noise per corner column.
    const jag = new Float64Array(25);
    batch.reset();
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) batch.push(j * 5 + i, bx + i * 4, 0, bz + j * 4);
    noises.jagged.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp);
    for (let k = 0; k < 25; k++) jag[k] = tmp[k]!;
    const entrance = new Float64Array(25);
    noises.entrance.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp);
    for (let k = 0; k < 25; k++) entrance[k] = tmp[k]!;
    const heights = new Float64Array(25);
    const scales = new Float64Array(25);

    // Pass 1: terrain slope density; detail noise only in the band around the surface.
    batch.reset();
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        const col = cols[(j + 1) * 7 + (i + 1)]!;
        const c = j * 5 + i;
        const jn = jag[c]!;
        const h = col.height + col.jag * (Math.abs(jn) * 2.2 - 0.45);
        heights[c] = h;
        scales[c] = col.scale;
        for (let k = 0; k < ny; k++) {
          const y = minY + k * CELL_H;
          let t = (h - y) / col.scale;
          if (y > maxY - 40) t -= (y - (maxY - 40)) / 6;
          if (y < minY + 8) t += (minY + 8 - y) / 2;
          const ci = (k * 5 + j) * 5 + i;
          dTerrain[ci] = t;
          if (t > -4 && t < 4) batch.push(ci, bx + i * 4, y, bz + j * 4);
        }
      }
    }
    noises.detail.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp);
    for (let q = 0; q < batch.n; q++) dTerrain[batch.idx[q]!] = dTerrain[batch.idx[q]!]! + tmp[q]! * 1.8;
    dFinal.set(dTerrain);

    // Pass 2: caves in solid ground.
    batch.reset();
    for (let k = 0; k < ny; k++) {
      const y = minY + k * CELL_H;
      if (y <= minY) continue;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
        const ci = (k * 5 + j) * 5 + i;
        if (dTerrain[ci]! > -0.3 && y < heights[j * 5 + i]! + 6) batch.push(ci, bx + i * 4, y, bz + j * 4);
      }
    }
    const n = batch.n;
    const cheese = new Float64Array(n), pillar = new Float64Array(n), rarity = new Float64Array(n);
    const sa = new Float64Array(n), sb = new Float64Array(n), sm = new Float64Array(n);
    const ys16 = new Float64Array(n);
    for (let q = 0; q < n; q++) ys16[q] = batch.ys[q]! * 1.6;
    noises.cheese.sampleBatch(batch.xs, ys16, batch.zs, n, cheese);
    noises.pillar.sampleBatch(batch.xs, batch.ys, batch.zs, n, pillar);
    noises.pillarRarity.sampleBatch(batch.xs, batch.ys, batch.zs, n, rarity);
    noises.spagA.sampleBatch(batch.xs, batch.ys, batch.zs, n, sa);
    noises.spagB.sampleBatch(batch.xs, batch.ys, batch.zs, n, sb);
    noises.spagMod.sampleBatch(batch.xs, batch.ys, batch.zs, n, sm);
    noises.noodleToggle.sampleBatch(batch.xs, batch.ys, batch.zs, n, tmp);
    // Noodles only where toggled on (sub-batch).
    const nb = new PointBatch(n);
    for (let q = 0; q < n; q++) {
      const y = batch.ys[q]!;
      if (tmp[q]! > -0.15 && y > -60 && y < 130) nb.push(q, batch.xs[q]!, y, batch.zs[q]!);
    }
    noises.noodleA.sampleBatch(nb.xs, nb.ys, nb.zs, nb.n, tmp2);
    noises.noodleB.sampleBatch(nb.xs, nb.ys, nb.zs, nb.n, tmp3);
    const noodle = new Float64Array(n).fill(1e9);
    for (let q = 0; q < nb.n; q++) noodle[nb.idx[q]!] = (Math.max(Math.abs(tmp2[q]!), Math.abs(tmp3[q]!)) - 0.045) * 20;

    for (let q = 0; q < n; q++) {
      const ci = batch.idx[q]!;
      const i = ci % 5, j = Math.floor(ci / 5) % 5;
      const y = batch.ys[q]!;
      const depth = heights[j * 5 + i]! - y;
      const thr = -0.64 + 0.16 * smooth(4, 40, depth);
      let cave = (cheese[q]! - thr) * 3;
      if (rarity[q]! > 0.15 && pillar[q]! > 0.42) cave = Math.max(cave, (pillar[q]! - 0.42) * 10);
      const thick = 0.064 + 0.024 * sm[q]!;
      const spag = (Math.max(Math.abs(sa[q]!), Math.abs(sb[q]!)) - thick) * 14;
      if (spag < cave) cave = spag;
      if (noodle[q]! < cave) cave = noodle[q]!;
      if (depth < 14) {
        const open = entrance[j * 5 + i]! > 0.3;
        if (!open) cave += (14 - depth) * 0.4;
        else cave += Math.max(0, 6 - depth) * 0.1;
      }
      if (cave < dFinal[ci]!) dFinal[ci] = cave;
    }

    // Pass 3: ore vein fields (deep ground only).
    batch.reset();
    for (let k = 0; k < ny; k++) {
      const y = minY + k * CELL_H;
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
        const ci = (k * 5 + j) * 5 + i;
        vToggle[ci] = 0;
        vRidge[ci] = 1;
        if (y <= 56) batch.push(ci, bx + i * 4, y, bz + j * 4);
      }
    }
    noises.veinToggle.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp);
    noises.veinA.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp2);
    noises.veinB.sampleBatch(batch.xs, batch.ys, batch.zs, batch.n, tmp3);
    for (let q = 0; q < batch.n; q++) {
      const ci = batch.idx[q]!;
      vToggle[ci] = tmp[q]!;
      vRidge[ci] = Math.max(Math.abs(tmp2[q]!), Math.abs(tmp3[q]!)) - 0.08;
    }
  }

  private interpolate(bx: number, bz: number, out: Uint16Array): void {
    const { ny, minY, blocks: B, dFinal, dTerrain, vToggle, vRidge, aquifer, seaLevel } = this;
    const seedA = this.noises.seedA;
    out.fill(B.air);
    for (let k = 0; k < ny - 1; k++) {
      const y0 = minY + k * CELL_H;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const c000 = (k * 5 + j) * 5 + i, c100 = c000 + 1, c010 = c000 + 5, c110 = c000 + 6;
          const c001 = c000 + 25, c101 = c001 + 1, c011 = c001 + 5, c111 = c001 + 6;
          const f000 = dFinal[c000]!, f100 = dFinal[c100]!, f010 = dFinal[c010]!, f110 = dFinal[c110]!;
          const f001 = dFinal[c001]!, f101 = dFinal[c101]!, f011 = dFinal[c011]!, f111 = dFinal[c111]!;
          const t000 = dTerrain[c000]!, t100 = dTerrain[c100]!, t010 = dTerrain[c010]!, t110 = dTerrain[c110]!;
          const t001 = dTerrain[c001]!, t101 = dTerrain[c101]!, t011 = dTerrain[c011]!, t111 = dTerrain[c111]!;
          const maxF = Math.max(f000, f100, f010, f110, f001, f101, f011, f111);
          const minF = Math.min(f000, f100, f010, f110, f001, f101, f011, f111);
          const maxT = Math.max(t000, t100, t010, t110, t001, t101, t011, t111);
          // Fully open sky above the sea: nothing to write.
          if (maxF <= 0 && maxT <= 0 && y0 >= seaLevel) continue;
          const veins = y0 <= 56;
          const v000 = vToggle[c000]!, v100 = vToggle[c100]!, v010 = vToggle[c010]!, v110 = vToggle[c110]!;
          const v001 = vToggle[c001]!, v101 = vToggle[c101]!, v011 = vToggle[c011]!, v111 = vToggle[c111]!;
          const r000 = vRidge[c000]!, r100 = vRidge[c100]!, r010 = vRidge[c010]!, r110 = vRidge[c110]!;
          const r001 = vRidge[c001]!, r101 = vRidge[c101]!, r011 = vRidge[c011]!, r111 = vRidge[c111]!;
          for (let dy = 0; dy < CELL_H; dy++) {
            const y = y0 + dy;
            const ty = dy / CELL_H;
            const rowBase = (y - minY) << 8;
            for (let dz = 0; dz < CELL_W; dz++) {
              const tz = dz / CELL_W;
              const z = j * 4 + dz;
              // interpolate along y then z; x innermost
              const fa0 = lerp3(ty, f000, f001), fb0 = lerp3(ty, f010, f011);
              const fa1 = lerp3(ty, f100, f101), fb1 = lerp3(ty, f110, f111);
              const fz0 = lerp3(tz, fa0, fb0), fz1 = lerp3(tz, fa1, fb1);
              for (let dx = 0; dx < CELL_W; dx++) {
                const tx = dx / CELL_W;
                const x = i * 4 + dx;
                const d = minF > 0 ? 1 : lerp3(tx, fz0, fz1);
                let st: number;
                if (d > 0) {
                  st = this.solidAt(bx + x, y, bz + z, seedA);
                  if (veins) {
                    const tv = tri(tx, ty, tz, v000, v100, v010, v110, v001, v101, v011, v111);
                    const av = tv < 0 ? -tv : tv;
                    if (av > 0.4) {
                      const copper = tv > 0;
                      if (copper ? y >= 0 && y <= 50 : y >= -60 && y <= -8) {
                        const edge = copper ? Math.min(y, 50 - y) : Math.min(y + 60, -8 - y);
                        if (edge > 4 || av - 0.4 > (4 - edge) * 0.05) {
                          const rv = tri(tx, ty, tz, r000, r100, r010, r110, r001, r101, r011, r111);
                          const h = hash4(seedA, bx + x, y, bz + z) & 1023;
                          if (rv < 0) {
                            if (h < 20) st = copper ? B.rawCopper : B.rawIron;
                            else if (h < 400) st = copper ? B.copperOre : B.ironOre;
                            else st = copper ? B.granite : B.tuff;
                          } else if (av > 0.55 && h < 700) {
                            st = copper ? B.granite : B.tuff;
                          }
                        }
                      }
                    }
                  }
                } else {
                  const dt = maxT <= 0 ? -1 : tri(tx, ty, tz, t000, t100, t010, t110, t001, t101, t011, t111);
                  if (dt <= 0) st = y < seaLevel ? B.water : B.air;
                  else st = aquifer.at(bx + x, y, bz + z);
                }
                if (st !== B.air) out[rowBase | (z << 4) | x] = st;
              }
            }
          }
        }
      }
    }
    // Top cell layer (y = maxY-1 ... ) is always air after the top slide.
  }

  private solidAt(x: number, y: number, z: number, seedA: number): number {
    const B = this.blocks;
    const minY = this.minY;
    if (y < minY + 5) {
      if (y === minY) return B.bedrock;
      if ((hash4(seedA ^ 0x5bd1e995, x, y, z) & 255) < ((minY + 5 - y) * 256) / 5) return B.bedrock;
    }
    if (y < 0) return B.deepslate;
    if (y < 8 && (hash4(seedA ^ 0x1b873593, x, y, z) & 255) < ((8 - y) * 256) / 8) return B.deepslate;
    return B.stone;
  }
}

function lerp3(t: number, a: number, b: number): number {
  return a + (b - a) * t;
}

function tri(tx: number, ty: number, tz: number, v000: number, v100: number, v010: number, v110: number, v001: number, v101: number, v011: number, v111: number): number {
  const a0 = v000 + (v001 - v000) * ty, a1 = v100 + (v101 - v100) * ty;
  const b0 = v010 + (v011 - v010) * ty, b1 = v110 + (v111 - v110) * ty;
  const z0 = a0 + (b0 - a0) * tz, z1 = a1 + (b1 - a1) * tz;
  return z0 + (z1 - z0) * tx;
}

// ---------------------------------------------------------------------------------------------
// Aquifers
// ---------------------------------------------------------------------------------------------

const AQ_W = 16;
const AQ_H = 12;

/**
 * Cave fluids. Space is split into jittered 16×12×16 cells; each cell has a fluid level
 * (sea level near oceans, a local water table, lava at the bottom of the world or none).
 * Where two neighbouring cells disagree a stone barrier separates them.
 */
export class Aquifer {
  private gx0 = 0;
  private gy0 = 0;
  private gz0 = 0;
  private nx = 0;
  private ny = 0;
  private nz = 0;
  private cx = new Int32Array(0);
  private cy = new Int32Array(0);
  private cz = new Int32Array(0);
  private level = new Float64Array(0);
  private lava = new Uint8Array(0);
  private ready = new Uint8Array(0);
  private readonly colCache = new Map<number, number>();

  constructor(private readonly noises: TerrainNoises, private readonly climate: Climate, private readonly blocks: TerrainBlocks) {}

  prepare(bx: number, bz: number, minY: number, height: number): void {
    this.gx0 = Math.floor((bx - 16) / AQ_W);
    this.gz0 = Math.floor((bz - 16) / AQ_W);
    this.gy0 = Math.floor((minY - 12) / AQ_H);
    this.nx = Math.floor((bx + 32) / AQ_W) - this.gx0 + 1;
    this.nz = Math.floor((bz + 32) / AQ_W) - this.gz0 + 1;
    this.ny = Math.floor((minY + height + 12) / AQ_H) - this.gy0 + 1;
    const n = this.nx * this.ny * this.nz;
    if (this.ready.length < n) {
      this.cx = new Int32Array(n); this.cy = new Int32Array(n); this.cz = new Int32Array(n);
      this.level = new Float64Array(n); this.lava = new Uint8Array(n); this.ready = new Uint8Array(n);
    } else {
      this.ready.fill(0);
    }
    if (this.colCache.size > 4096) this.colCache.clear();
  }

  private surfaceAt(x: number, z: number): number {
    const key = (x >> 2) * 65536 + (z >> 2);
    let h = this.colCache.get(key);
    if (h === undefined) {
      h = this.climate.column(x, z).height;
      this.colCache.set(key, h);
    }
    return h;
  }

  private cell(gx: number, gy: number, gz: number): number {
    const i = ((gy - this.gy0) * this.nz + (gz - this.gz0)) * this.nx + (gx - this.gx0);
    if (this.ready[i]) return i;
    this.ready[i] = 1;
    const h = hash4(this.noises.seedA ^ 0x2545f491, gx, gy, gz);
    const x = gx * AQ_W + 2 + (h & 15) % 12;
    const y = gy * AQ_H + 1 + ((h >>> 4) & 15) % 10;
    const z = gz * AQ_W + 2 + ((h >>> 8) & 15) % 12;
    this.cx[i] = x; this.cy[i] = y; this.cz[i] = z;
    const surf = this.surfaceAt(x, z);
    let level = NONE, lava = 0;
    if (y > surf - 12) {
      level = surf < SEA_LEVEL - 1 ? SEA_LEVEL : NONE;
    } else if (y < LAVA_LEVEL + 14) {
      level = LAVA_LEVEL;
      lava = 1;
    } else {
      const f = this.noises.flood.sample(x, y * 0.67, z);
      if (f > 0.2) {
        const spread = this.noises.spread.sample(x / 1.5, y, z / 1.5);
        level = Math.min(Math.floor(y + 3 + spread * 10), Math.floor(surf - 10));
        if (level < LAVA_LEVEL + 2) lava = 1;
      } else if (surf < SEA_LEVEL - 1 && f > -0.25 && y > surf - 40) {
        level = SEA_LEVEL;
      }
    }
    this.level[i] = level;
    this.lava[i] = lava;
    return i;
  }

  /** Block for a cave position (density ≤ 0 below the terrain surface). */
  at(x: number, y: number, z: number): number {
    const B = this.blocks;
    const gxa = Math.floor((x - 8) / AQ_W), gya = Math.floor((y - 6) / AQ_H), gza = Math.floor((z - 8) / AQ_W);
    let d1 = Infinity, d2 = Infinity, i1 = -1, i2 = -1;
    for (let gy = gya - 1; gy <= gya + 1; gy++) {
      for (let gz = gza; gz <= gza + 1; gz++) {
        for (let gx = gxa; gx <= gxa + 1; gx++) {
          const i = this.cell(gx, gy, gz);
          const dx = this.cx[i]! - x, dy = this.cy[i]! - y, dz = this.cz[i]! - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; } else if (d < d2) { d2 = d; i2 = i; }
        }
      }
    }
    const l1 = this.level[i1]!;
    const l2 = i2 >= 0 ? this.level[i2]! : l1;
    if (l1 !== l2 && Math.sqrt(d2) - Math.sqrt(d1) < 3 && (y < l1 || y < l2)) return B.stone;
    if (y < l1) return this.lava[i1] ? B.lava : B.water;
    return B.air;
  }
}
