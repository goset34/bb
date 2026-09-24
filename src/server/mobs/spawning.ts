/**
 * Natural spawning (reference NaturalSpawner): per-biome spawn lists, category caps scaled by the
 * number of chunks around players, pack spawning around a random point of each chunk, light and
 * ground rules, initial creatures of freshly generated chunks, phantoms for sleepless players and
 * monster spawner blocks.
 */
import type { Entity } from '../../common/entity/ecs';
import { AABB } from '../../common/math/geom';
import type { Random } from '../../common/math/random';
import { BIOMES, Biome } from '../../common/worldgen/biomes';
import { MOBS, MobCategory } from '../../common/entity/mobs';
import { blockOf, stateFlags, F, getCollisionShape } from '../../common/block/registry';
import type { WorldAccess } from '../../common/worldgen/features/api';
import type { ServerLevel } from '../level';
import { MOB_DEFS, mobOf, SpawnReason } from './mob';
import { localDifficulty } from './factory';

export interface SpawnEntry {
  type: string;
  weight: number;
  min: number;
  max: number;
}

type Lists = Partial<Record<MobCategory, SpawnEntry[]>>;

const e = (type: string, weight: number, min: number, max: number): SpawnEntry => ({ type, weight, min, max });

// ---- Reference spawn lists (BiomeDefaultFeatures) -------------------------------------------

function monsters(zombie = 95, villager = 5, skeleton = 100, drowned = false): SpawnEntry[] {
  const list = [
    e('spider', 100, 4, 4), e(drowned ? 'drowned' : 'zombie', zombie, 4, 4), e('zombie_villager', villager, 1, 1),
    e('skeleton', skeleton, 4, 4), e('hisser', 100, 4, 4), e('slime', 100, 4, 4), e('voidwalker', 10, 1, 4), e('witch', 5, 1, 1),
  ];
  return list;
}

const FARM = (): SpawnEntry[] => [e('sheep', 12, 4, 4), e('pig', 10, 4, 4), e('chicken', 10, 4, 4), e('cow', 8, 4, 4)];
const BATS = (): SpawnEntry[] => [e('bat', 10, 8, 8)];
const CAVES = (): Lists => ({ ambient: BATS(), underground_water_creature: [e('glow_squid', 10, 4, 6)] });

function common(extraCreatures: SpawnEntry[] = [], mons: SpawnEntry[] = monsters()): Lists {
  return { ...CAVES(), creature: [...FARM(), ...extraCreatures], monster: mons };
}

function oceanLists(kind: 'normal' | 'warm' | 'lukewarm' | 'cold' | 'frozen'): Lists {
  const water: SpawnEntry[] = [];
  const fish: SpawnEntry[] = [];
  if (kind === 'normal') { water.push(e('squid', 1, 1, 4), e('dolphin', 1, 1, 2)); fish.push(e('cod', 10, 3, 6)); }
  if (kind === 'lukewarm') { water.push(e('squid', 10, 1, 2), e('dolphin', 2, 1, 2)); fish.push(e('cod', 15, 3, 6), e('pufferfish', 5, 1, 3), e('tropical_fish', 25, 8, 8)); }
  if (kind === 'warm') { water.push(e('squid', 10, 4, 4)); fish.push(e('pufferfish', 15, 1, 3), e('tropical_fish', 25, 8, 8)); }
  if (kind === 'cold') { water.push(e('squid', 3, 1, 4)); fish.push(e('cod', 15, 3, 6), e('salmon', 15, 1, 5)); }
  if (kind === 'frozen') { water.push(e('squid', 1, 1, 4)); fish.push(e('salmon', 15, 1, 5)); }
  const mons = monsters(95, 5, 100, false).filter((x) => x.type !== 'zombie');
  mons.push(e('drowned', kind === 'warm' || kind === 'lukewarm' ? 5 : 100, 1, 1), e('zombie', 95, 4, 4));
  return { ...CAVES(), water_creature: water, water_ambient: fish, monster: mons, creature: kind === 'frozen' ? [e('polar_bear', 1, 1, 2)] : [] };
}

