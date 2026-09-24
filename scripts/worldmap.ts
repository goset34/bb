// Top-down climate/biome map for tuning world generation.
// Usage: npx tsx scripts/worldmap.ts <seed> <out.png> [sizePx=768] [blocksPerPx=8] [large=0]
import { writePNG } from './png-node';
import { initRegistries } from '../src/common/init';
import { parseSeed } from '../src/common/math/random';
import { Climate, surfaceBiome, newColumn, Column } from '../src/common/worldgen/overworld/climate';
import { BIOMES } from '../src/common/worldgen/biomes';

initRegistries();
const [seedText = 'strata', out = 'map.png', sizeArg = '768', bppArg = '8', largeArg = '0'] = process.argv.slice(2);
const size = Number(sizeArg), bpp = Number(bppArg);
const climate = new Climate(parseSeed(seedText), { largeBiomes: largeArg === '1' });

const MAP_COLORS: Record<string, number> = {
  plains: 0x8db360, sunflower_plains: 0xb5db88, snowy_plains: 0xffffff, ice_spikes: 0xb4dcdc, desert: 0xfa9418, swamp: 0x07f9b2,
  mangrove_swamp: 0x2ccc8e, forest: 0x056621, flower_forest: 0x2d8e49, birch_forest: 0x307444, dark_forest: 0x40511a,
  old_growth_birch_forest: 0x589c6c, old_growth_pine_taiga: 0x596651, old_growth_spruce_taiga: 0x818e79, taiga: 0x0b6a5f,
  snowy_taiga: 0x31554a, savanna: 0xbdb25f, savanna_plateau: 0xa79d64, windswept_hills: 0x606060, windswept_gravelly_hills: 0x888888,
  windswept_forest: 0x5b7352, windswept_savanna: 0xe5da87, jungle: 0x537b09, sparse_jungle: 0x628b17, bamboo_jungle: 0x768e14,
  badlands: 0xd94515, eroded_badlands: 0xff6d3d, wooded_badlands: 0xb09765, meadow: 0x60a445, cherry_grove: 0xffa4d6, grove: 0x47726c,
  snowy_slopes: 0xc4c4c4, frozen_peaks: 0xa0a0ff, jagged_peaks: 0xdcdcdc, stony_peaks: 0x7b8f74, river: 0x0000ff, frozen_river: 0xa0a0ff,
  beach: 0xfade55, snowy_beach: 0xfaf0c0, stony_shore: 0xa2a284, warm_ocean: 0x0000ac, lukewarm_ocean: 0x000090, deep_lukewarm_ocean: 0x000040,
  ocean: 0x000070, deep_ocean: 0x000030, cold_ocean: 0x202070, deep_cold_ocean: 0x202038, frozen_ocean: 0x7070d6, deep_frozen_ocean: 0x404090,
  mushroom_fields: 0xff00ff, pale_garden: 0x696d95,
};

const rgba = new Uint8Array(size * size * 4);
const counts = new Map<string, number>();
const stat = { c: [] as number[], e: [] as number[], t: [] as number[], h: [] as number[], w: [] as number[], height: [] as number[] };
const half = (size * bpp) / 2;
const row: Column[] = [];
const t0 = performance.now();
for (let py = 0; py < size; py++) {
  climate.grid(-half, -half + py * bpp, bpp, size, 1, row);
  for (let px = 0; px < size; px++) {
    const col = row[px]!;
    const b = BIOMES[surfaceBiome(col)]!;
    counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
    if ((px & 7) === 0 && (py & 7) === 0) {
      stat.c.push(col.c); stat.e.push(col.e); stat.t.push(col.t); stat.h.push(col.h); stat.w.push(col.w); stat.height.push(col.height);
    }
    let color = MAP_COLORS[b.name] ?? 0xff00ff;
    const shade = col.height < 63 ? 1 : 0.75 + Math.min(0.5, (col.height - 63) / 300);
    const i = (py * size + px) * 4;
    rgba[i] = Math.min(255, ((color >> 16) & 255) * shade);
    rgba[i + 1] = Math.min(255, ((color >> 8) & 255) * shade);
    rgba[i + 2] = Math.min(255, (color & 255) * shade);
    rgba[i + 3] = 255;
    // contour lines every 32 blocks
    if (col.height > 63 && Math.floor(col.height / 32) !== Math.floor((row[px + 1]?.height ?? col.height) / 32)) { rgba[i] >>= 1; rgba[i + 1] >>= 1; rgba[i + 2] >>= 1; }
  }
}
// origin marker
for (let d = -4; d <= 4; d++) for (const [x, y] of [[size / 2 + d, size / 2], [size / 2, size / 2 + d]]) {
  const i = (y! * size + x!) * 4; rgba[i] = 255; rgba[i + 1] = 0; rgba[i + 2] = 0;
}
writePNG(out, size, size, rgba);
const pct = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => s[Math.floor(p * (s.length - 1))]!.toFixed(2)).join(' '); };
console.log(`map ${size}px × ${bpp} blocks in ${(performance.now() - t0).toFixed(0)} ms`);
for (const k of Object.keys(stat) as (keyof typeof stat)[]) console.log(`${k.padEnd(7)} p5..p95: ${pct(stat[k])}`);
const total = size * size;
console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`).join(', '));
