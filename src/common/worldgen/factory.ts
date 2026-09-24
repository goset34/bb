/** Build the chunk generator for each dimension from world settings. */
import { ChunkGenerator, GeneratorSettings } from './generator';
import { DIMENSIONS, DimensionId } from '../world/dimension';
import { WorldSeed } from '../math/random';
import { FlatGenerator, SimpleGenerator } from './flat';

type Factory = (dim: DimensionId, seed: WorldSeed, settings: GeneratorSettings) => ChunkGenerator | null;

const factories: Factory[] = [];

/** Later milestones register the full noise generators here. */
export function registerGeneratorFactory(f: Factory): void {
  factories.unshift(f);
}

export function createGenerator(dim: DimensionId, seed: WorldSeed, settings: GeneratorSettings): ChunkGenerator {
  for (const f of factories) {
    const g = f(dim, seed, settings);
    if (g) return g;
  }
  if (dim === 'overworld') {
    if (settings.type === 'flat') return new FlatGenerator(DIMENSIONS.overworld, settings);
    return new SimpleGenerator(DIMENSIONS.overworld, seed);
  }
  // Fallback for dimensions without a registered generator: empty flat world
  return new FlatGenerator(DIMENSIONS[dim], { ...settings, flatLayers: [['bedrock', 1]] });
}

export function createGenerators(seed: WorldSeed, settings: GeneratorSettings): Map<DimensionId, ChunkGenerator> {
  const m = new Map<DimensionId, ChunkGenerator>();
  for (const d of ['overworld', 'inferno', 'verge'] as DimensionId[]) m.set(d, createGenerator(d, seed, settings));
  return m;
}
