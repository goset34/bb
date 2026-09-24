/**
 * Block drop tables, generated from block definitions: silk touch / shears variants, ores with
 * fortune, crops by age, leaves with saplings and apples, double blocks, stacked blocks, and
 * blocks that drop something else. Also block experience.
 */
import { P } from '../block/properties';
import { Block, BLOCK_BY_NAME, blockHasTag, tryGetValue } from '../block/registry';
import { ITEMS } from '../item/items';
import { Random } from '../math/random';
import { ItemStack } from '../item/stack';
import {
  LootTable, LootEntry, Condition, LootContext, table, pool, entry, alternatives, group, empty, when, apply, hasSilk, hasShears, silkOrShears,
  survivesExplosion, setCount, setCountF, oreBonus, uniformBonus, binomialBonus, limit, explosionDecay, fortuneChance, chance, registerLootResolver,
} from './loot';

const stateIs = (fn: (state: number) => boolean): Condition => (c) => c.state !== undefined && fn(c.state);
const prop = <T>(p: { name: string }, v: T): Condition => stateIs((s) => tryGetValue(s, p as never) === v);

function selfItem(b: Block): string | null {
  const id = b.item ?? b.name;
  return ITEMS.has(id) ? id : null;
}

function dropsSelf(b: Block): LootTable | null {
  const id = selfItem(b);
  if (!id) return null;
  return table(pool([entry(id)], 1, when(survivesExplosion)));
}

function silkOr(self: string, other: LootEntry): LootTable {
  return table(pool([alternatives(entry(self, when(hasSilk)), other)], 1, when(survivesExplosion)));
}

function onlySilk(self: string): LootTable {
  return table(pool([entry(self)], 1, when(hasSilk)));
}

function onlySilkOrShears(self: string): LootTable {
  return table(pool([entry(self)], 1, when(silkOrShears)));
}

function oreTable(self: string, drop: string, count: [number, number] | number, bonus: 'ore' | 'uniform'): LootTable {
  const fns = [apply(typeof count === 'number' ? setCount(count) : setCountF(count[0], count[1])), apply(bonus === 'ore' ? oreBonus : uniformBonus(1)), apply(explosionDecay)];
  return silkOr(self, entry(drop, ...fns));
}

const ORES: Record<string, [string, [number, number] | number, 'ore' | 'uniform']> = {
  coal_ore: ['coal', 1, 'ore'], iron_ore: ['raw_iron', 1, 'ore'], copper_ore: ['raw_copper', [2, 5], 'ore'], gold_ore: ['raw_gold', 1, 'ore'],
  diamond_ore: ['diamond', 1, 'ore'], emerald_ore: ['emerald', 1, 'ore'], lapis_ore: ['lapis_lazuli', [4, 9], 'ore'], flux_ore: ['flux_dust', [4, 5], 'uniform'],
  cinder_quartz_ore: ['cinder_quartz', 1, 'ore'], cinder_gold_ore: ['gold_nugget', [2, 6], 'ore'],
};

/** Sapling chances by fortune level (table bonus). */
const SAPLING = [0.05, 0.0625, 0.083333336, 0.1];
const RARE_SAPLING = [0.025, 0.027777778, 0.03125, 0.041666668, 0.1];
const STICKS = [0.02, 0.022222223, 0.025, 0.033333335, 0.1];
const APPLE = [0.005, 0.0055555557, 0.00625, 0.008333334, 0.025];

function leavesTable(b: Block): LootTable {
  const self = b.name;
  const wood = self.replace(/_leaves$/, '');
  const pools = [];
  const sapling = wood === 'azalea' ? 'azalea' : wood === 'flowering_azalea' ? 'flowering_azalea' : `${wood}_sapling`;
  const saplingEntry = ITEMS.has(sapling) && wood !== 'mangrove'
    ? entry(sapling, when(fortuneChance(wood === 'jungle' ? RARE_SAPLING : SAPLING)))
    : empty();
  pools.push(pool([alternatives(entry(self, when(silkOrShears)), group(saplingEntry))], 1, when(survivesExplosion)));
  pools.push(pool([entry('stick', when(fortuneChance(STICKS)), apply(setCountF(1, 2)), apply(explosionDecay))], 1, when((c) => !silkOrShears(c))));
  if (wood === 'oak' || wood === 'dark_oak') pools.push(pool([entry('apple', when(fortuneChance(APPLE)))], 1, when((c) => !silkOrShears(c))));
  return { pools, functions: [] };
}

