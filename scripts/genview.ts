// Headless world generation check: timings, top-down map and a vertical slice from real blocks.
// Usage: npx tsx scripts/genview.ts <seed> <outPrefix> [radiusChunks=8] [type=normal] [centerX=0] [centerZ=0] [js]
import { writePNG } from './png-node';
import { initRegistries } from '../src/common/init';
import { parseSeed } from '../src/common/math/random';
import { blockOf, stateFlags, F } from '../src/common/block/registry';
import { Chunk } from '../src/common/world/chunk';
import { DIMENSIONS } from '../src/common/world/dimension';
import { createGenerator } from '../src/common/worldgen/factory';
import { GenRegion, WorldType } from '../src/common/worldgen/generator';
import { installNativeKernels } from '../src/common/native/native';
import { BIOMES } from '../src/common/worldgen/biomes';

const [seedText = 'strata', prefix = '/tmp/claude-0/gen', rArg = '8', type = 'normal', cxArg = '0', czArg = '0', mode = ''] = process.argv.slice(2);
initRegistries();
const backend = await installNativeKernels(mode !== 'js');
const seed = parseSeed(seedText);
const dim = DIMENSIONS.overworld;
const gen = createGenerator('overworld', seed, { type: type as WorldType, structures: true, bonusChest: false });
const R = Number(rArg);
const ccx = Math.floor(Number(cxArg) / 16), ccz = Math.floor(Number(czArg) / 16);
const chunks = new Map<string, Chunk>();
const k = (x: number, z: number) => `${x},${z}`;
let t0 = performance.now();
for (let z = ccz - R - 1; z <= ccz + R + 1; z++) for (let x = ccx - R - 1; x <= ccx + R + 1; x++) {
  const c = new Chunk(x, z, dim);
  gen.generateTerrain(c);
  chunks.set(k(x, z), c);
}
const nGen = (2 * R + 3) ** 2;
const tGen = performance.now() - t0;

class Region implements GenRegion {
  readonly minY = dim.minY;
  readonly maxY = dim.minY + dim.height;
  private readonly near: Chunk[] = [];
  constructor(readonly seed = parseSeed(seedText), readonly dim_ = dim, readonly centerX = 0, readonly centerZ = 0) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.near.push(chunks.get(k(centerX + dx, centerZ + dz))!);
  }
  get dim() { return this.dim_; }
  private c(x: number, z: number) {
    const dx = (x >> 4) - this.centerX + 1, dz = (z >> 4) - this.centerZ + 1;
    if (dx < 0 || dx > 2 || dz < 0 || dz > 2) return undefined;
    return this.near[dz * 3 + dx];
  }
  getBlock(x: number, y: number, z: number) { return this.c(x, z)?.getBlock(x & 15, y, z & 15) ?? 0; }
  setBlock(x: number, y: number, z: number, s: number) { this.c(x, z)?.setBlock(x & 15, y, z & 15, s); }
  getHeight(kind: 'surface' | 'motion' | 'ocean_floor' | 'opaque', x: number, z: number) {
    const c = this.c(x, z);
    if (!c) return this.minY;
    const lx = x & 15, lz = z & 15;
    if (kind === 'surface') return c.surface.get(lx, lz);
    if (kind === 'motion') return c.motion.get(lx, lz);
    if (kind === 'opaque') return c.opaque.get(lx, lz);
    let y = c.motion.get(lx, lz) - 1;
    while (y > this.minY) { const f = stateFlags[c.getBlock(lx, y, lz)]!; if (!(f & F.NO_COLLISION) && !(f & F.FLUID_BLOCK)) break; y--; }
    return y + 1;
  }
  getBiome(x: number, y: number, z: number) { return this.c(x, z)?.getBiome(x & 15, y, z & 15) ?? 0; }
  isInside(x: number, z: number) { return this.c(x, z) !== undefined; }
  setBlockEntity() {}
  addEntity() {}
  scheduleTick() {}
}
t0 = performance.now();
let nDec = 0;
for (let z = ccz - R; z <= ccz + R; z++) for (let x = ccx - R; x <= ccx + R; x++) {
  gen.decorate(new Region(seed, dim, x, z), x, z);
  nDec++;
}
const tDec = performance.now() - t0;
console.log(`backend ${backend}: terrain ${(tGen / nGen).toFixed(2)} ms/chunk (${nGen}), decoration ${(tDec / nDec).toFixed(2)} ms/chunk (${nDec})`);

