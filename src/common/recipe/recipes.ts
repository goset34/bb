/**
 * Recipe registry and matching: shaped / shapeless / special crafting, cooking (furnace,
 * blast furnace, smoker, campfire), stonecutting and smithing. Ingredients are item ids,
 * `#tag` item tags, or `a|b|c` alternatives.
 */
import { ItemStack, ItemData } from '../item/stack';
import { ITEMS, getItem } from '../item/items';
import { TAGS, BLOCK_BY_NAME, BLOCKS } from '../block/registry';

export type RecipeCategory = 'building' | 'redstone' | 'equipment' | 'misc' | 'food' | 'blocks' | 'items';

export interface Result {
  id: string;
  count: number;
  data?: ItemData;
}

export type Ingredient = string;

export interface ShapedRecipe {
  type: 'shaped';
  id: string;
  category: RecipeCategory;
  group?: string;
  pattern: string[];
  key: Record<string, Ingredient>;
  result: Result;
}

export interface ShapelessRecipe {
  type: 'shapeless';
  id: string;
  category: RecipeCategory;
  group?: string;
  ingredients: Ingredient[];
  result: Result;
}

/** Recipes computed from the grid content (dyeing, fireworks, repairs…). */
export interface SpecialRecipe {
  type: 'special';
  id: string;
  category: RecipeCategory;
  /** Result or null when the grid does not match. */
  match(grid: CraftingGrid): ItemStack | null;
  /** Custom leftovers (book cloning keeps the original…). */
  remainders?(grid: CraftingGrid): ItemStack[] | null;
}

export type CraftingRecipe = ShapedRecipe | ShapelessRecipe | SpecialRecipe;

export type CookingKind = 'smelting' | 'blasting' | 'smoking' | 'campfire';

export interface CookingRecipe {
  type: CookingKind;
  id: string;
  category: RecipeCategory;
  ingredient: Ingredient;
  result: Result;
  xp: number;
  /** Cooking time in ticks. */
  time: number;
}

export interface StonecuttingRecipe {
  type: 'stonecutting';
  id: string;
  ingredient: Ingredient;
  result: Result;
}

export interface SmithingRecipe {
  type: 'smithing_transform' | 'smithing_trim';
  id: string;
  template: Ingredient;
  base: Ingredient;
  addition: Ingredient;
  /** Transform result (trims keep the base item and add trim data). */
  result?: Result;
}

export type Recipe = CraftingRecipe | CookingRecipe | StonecuttingRecipe | SmithingRecipe;

/** A crafting grid (width × height) of stacks. */
export interface CraftingGrid {
  width: number;
  height: number;
  items: ItemStack[];
}

// ---------------------------------------------------------------------------------------------
// Item tags
// ---------------------------------------------------------------------------------------------

const itemTags = new Map<string, Set<string>>();
const extraTagMembers: Array<[string, string[]]> = [];

/** Add items to an item tag (in addition to block tags and item definition tags). */
export function addItemTag(tag: string, ids: string[]): void {
  extraTagMembers.push([tag, ids]);
  itemTags.clear();
}

function buildTags(): void {
  // Block tags → item tags (via block items)
  for (const [tag, set] of TAGS) {
    const s = new Set<string>();
    for (const bi of set) {
      const b = BLOCKS[bi]!;
      if (b.item) s.add(b.item);
    }
    itemTags.set(tag, s);
  }
  for (const def of ITEMS.values()) {
    for (const t of def.tags) {
      let s = itemTags.get(t);
      if (!s) itemTags.set(t, (s = new Set()));
      s.add(def.id);
    }
  }
  for (const [tag, ids] of extraTagMembers) {
    let s = itemTags.get(tag);
    if (!s) itemTags.set(tag, (s = new Set()));
    for (const id of ids) if (ITEMS.has(id)) s.add(id);
  }
}

export function itemTag(tag: string): Set<string> {
  if (itemTags.size === 0) buildTags();
  return itemTags.get(tag) ?? new Set();
}

export function itemHasTag(id: string, tag: string): boolean {
  return itemTag(tag).has(id);
}

const ingredientCache = new Map<string, Set<string>>();

/** Item ids accepted by an ingredient. */
export function ingredientItems(ing: Ingredient): Set<string> {
  let s = ingredientCache.get(ing);
  if (s) return s;
  s = new Set();
  for (const part of ing.split('|')) {
    if (part.startsWith('#')) for (const id of itemTag(part.slice(1))) s.add(id);
    else s.add(part);
  }
  ingredientCache.set(ing, s);
  return s;
}

