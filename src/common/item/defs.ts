/**
 * Non-block items: tools and weapons of every tier, armor, food, materials, buckets, vehicles,
 * music discs, templates, sherds… Stats follow the reference game's mechanics.
 */
import { MOBS, spawnEggOf } from '../entity/mobs';
import { registerItem, ItemDef, ToolTier, ToolType, ArmorInfo, FoodInfo, ITEMS } from './items';
import { COLORS } from '../block/defs/helpers';

export const TIERS: Record<string, ToolTier> = {
  wooden: { name: 'wooden', level: 0, uses: 59, speed: 2, damage: 0, enchantability: 15, repair: 'planks' },
  stone: { name: 'stone', level: 1, uses: 131, speed: 4, damage: 1, enchantability: 5, repair: 'stone_tool_materials' },
  copper: { name: 'copper', level: 1, uses: 190, speed: 5, damage: 1, enchantability: 13, repair: 'copper_ingot' },
  iron: { name: 'iron', level: 2, uses: 250, speed: 6, damage: 2, enchantability: 14, repair: 'iron_ingot' },
  golden: { name: 'golden', level: 0, uses: 32, speed: 12, damage: 0, enchantability: 22, repair: 'gold_ingot' },
  diamond: { name: 'diamond', level: 3, uses: 1561, speed: 8, damage: 3, enchantability: 10, repair: 'diamond' },
  infernium: { name: 'infernium', level: 4, uses: 2031, speed: 9, damage: 4, enchantability: 15, repair: 'infernium_ingot' },
};

/** [attack damage, attack speed] per tool type and tier. */
const WEAPON_STATS: Record<ToolType, Record<string, [number, number]>> = {
  sword: { wooden: [4, 1.6], stone: [5, 1.6], copper: [5, 1.6], iron: [6, 1.6], golden: [4, 1.6], diamond: [7, 1.6], infernium: [8, 1.6] },
  axe: { wooden: [7, 0.8], stone: [9, 0.8], copper: [9, 0.8], iron: [9, 0.9], golden: [7, 1.0], diamond: [9, 1.0], infernium: [10, 1.0] },
  pickaxe: { wooden: [2, 1.2], stone: [3, 1.2], copper: [3, 1.2], iron: [4, 1.2], golden: [2, 1.2], diamond: [5, 1.2], infernium: [6, 1.2] },
  shovel: { wooden: [2.5, 1], stone: [3.5, 1], copper: [3.5, 1], iron: [4.5, 1], golden: [2.5, 1], diamond: [5.5, 1], infernium: [6.5, 1] },
  hoe: { wooden: [1, 1], stone: [1, 2], copper: [1, 2], iron: [1, 3], golden: [1, 1], diamond: [1, 4], infernium: [1, 4] },
  shears: {}, mace: {}, trident: {}, brush: {},
};

interface ArmorMaterial {
  defense: [number, number, number, number]; // boots, legs, chest, helmet
  toughness: number;
  knockback: number;
  durability: number;
  enchantability: number;
  repair: string;
}

export const ARMOR_MATERIALS: Record<string, ArmorMaterial> = {
  leather: { defense: [1, 2, 3, 1], toughness: 0, knockback: 0, durability: 5, enchantability: 15, repair: 'leather' },
  copper: { defense: [1, 3, 4, 2], toughness: 0, knockback: 0, durability: 11, enchantability: 8, repair: 'copper_ingot' },
  chainmail: { defense: [1, 4, 5, 2], toughness: 0, knockback: 0, durability: 15, enchantability: 12, repair: 'iron_ingot' },
  iron: { defense: [2, 5, 6, 2], toughness: 0, knockback: 0, durability: 15, enchantability: 9, repair: 'iron_ingot' },
  golden: { defense: [1, 3, 5, 2], toughness: 0, knockback: 0, durability: 7, enchantability: 25, repair: 'gold_ingot' },
  diamond: { defense: [3, 6, 8, 3], toughness: 2, knockback: 0, durability: 33, enchantability: 10, repair: 'diamond' },
  infernium: { defense: [3, 6, 8, 3], toughness: 3, knockback: 0.1, durability: 37, enchantability: 15, repair: 'infernium_ingot' },
  turtle: { defense: [0, 0, 0, 2], toughness: 0, knockback: 0, durability: 25, enchantability: 9, repair: 'turtle_scute' },
};