function cropTable(seed: string, crop: string, ageProp: { name: string }, maxAge: number, cropCount: [number, number] | number = 1, seedBonus = true): LootTable {
  const mature = prop(ageProp, maxAge);
  const pools = [
    pool([alternatives(entry(crop, when(mature), apply(typeof cropCount === 'number' ? setCount(cropCount) : setCountF(cropCount[0], cropCount[1]))), entry(seed))], 1),
  ];
  if (seedBonus) pools.push(pool([entry(seed, apply(binomialBonus(3, 0.5714286)))], 1, when(mature)));
  return { pools, functions: [] };
}

function doubleBlockLower(b: Block, id: string): LootTable {
  return table(pool([entry(id)], 1, when(prop(P.doubleHalf, 'lower')), when(survivesExplosion)));
}

const setLayers = (st: ItemStack, c: LootContext) => {
  st.count = tryGetValue(c.state!, P.layers) ?? 1;
  return st;
};

function build(b: Block): LootTable | null {
  const n = b.name;
  const s = b.settings;
  if (s.air || s.fluid && (n === 'water' || n === 'lava')) return null;
  if (s.noDrops) {
    // Silk-only blocks
    if (/^(glass|tinted_glass|.*_stained_glass(_pane)?|glass_pane|ice|packed_ice|blue_ice|budding_amethyst|turtle_egg|sniffer_egg|frogspawn|bee_nest|beehive|spawner|infested_.+|reinforced_deepslate|cake|.*_candle_cake|suspicious_.+|trial_spawner|vault|frosted_ice|bubble_column|fire|soul_fire|moving_piston|piston_head|inferno_portal|verge_portal|verge_gateway|farmland|dirt_path|light|barrier|structure_void|jigsaw|command_block|chain_command_block|repeating_command_block|structure_block|echo_.+)$/.test(n)) {
      if (/^(glass|tinted_glass|.*_stained_glass(_pane)?|glass_pane|ice|packed_ice|blue_ice)$/.test(n)) return n === 'tinted_glass' ? dropsSelf(b) : onlySilk(n);
      if (n === 'farmland' || n === 'dirt_path') return table(pool([entry('dirt')], 1, when(survivesExplosion)));
      if (/^echo_/.test(n)) return onlySilk(n);
      if (n === 'bee_nest' || n === 'beehive') return n === 'beehive' ? dropsSelf(b) : onlySilk(n);
      return null;
    }
    return null;
  }
  if (s.drops === 'none') {
    // grass-like plants: shears → self, otherwise seeds
    if (n === 'short_grass' || n === 'fern') {
      return table(pool([alternatives(entry(n, when(hasShears)), entry('wheat_seeds', when(chance(0.125)), apply(uniformBonus(2)), apply(explosionDecay)))], 1));
    }
    if (n === 'tall_grass' || n === 'large_fern') {
      const small = n === 'tall_grass' ? 'short_grass' : 'fern';
      return table(pool([alternatives(entry(small, when(hasShears), apply(setCount(2))), entry('wheat_seeds', when(chance(0.125))))], 1, when(prop(P.doubleHalf, 'lower'))));
    }
    if (n === 'dead_bush' || n === 'short_dry_grass' || n === 'tall_dry_grass' || n === 'bush') {
      return table(pool([alternatives(entry(n, when(hasShears)), n === 'dead_bush' ? entry('stick', apply(setCountF(0, 2)), apply(explosionDecay)) : empty())], 1));
    }
    if (/seagrass|vine$|hanging_roots|glow_lichen|nether_sprouts|twisting|weeping|pale_hanging_moss/.test(n)) return onlySilkOrShears(n.replace(/^tall_/, ''));
    return null;
  }
  if (ORES[n] || ORES[n.replace(/^deepslate_/, '')]) {
    const base = ORES[n] ?? ORES[n.replace(/^deepslate_/, '')]!;
    return oreTable(n, base[0], base[1], base[2]);
  }
  // Blocks that drop something else unless silk touched
  const silkTo: Record<string, [string, number | [number, number]]> = {
    grass_block: ['dirt', 1], podzol: ['dirt', 1], mycelium: ['dirt', 1], stone: ['cobblestone', 1], deepslate: ['cobbled_deepslate', 1],
    cinderrack: ['cinderrack', 1], crimson_nylium: ['cinderrack', 1], warped_nylium: ['cinderrack', 1], clay: ['clay_ball', 4],
    snow_block: ['snowball', 4], bookshelf: ['book', 3], void_chest: ['obsidian', 8], campfire: ['charcoal', 2], soul_campfire: ['soul_soil', 1],
    sea_lantern: ['prismarine_crystals', [2, 3]], glowstone: ['glowstone_dust', [2, 4]], melon: ['melon_slice', [3, 7]],
    amethyst_cluster: ['amethyst_shard', 4], gilded_blackstone: ['gilded_blackstone', 1], big_dripleaf_stem: ['big_dripleaf', 1],
    chiseled_bookshelf: ['chiseled_bookshelf', 1], dried_ghast: ['dried_ghast', 1],
  };
  if (silkTo[n]) {
    const [drop, cnt] = silkTo[n];
    let e = entry(drop, apply(typeof cnt === 'number' ? setCount(cnt) : setCountF(cnt[0], cnt[1])));
    if (n === 'glowstone') e = entry(drop, apply(setCountF(2, 4)), apply(uniformBonus(1)), apply(limit(1, 4)));
    if (n === 'melon') e = entry(drop, apply(setCountF(3, 7)), apply(uniformBonus(1)), apply(limit(1, 9)));
    if (n === 'sea_lantern') e = entry(drop, apply(setCountF(2, 3)), apply(uniformBonus(1)), apply(limit(1, 5)));
    if (n === 'amethyst_cluster') e = entry(drop, apply(setCount(4)), apply(oreBonus));
    if (n === 'gilded_blackstone') e = alternatives(entry('gold_nugget', when(chance(0.1)), apply(setCountF(2, 5))), entry('gilded_blackstone'));
    return silkOr(n, e);
  }
  if (n === 'gravel') return silkOr(n, alternatives(entry('flint', when(fortuneChance([0.1, 0.14285715, 0.25, 1])) ), entry('gravel')));
  if (/_amethyst_bud$/.test(n)) return onlySilk(n);
  if (blockHasTag(b, 'leaves')) return leavesTable(b);
  if (n === 'snow') return table(pool([alternatives(entry('snow', when(hasSilk), apply(setLayers))), entry('snowball', apply(setLayers))], 1));
  // Crops
  if (n === 'wheat') return cropTable('wheat_seeds', 'wheat', P.age7, 7);
  if (n === 'beetroots') return cropTable('beetroot_seeds', 'beetroot', P.age3, 3);
  if (n === 'carrots' || n === 'potatoes') {
    const item = n === 'carrots' ? 'carrot' : 'potato';
    const t = table(pool([entry(item)], 1), pool([entry(item, apply(binomialBonus(3, 0.5714286)))], 1, when(prop(P.age7, 7))));
    if (n === 'potatoes') t.pools.push(pool([entry('poisonous_potato', when(chance(0.02)))], 1, when(prop(P.age7, 7))));
    return t;
  }
  if (n === 'torchflower_crop') return table(pool([alternatives(entry('torchflower', when(prop(P.age1, 1))), entry('torchflower_seeds'))], 1));
  if (n === 'pitcher_crop') return table(pool([alternatives(entry('pitcher_plant', when(prop(P.age4, 4))), entry('pitcher_pod'))], 1, when(prop(P.doubleHalf, 'lower'))));
  if (n === 'ember_wart') return table(pool([entry('ember_wart', apply((st, c) => { st.count = tryGetValue(c.state!, P.age3) === 3 ? c.rng.nextIntBetween(2, 4) : 1; return st; }), apply(uniformBonus(1)))], 1));
  if (n === 'cocoa') return table(pool([entry('cocoa_beans', apply((st, c) => { st.count = tryGetValue(c.state!, P.age2) === 2 ? 3 : 1; return st; }))], 1));
  if (n === 'sweet_berry_bush') return table(pool([entry('sweet_berries', apply((st, c) => { const a = tryGetValue(c.state!, P.age3) ?? 0; st.count = a === 3 ? c.rng.nextIntBetween(2, 3) : a === 2 ? c.rng.nextIntBetween(1, 2) : 0; return st; }))], 1));
  if (n === 'cave_vines' || n === 'cave_vines_plant') return table(pool([entry('glow_berries')], 1, when(prop(P.berries, true))));
  if (n === 'melon_stem' || n === 'pumpkin_stem' || n === 'attached_melon_stem' || n === 'attached_pumpkin_stem') {
    const seed = n.includes('melon') ? 'melon_seeds' : 'pumpkin_seeds';
    return table(pool([entry(seed, apply((st, c) => { const age = n.startsWith('attached') ? 7 : tryGetValue(c.state!, P.age7) ?? 0; let k = 0; for (let i = 0; i < 3; i++) if (c.rng.nextFloat() < (age + 1) / 15) k++; st.count = k; return st; }))], 1));
  }
  // Double-height blocks and multiples
  if (blockHasTag(b, 'doors') || blockHasTag(b, 'tall_flowers') || n === 'small_dripleaf' || n === 'pitcher_plant') {
    const id = selfItem(b);
    return id ? doubleBlockLower(b, id) : null;
  }
  if (blockHasTag(b, 'beds')) {
    const id = selfItem(b);
    return id ? table(pool([entry(id)], 1, when(prop(P.bedPart, 'head')), when(survivesExplosion))) : null;
  }
  if (n.endsWith('_slab')) return table(pool([entry(n, apply((st, c) => { st.count = tryGetValue(c.state!, P.slabType) === 'double' ? 2 : 1; return st; }), apply(explosionDecay))], 1));
  if (blockHasTag(b, 'candles')) return table(pool([entry(n, apply((st, c) => { st.count = tryGetValue(c.state!, P.candles) ?? 1; return st; }))], 1));
  if (n === 'sea_pickle') return table(pool([entry(n, apply((st, c) => { st.count = tryGetValue(c.state!, P.pickles) ?? 1; return st; }))], 1));
  if (/^(pink_petals|wildflowers)$/.test(n)) return table(pool([entry(n, apply((st, c) => { st.count = tryGetValue(c.state!, P.flowerAmount) ?? 1; return st; }))], 1));
  if (n === 'leaf_litter') return table(pool([entry(n, apply((st, c) => { st.count = tryGetValue(c.state!, P.segmentAmount) ?? 1; return st; }))], 1));
  if (n === 'turtle_egg' || n === 'frogspawn') return null;
  if (blockHasTag(b, 'flower_pots') && n.startsWith('potted_')) {
    const plant = n.replace(/^potted_/, '');
    return table(pool([entry('flower_pot')], 1), pool([entry(ITEMS.has(plant) ? plant : 'flower_pot')], 1, when(() => ITEMS.has(plant))));
  }
  if (n === 'decorated_pot') return dropsSelf(b);
  if (s.drops) {
    if (!ITEMS.has(s.drops)) return null;
    return table(pool([entry(s.drops)], 1, when(survivesExplosion)));
  }
  return dropsSelf(b);
}

registerLootResolver((id) => {
  if (!id.startsWith('blocks/')) return null;
  const b = BLOCK_BY_NAME.get(id.slice(7));
  if (!b) return null;
  return build(b) ?? { pools: [], functions: [] };
});

/** Experience dropped when a block is mined without silk touch. */
export function blockExperience(name: string, r: Random, silk: boolean): number {
  if (silk) return 0;
  const base = name.replace(/^deepslate_/, '');
  switch (base) {
    case 'coal_ore': return r.nextIntBetween(0, 2);
    case 'diamond_ore': case 'emerald_ore': return r.nextIntBetween(3, 7);
    case 'lapis_ore': case 'cinder_quartz_ore': return r.nextIntBetween(2, 5);
    case 'flux_ore': return r.nextIntBetween(1, 5);
    case 'cinder_gold_ore': return r.nextIntBetween(0, 1);
    case 'spawner': return r.nextIntBetween(15, 43);
    case 'echo_moss': case 'echo_sensor': case 'calibrated_echo_sensor': return 1;
    case 'echo_catalyst': case 'echo_shrieker': return 5;
    default: return 0;
  }
}
