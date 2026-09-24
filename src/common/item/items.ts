/**
 * Item registry. Block items are generated for every block with an item form; all other
 * items are registered by common/item/defs.ts.
 */
import { BLOCKS, Block, BLOCK_BY_NAME } from '../block/registry';

export type ItemCategory =
  | 'building' | 'colored' | 'natural' | 'functional' | 'redstone' | 'tools' | 'combat' | 'food' | 'ingredients'
  | 'spawn_eggs' | 'operator' | 'misc';

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears' | 'mace' | 'trident' | 'brush';

export interface ToolTier {
  name: string;
  level: number;
  uses: number;
  speed: number;
  damage: number;
  enchantability: number;
  repair: string;
}

export interface FoodInfo {
  nutrition: number;
  saturation: number;
  alwaysEdible?: boolean;
  fast?: boolean;
  effects?: Array<{ id: string; amp: number; dur: number; chance: number }>;
  remainder?: string;
  eatSeconds?: number;
}

export interface ArmorInfo {
  slot: 'head' | 'chest' | 'legs' | 'feet' | 'body';
  defense: number;
  toughness: number;
  knockbackResistance: number;
  material: string;
}

export interface ItemDef {
  id: string;
  maxStack: number;
  maxDamage: number;
  /** Block placed by this item. */
  block?: string;
  category: ItemCategory;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic';
  fireResistant: boolean;
  tool?: { type: ToolType; tier: ToolTier; attackDamage: number; attackSpeed: number };
  armor?: ArmorInfo;
  food?: FoodInfo;
  /** Fuel burn time in ticks. */
  fuel?: number;
  /** Compost chance 0..1. */
  compost?: number;
  /** Container item left after crafting (bucket from milk bucket…). */
  craftRemainder?: string;
  /** Enchantability for enchanting table (0 = not enchantable). */
  enchantability: number;
  /** Tags for recipes / enchantment targets. */
  tags: string[];
  /** Use duration in ticks for items with a use animation. */
  useDuration?: number;
  useAnim?: 'none' | 'eat' | 'drink' | 'block' | 'bow' | 'spear' | 'crossbow' | 'spyglass' | 'horn' | 'brush' | 'bundle';
  /** Texture/icon key (defaults to id). */
  icon?: string;
  /** Glint without enchantments (enchanted golden apple, nether star…). */
  glint?: boolean;
  /** Attribute bonus for maces, etc. */
  extra?: Record<string, unknown>;
}

export const ITEMS = new Map<string, ItemDef>();
export const ITEM_LIST: ItemDef[] = [];

export function registerItem(id: string, props: Partial<ItemDef> = {}): ItemDef {
  if (ITEMS.has(id)) {
    // Allow later definitions to enrich block items (e.g. fuel values)
    const cur = ITEMS.get(id)!;
    Object.assign(cur, props);
    return cur;
  }
  const def: ItemDef = {
    id, maxStack: 64, maxDamage: 0, category: 'misc', rarity: 'common', fireResistant: false, enchantability: 0, tags: [],
    ...props,
  };
  ITEMS.set(id, def);
  ITEM_LIST.push(def);
  return def;
}

export function getItem(id: string): ItemDef | undefined {
  return ITEMS.get(id);
}

export function itemOrThrow(id: string): ItemDef {
  const d = ITEMS.get(id);
  if (!d) throw new Error('Unknown item ' + id);
  return d;
}

function blockCategory(b: Block): ItemCategory {
  const n = b.name;
  const t = b.settings.tags ?? [];
  if (/(wool|carpet|concrete|terracotta|stained|candle|bed|banner|shell_box)/.test(n)) return 'colored';
  if (/(flux|repeater|comparator|piston|observer|hopper|dropper|dispenser|lever|button|pressure_plate|rail|tnt|daylight|target|tripwire|lamp|note_block|crafter|sensor|lightning_rod)/.test(n)) return 'redstone';
  if (/(table|furnace|smoker|chest|barrel|anvil|stand|cauldron|grindstone|loom|stonecutter|composter|lectern|bell|campfire|beacon|conduit|lodestone|anchor|bookshelf|jukebox|beehive|bee_nest|lantern|torch|ladder|scaffolding|sign|flower_pot|spawner|vault|decorated_pot|shelf|head|skull)/.test(n)) return 'functional';
  if (t.includes('logs') || t.includes('leaves') || t.includes('saplings') || t.includes('flowers') || /(ore|dirt|grass|sand|gravel|clay|moss|mud|snow|ice|stone$|deepslate$|tuff$|calcite|dripstone|amethyst|cinderrack|nylium|soul|basalt|blackstone$|verge_stone$|coral|kelp|seagrass|mushroom|vine|fungus|roots|bamboo$|cactus|sugar_cane|lily|pumpkin|melon|hay|bone_block|egg|froglight|sponge|obsidian|magma|glowstone|podzol|mycelium|fern|bush|petals|leaf_litter|dripleaf|azalea|spore|chorus|frogspawn|sniffer|sculk|echo)/.test(n)) return 'natural';
  return 'building';
}

/** Create block items for every block that has an item form. */
export function registerBlockItems(): void {
  for (const b of BLOCKS) {
    const s = b.settings;
    if (s.noItem || s.air || s.fluid && (b.name === 'water' || b.name === 'lava')) continue;
    const id = s.itemId ?? b.name;
    if (id !== b.name && BLOCK_BY_NAME.has(id) && !ITEMS.has(id)) continue; // wall variants map to standing item
    const existing = ITEMS.get(id);
    if (existing) {
      if (!existing.block) existing.block = b.name;
      b.item = id;
      continue;
    }
    const def = registerItem(id, { block: b.name, category: blockCategory(b) });
    if (s.tags?.includes('shell_boxes')) def.maxStack = 1;
    if (s.tags?.includes('beds') || s.tags?.includes('banners')) def.maxStack = b.name.endsWith('banner') ? 16 : 1;
    if (s.tags?.includes('signs')) def.maxStack = 16;
    if (b.name === 'cake') def.maxStack = 1;
    if (/(command_block|structure_block|jigsaw|barrier|light$|structure_void|spawner|trial_spawner|vault)/.test(b.name)) def.category = 'operator';
    if (b.name === 'dragon_egg' || b.name === 'beacon' || b.name === 'conduit') def.rarity = b.name === 'dragon_egg' ? 'epic' : 'rare';
    if (s.flammable || s.tags?.includes('planks') || s.tags?.includes('logs')) {
      def.fuel = s.tags?.includes('logs') || s.tags?.includes('planks') ? 300 : undefined;
    }
    b.item = id;
  }
  // Map wall/variant blocks to their items
  for (const b of BLOCKS) {
    if (!b.item && b.settings.itemId && ITEMS.has(b.settings.itemId)) b.item = b.settings.itemId;
  }
}

/** Block placed by an item id, if any. */
export function blockForItem(id: string): Block | undefined {
  const d = ITEMS.get(id);
  if (!d?.block) return undefined;
  return BLOCK_BY_NAME.get(d.block);
}