function listsFor(b: Biome): Lists {
  const n = b.name;
  switch (n) {
    case 'plains': case 'sunflower_plains': return common([e('horse', 5, 2, 6), e('donkey', 1, 1, 3)]);
    case 'snowy_plains': case 'ice_spikes': return { ...CAVES(), creature: [e('rabbit', 10, 2, 3), e('polar_bear', 1, 1, 2)], monster: [...monsters(95, 5, 20), e('stray', 80, 4, 4)] };
    case 'desert': return { ...CAVES(), creature: [e('rabbit', 4, 2, 3), e('camel', 1, 1, 1)], monster: [...monsters(19, 1).filter((x) => x.type !== 'slime'), e('husk', 80, 4, 4), e('slime', 100, 4, 4)] };
    case 'swamp': return { ...common([e('frog', 10, 2, 5)]), monster: [...monsters(), e('slime', 1, 1, 1), e('bogged', 50, 4, 4)] };
    case 'mangrove_swamp': return { ...CAVES(), creature: [e('frog', 10, 2, 5)], water_ambient: [e('tropical_fish', 25, 8, 8)], monster: [...monsters(), e('slime', 1, 1, 1), e('bogged', 50, 4, 4)] };
    case 'forest': case 'flower_forest': case 'birch_forest': case 'old_growth_birch_forest':
      return common(n === 'forest' ? [e('wolf', 5, 4, 4)] : n === 'flower_forest' ? [e('rabbit', 4, 2, 3)] : []);
    case 'dark_forest': return common();
    case 'taiga': case 'old_growth_pine_taiga': case 'old_growth_spruce_taiga': case 'snowy_taiga':
      return common([e('wolf', 8, 4, 4), e('rabbit', 4, 2, 3), e('fox', 8, 2, 4)]);
    case 'savanna': case 'savanna_plateau':
      return common([e('horse', 1, 2, 6), e('donkey', 1, 1, 1), e('armadillo', 10, 2, 3), ...(n === 'savanna_plateau' ? [e('llama', 8, 4, 4), e('wolf', 8, 4, 8)] : [])]);
    case 'windswept_savanna': return common([e('horse', 1, 2, 6), e('donkey', 1, 1, 1), e('armadillo', 10, 2, 3)]);
    case 'windswept_hills': case 'windswept_gravelly_hills': case 'windswept_forest': return common([e('llama', 5, 4, 6)]);
    case 'jungle': case 'sparse_jungle': return common([e('parrot', 40, 1, 2), e('ocelot', 2, 1, 3), ...(n === 'jungle' ? [e('panda', 1, 1, 2)] : [e('wolf', 8, 2, 4)])]);
    case 'bamboo_jungle': return common([e('parrot', 40, 1, 2), e('panda', 80, 1, 2), e('ocelot', 2, 1, 1)]);
    case 'badlands': case 'eroded_badlands': case 'wooded_badlands': return { ...CAVES(), creature: [e('armadillo', 6, 1, 2), ...(n === 'wooded_badlands' ? [e('wolf', 2, 4, 8)] : [])], monster: monsters() };
    case 'meadow': return { ...CAVES(), creature: [e('donkey', 1, 1, 2), e('rabbit', 2, 2, 6), e('sheep', 2, 2, 4)], monster: monsters() };
    case 'cherry_grove': return { ...CAVES(), creature: [e('pig', 1, 1, 2), e('rabbit', 2, 2, 6), e('sheep', 2, 2, 4)], monster: monsters() };
    case 'grove': return { ...CAVES(), creature: [e('wolf', 1, 1, 1), e('rabbit', 8, 2, 3), e('fox', 4, 2, 4)], monster: monsters() };
    case 'snowy_slopes': return { ...CAVES(), creature: [e('rabbit', 4, 2, 3), e('goat', 5, 1, 3)], monster: monsters() };
    case 'frozen_peaks': case 'jagged_peaks': return { ...CAVES(), creature: [e('goat', 5, 1, 3)], monster: monsters() };
    case 'stony_peaks': return { ...CAVES(), monster: monsters() };
    case 'river': return { ...CAVES(), water_creature: [e('squid', 2, 1, 4)], water_ambient: [e('salmon', 5, 1, 5)], monster: [...monsters(), e('drowned', 100, 1, 1)] };
    case 'frozen_river': return { ...CAVES(), water_creature: [e('squid', 2, 1, 4)], water_ambient: [e('salmon', 5, 1, 5)], monster: [...monsters(), e('drowned', 1, 1, 1)], creature: [e('rabbit', 10, 2, 3)] };
    case 'beach': return { ...CAVES(), creature: [e('turtle', 5, 2, 5)], monster: monsters() };
    case 'snowy_beach': case 'stony_shore': return { ...CAVES(), monster: monsters() };
    case 'ocean': case 'deep_ocean': return oceanLists('normal');
    case 'warm_ocean': return oceanLists('warm');
    case 'lukewarm_ocean': case 'deep_lukewarm_ocean': return oceanLists('lukewarm');
    case 'cold_ocean': case 'deep_cold_ocean': return oceanLists('cold');
    case 'frozen_ocean': case 'deep_frozen_ocean': return oceanLists('frozen');
    case 'mushroom_fields': return { creature: [e('mushcow', 8, 4, 8)], ambient: BATS() };
    case 'lush_caves': return { ...CAVES(), axolotls: [e('axolotl', 10, 4, 6)], water_ambient: [e('tropical_fish', 25, 8, 8)], monster: monsters() };
    case 'dripstone_caves': return { ...CAVES(), monster: [...monsters(95, 5, 100), e('drowned', 95, 4, 4)] };
    case 'deep_dark': case 'pale_garden': case 'the_void': return {};
    default:
      if (b.dimension !== 'overworld') return {};
      return common();
  }
}