export function matches(ing: Ingredient, stack: ItemStack): boolean {
  if (stack.isEmpty()) return false;
  return ingredientItems(ing).has(stack.id);
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

export const RECIPES = new Map<string, Recipe>();
const crafting: CraftingRecipe[] = [];
const cooking: CookingRecipe[] = [];
const stonecutting: StonecuttingRecipe[] = [];
const smithing: SmithingRecipe[] = [];

export function addRecipe(r: Recipe): void {
  if (RECIPES.has(r.id)) throw new Error('Duplicate recipe ' + r.id);
  RECIPES.set(r.id, r);
  switch (r.type) {
    case 'shaped': case 'shapeless': case 'special': crafting.push(r); break;
    case 'smelting': case 'blasting': case 'smoking': case 'campfire': cooking.push(r); break;
    case 'stonecutting': stonecutting.push(r); break;
    default: smithing.push(r);
  }
}

export function craftingRecipes(): readonly CraftingRecipe[] {
  return crafting;
}

export function cookingRecipes(kind?: CookingKind): CookingRecipe[] {
  return kind ? cooking.filter((r) => r.type === kind) : cooking;
}

export function stonecuttingRecipes(): readonly StonecuttingRecipe[] {
  return stonecutting;
}

export function smithingRecipes(): readonly SmithingRecipe[] {
  return smithing;
}

export function resultStack(r: Result): ItemStack {
  return new ItemStack(r.id, r.count, r.data ? JSON.parse(JSON.stringify(r.data)) as ItemData : {});
}

// ---------------------------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------------------------

interface Trimmed {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

function trim(grid: CraftingGrid): Trimmed | null {
  let x0 = grid.width, y0 = grid.height, x1 = -1, y1 = -1;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    if (grid.items[y * grid.width + x]!.isEmpty()) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function shapedMatch(r: ShapedRecipe, grid: CraftingGrid, t: Trimmed, mirror: boolean): boolean {
  const ph = r.pattern.length, pw = r.pattern[0]!.length;
  if (pw !== t.w || ph !== t.h) return false;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const ch = r.pattern[y]![mirror ? pw - 1 - x : x]!;
      const stack = grid.items[(t.y0 + y) * grid.width + t.x0 + x]!;
      if (ch === ' ') {
        if (!stack.isEmpty()) return false;
      } else if (!matches(r.key[ch]!, stack)) return false;
    }
  }
  return true;
}

function shapelessMatch(r: ShapelessRecipe, grid: CraftingGrid): boolean {
  const stacks = grid.items.filter((s) => !s.isEmpty());
  if (stacks.length !== r.ingredients.length) return false;
  const used = new Array<boolean>(stacks.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === r.ingredients.length) return true;
    const ing = r.ingredients[i]!;
    for (let k = 0; k < stacks.length; k++) {
      if (used[k] || !matches(ing, stacks[k]!)) continue;
      used[k] = true;
      if (assign(i + 1)) return true;
      used[k] = false;
    }
    return false;
  };
  return assign(0);
}

export interface CraftMatch {
  recipe: CraftingRecipe;
  result: ItemStack;
}

/** Find the crafting recipe matching the grid. */
export function findCrafting(grid: CraftingGrid): CraftMatch | null {
  const t = trim(grid);
  if (!t) return null;
  for (const r of crafting) {
    if (r.type === 'shaped') {
      if (shapedMatch(r, grid, t, false) || shapedMatch(r, grid, t, true)) return { recipe: r, result: resultStack(r.result) };
    } else if (r.type === 'shapeless') {
      if (shapelessMatch(r, grid)) return { recipe: r, result: resultStack(r.result) };
    } else {
      const out = r.match(grid);
      if (out) return { recipe: r, result: out };
    }
  }
  return null;
}

/** Items left in the grid after crafting once (buckets, bottles…), same layout as the grid. */
export function craftingRemainders(match: CraftMatch, grid: CraftingGrid): ItemStack[] {
  if (match.recipe.type === 'special' && match.recipe.remainders) {
    const r = match.recipe.remainders(grid);
    if (r) return r;
  }
  return grid.items.map((s) => {
    if (s.isEmpty()) return ItemStack.empty();
    const rem = getItem(s.id)?.craftRemainder;
    return rem ? new ItemStack(rem, 1) : ItemStack.empty();
  });
}

// ---------------------------------------------------------------------------------------------
// Other stations
// ---------------------------------------------------------------------------------------------

export function findCooking(kind: CookingKind, input: ItemStack): CookingRecipe | null {
  if (input.isEmpty()) return null;
  for (const r of cooking) if (r.type === kind && matches(r.ingredient, input)) return r;
  return null;
}

export function stonecutterOptions(input: ItemStack): StonecuttingRecipe[] {
  if (input.isEmpty()) return [];
  return stonecutting.filter((r) => matches(r.ingredient, input)).sort((a, b) => a.result.id.localeCompare(b.result.id));
}

export function findSmithing(template: ItemStack, base: ItemStack, addition: ItemStack): { recipe: SmithingRecipe; result: ItemStack } | null {
  for (const r of smithing) {
    if (!matches(r.template, template) || !matches(r.base, base) || !matches(r.addition, addition)) continue;
    if (r.type === 'smithing_transform') {
      const out = new ItemStack(r.result!.id, r.result!.count, JSON.parse(JSON.stringify(base.data)) as ItemData);
      return { recipe: r, result: out };
    }
    const pattern = template.id.replace(/_armor_trim_smithing_template$/, '');
    const material = TRIM_MATERIALS[addition.id];
    if (!material) continue;
    if (base.data.trim && base.data.trim.pattern === pattern && base.data.trim.material === material) continue;
    const out = base.copyWithCount(1);
    out.data.trim = { pattern, material };
    return { recipe: r, result: out };
  }
  return null;
}

/** Items usable as armor trim materials → trim material name. */
export const TRIM_MATERIALS: Record<string, string> = {
  iron_ingot: 'iron', copper_ingot: 'copper', gold_ingot: 'gold', lapis_lazuli: 'lapis', emerald: 'emerald', diamond: 'diamond',
  infernium_ingot: 'infernium', flux_dust: 'flux', amethyst_shard: 'amethyst', cinder_quartz: 'quartz', resin_brick: 'resin',
};

/** Whether an item id is a block item whose block exists (used by recipe validation). */
export function isKnownItem(id: string): boolean {
  return ITEMS.has(id) || BLOCK_BY_NAME.has(id);
}