const ARMOR_SLOTS: Array<[ArmorInfo['slot'], string, number]> = [['feet', 'boots', 13], ['legs', 'leggings', 15], ['chest', 'chestplate', 16], ['head', 'helmet', 11]];

export const MUSIC_DISCS: Array<{ id: string; minutes: number; comparator: number }> = [
  { id: 'disc_ember', minutes: 2.9, comparator: 1 }, { id: 'disc_tide', minutes: 3.1, comparator: 2 }, { id: 'disc_lantern', minutes: 5.8, comparator: 3 },
  { id: 'disc_meadow', minutes: 3.1, comparator: 4 }, { id: 'disc_drift', minutes: 2.9, comparator: 5 }, { id: 'disc_hollow', minutes: 3.3, comparator: 6 },
  { id: 'disc_quartz', minutes: 1.6, comparator: 7 }, { id: 'disc_orbit', minutes: 2.5, comparator: 8 }, { id: 'disc_cinder', minutes: 3.1, comparator: 9 },
  { id: 'disc_fathom', minutes: 4.2, comparator: 10 }, { id: 'disc_bloom', minutes: 1.2, comparator: 11 }, { id: 'disc_vesper', minutes: 3.8, comparator: 12 },
  { id: 'disc_shards', minutes: 2.9, comparator: 15 }, { id: 'disc_aurora', minutes: 3.3, comparator: 13 }, { id: 'disc_marrow', minutes: 2.4, comparator: 14 },
  { id: 'disc_zephyr', minutes: 3.0, comparator: 12 }, { id: 'disc_lumen', minutes: 2.7, comparator: 10 }, { id: 'disc_rust', minutes: 2.2, comparator: 6 },
  { id: 'disc_nocturne', minutes: 3.5, comparator: 4 }, { id: 'disc_keepsake', minutes: 1.0, comparator: 2 }, { id: 'disc_lava_hen', minutes: 2.1, comparator: 9 },
];

export const SHERDS = [
  'fisher', 'bowman', 'rejoice', 'edge', 'alchemist', 'scorch', 'peril', 'wanderer', 'swirl', 'companion', 'gale', 'kinship', 'sorrow', 'baying', 'delver', 'lament', 'harvest', 'trophy', 'scuff', 'stook', 'haven', 'cranium', 'grunt',
];

export const TRIM_PATTERNS = [
  'watchman', 'dunes', 'shoreline', 'thicket', 'bulwark', 'gaze', 'wisp', 'undertow', 'muzzle', 'ribcage', 'pinnacle', 'pathfinder', 'molder', 'hush', 'hoister', 'hearth', 'eddy', 'rivet',
];

export const WOODS_FOR_BOATS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];

function item(id: string, props: Partial<ItemDef> = {}): ItemDef {
  return registerItem(id, props);
}

function food(id: string, nutrition: number, satMod: number, extra: Partial<FoodInfo> = {}, props: Partial<ItemDef> = {}): ItemDef {
  return item(id, {
    category: 'food', useAnim: 'eat', useDuration: extra.fast ? 16 : 32,
    food: { nutrition, saturation: nutrition * satMod * 2, ...extra }, ...props,
  });
}