const LIST_CACHE = new Map<number, Lists>();

export function spawnListsFor(biome: number): Lists {
  let l = LIST_CACHE.get(biome);
  if (!l) {
    const b = BIOMES[biome];
    l = b ? listsFor(b) : {};
    // Only mobs that exist in this build take part
    for (const k of Object.keys(l) as MobCategory[]) l[k] = l[k]!.filter((x) => MOB_DEFS.has(x.type));
    LIST_CACHE.set(biome, l);
  }
  return l;
}

function pick(list: SpawnEntry[], r: Random): SpawnEntry | null {
  let total = 0;
  for (const x of list) total += x.weight;
  if (total <= 0) return null;
  let n = r.nextInt(total);
  for (const x of list) {
    n -= x.weight;
    if (n < 0) return x;
  }
  return null;
}

// ---- Rules ------------------------------------------------------------------------------------

const CAPS: Partial<Record<MobCategory, number>> = { monster: 70, creature: 10, ambient: 15, water_creature: 5, water_ambient: 20, underground_water_creature: 5, axolotls: 5 };
const DESPAWN_FAR: Partial<Record<MobCategory, number>> = { monster: 128, creature: 128, ambient: 128, water_creature: 128, water_ambient: 64, underground_water_creature: 128, axolotls: 128 };
const WATER_TYPES = new Set(['drowned', 'guardian', 'elder_guardian', 'axolotl']);

function inWaterPlacement(type: string, cat: MobCategory): boolean {
  return cat === 'water_creature' || cat === 'water_ambient' || cat === 'underground_water_creature' || cat === 'axolotls' || WATER_TYPES.has(type);
}

interface SpawnWorld {
  getBlockState(x: number, y: number, z: number): number;
}

function emptyForSpawn(w: SpawnWorld, x: number, y: number, z: number): boolean {
  const s = w.getBlockState(x, y, z);
  const f = stateFlags[s]!;
  if (f & (F.WATER | F.LAVA | F.FLUID_BLOCK)) return false;
  if (getCollisionShape(s).length) return false;
  const n = blockOf(s).name;
  return !n.endsWith('rail') && n !== 'powder_snow' && n !== 'sweet_berry_bush' && n !== 'fire' && n !== 'soul_fire' && n !== 'wither_rose' && n !== 'blight_rose';
}

