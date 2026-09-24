// Locate the nearest column of each named biome (climate only, fast).
// Usage: npx tsx scripts/findbiome.ts <seed> <biome> [biome…]
import { initRegistries } from '../src/common/init';
import { parseSeed } from '../src/common/math/random';
import { Climate, newColumn, surfaceBiome } from '../src/common/worldgen/overworld/climate';
import { BIOMES } from '../src/common/worldgen/biomes';

const [seedText = 'strata', ...names] = process.argv.slice(2);
initRegistries();
const climate = new Climate(parseSeed(seedText), { largeBiomes: false });
const col = newColumn();
const want = new Set(names);
const found = new Map<string, [number, number]>();
outer: for (let r = 0; r < 12000; r += 32) {
  const steps = Math.max(1, Math.floor((2 * Math.PI * r) / 32));
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
    const name = BIOMES[surfaceBiome(climate.column(x, z, col))]!.name;
    if (want.has(name) && !found.has(name)) {
      found.set(name, [x, z]);
      if (found.size === want.size) break outer;
    }
  }
}
for (const n of names) console.log(n, found.get(n)?.join(' ') ?? 'not found within 12000 blocks');
