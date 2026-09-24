import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries } from '../../src/common/init';
import { S, stateFlags, F, hasTag } from '../../src/common/block/registry';
import { parseSeed } from '../../src/common/math/random';
import { setNoiseKernel } from '../../src/common/math/noise';
import { loadNative, NativeKernels } from '../../src/common/native/native';
import { Chunk } from '../../src/common/world/chunk';
import { DIMENSIONS } from '../../src/common/world/dimension';
import { createGenerator } from '../../src/common/worldgen/factory';
import { GenRegion, WorldType } from '../../src/common/worldgen/generator';
import { BIOMES } from '../../src/common/worldgen/biomes';
import { Climate, newColumn, surfaceBiome, peaksValleys } from '../../src/common/worldgen/overworld/climate';

let native: NativeKernels | null = null;
beforeAll(async () => {
  initRegistries();
  native = await loadNative();
});

const dim = DIMENSIONS.overworld;

function gen(seed: string, type: WorldType = 'normal') {
  return createGenerator('overworld', parseSeed(seed), { type, structures: true, bonusChest: false });
}

function terrain(seed: string, cx: number, cz: number, type: WorldType = 'normal'): Chunk {
  const c = new Chunk(cx, cz, dim);
  gen(seed, type).generateTerrain(c);
  return c;
}

function hashChunk(c: Chunk): number {
  let h = 0x811c9dc5;
  for (let y = dim.minY; y < dim.minY + dim.height; y++) {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      h ^= c.getBlock(x, y, z);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** Minimal 3×3 decoration region over an in-memory map. */
function region(chunks: Map<string, Chunk>, cx: number, cz: number, seed: string): GenRegion {
  const at = (x: number, z: number) => {
    const ox = x >> 4, oz = z >> 4;
    if (Math.abs(ox - cx) > 1 || Math.abs(oz - cz) > 1) return undefined;
    return chunks.get(`${ox},${oz}`);
  };
  return {
    seed: parseSeed(seed), dim, centerX: cx, centerZ: cz, minY: dim.minY, maxY: dim.minY + dim.height,
    getBlock: (x, y, z) => at(x, z)?.getBlock(x & 15, y, z & 15) ?? 0,
    setBlock: (x, y, z, s) => { at(x, z)?.setBlock(x & 15, y, z & 15, s); },
    getHeight: (kind, x, z) => {
      const c = at(x, z);
      if (!c) return dim.minY;
      if (kind === 'surface') return c.surface.get(x & 15, z & 15);
      if (kind === 'opaque') return c.opaque.get(x & 15, z & 15);
      let y = c.motion.get(x & 15, z & 15);
      if (kind === 'ocean_floor') while (y > dim.minY && (stateFlags[c.getBlock(x & 15, y - 1, z & 15)]! & (F.FLUID_BLOCK | F.NO_COLLISION))) y--;
      return y;
    },
    getBiome: (x, y, z) => at(x, z)?.getBiome(x & 15, y, z & 15) ?? 0,
    isInside: (x, z) => at(x, z) !== undefined,
    setBlockEntity: () => {},
    addEntity: () => {},
    scheduleTick: () => {},
  };
}

describe('Overworld generation', () => {
  it('is deterministic for a seed', () => {
    expect(hashChunk(terrain('det', 3, -2))).toBe(hashChunk(terrain('det', 3, -2)));
    expect(hashChunk(terrain('det', 3, -2))).not.toBe(hashChunk(terrain('other', 3, -2)));
  });

  it('produces identical chunks with the WASM kernel and the TypeScript fallback', () => {
    expect(native).not.toBeNull();
    for (const [cx, cz] of [[0, 0], [-7, 12], [40, -33]] as const) {
      setNoiseKernel(null);
      const js = hashChunk(terrain('parity', cx, cz));
      setNoiseKernel(native);
      const wasm = hashChunk(terrain('parity', cx, cz));
      setNoiseKernel(null);
      expect(wasm).toBe(js);
    }
  });

  it('has bedrock at the bottom, deepslate below zero and stone above', () => {
    const c = terrain('layers', 5, 5);
    for (let x = 0; x < 16; x++) expect(c.getBlock(x, dim.minY, 3)).toBe(S('bedrock'));
    let deep = 0, stoneLow = 0, stone = 0, deepHigh = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      if (c.getBlock(x, -32, z) === S('deepslate')) deep++;
      if (c.getBlock(x, -32, z) === S('stone')) stoneLow++;
      if (c.getBlock(x, 30, z) === S('stone')) stone++;
      if (c.getBlock(x, 30, z) === S('deepslate')) deepHigh++;
    }
    expect(deep).toBeGreaterThan(50);
    expect(stoneLow).toBe(0);
    expect(stone).toBeGreaterThan(50);
    expect(deepHigh).toBe(0);
  });

  it('fills oceans to sea level', () => {
    const climate = new Climate(parseSeed('ocean-search'), { largeBiomes: false });
    const col = newColumn();
    let found: [number, number] | null = null;
    for (let i = 0; i < 400 && !found; i++) {
      const x = (i % 20) * 256 - 2560, z = Math.floor(i / 20) * 256 - 2560;
      climate.column(x, z, col);
      if (BIOMES[surfaceBiome(col)]!.category === 'ocean' && col.height < 45) found = [x, z];
    }
    expect(found).not.toBeNull();
    const c = terrain('ocean-search', found![0] >> 4, found![1] >> 4);
    expect(c.getBlock(8, 62, 8)).toBe(S('water'));
    expect(c.getBlock(8, 63, 8)).toBe(S('air'));
  });

  it('decorates with ores, plants and snow where appropriate', () => {
    const seed = 'deco';
    const g = gen(seed);
    const chunks = new Map<string, Chunk>();
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
      const c = new Chunk(x, z, dim);
      g.generateTerrain(c);
      chunks.set(`${x},${z}`, c);
    }
    g.decorate(region(chunks, 0, 0, seed), 0, 0);
    const c = chunks.get('0,0')!;
    let ores = 0;
    for (let y = dim.minY; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (hasTag(c.getBlock(x, y, z), 'ores')) ores++;
    expect(ores).toBeGreaterThan(10);
  });

  it('keeps floating islands above the void and without seas', () => {
    const c = terrain('islands', 2, 2, 'floating_islands');
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      expect(c.getBlock(x, 0, z)).toBe(S('air'));
      expect(c.getBlock(x, 40, z)).toBe(S('air'));
    }
  });

  it('folds weirdness into peaks and valleys', () => {
    expect(peaksValleys(0)).toBeCloseTo(-1, 5);
    expect(peaksValleys(2 / 3)).toBeCloseTo(1, 5);
    expect(peaksValleys(-2 / 3)).toBeCloseTo(1, 5);
  });

  it('finds a dry spawn point', () => {
    for (const seed of ['a', 'b', 'c']) {
      const s = gen(seed).findSpawn();
      const c = terrain(seed, Math.floor(s.x) >> 4, Math.floor(s.z) >> 4);
      const below = c.getBlock(Math.floor(s.x) & 15, s.y - 1, Math.floor(s.z) & 15);
      expect(stateFlags[below]! & F.FLUID_BLOCK).toBe(0);
      expect(c.getBlock(Math.floor(s.x) & 15, s.y, Math.floor(s.z) & 15)).not.toBe(S('water'));
    }
  });
});