/** Placement check: solid spawnable floor with two free blocks, or water for aquatic mobs. */
export function placementOk(w: SpawnWorld, type: string, cat: MobCategory, x: number, y: number, z: number): boolean {
  if (inWaterPlacement(type, cat)) {
    const s = w.getBlockState(x, y, z);
    return !!(stateFlags[s]! & F.WATER) && !(stateFlags[w.getBlockState(x, y + 1, z)]! & F.OPAQUE_CUBE);
  }
  const below = w.getBlockState(x, y - 1, z);
  const bn = blockOf(below).name;
  if (!(stateFlags[below]! & F.SPAWNABLE) || bn === 'bedrock' || bn === 'barrier') return false;
  return emptyForSpawn(w, x, y, z) && emptyForSpawn(w, x, y + 1, z);
}

/** Reference Monster.isDarkEnoughToSpawn (overworld: no block light, sky/raw light tests). */
export function darkEnough(level: ServerLevel, x: number, y: number, z: number, r: Random): boolean {
  if (level.getSkyLight(x, y, z) > r.nextInt(32)) return false;
  const limit = level.dimId === 'inferno' ? 11 : 0;
  if (level.getBlockLight(x, y, z) > limit) return false;
  let raw = level.getMaxLocalRawBrightness(x, y, z);
  if (level.isThundering()) raw = Math.min(raw, Math.max(level.getBlockLight(x, y, z), level.getSkyLight(x, y, z) - 10));
  return raw <= r.nextInt(8);
}

function animalRule(level: ServerLevel, x: number, y: number, z: number): boolean {
  return blockOf(level.getBlockState(x, y - 1, z)).name === 'grass_block' && level.getMaxLocalRawBrightness(x, y, z) > 8;
}

/** Mob-specific plus category spawn rules for a candidate position. */
export function spawnRulesOk(level: ServerLevel, type: string, x: number, y: number, z: number, reason: SpawnReason, r: Random): boolean {
  const def = MOB_DEFS.get(type);
  const info = MOBS.get(type);
  if (!def || !info) return false;
  if (def.hostile) {
    if (level.getDifficulty() === 0) return false;
    if (def.spawnDarkness !== false && reason !== 'spawner' && !darkEnough(level, x, y, z, r)) return false;
    if (reason === 'spawner' && level.getBlockLight(x, y, z) > 11) return false;
    return def.canSpawn ? def.canSpawn(level, x, y, z, reason, r) : true;
  }
  if (def.canSpawn) return def.canSpawn(level, x, y, z, reason, r);
  if (info.category === 'creature') return animalRule(level, x, y, z);
  if (info.category === 'ambient') return level.getMaxLocalRawBrightness(x, y, z) <= r.nextInt(4);
  return true;
}

function noCollision(level: ServerLevel, type: string, x: number, y: number, z: number): boolean {
  const info = MOBS.get(type)!;
  const hw = info.width / 2;
  const box = new AABB(x - hw, y, z - hw, x + hw, y + info.height, z + hw);
  for (let bx = Math.floor(box.minX); bx <= Math.floor(box.maxX); bx++) {
    for (let by = Math.floor(box.minY); by <= Math.floor(box.maxY); by++) {
      for (let bz = Math.floor(box.minZ); bz <= Math.floor(box.maxZ); bz++) {
        const s = getCollisionShape(level.getBlockState(bx, by, bz));
        for (let i = 0; i < s.length; i += 6) if (box.intersectsRaw(bx + s[i]!, by + s[i + 1]!, bz + s[i + 2]!, bx + s[i + 3]!, by + s[i + 4]!, bz + s[i + 5]!)) return false;
      }
    }
  }
  return !level.getEntities(box, (o) => !!o.living || o.type === 'boat').length;
}

// ---- Natural spawner ------------------------------------------------------------------------

function countByCategory(level: ServerLevel): Map<MobCategory, number> {
  const counts = new Map<MobCategory, number>();
  for (const e of level.entities.all()) {
    const m = mobOf(e);
    if (!m || m.persistent) continue;
    const cat = MOBS.get(m.def.id)?.category;
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return counts;
}

function spawnableChunks(level: ServerLevel): Array<[number, number]> {
  const set = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const p of level.players) {
    if (p.data.gameMode === 'spectator') continue;
    const t = p.entity.transform;
    const pcx = Math.floor(t.x) >> 4, pcz = Math.floor(t.z) >> 4;
    for (let dz = -8; dz <= 8; dz++) {
      for (let dx = -8; dx <= 8; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = (cx & 0xffff) | ((cz & 0xffff) << 16);
        if (set.has(k)) continue;
        // Chunk centre within 128 blocks of the player
        if (((cx << 4) + 8 - t.x) ** 2 + ((cz << 4) + 8 - t.z) ** 2 > 128 * 128) continue;
        if (!level.chunks.getFull(cx, cz)) continue;
        set.add(k);
        out.push([cx, cz]);
      }
    }
  }
  return out;
}

