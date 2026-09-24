/**
 * Overworld chunk generator: climate → biomes, interpolated density terrain with caves and
 * aquifers, surface rules, carvers; decoration is delegated to the feature decorator.
 */
import { Chunk } from '../../world/chunk';
import { DimensionType } from '../../world/dimension';
import { WorldSeed, subSeed } from '../../math/random';
import { STATE_COUNT, stateFlags, F } from '../../block/registry';
import { ChunkGenerator, GenRegion, GeneratorSettings } from '../generator';
import { biomeId, BIOMES, fuzzyQuart } from '../biomes';
import { Climate, Column, SEA_LEVEL, caveBiome, newColumn, surfaceBiome } from './climate';
import { TerrainFiller, TerrainNoises, terrainBlocks } from './terrain';
import { SurfaceBuilder } from './surface';
import { Carvers } from './carvers';
import { OverworldDecorator } from '../features/decorator';

export type OverworldMode = 'normal' | 'amplified' | 'large_biomes' | 'single_biome' | 'floating_islands';

export class OverworldGenerator implements ChunkGenerator {
  readonly climate: Climate;
  private readonly noises: TerrainNoises;
  private readonly filler: TerrainFiller;
  private readonly surface: SurfaceBuilder;
  private readonly carvers: Carvers;
  private readonly decorator: OverworldDecorator;
  private readonly cols: Column[] = [];
  private readonly blocks: Uint16Array;
  private readonly forcedBiome: number;
  private readonly biomeGrid: Uint8Array;
  private readonly landCol = newColumn();
  private readonly ring = new Uint8Array(36);
  /** Hash for jittered biome borders (shared with decoration). */
  readonly fuzzSeed: number;

  constructor(readonly dim: DimensionType, readonly seed: WorldSeed, readonly mode: OverworldMode, settings: GeneratorSettings) {
    this.climate = new Climate(seed, { largeBiomes: mode === 'large_biomes' });
    if (mode === 'amplified') this.climate.amplify = 1.9;
    this.noises = new TerrainNoises(seed);
    this.filler = new TerrainFiller(this.noises, this.climate, terrainBlocks(), dim.minY, dim.height);
    if (mode === 'floating_islands') {
      this.filler.floating = true;
      this.filler.seaLevel = dim.minY;
    }
    this.surface = new SurfaceBuilder(seed, dim.minY, dim.height);
    this.carvers = new Carvers(seed, dim.minY, dim.height, {
      caveChance: mode === 'floating_islands' ? 0.04 : 0.14, canyonChance: mode === 'floating_islands' ? 0 : 0.02, minY: dim.minY + 8, maxY: 180,
    }, STATE_COUNT);
    this.fuzzSeed = subSeed(seed, 'biome/fuzz');
    this.forcedBiome = mode === 'single_biome' ? biomeId(settings.singleBiome ?? 'plains') : -1;
    this.decorator = new OverworldDecorator(seed, this, settings);
    this.blocks = new Uint16Array(dim.height * 256);
    this.biomeGrid = new Uint8Array((dim.height >> 2) * 16);
    for (let i = 0; i < 49; i++) this.cols.push(newColumn());
  }

  get seaLevel(): number {
    return this.mode === 'floating_islands' ? this.dim.minY : SEA_LEVEL;
  }

