/** Superflat generator (customisable layers) and a lightweight "simple" heightmap generator. */
import { Chunk } from '../world/chunk';
import { ChunkGenerator, GenRegion, GeneratorSettings } from './generator';
import { DimensionType } from '../world/dimension';
import { S, tryGetBlock, STATE_COUNT } from '../block/registry';
import { biomeId } from './biomes';
import { WorldSeed, Random, chunkRandom, subSeed } from '../math/random';
import { OctaveNoise } from '../math/noise';

export const DEFAULT_FLAT_LAYERS: Array<[string, number]> = [['bedrock', 1], ['dirt', 2], ['grass_block', 1]];

export class FlatGenerator implements ChunkGenerator {
  private readonly layers: number[] = [];
  private readonly biome: number;

  constructor(readonly dim: DimensionType, settings: GeneratorSettings) {
    const spec = settings.flatLayers && settings.flatLayers.length ? settings.flatLayers : DEFAULT_FLAT_LAYERS;
    for (const [name, count] of spec) {
      const b = tryGetBlock(name);
      const st = b ? b.defaultState : 0;
      for (let i = 0; i < count && this.layers.length < dim.height; i++) this.layers.push(st);
    }
    this.biome = biomeId(settings.flatBiome ?? 'plains');
  }

  generateTerrain(chunk: Chunk): void {
    for (let i = 0; i < this.layers.length; i++) {
      const y = this.dim.minY + i;
      const st = this.layers[i]!;
      if (st === 0) continue;
      const sec = chunk.sectionAt(y)!;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) sec.setXYZ(lx, y & 15, lz, st);
    }
    for (const s of chunk.sections) s.biomes.fill(this.biome);
    chunk.recomputeHeightmaps();
  }

  decorate(_region: GenRegion, _cx: number, _cz: number): void {}

  surfaceHeight(): number {
    return this.dim.minY + this.layers.length;
  }

  biomeAt(): number {
    return this.biome;
  }

  findSpawn() {
    return { x: 0.5, y: this.surfaceHeight(), z: 0.5 };
  }
}

/** Simple rolling hills with trees; used as a fast debug world type. */
export class SimpleGenerator implements ChunkGenerator {
  private readonly height: OctaveNoise;
  private readonly detail: OctaveNoise;
  private readonly plains = biomeId('plains');
  private readonly ocean = biomeId('ocean');
  private readonly beach = biomeId('beach');

  constructor(readonly dim: DimensionType, readonly seed: WorldSeed) {
    this.height = new OctaveNoise(new Random(subSeed(seed, 'simple_height')), -8, [1, 1, 1, 1, 0.5, 0.25]);
    this.detail = new OctaveNoise(new Random(subSeed(seed, 'simple_detail')), -4, [1, 1, 1]);
  }

  surfaceHeight(x: number, z: number): number {
    const h = this.height.sample(x, 0, z);
    return Math.floor(64 + h * 28 + this.detail.sample(x, 0, z) * 4);
  }

  biomeAt(x: number, _y: number, z: number): number {
    const h = this.surfaceHeight(x, z);
    return h < 62 ? this.ocean : h < 65 ? this.beach : this.plains;
  }

  generateTerrain(chunk: Chunk): void {
    const bedrock = S('bedrock'), stone = S('stone'), dirt = S('dirt'), grass = S('grass_block'), sand = S('sand'), water = S('water'), deepslate = S('deepslate');
    const bx = chunk.x << 4, bz = chunk.z << 4;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = this.surfaceHeight(bx + lx, bz + lz);
        for (let y = this.dim.minY; y < Math.max(h, 63); y++) {
          let st: number;
          if (y === this.dim.minY) st = bedrock;
          else if (y < h - 4) st = y < 0 ? deepslate : stone;
          else if (y < h - 1) st = h < 65 ? sand : dirt;
          else if (y < h) st = h < 65 ? sand : grass;
          else st = water;
          chunk.setBlock(lx, y, lz, st);
        }
      }
    }
    for (let qx = 0; qx < 4; qx++) for (let qz = 0; qz < 4; qz++) {
      const b = this.biomeAt(bx + qx * 4 + 2, 64, bz + qz * 4 + 2);
      for (let qy = this.dim.minY >> 2; qy < (this.dim.minY + this.dim.height) >> 2; qy++) chunk.setBiome(qx, qy, qz, b);
    }
  }

  decorate(region: GenRegion, cx: number, cz: number): void {
    const rng = chunkRandom(region.seed, cx, cz, 0x7ee5);
    const log = S('oak_log'), leaves = tryGetBlock('oak_leaves')!.with({ distance: 1 }), grassBlock = S('grass_block'), shortGrass = S('short_grass');
    const trees = rng.nextInt(3);
    for (let i = 0; i < trees; i++) {
      const x = (cx << 4) + rng.nextInt(16), z = (cz << 4) + rng.nextInt(16);
      const y = region.getHeight('motion', x, z);
      if (region.getBlock(x, y - 1, z) !== grassBlock) continue;
      const h = 4 + rng.nextInt(3);
      for (let dy = h - 3; dy <= h; dy++) {
        const r = dy >= h - 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === h || rng.nextInt(2) === 0)) continue;
          if (region.getBlock(x + dx, y + dy, z + dz) === 0) region.setBlock(x + dx, y + dy, z + dz, leaves);
        }
      }
      for (let dy = 0; dy < h; dy++) region.setBlock(x, y + dy, z, log);
      region.setBlock(x, y - 1, z, S('dirt'));
    }
    for (let i = 0; i < 12; i++) {
      const x = (cx << 4) + rng.nextInt(16), z = (cz << 4) + rng.nextInt(16);
      const y = region.getHeight('motion', x, z);
      if (region.getBlock(x, y - 1, z) === grassBlock && region.getBlock(x, y, z) === 0) region.setBlock(x, y, z, shortGrass);
    }
  }

  findSpawn() {
    for (let r = 0; r < 256; r += 8) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const h = this.surfaceHeight(x, z);
        if (h >= 65) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }
}

/**
 * Debug world: every block state laid out on a grid at y = 70 (two blocks apart) above a
 * barrier floor, for inspecting models and textures.
 */
export class DebugGenerator implements ChunkGenerator {
  private readonly grid: number;
  private readonly barrier: number;
  private readonly biome = biomeId('plains');

  constructor(readonly dim: DimensionType) {
    this.grid = Math.ceil(Math.sqrt(STATE_COUNT));
    this.barrier = S('barrier');
  }

  /** State at world column (x, z) or 0. */
  stateAt(x: number, z: number): number {
    if (x <= 0 || z <= 0 || x % 2 !== 1 || z % 2 !== 1) return 0;
    const i = (x - 1) / 2, j = (z - 1) / 2;
    if (i >= this.grid || j >= this.grid) return 0;
    const s = j * this.grid + i + 1;
    return s < STATE_COUNT ? s : 0;
  }

  generateTerrain(chunk: Chunk): void {
    const bx = chunk.x << 4, bz = chunk.z << 4;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        chunk.setBlock(lx, 60, lz, this.barrier);
        const st = this.stateAt(bx + lx, bz + lz);
        if (st) chunk.setBlock(lx, 70, lz, st);
      }
    }
    for (const s of chunk.sections) s.biomes.fill(this.biome);
    chunk.recomputeHeightmaps();
  }

  decorate(): void {}

  surfaceHeight(): number {
    return 61;
  }

  biomeAt(): number {
    return this.biome;
  }

  findSpawn() {
    return { x: 0.5, y: 71, z: 0.5 };
  }
}