function nearestPlayerDistSqr(level: ServerLevel, x: number, y: number, z: number): number {
  let best = Infinity;
  for (const p of level.players) {
    if (p.data.gameMode === 'spectator') continue;
    const t = p.entity.transform;
    best = Math.min(best, (t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2);
  }
  return best;
}

/** One pack attempt of a category around a random point of a chunk (reference spawnCategoryForPosition). */
function spawnForChunk(level: ServerLevel, cat: MobCategory, cx: number, cz: number, budget: { left: number }): void {
  const r = level.random;
  const x0 = (cx << 4) + r.nextInt(16), z0 = (cz << 4) + r.nextInt(16);
  const top = level.getHeight('surface', x0, z0) + 1;
  const y = level.minY + r.nextInt(Math.max(1, top - level.minY + 1));
  if (y < level.minY + 1) return;
  if (stateFlags[level.getBlockState(x0, y, z0)]! & F.OPAQUE_CUBE) return;
  const spawn = level.server.info.spawn;
  let count = 0;
  for (let k = 0; k < 3; k++) {
    let x = x0, z = z0;
    let entry: SpawnEntry | null = null;
    let packSize = Math.ceil(r.nextFloat() * 4);
    let inPack = 0;
    for (let i = 0; i < packSize; i++) {
      x += r.nextInt(6) - r.nextInt(6);
      z += r.nextInt(6) - r.nextInt(6);
      const px = x + 0.5, pz = z + 0.5;
      const d2 = nearestPlayerDistSqr(level, px, y, pz);
      if (d2 <= 576 || (spawn.x - px) ** 2 + (spawn.z - pz) ** 2 < 576 && level.dimId === 'overworld') continue;
      if (x >> 4 !== cx || z >> 4 !== cz) continue;
      if (!entry) {
        const lists = spawnListsFor(level.getBiome(x, y, z));
        entry = pick(lists[cat] ?? [], r);
        if (!entry) break;
        packSize = entry.min + r.nextInt(1 + entry.max - entry.min);
      }
      const far = DESPAWN_FAR[cat] ?? 128;
      if (d2 > far * far) continue;
      if (!placementOk(level, entry.type, cat, x, y, z)) continue;
      if (!spawnRulesOk(level, entry.type, x, y, z, 'natural', r)) continue;
      if (!noCollision(level, entry.type, px, y, pz)) continue;
      const e = level.createEntity(entry.type, px, y, pz, { reason: 'natural', groupIndex: inPack, yaw: r.nextFloat() * 360 });
      if (!e) return;
      count++;
      inPack++;
      budget.left--;
      if (budget.left <= 0 || count >= maxCluster(entry.type)) return;
    }
  }
}

function maxCluster(type: string): number {
  if (type === 'wolf') return 8;
  if (type === 'voidwalker' || type === 'ocelot') return 4;
  if (type === 'tropical_fish' || type === 'cod' || type === 'salmon') return 8;
  return 4;
}

export function naturalSpawnSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  return {
    name: 'natural_spawning',
    tick() {
      if (level.getGameRule('doMobSpawning') === false || !level.players.length) return;
      const chunks = spawnableChunks(level);
      if (!chunks.length) return;
      const counts = countByCategory(level);
      const persistentTurn = level.getGameTime() % 400 === 0;
      const cats: MobCategory[] = [];
      for (const [cat, cap] of Object.entries(CAPS) as Array<[MobCategory, number]>) {
        if (cat === 'monster' && level.getDifficulty() === 0) continue;
        if (cat === 'creature' && !persistentTurn) continue;
        const limit = Math.floor((cap * chunks.length) / 289);
        if ((counts.get(cat) ?? 0) < limit) cats.push(cat);
      }
      if (!cats.length) return;
      // Shuffle chunk order so no area is favoured
      const r = level.random;
      for (let i = chunks.length - 1; i > 0; i--) {
        const j = r.nextInt(i + 1);
        [chunks[i], chunks[j]] = [chunks[j]!, chunks[i]!];
      }
      for (const cat of cats) {
        const cap = Math.floor((CAPS[cat]! * chunks.length) / 289);
        const budget = { left: cap - (counts.get(cat) ?? 0) };
        for (const [cx, cz] of chunks) {
          if (budget.left <= 0) break;
          spawnForChunk(level, cat, cx, cz, budget);
        }
      }
    },
  };
}

