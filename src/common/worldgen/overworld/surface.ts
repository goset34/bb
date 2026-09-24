/**
 * Surface rules: replace the top layers of stone with biome materials (grass, sand, snow,
 * terracotta bands…), ocean and river floors, steep rocky slopes and badlands hoodoos.
 */
import { NoiseStack, OctaveNoise } from '../../math/noise';
import { Random, WorldSeed, hash4, subSeed } from '../../math/random';
import { S, stateFlags, F } from '../../block/registry';
import { BIOMES } from '../biomes';
import { SEA_LEVEL, seededRandom } from './climate';

const BAND_COLORS = ['orange', 'yellow', 'brown', 'red', 'white', 'light_gray'] as const;

interface SurfaceBlocks {
  air: number; stone: number; deepslate: number; water: number; grass: number; dirt: number; coarse: number; podzol: number;
  mycelium: number; mud: number; sand: number; redSand: number; sandstone: number; redSandstone: number; gravel: number;
  clay: number; snowBlock: number; powderSnow: number; packedIce: number; calcite: number; terracotta: number;
  bands: number[];
}

export class SurfaceBuilder {
  private readonly depthNoise: NoiseStack;
  private readonly patchNoise: NoiseStack;
  private readonly bandOffset: NoiseStack;
  private readonly hoodoo: NoiseStack;
  private readonly hoodooRoof: NoiseStack;
  private readonly B: SurfaceBlocks;
  private readonly seedA: number;
  private readonly bandPattern: Uint8Array;
  private readonly name: string[];

  constructor(seed: WorldSeed, readonly minY: number, readonly height: number) {
    const r = (n: string) => seededRandom(seed, 'surface/' + n);
    this.depthNoise = new OctaveNoise(r('depth'), -5, [1, 0.5, 0.25]);
    this.patchNoise = new OctaveNoise(r('patch'), -4, [1, 0.5]);
    this.bandOffset = new OctaveNoise(r('bands'), -9, [1]);
    this.hoodoo = new OctaveNoise(r('hoodoo'), -4, [1, 0.5, 0.25]);
    this.hoodooRoof = new OctaveNoise(r('hoodoo_roof'), -6, [1]);
    this.seedA = subSeed(seed, 'surface/hash');
    const bands = BAND_COLORS.map((c) => S(`${c}_terracotta`));
    this.B = {
      air: S('air'), stone: S('stone'), deepslate: S('deepslate'), water: S('water'), grass: S('grass_block'), dirt: S('dirt'),
      coarse: S('coarse_dirt'), podzol: S('podzol'), mycelium: S('mycelium'), mud: S('mud'), sand: S('sand'), redSand: S('red_sand'),
      sandstone: S('sandstone'), redSandstone: S('red_sandstone'), gravel: S('gravel'), clay: S('clay'), snowBlock: S('snow_block'),
      powderSnow: S('powder_snow'), packedIce: S('packed_ice'), calcite: S('calcite'), terracotta: S('terracotta'), bands,
    };
    this.bandPattern = makeBands(seededRandom(seed, 'surface/band_pattern'));
    this.name = BIOMES.map((b) => b.name);
  }

  private band(x: number, y: number, z: number): number {
    const off = Math.round(this.bandOffset.sample(x, 0, z) * 4);
    const v = this.bandPattern[(((y + off + 64) % 192) + 192) % 192]!;
    return v === 255 ? this.B.terracotta : this.B.bands[v]!;
  }

