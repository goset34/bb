/** Build the chunk generator for each dimension from world settings. */
import { ChunkGenerator, GeneratorSettings } from './generator';
import { DIMENSIONS, DimensionId } from '../world/dimension';
import { WorldSeed } from '../math/random';
import { FlatGenerator, SimpleGenerator, DebugGenerator } from './flat';
import { OverworldGenerator } from './overworld/generator';

type Factory = (dim: DimensionId, seed: WorldSeed, settings: GeneratorSettings) => ChunkGenerator | null;

const factories: Factory[] = [];

/** Other dimensions register their generators here (Inferno, Verge). */
export function registerGeneratorFactory(f: Factory): void {
  factories.unshift(f);
}

function overworld(seed: WorldSeed, settings: GeneratorSettings): ChunkGenerator {
  const dim = DIMENSIONS.overworld;
  switch (settings.type) {
    case 'flat': return new FlatGenerator(dim, settings);
    case 'debug': return new DebugGenerator(dim);
    case 'debug_simple': return new SimpleGenerator(dim, seed);
    case 'amplified': case 'large_biomes': case 'floating_islands': case 'single_biome':
      return new OverworldGenerator(dim, seed, settings.type, settings);
    default: return new OverworldGenerator(dim, seed, 'normal', settings);
  }
}

export function createGenerator(dim: DimensionId, seed: WorldSeed, settings: GeneratorSettings): ChunkGenerator {
  for (const f of factories) {
    const g = f(dim, seed, settings);
    if (g) return g;
  }
  if (dim === 'overworld') return overworld(seed, settings);
  // Dimensions without a registered generator: an empty world with a bedrock floor.
  return new FlatGenerator(DIMENSIONS[dim], { ...settings, flatLayers: [['bedrock', 1]] });
}

export function createGenerators(seed: WorldSeed, settings: GeneratorSettings): Map<DimensionId, ChunkGenerator> {
  const m = new Map<DimensionId, ChunkGenerator>();
  for (const d of ['overworld', 'inferno', 'verge'] as DimensionId[]) m.set(d, createGenerator(d, seed, settings));
  return m;
}