// ---- Initial creatures of new chunks ---------------------------------------------------------

/** Region adapter so spawn rules written against the level can judge generation-time positions. */
function regionView(region: WorldAccess, level: ServerLevel): ServerLevel {
  return new Proxy(level, {
    get(target, prop) {
      if (prop === 'getBlockState') return (x: number, y: number, z: number) => region.getBlock(x, y, z);
      if (prop === 'getMaxLocalRawBrightness') return (x: number, y: number, z: number) => (y >= region.getHeight('surface', x, z) ? 15 : 0);
      if (prop === 'canSeeSky') return (x: number, y: number, z: number) => y >= region.getHeight('motion', x, z);
      if (prop === 'getBiome') return (x: number, y: number, z: number) => region.getBiome(x, y, z);
      return Reflect.get(target, prop) as unknown;
    },
  });
}

export function spawnInitialCreatures(level: ServerLevel, region: WorldAccess, cx: number, cz: number): void {
  if (!region.addEntity || level.dimId !== 'overworld') return;
  const r = level.random;
  const x0 = cx << 4, z0 = cz << 4;
  const biome = region.getBiome(x0 + 8, region.getHeight('surface', x0 + 8, z0 + 8), z0 + 8);
  const b = BIOMES[biome];
  const list = spawnListsFor(biome).creature ?? [];
  if (!b || !list.length) return;
  const view = regionView(region, level);
  const prob = b.creatureProbability || 0.1;
  let guard = 0;
  while (r.nextFloat() < prob && guard++ < 8) {
    const entry = pick(list, r);
    if (!entry) return;
    const n = entry.min + r.nextInt(1 + entry.max - entry.min);
    const info = MOBS.get(entry.type)!;
    let x = x0 + r.nextInt(16), z = z0 + r.nextInt(16);
    const sx = x, sz = z;
    for (let i = 0; i < n; i++) {
      let placed = false;
      for (let t = 0; !placed && t < 4; t++) {
        const y = region.getHeight('motion', x, z);
        const px = Math.max(x0 + info.width, Math.min(x0 + 16 - info.width, x + 0.5));
        const pz = Math.max(z0 + info.width, Math.min(z0 + 16 - info.width, z + 0.5));
        if (placementOk(view, entry.type, 'creature', x, y, z) && spawnRulesOk(view, entry.type, x, y, z, 'chunk_generation', r)) {
          region.addEntity(entry.type, px, y, pz, { reason: 'chunk_generation', groupIndex: i });
          placed = true;
        }
        x += r.nextInt(5) - r.nextInt(5);
        z += r.nextInt(5) - r.nextInt(5);
        while (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16) {
          x = sx + r.nextInt(5) - r.nextInt(5);
          z = sz + r.nextInt(5) - r.nextInt(5);
        }
      }
    }
  }
}

// ---- Phantoms --------------------------------------------------------------------------------