  /**
   * Apply rules to the chunk array `blocks` (index ((y-minY)<<8)|(z<<4)|x). `biomeAt(x, y, z)`
   * returns the biome id at local coordinates.
   */
  build(cx: number, cz: number, blocks: Uint16Array, biomeAt: (x: number, y: number, z: number) => number): void {
    const { minY, B } = this;
    const maxY = minY + this.height;
    const bx = cx << 4, bz = cz << 4;
    // Surface heights (first solid block from the top, ignoring water) for slope detection.
    const top = new Int32Array(256);
    const waterTop = new Int32Array(256);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let y = maxY - 1;
        let wt = minY - 1;
        for (; y >= minY; y--) {
          const st = blocks[((y - minY) << 8) | (z << 4) | x]!;
          if (st === B.air) continue;
          if (st === B.water) { if (wt < minY) wt = y; continue; }
          if (stateFlags[st]! & F.FLUID_BLOCK) { if (wt < minY) wt = y; continue; }
          break;
        }
        top[z * 16 + x] = y;
        waterTop[z * 16 + x] = wt;
      }
    }
    const xs = new Float64Array(256), zs = new Float64Array(256), ys = new Float64Array(256);
    for (let i = 0; i < 256; i++) { xs[i] = bx + (i & 15); zs[i] = bz + (i >> 4); }
    const depthN = new Float64Array(256), patchN = new Float64Array(256);
    this.depthNoise.sampleBatch(xs, ys, zs, 256, depthN);
    this.patchNoise.sampleBatch(xs, ys, zs, 256, patchN);

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const ci = z * 16 + x;
        const surf = top[ci]!;
        if (surf < minY) continue;
        const wx = bx + x, wz = bz + z;
        const h = top[ci]!;
        const hx0 = x > 0 ? top[ci - 1]! : h, hx1 = x < 15 ? top[ci + 1]! : h;
        const hz0 = z > 0 ? top[ci - 16]! : h, hz1 = z < 15 ? top[ci + 16]! : h;
        const slope = Math.max(Math.abs(hx1 - hx0) / (x > 0 && x < 15 ? 2 : 1), Math.abs(hz1 - hz0) / (z > 0 && z < 15 ? 2 : 1));
        const steep = slope >= 2.5;
        const biome = biomeAt(x, surf, z);
        const name = this.name[biome]!;
        const underwater = waterTop[ci]! >= minY;
        const noise = depthN[ci]!;
        const patch = patchN[ci]!;
        const rnd = hash4(this.seedA, wx, surf, wz) & 255;
        const depth = 3 + Math.floor((noise + 1) * 1.5 + rnd / 256);
        const set = (y: number, st: number) => { blocks[((y - minY) << 8) | (z << 4) | x] = st; };
        const get = (y: number) => blocks[((y - minY) << 8) | (z << 4) | x]!;
        const fillDown = (from: number, n: number, st: number) => {
          for (let y = from, k = 0; k < n && y >= minY; y--, k++) {
            const cur = get(y);
            if (cur !== B.stone && cur !== B.deepslate) return y;
            set(y, st);
          }
          return from - n;
        };

        if (name.includes('badlands')) {
          this.badlandsColumn(wx, wz, surf, name, underwater, patch, get, set);
          continue;
        }
        let topSt: number, under: number, underDepth = depth, deep = -1, deepDepth = 0;
        if (underwater) {
          const d = waterTop[ci]! - surf;
          switch (true) {
            case name === 'warm_ocean' || name === 'lukewarm_ocean' || name === 'deep_lukewarm_ocean' || name === 'beach' || name === 'desert':
              topSt = B.sand; under = B.sand; deep = B.sandstone; deepDepth = 3; break;
            case name === 'mangrove_swamp': topSt = B.mud; under = B.mud; break;
            case name === 'swamp': topSt = patch > 0.2 ? B.clay : B.dirt; under = B.dirt; break;
            case name === 'river' || name === 'frozen_river':
              topSt = patch > 0.35 ? B.clay : patch < -0.25 ? B.gravel : B.sand; under = topSt === B.clay ? B.clay : B.dirt; underDepth = 2; break;
            case name.includes('frozen') || name.includes('cold') || d > 24:
              topSt = patch > 0.25 ? B.sand : B.gravel; under = topSt; break;
            case name === 'mushroom_fields': topSt = B.dirt; under = B.dirt; break;
            default:
              topSt = patch > 0.45 ? B.clay : patch < -0.2 ? B.gravel : B.sand; under = topSt === B.clay ? B.clay : topSt;
          }
          set(surf, topSt);
          let y = fillDown(surf - 1, underDepth, under);
          if (deep >= 0) fillDown(y, deepDepth, deep);
          continue;
        }

        topSt = B.grass; under = B.dirt;
        switch (name) {
          case 'desert':
            topSt = B.sand; under = B.sand; deep = B.sandstone; deepDepth = 3 + (rnd & 3); break;
          case 'beach': case 'snowy_beach':
            topSt = B.sand; under = B.sand; deep = B.sandstone; deepDepth = 2; break;
          case 'stony_shore':
            topSt = patch > 0.4 ? B.gravel : B.stone; under = B.stone; break;
          case 'mushroom_fields':
            topSt = B.mycelium; break;
          case 'mangrove_swamp':
            topSt = B.mud; under = B.mud; break;
          case 'old_growth_pine_taiga': case 'old_growth_spruce_taiga':
            topSt = patch > 0.35 ? B.coarse : patch > -0.05 ? B.podzol : B.grass; break;
          case 'windswept_gravelly_hills':
            if (patch > 0.1 || steep) { topSt = B.gravel; under = B.gravel; }
            break;
          case 'windswept_hills': case 'windswept_forest':
            if (steep || patch > 0.55) { topSt = B.stone; under = B.stone; }
            break;
          case 'windswept_savanna':
            topSt = patch > 0.3 ? B.stone : patch > 0.05 ? B.coarse : B.grass; if (topSt === B.stone) under = B.stone; break;
          case 'savanna_plateau': case 'savanna':
            if (patch > 0.55) topSt = B.coarse;
            break;
          case 'ice_spikes':
            topSt = B.snowBlock; break;
          case 'snowy_slopes':
            topSt = steep ? B.stone : patch > 0.4 ? B.powderSnow : B.snowBlock; under = steep ? B.stone : B.snowBlock; underDepth = 2; break;
          case 'grove':
            topSt = patch > 0.45 ? B.powderSnow : B.snowBlock; under = B.dirt; break;
          case 'jagged_peaks':
            topSt = steep ? B.stone : B.snowBlock; under = steep ? B.stone : B.snowBlock; underDepth = 2; break;
          case 'frozen_peaks':
            topSt = steep ? B.packedIce : patch > 0.2 ? B.packedIce : B.snowBlock; under = topSt; underDepth = 2; break;
          case 'stony_peaks': {
            const calciteBand = Math.abs(Math.sin((surf + patch * 8) * 0.35)) > 0.85;
            topSt = calciteBand ? B.calcite : B.stone; under = topSt; break;
          }
          case 'dripstone_caves': case 'lush_caves': case 'deep_dark':
            break;
          default:
            if (steep && slope >= 4 && surf > 90) { topSt = B.stone; under = B.stone; }
        }
        // Frozen/snowy summits above the tree line in cold uplands.
        if (surf > 200 && topSt === B.grass) { topSt = B.snowBlock; under = B.snowBlock; underDepth = 1; }
        set(surf, topSt);
        const y = fillDown(surf - 1, underDepth, under);
        if (deep >= 0) fillDown(y, deepDepth, deep);
      }
    }
  }

  private badlandsColumn(
    wx: number, wz: number, surf: number, name: string, underwater: boolean, patch: number,
    get: (y: number) => number, set: (y: number, st: number) => void,
  ): void {
    const { B, minY } = this;
    let top = surf;
    if (name === 'eroded_badlands' && !underwater && surf >= SEA_LEVEL) {
      const hn = Math.abs(this.hoodoo.sample(wx, 0, wz) * 8.25);
      const roof = Math.abs(this.hoodooRoof.sample(wx * 0.9765625, 0, wz * 0.9765625) * 15);
      const extra = Math.min(hn * hn * 1.2, roof * 2.4);
      const add = Math.floor(extra);
      for (let k = 1; k <= add && surf + k < minY + this.height; k++) set(surf + k, this.band(wx, surf + k, wz));
      top = surf + add;
    }
    for (let y = top, k = 0; y >= Math.max(minY, top - 48); y--, k++) {
      const cur = get(y);
      if (cur !== B.stone && y !== top && k > 0 && cur !== B.deepslate) {
        if (cur === B.air || cur === B.water) continue;
        break;
      }
      if (k === 0 && !underwater && y < 82 && top === surf) set(y, name === 'wooded_badlands' && y > 76 ? B.coarse : B.redSand);
      else if (k === 0 && name === 'wooded_badlands' && y >= 82) set(y, patch > 0.1 ? B.coarse : B.grass);
      else if (k === 1 && !underwater && top === surf && y < 81) set(y, B.redSandstone);
      else set(y, this.band(wx, y, wz));
    }
  }
}

/** Terracotta band pattern (192 entries, 255 = plain terracotta). */
function makeBands(r: Random): Uint8Array {
  const out = new Uint8Array(192).fill(255);
  for (let i = 0; i < 192; i++) {
    i += r.nextInt(5) + 1;
    if (i < 192) out[i] = 0; // orange
  }
  const stripe = (count: number, color: number, width: number) => {
    for (let n = 0; n < count; n++) {
      const w = r.nextInt(width) + 1;
      const start = r.nextInt(192);
      for (let k = 0; k < w && start + k < 192; k++) out[start + k] = color;
    }
  };
  stripe(r.nextInt(4) + 2, 1, 3); // yellow
  stripe(r.nextInt(4) + 2, 2, 3); // brown
  stripe(r.nextInt(4) + 2, 3, 3); // red
  // white bands with light gray fringes
  const whites = r.nextInt(3) + 3;
  let pos = 0;
  for (let n = 0; n < whites; n++) {
    pos += r.nextInt(16) + 4;
    if (pos >= 192) break;
    out[pos] = 4;
    if (pos > 1 && r.nextBool()) out[pos - 1] = 5;
    if (pos < 191 && r.nextBool()) out[pos + 1] = 5;
  }
  return out;
}
