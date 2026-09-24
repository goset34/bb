/**
 * Chunk decoration: collects the biomes present in the chunk, then runs each biome's placed
 * features step by step in a stable global order with a per-feature random, so results do
 * not depend on generation order.
 */
import { WorldSeed, Random, hash4, subSeed } from '../../math/random';
import { NoiseStack, OctaveNoise } from '../../math/noise';
import { GenRegion, GeneratorSettings } from '../generator';
import { ClimateAccess, FeatureContext, PlacedFeature, STEP_COUNT, runPlaced } from './api';
import { biomeFeatureSets } from './biome_features';
import { seededRandom } from '../overworld/climate';

/** Structure (or other) hooks run once per step before the step's features. */
export type StepHook = (region: GenRegion, cx: number, cz: number, step: number) => void;

export interface DecoratorHost {
  readonly seaLevel: number;
}

export class OverworldDecorator implements ClimateAccess {
  private readonly salt: number;
  private readonly tempNoise: NoiseStack;
  readonly hooks: StepHook[] = [];

  constructor(readonly seed: WorldSeed, private readonly host: DecoratorHost, readonly settings: GeneratorSettings) {
    this.salt = subSeed(seed, 'decoration');
    this.tempNoise = new OctaveNoise(seededRandom(seed, 'decoration/temperature'), -6, [1, 0.5]);
  }

  get seaLevel(): number {
    return this.host.seaLevel;
  }

  temperatureNoise(x: number, z: number): number {
    return this.tempNoise.sample(x, 0, z);
  }

  decorate(region: GenRegion, cx: number, cz: number): void {
    const bx = cx << 4, bz = cz << 4;
    const present = new Set<number>();
    for (let y = region.minY; y < region.maxY; y += 4) {
      for (let qz = 0; qz < 4; qz++) for (let qx = 0; qx < 4; qx++) present.add(region.getBiome(bx + qx * 4, y, bz + qz * 4));
    }
    const sets = biomeFeatureSets();
    const byStep: PlacedFeature[][] = Array.from({ length: STEP_COUNT }, () => []);
    const seen = new Set<PlacedFeature>();
    for (const b of present) {
      const set = sets.get(b);
      if (!set) continue;
      for (const pf of set) {
        if (seen.has(pf)) continue;
        seen.add(pf);
        byStep[pf.step]!.push(pf);
      }
    }
    const ctx: FeatureContext = { world: region, rng: new Random(0), seed: this.seed, climate: this, cx, cz };
    for (let step = 0; step < STEP_COUNT; step++) {
      for (const hook of this.hooks) hook(region, cx, cz, step);
      const list = byStep[step]!;
      list.sort((a, b) => a.index - b.index);
      for (const pf of list) {
        ctx.rng = new Random(hash4(this.salt, cx, pf.index * 16 + step, cz), this.salt ^ pf.index);
        runPlaced(ctx, pf, (x, y, z) => {
          const set = sets.get(region.getBiome(x, y, z));
          return !!set && set.has(pf);
        });
      }
    }
  }
}