/** Reference PhantomSpawner: sleepless players (3+ days) may be visited at night. */
export function phantomSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  let next = 0;
  return {
    name: 'phantoms',
    tick() {
      if (level.getGameRule('doInsomnia') === false || !level.dim.hasSkylight) return;
      if (--next > 0) return;
      const r = level.random;
      next += (60 + r.nextInt(60)) * 20;
      if (level.getSkyDarken() < 5 || level.getDifficulty() === 0) return;
      for (const p of level.players) {
        const e = p.entity, t = e.transform;
        if (p.data.gameMode === 'spectator' || p.data.gameMode === 'creative' || e.living?.dead) continue;
        const x = Math.floor(t.x), y = Math.floor(t.y), z = Math.floor(t.z);
        if (y < 63 || !level.canSeeSky(x, y, z)) continue;
        const diff = localDifficulty(level, x, z);
        if (diff <= r.nextFloat() * 3) continue;
        const rest = Math.max(1, (p.ext['timeSinceRest'] as number | undefined) ?? 0);
        if (r.nextInt(rest) < 72000) continue;
        const sx = x - 10 + r.nextInt(21), sy = y + 20 + r.nextInt(15), sz = z - 10 + r.nextInt(21);
        if (!(stateFlags[level.getBlockState(sx, sy, sz)]! & F.AIR)) continue;
        const n = 1 + r.nextInt(level.getDifficulty() + 1);
        for (let i = 0; i < n; i++) level.createEntity('phantom', sx + 0.5, sy, sz + 0.5, { reason: 'natural' });
      }
    },
  };
}

// ---- Monster spawner blocks ------------------------------------------------------------------

interface SpawnerData {
  entity?: string;
  delay?: number;
  minDelay?: number;
  maxDelay?: number;
  spawnCount?: number;
  maxNearby?: number;
  playerRange?: number;
  spawnRange?: number;
}

/** Spawner blocks (dungeons, mineshafts, strongholds…): reference BaseSpawner. */
export function spawnerSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  return {
    name: 'spawners',
    tick() {
      for (const h of level.chunks.holders.values()) {
        const c = h.chunk;
        if (!c || !c.blockEntities.size) continue;
        for (const be of c.blockEntities.values()) {
          if (be.type !== 'spawner') continue;
          tickSpawner(level, be.x, be.y, be.z, be.data as SpawnerData);
        }
      }
    },
  };
}

function tickSpawner(level: ServerLevel, x: number, y: number, z: number, d: SpawnerData): void {
  if (!d.entity || blockOf(level.getBlockState(x, y, z)).name !== 'spawner') return;
  const range = d.playerRange ?? 16;
  if (nearestPlayerDistSqr(level, x + 0.5, y + 0.5, z + 0.5) > range * range) return;
  if (level.getGameTime() % 4 === 0) level.addParticle('flame', x + 0.5, y + 0.5, z + 0.5, 0, 0, 0, 1);
  if (d.delay === undefined || d.delay === -1) resetDelay(level, d);
  if (d.delay! > 0) {
    d.delay!--;
    return;
  }
  if (level.getGameRule('doMobSpawning') === false && level.getDifficulty() === 0) return;
  const r = level.random;
  const count = d.spawnCount ?? 4, sr = d.spawnRange ?? 4;
  let spawned = false;
  for (let i = 0; i < count; i++) {
    const sx = x + (r.nextDouble() - r.nextDouble()) * sr + 0.5;
    const sy = y + r.nextInt(3) - 1;
    const sz = z + (r.nextDouble() - r.nextDouble()) * sr + 0.5;
    const info = MOBS.get(d.entity);
    if (!info) return;
    const near = level.getEntities(new AABB(x - sr, y - sr, z - sr, x + 1 + sr, y + 1 + sr, z + 1 + sr), (e: Entity) => e.type === d.entity).length;
    if (near >= (d.maxNearby ?? 6)) break;
    if (!noCollision(level, d.entity, sx, sy, sz)) continue;
    if (!spawnRulesOk(level, d.entity, Math.floor(sx), sy, Math.floor(sz), 'spawner', r)) continue;
    const e = level.createEntity(d.entity, sx, sy, sz, { reason: 'spawner', yaw: r.nextFloat() * 360 });
    if (e) {
      level.levelEvent(2004, x, y, z, 0);
      mobOf(e)?.broadcastEvent('poof');
      spawned = true;
    }
  }
  if (spawned) resetDelay(level, d);
}

function resetDelay(level: ServerLevel, d: SpawnerData): void {
  const min = d.minDelay ?? 200, max = d.maxDelay ?? 800;
  d.delay = max <= min ? min : min + level.random.nextInt(max - min);
}