const COLORS: Array<[RegExp, number]> = [
  [/^water|bubble/, 0x3355dd], [/^lava/, 0xff6010], [/grass_block|moss_block/, 0x6aa84f], [/leaves/, 0x2f6b2a], [/log|wood|stem/, 0x6b4e2e],
  [/^sand|sandstone/, 0xdbcf8e], [/red_sand/, 0xbf6a2f], [/terracotta/, 0xa05a3a], [/snow|powder/, 0xf4f8ff], [/ice/, 0x9cc4ff],
  [/gravel/, 0x8a8480], [/clay/, 0xa0a6b4], [/mud/, 0x3c3a36], [/podzol|coarse|dirt|rooted/, 0x7a5a3a], [/mycelium/, 0x8a7090],
  [/deepslate/, 0x505055], [/^stone|andesite|cobble/, 0x7d7d7d], [/granite/, 0x9a6a5a], [/diorite|calcite/, 0xd0d0d0], [/tuff/, 0x6c6d66],
  [/ore/, 0xe0c040], [/bedrock/, 0x222222], [/flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of|petals|wildflowers/, 0xe05080],
  [/short_grass|fern|tall_grass|bush/, 0x5a9a3a], [/kelp|seagrass/, 0x2a7a4a], [/coral/, 0xe060a0], [/cactus/, 0x3a7a2a], [/dripstone/, 0x8a6a50],
  [/echo/, 0x0a2a33], [/amethyst/, 0x9a60d0], [/mushroom/, 0xb03030], [/basalt/, 0x444444],
];
const colorCache = new Map<number, number>();
function colorOf(s: number): number {
  let c = colorCache.get(s);
  if (c === undefined) {
    const n = blockOf(s).name;
    c = COLORS.find(([re]) => re.test(n))?.[1] ?? 0xff00ff;
    colorCache.set(s, c);
  }
  return c;
}
// top-down
const W = (2 * R + 1) * 16;
const img = new Uint8Array(W * W * 4);
const missing = new Map<string, number>();
for (let pz = 0; pz < W; pz++) for (let px = 0; px < W; px++) {
  const wx = (ccx - R) * 16 + px, wz = (ccz - R) * 16 + pz;
  const c = chunks.get(k(wx >> 4, wz >> 4))!;
  const y = c.surface.get(wx & 15, wz & 15) - 1;
  const s = c.getBlock(wx & 15, y, wz & 15);
  const col = colorOf(s);
  if (col === 0xff00ff) missing.set(blockOf(s).name, (missing.get(blockOf(s).name) ?? 0) + 1);
  const shade = 0.6 + Math.max(0, Math.min(0.6, (y - 40) / 200));
  const i = (pz * W + px) * 4;
  img[i] = Math.min(255, ((col >> 16) & 255) * shade); img[i + 1] = Math.min(255, ((col >> 8) & 255) * shade); img[i + 2] = Math.min(255, (col & 255) * shade); img[i + 3] = 255;
}
writePNG(prefix + '-top.png', W, W, img);
// vertical slice along x at the centre z
const H = dim.height;
const sl = new Uint8Array(W * H * 4);
const sz = ccz * 16 + 8;
for (let px = 0; px < W; px++) for (let yy = 0; yy < H; yy++) {
  const wx = (ccx - R) * 16 + px, y = dim.minY + yy;
  const s = chunks.get(k(wx >> 4, sz >> 4))!.getBlock(wx & 15, y, sz & 15);
  const col = s === 0 ? (y < 63 ? 0x101018 : 0xa0c0ff) : colorOf(s);
  const i = ((H - 1 - yy) * W + px) * 4;
  sl[i] = (col >> 16) & 255; sl[i + 1] = (col >> 8) & 255; sl[i + 2] = col & 255; sl[i + 3] = 255;
}
writePNG(prefix + '-slice.png', W, H, sl);
const biomes = new Map<string, number>();
for (const c of chunks.values()) biomes.set(BIOMES[c.getBiome(8, 64, 8)]!.name, (biomes.get(BIOMES[c.getBiome(8, 64, 8)]!.name) ?? 0) + 1);
console.log('biomes:', [...biomes.entries()].map(([a, b]) => `${a}:${b}`).join(' '));
if (missing.size) console.log('uncoloured tops:', [...missing.entries()].slice(0, 20).map(([a, b]) => `${a}:${b}`).join(' '));
console.log('spawn:', JSON.stringify(gen.findSpawn()));
// cave statistics: fraction of air/fluid below the surface per 32-block band
const bands = new Map<number, [number, number, number]>();
for (const c of chunks.values()) {
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const top = c.opaque.get(lx, lz) - 8;
    for (let y = dim.minY + 1; y < top; y++) {
      const b = Math.floor((y - dim.minY) / 32);
      const s = c.getBlock(lx, y, lz);
      const e = bands.get(b) ?? [0, 0, 0];
      e[0]++;
      if (s === 0) e[1]++;
      else if (stateFlags[s]! & F.FLUID_BLOCK) e[2]++;
      bands.set(b, e);
    }
  }
}
console.log('underground air/fluid by band:', [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([b, [n, a, f]]) => `${dim.minY + b * 32}:${(100 * a / n).toFixed(1)}%/${(100 * f / n).toFixed(1)}%`).join(' '));