export function registerItems(): void {
  for (const m of MOBS.values()) if (m.egg) item(spawnEggOf(m.id), { category: 'spawn_eggs' });
  // ---- tools and weapons ----------------------------------------------------------------------
  for (const [tierName, tier] of Object.entries(TIERS)) {
    for (const type of ['sword', 'shovel', 'pickaxe', 'axe', 'hoe'] as ToolType[]) {
      const [dmg, spd] = WEAPON_STATS[type][tierName]!;
      item(`${tierName}_${type}`, {
        category: type === 'sword' ? 'combat' : 'tools', maxStack: 1, maxDamage: tier.uses, enchantability: tier.enchantability,
        tool: { type, tier, attackDamage: dmg, attackSpeed: spd }, fireResistant: tierName === 'infernium',
        tags: [`${type}s`, type === 'sword' ? 'enchantable/sword' : 'enchantable/mining', 'enchantable/durability', ...(type === 'axe' ? ['enchantable/sharp_weapon'] : []), ...(type === 'sword' ? ['enchantable/sharp_weapon', 'enchantable/fire_aspect'] : [])],
        fuel: tierName === 'wooden' ? 200 : undefined,
      });
    }
  }
  const noTier = TIERS.wooden!;
  item('mace', { category: 'combat', maxStack: 1, maxDamage: 500, enchantability: 15, rarity: 'epic', tool: { type: 'mace', tier: noTier, attackDamage: 6, attackSpeed: 0.6 }, tags: ['enchantable/mace', 'enchantable/durability'] });
  item('trident', { category: 'combat', maxStack: 1, maxDamage: 250, enchantability: 1, rarity: 'epic', useAnim: 'spear', useDuration: 72000, tool: { type: 'trident', tier: noTier, attackDamage: 9, attackSpeed: 1.1 }, tags: ['enchantable/trident', 'enchantable/durability'] });
  item('bow', { category: 'combat', maxStack: 1, maxDamage: 384, enchantability: 1, useAnim: 'bow', useDuration: 72000, fuel: 300, tags: ['enchantable/bow', 'enchantable/durability'] });
  item('crossbow', { category: 'combat', maxStack: 1, maxDamage: 465, enchantability: 1, useAnim: 'crossbow', useDuration: 25, fuel: 300, tags: ['enchantable/crossbow', 'enchantable/durability'] });
  item('shield', { category: 'combat', maxStack: 1, maxDamage: 336, useAnim: 'block', useDuration: 72000, fuel: 300, tags: ['enchantable/durability'] });
  item('shears', { category: 'tools', maxStack: 1, maxDamage: 238, tool: { type: 'shears', tier: noTier, attackDamage: 1, attackSpeed: 4 }, tags: ['enchantable/durability', 'enchantable/mining_loot'] });
  item('flint_and_steel', { category: 'tools', maxStack: 1, maxDamage: 64, tags: ['enchantable/durability'] });
  item('fishing_rod', { category: 'tools', maxStack: 1, maxDamage: 64, enchantability: 1, fuel: 300, tags: ['enchantable/fishing', 'enchantable/durability'] });
  item('carrot_on_a_stick', { category: 'tools', maxStack: 1, maxDamage: 25, tags: ['enchantable/durability'] });
  item('warped_fungus_on_a_stick', { category: 'tools', maxStack: 1, maxDamage: 100, tags: ['enchantable/durability'] });
  item('brush', { category: 'tools', maxStack: 1, maxDamage: 64, useAnim: 'brush', useDuration: 200, tool: { type: 'brush', tier: noTier, attackDamage: 1, attackSpeed: 4 }, tags: ['enchantable/durability'] });
  item('spyglass', { category: 'tools', maxStack: 1, useAnim: 'spyglass', useDuration: 1200 });
  item('compass', { category: 'tools', maxStack: 64 });
  item('recovery_compass', { category: 'tools', maxStack: 64, rarity: 'uncommon' });
  item('clock', { category: 'tools', maxStack: 64 });
  item('lead', { category: 'tools' });
  item('name_tag', { category: 'tools' });
  item('goat_horn', { category: 'tools', maxStack: 1, rarity: 'uncommon', useAnim: 'horn', useDuration: 140 });
  item('elytra', { category: 'combat', maxStack: 1, maxDamage: 432, rarity: 'epic', armor: { slot: 'chest', defense: 0, toughness: 0, knockbackResistance: 0, material: 'elytra' }, tags: ['enchantable/durability', 'enchantable/equippable'] });
  item('saddle', { category: 'tools', maxStack: 1 });
  item('totem_of_undying', { category: 'combat', maxStack: 1, rarity: 'uncommon' });
  item('wind_charge', { category: 'combat' });
  item('bundle', { category: 'tools', maxStack: 1, useAnim: 'bundle' });
  for (const c of COLORS) item(`${c}_bundle`, { category: 'tools', maxStack: 1, useAnim: 'bundle' });

  // Buckets
  item('bucket', { category: 'tools', maxStack: 16 });
  item('water_bucket', { category: 'tools', maxStack: 1, craftRemainder: 'bucket' });
  item('lava_bucket', { category: 'tools', maxStack: 1, craftRemainder: 'bucket', fuel: 20000 });
  item('milk_bucket', { category: 'food', maxStack: 1, craftRemainder: 'bucket', useAnim: 'drink', useDuration: 32 });
  item('powder_snow_bucket', { category: 'tools', maxStack: 1 });
  for (const f of ['cod', 'salmon', 'pufferfish', 'tropical_fish', 'axolotl', 'tadpole']) item(`${f}_bucket`, { category: 'tools', maxStack: 1 });

  // Projectiles and throwables
  item('arrow', { category: 'combat', tags: ['arrows'] });
  item('spectral_arrow', { category: 'combat', tags: ['arrows'] });
  item('tipped_arrow', { category: 'combat', tags: ['arrows'] });
  item('snowball', { category: 'combat', maxStack: 16 });
  item('egg', { category: 'combat', maxStack: 16, tags: ['eggs'] });
  item('blue_egg', { category: 'combat', maxStack: 16, tags: ['eggs'] });
  item('brown_egg', { category: 'combat', maxStack: 16, tags: ['eggs'] });
  item('void_pearl', { category: 'combat', maxStack: 16 });
  item('void_eye', { category: 'misc' });
  item('experience_bottle', { category: 'misc', rarity: 'uncommon', glint: true });
  item('fire_charge', { category: 'misc' });
  item('firework_rocket', { category: 'misc' });
  item('firework_star', { category: 'misc' });

  // ---- armor ------------------------------------------------------------------------------------
  for (const [mat, m] of Object.entries(ARMOR_MATERIALS)) {
    if (mat === 'turtle') continue;
    ARMOR_SLOTS.forEach(([slot, piece, base], i) => {
      item(`${mat}_${piece}`, {
        category: 'combat', maxStack: 1, maxDamage: base * m.durability, enchantability: m.enchantability, fireResistant: mat === 'infernium',
        armor: { slot, defense: m.defense[i]!, toughness: m.toughness, knockbackResistance: m.knockback, material: mat },
        tags: [`${slot === 'feet' ? 'foot' : slot === 'legs' ? 'leg' : slot}_armor`, 'enchantable/armor', 'enchantable/durability', 'enchantable/equippable', 'trimmable_armor', `enchantable/${slot === 'feet' ? 'foot' : slot === 'legs' ? 'leg' : slot === 'chest' ? 'chest' : 'head'}_armor`],
      });
    });
  }
  item('turtle_helmet', {
    category: 'combat', maxStack: 1, maxDamage: 11 * 25, enchantability: 9,
    armor: { slot: 'head', defense: 2, toughness: 0, knockbackResistance: 0, material: 'turtle' },
    tags: ['head_armor', 'enchantable/armor', 'enchantable/durability', 'enchantable/head_armor', 'trimmable_armor'],
  });
  for (const m of ['leather', 'iron', 'golden', 'diamond']) item(`${m}_horse_armor`, { category: 'combat', maxStack: 1, extra: { horseArmor: { leather: 3, iron: 5, golden: 7, diamond: 11 }[m] } });
  item('wolf_armor', { category: 'combat', maxStack: 1, maxDamage: 64, extra: { wolfArmor: 11 } });

  // ---- materials ------------------------------------------------------------------------------
  const mats = [
    'coal', 'charcoal', 'diamond', 'emerald', 'lapis_lazuli', 'cinder_quartz', 'amethyst_shard', 'iron_ingot', 'gold_ingot', 'copper_ingot',
    'infernium_ingot', 'infernium_scrap', 'raw_iron', 'raw_gold', 'raw_copper', 'iron_nugget', 'gold_nugget', 'copper_nugget', 'stick', 'bowl',
    'string', 'feather', 'gunpowder', 'flint', 'leather', 'rabbit_hide', 'turtle_scute', 'armadillo_scute', 'bone', 'bone_meal', 'blaze_rod', 'blaze_powder',
    'gust_rod', 'ghast_tear', 'magma_cream', 'slime_ball', 'glowstone_dust', 'flux_dust', 'sugar', 'paper', 'book', 'clay_ball', 'brick', 'cinder_brick',
    'prismarine_shard', 'prismarine_crystals', 'nautilus_shell', 'heart_of_the_sea', 'echo_shard', 'disc_fragment', 'phantom_membrane', 'popped_chorus_fruit',
    'lurker_shell', 'blight_star', 'dragon_breath', 'honeycomb', 'ink_sac', 'glow_ink_sac', 'wheat', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds',
    'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod', 'cocoa_beans', 'glistering_melon_slice', 'fermented_spider_eye', 'rabbit_foot',
    'resin_brick', 'trial_key', 'ominous_trial_key',
  ];
  for (const id of mats) item(id, { category: 'ingredients' });
  ITEMS.get('coal')!.fuel = 1600;
  ITEMS.get('charcoal')!.fuel = 1600;
  ITEMS.get('blaze_rod')!.fuel = 2400;
  ITEMS.get('stick')!.fuel = 100;
  ITEMS.get('bowl')!.fuel = 100;
  ITEMS.get('coal')!.tags.push('coals');
  ITEMS.get('charcoal')!.tags.push('coals');
  ITEMS.get('infernium_ingot')!.fireResistant = true;
  ITEMS.get('infernium_scrap')!.fireResistant = true;
  for (const id of ['heart_of_the_sea', 'blight_star', 'dragon_breath', 'nautilus_shell', 'echo_shard', 'trial_key']) ITEMS.get(id)!.rarity = 'uncommon';
  ITEMS.get('blight_star')!.rarity = 'rare';
  ITEMS.get('blight_star')!.glint = true;
  ITEMS.get('heart_of_the_sea')!.rarity = 'rare';
  ITEMS.get('ominous_trial_key')!.rarity = 'uncommon';
  ITEMS.get('dragon_breath')!.craftRemainder = 'glass_bottle';
  for (const id of ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'torchflower_seeds', 'pitcher_pod', 'cocoa_beans']) {
    ITEMS.get(id)!.compost = id === 'pitcher_pod' || id === 'cocoa_beans' ? 0.65 : 0.3;
  }
  ITEMS.get('wheat')!.compost = 0.65;
  for (const c of COLORS) item(`${c}_dye`, { category: 'ingredients', tags: ['dyes'] });
  item('glass_bottle', { category: 'ingredients' });
  item('honey_bottle', { category: 'food', maxStack: 16, craftRemainder: 'glass_bottle', useAnim: 'drink', useDuration: 40, food: { nutrition: 6, saturation: 1.2, alwaysEdible: false } });
  item('armor_stand', { category: 'functional', maxStack: 16 });
  item('painting', { category: 'functional' });
  item('item_frame', { category: 'functional' });
  item('glow_item_frame', { category: 'functional' });
  item('verge_crystal', { category: 'combat', glint: true });
  item('ominous_bottle', { category: 'food', useAnim: 'drink', useDuration: 32, rarity: 'uncommon' });

  // Sherds, templates, banner patterns
  for (const s of SHERDS) item(`${s}_pottery_sherd`, { category: 'ingredients', tags: ['decorated_pot_sherds'] });
  item('infernium_upgrade_smithing_template', { category: 'ingredients', rarity: 'uncommon' });
  for (const t of TRIM_PATTERNS) item(`${t}_armor_trim_smithing_template`, { category: 'ingredients', rarity: 'uncommon', tags: ['trim_templates'] });
  for (const p of ['flower', 'hisser', 'skull', 'emblem', 'globe', 'snout', 'flow', 'guster', 'field_masoned', 'bordure_indented']) {
    item(`${p}_banner_pattern`, { category: 'ingredients', maxStack: 1, rarity: p === 'emblem' || p === 'skull' || p === 'hisser' ? 'uncommon' : 'common', tags: ['banner_patterns'] });
  }

  // Books and maps
  item('writable_book', { category: 'tools', maxStack: 1 });
  item('written_book', { category: 'tools', maxStack: 16, glint: true });
  item('enchanted_book', { category: 'tools', maxStack: 1, rarity: 'uncommon', glint: true });
  item('knowledge_book', { category: 'operator', maxStack: 1, rarity: 'epic' });
  item('map', { category: 'tools' });
  item('filled_map', { category: 'tools' });
  item('debug_stick', { category: 'operator', maxStack: 1, rarity: 'epic', glint: true });

  // Potions (effects filled in by the brewing module)
  item('potion', { category: 'food', maxStack: 1, useAnim: 'drink', useDuration: 32, craftRemainder: 'glass_bottle' });
  item('splash_potion', { category: 'combat', maxStack: 1 });
  item('lingering_potion', { category: 'combat', maxStack: 1 });

  // Vehicles
  for (const w of WOODS_FOR_BOATS) {
    item(`${w}_boat`, { category: 'tools', maxStack: 1, fuel: 1200, tags: ['boats'] });
    item(`${w}_chest_boat`, { category: 'tools', maxStack: 1, fuel: 1200, tags: ['chest_boats'] });
  }
  item('bamboo_raft', { category: 'tools', maxStack: 1, fuel: 1200, tags: ['boats'] });
  item('bamboo_chest_raft', { category: 'tools', maxStack: 1, fuel: 1200, tags: ['chest_boats'] });
  for (const m of ['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart', 'command_block_minecart']) {
    item(m, { category: m === 'command_block_minecart' ? 'operator' : 'redstone', maxStack: 1 });
  }

  // Music discs
  for (const d of MUSIC_DISCS) item(d.id, { category: 'tools', maxStack: 1, rarity: 'rare', tags: ['music_discs'], extra: { minutes: d.minutes, comparator: d.comparator } });

  // ---- food -------------------------------------------------------------------------------------
  food('apple', 4, 0.3);
  food('golden_apple', 4, 1.2, { alwaysEdible: true, effects: [{ id: 'regeneration', amp: 1, dur: 100, chance: 1 }, { id: 'absorption', amp: 0, dur: 2400, chance: 1 }] }, { rarity: 'rare' });
  food('enchanted_golden_apple', 4, 1.2, {
    alwaysEdible: true,
    effects: [{ id: 'regeneration', amp: 1, dur: 400, chance: 1 }, { id: 'absorption', amp: 3, dur: 2400, chance: 1 }, { id: 'resistance', amp: 0, dur: 6000, chance: 1 }, { id: 'fire_resistance', amp: 0, dur: 6000, chance: 1 }],
  }, { rarity: 'epic', glint: true });
  food('melon_slice', 2, 0.3);
  food('sweet_berries', 2, 0.1);
  food('glow_berries', 2, 0.1);
  food('carrot', 3, 0.3);
  food('potato', 1, 0.3);
  food('baked_potato', 5, 0.6);
  food('poisonous_potato', 2, 0.3, { effects: [{ id: 'poison', amp: 0, dur: 100, chance: 0.6 }] });
  food('beetroot', 1, 0.6);
  food('beetroot_soup', 6, 0.6, { remainder: 'bowl' }, { maxStack: 1 });
  food('bread', 5, 0.6);
  food('cookie', 2, 0.1);
  food('pumpkin_pie', 8, 0.3);
  food('mushroom_stew', 6, 0.6, { remainder: 'bowl' }, { maxStack: 1 });
  food('rabbit_stew', 10, 0.6, { remainder: 'bowl' }, { maxStack: 1 });
  food('suspicious_stew', 6, 0.6, { remainder: 'bowl', alwaysEdible: true }, { maxStack: 1 });
  food('beef', 3, 0.3);
  food('cooked_beef', 8, 0.8);
  food('porkchop', 3, 0.3);
  food('cooked_porkchop', 8, 0.8);
  food('chicken', 2, 0.3, { effects: [{ id: 'hunger', amp: 0, dur: 600, chance: 0.3 }] });
  food('cooked_chicken', 6, 0.6);
  food('mutton', 2, 0.3);
  food('cooked_mutton', 6, 0.8);
  food('rabbit', 3, 0.3);
  food('cooked_rabbit', 5, 0.6);
  food('cod', 2, 0.1, {}, { tags: ['fishes'] });
  food('cooked_cod', 5, 0.6, {}, { tags: ['fishes'] });
  food('salmon', 2, 0.1, {}, { tags: ['fishes'] });
  food('cooked_salmon', 6, 0.8, {}, { tags: ['fishes'] });
  food('tropical_fish', 1, 0.1, {}, { tags: ['fishes'] });
  food('pufferfish', 1, 0.1, { effects: [{ id: 'hunger', amp: 2, dur: 300, chance: 1 }, { id: 'nausea', amp: 0, dur: 300, chance: 1 }, { id: 'poison', amp: 1, dur: 1200, chance: 1 }] }, { tags: ['fishes'] });
  food('rotten_flesh', 4, 0.1, { effects: [{ id: 'hunger', amp: 0, dur: 600, chance: 0.8 }] });
  food('spider_eye', 2, 0.8, { effects: [{ id: 'poison', amp: 0, dur: 100, chance: 1 }] });
  food('dried_kelp', 1, 0.3, { fast: true });
  food('chorus_fruit', 4, 0.3, { alwaysEdible: true });
  food('golden_carrot', 6, 1.2);
  ITEMS.get('rotten_flesh')!.compost = undefined;
  for (const id of ['apple', 'carrot', 'potato', 'baked_potato', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries', 'dried_kelp']) ITEMS.get(id)!.compost = 0.65;
  for (const id of ['bread', 'cookie', 'baked_potato']) ITEMS.get(id)!.compost = 0.85;
  ITEMS.get('pumpkin_pie')!.compost = 1;
}

/** Fuel values and compost chances for block items (by name patterns and tags). */
export function assignBlockItemProperties(blockTags: (name: string) => string[]): void {
  const fuel: Array<[RegExp, number]> = [
    [/^coal_block$/, 16000], [/^dried_kelp_block$/, 4001], [/_slab$/, 150], [/(_door|_sign|_hanging_sign)$/, 200],
    [/_button$/, 100], [/_carpet$/, 67], [/_wool$/, 100], [/_banner$/, 300], [/^(bamboo|scaffolding)$/, 50],
    [/^(crafting_table|cartography_table|fletching_table|smithing_table|loom|bookshelf|chiseled_bookshelf|lectern|composter|note_block|jukebox|barrel|chest|trapped_chest|daylight_detector|bee_nest|beehive)$/, 300],
    [/_(sapling|propagule)$|^(azalea|flowering_azalea|dead_bush)$/, 100], [/^(mangrove_roots)$/, 300], [/_shelf$/, 300],
  ];
  const compost: Array<[RegExp, number]> = [
    [/(_leaves|_sapling|mangrove_propagule|short_grass|^fern$|kelp$|seagrass|glow_lichen|hanging_roots|moss_carpet|small_dripleaf|sweet_berries|vine$|pink_petals|wildflowers|leaf_litter|short_dry_grass)/, 0.3],
    [/(tall_grass|large_fern|tall_dry_grass|cactus|sugar_cane|dried_kelp_block|melon$|nether_sprouts|twisting_vines|weeping_vines|bush$|firefly_bush)/, 0.5],
    [/(poppy|dandelion|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|gazebloom|torchflower|sunflower|lilac|rose_bush|peony|pitcher_plant|spore_blossom|mushroom$|fungus|roots|lily_pad|pumpkin$|carved_pumpkin|sea_pickle|big_dripleaf|azalea$|cocoa|cactus_flower|moss_block|pale_moss|crimson_roots|warped_roots)/, 0.65],
    [/(hay_block|mushroom_block|mushroom_stem|ember_wart_block|warped_wart_block|flowering_azalea$)/, 0.85],
    [/^(cake|pumpkin_pie)$/, 1],
  ];
  for (const def of ITEMS.values()) {
    if (!def.block) continue;
    const n = def.id;
    const tags = blockTags(def.block);
    if (def.fuel === undefined) {
      if (tags.includes('logs') || tags.includes('planks') || /_(stairs|fence|fence_gate|trapdoor|pressure_plate)$/.test(n) && /(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)/.test(n) && !n.includes('stone')) def.fuel = 300;
      for (const [re, v] of fuel) if (re.test(n) && (!/(_slab|_door|_sign|_button|_shelf)$/.test(n) || /(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo)/.test(n))) def.fuel = v;
    }
    if (def.compost === undefined) for (const [re, v] of compost) if (re.test(n)) { def.compost = v; break; }
  }
}