  generateTerrain(chunk: Chunk): void {
    const { dim, blocks, biomeGrid } = this;
    const cx = chunk.x, cz = chunk.z;
    const bx = cx << 4, bz = cz << 4;
    this.climate.grid(bx - 4, bz - 4, 4, 7, 7, this.cols);
    // Biomes (4×4×4 quarts): surface biome per quart column, cave biomes underground.
    const qh = dim.height >> 2;
    const minQ = dim.minY >> 2;
    for (let qz = 0; qz < 4; qz++) {
      for (let qx = 0; qx < 4; qx++) {
        const col = this.cols[(qz + 1) * 7 + (qx + 1)]!;
        const sb = this.forcedBiome >= 0 ? this.forcedBiome : this.pickSurface(col);
        for (let qy = 0; qy < qh; qy++) {
          const y = ((minQ + qy) << 2) + 2;
          let b = sb;
          if (this.forcedBiome < 0 && this.mode !== 'floating_islands') {
            const cb = caveBiome(col, y);
            if (cb >= 0) b = cb;
          }
          biomeGrid[(qy << 4) | (qz << 2) | qx] = b;
          chunk.setBiome(qx, minQ + qy, qz, b);
        }
      }
    }
    this.filler.fill(cx, cz, this.cols, blocks);
    // Surface biomes of the quarts around the chunk (-1..4) for jittered borders.
    const ring = this.ring;
    for (let qz = -1; qz <= 4; qz++) for (let qx = -1; qx <= 4; qx++) {
      ring[(qz + 1) * 6 + (qx + 1)] = this.forcedBiome >= 0 ? this.forcedBiome : this.pickSurface(this.cols[(qz + 1) * 7 + (qx + 1)]!);
    }
    const minY = dim.minY;
    const q: [number, number] = [0, 0];
    const bqx = bx >> 2, bqz = bz >> 2;
    this.surface.build(cx, cz, blocks, (x, y, z) => {
      fuzzyQuart(this.fuzzSeed, bx + x, bz + z, q);
      const lqx = q[0] - bqx, lqz = q[1] - bqz;
      if (lqx >= 0 && lqx < 4 && lqz >= 0 && lqz < 4) return biomeGrid[(((y - minY) >> 2) << 4) | (lqz << 2) | lqx]!;
      return ring[(lqz + 1) * 6 + (lqx + 1)]!;
    });
    this.carvers.carve(cx, cz, blocks);
    for (let si = 0; si < chunk.sections.length; si++) chunk.sections[si]!.load(blocks, si * 4096);
    chunk.recomputeHeightmaps();
  }

  decorate(region: GenRegion, cx: number, cz: number): void {
    this.decorator.decorate(region, cx, cz);
  }

  surfaceHeight(x: number, z: number): number {
    return Math.floor(this.climate.column(x, z).height);
  }

  biomeAt(x: number, y: number, z: number): number {
    if (this.forcedBiome >= 0) return this.forcedBiome;
    const col = this.climate.column(x, z);
    if (this.mode !== 'floating_islands') {
      const cb = caveBiome(col, y);
      if (cb >= 0) return cb;
    }
    return this.pickSurface(col);
  }

  /** Surface biome; floating islands have no seas, rivers or shores. */
  private pickSurface(col: Column): number {
    if (this.mode !== 'floating_islands') return surfaceBiome(col);
    const land = this.landCol;
    Object.assign(land, col);
    land.c = Math.max(col.c, 0.05);
    land.river = 0;
    land.height = 80;
    land.mountain = 0;
    return surfaceBiome(land);
  }

  /** Column climate (used by features: e.g. temperature noise). */
  column(x: number, z: number): Column {
    return this.climate.column(x, z);
  }

  findSpawn(): { x: number; y: number; z: number } {
    // Spiral search for dry land in a temperate, non-mountain biome near the origin.
    let best: { x: number; z: number } | null = null;
    const col = newColumn();
    outer: for (let ring = 0; ring < 48; ring++) {
      const r = ring * 64;
      const steps = Math.max(1, ring * 8);
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.climate.column(x, z, col);
        if (this.mode === 'floating_islands') { best = { x, z }; break outer; }
        const b = BIOMES[this.pickSurface(col)]!;
        if (col.height > SEA_LEVEL + 1.5 && col.height < 110 && col.river < 0.3 && b.category !== 'ocean' && b.category !== 'river' && b.category !== 'beach') {
          best = { x, z };
          break outer;
        }
      }
    }
    const target = best ?? { x: 0, z: 0 };
    // Generate the chunk to find the exact standing position.
    const c = new Chunk(target.x >> 4, target.z >> 4, this.dim);
    this.generateTerrain(c);
    for (let dz = 0; dz < 16; dz++) {
      for (let dx = 0; dx < 16; dx++) {
        const lx = (target.x + dx) & 15, lz = (target.z + dz) & 15;
        const y = c.motion.get(lx, lz);
        const below = c.getBlock(lx, y - 1, lz);
        if (y > this.dim.minY + 1 && y > this.seaLevel && below !== 0 && !(stateFlags[below]! & F.FLUID_BLOCK)) {
          return { x: (c.x << 4) + lx + 0.5, y, z: (c.z << 4) + lz + 0.5 };
        }
      }
    }
    return { x: target.x + 0.5, y: c.motion.get(target.x & 15, target.z & 15) + 1, z: target.z + 0.5 };
  }
}
