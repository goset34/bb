/**
 * Concrete menus: player inventory (2×2 crafting, armor, off hand) and the crafting table.
 * Other milestones register more kinds (chests, furnaces, stations) in MENU_TYPES so the client
 * can mirror whatever the server opens.
 */
import { ItemStack } from '../item/stack';
import { getItem } from '../item/items';
import type { Inventory } from '../entity/player';
import { INV_ARMOR, INV_OFFHAND } from '../entity/player';
import { Container, InventoryContainer, CraftingContainer, ResultContainer, SimpleContainer, maxStackOf } from './container';
import { Menu, MenuPlayer, Slot } from './menu';
import { findCrafting, craftingRemainders, RECIPES, ShapedRecipe, ShapelessRecipe, matches, ingredientItems } from '../recipe/recipes';

/** Equipment slot of a wearable item: 3 head, 2 chest, 1 legs, 0 feet, -1 none. */
export function armorSlotOf(id: string): number {
  const def = getItem(id);
  if (def?.armor && def.armor.slot !== 'body') return { feet: 0, legs: 1, chest: 2, head: 3 }[def.armor.slot];
  if (id === 'elytra') return 2;
  if (id === 'carved_pumpkin' || id.endsWith('_head') || id.endsWith('_skull')) return 3;
  return -1;
}

export class ArmorSlot extends Slot {
  constructor(container: Container, slot: number, x: number, y: number, readonly armorIndex: number) {
    super(container, slot, x, y);
  }
  override mayPlace(s: ItemStack): boolean {
    return armorSlotOf(s.id) === this.armorIndex;
  }
  override maxStack(): number {
    return 1;
  }
  override mayPickup(p: MenuPlayer): boolean {
    const s = this.stack;
    return p.creative || s.isEmpty() || s.getEnchant('binding_curse') === 0;
  }
}

/** Crafting result slot: taking consumes one set of ingredients and leaves remainders. */
export class ResultSlot extends Slot {
  constructor(private readonly menu: CraftingMenuBase, container: ResultContainer, x: number, y: number) {
    super(container, 0, x, y);
  }
  override mayPlace(): boolean {
    return false;
  }
  /** The whole result is always taken. */
  override remove(_n: number): ItemStack {
    return super.remove(this.stack.count);
  }
  override onTake(p: MenuPlayer, stack: ItemStack): void {
    this.menu.consumeIngredients(p, stack);
  }
}

/** Shared logic of the 2×2 and 3×3 crafting menus. */
export abstract class CraftingMenuBase extends Menu {
  readonly grid: CraftingContainer;
  readonly result = new ResultContainer();
  private consuming = false;

  constructor(kind: string, windowId: number, w: number, h: number) {
    super(kind, windowId);
    this.grid = new CraftingContainer(w, h);
    this.grid.onChange(() => this.slotsChanged(this.grid));
  }

  override slotsChanged(c: Container): void {
    if (c !== this.grid || this.consuming) return;
    const m = findCrafting(this.grid);
    this.result.set(0, m ? m.result.copy() : ItemStack.empty());
    this.result.recipeId = m?.recipe.id ?? null;
  }

  consumeIngredients(p: MenuPlayer, taken: ItemStack): void {
    const m = findCrafting(this.grid);
    p.onCrafted?.(taken, taken.count);
    if (!m) return;
    const rem = craftingRemainders(m, this.grid);
    this.consuming = true;
    for (let i = 0; i < this.grid.size; i++) {
      const cur = this.grid.get(i);
      const r = rem[i] ?? ItemStack.empty();
      if (!cur.isEmpty()) {
        cur.shrink(1);
        this.grid.set(i, cur.isEmpty() ? ItemStack.empty() : cur);
      }
      if (r.isEmpty()) continue;
      const now = this.grid.get(i);
      if (now.isEmpty()) this.grid.set(i, r);
      else if (now.sameItemSameData(r)) { now.grow(r.count); this.grid.set(i, now); }
      else if (!p.inventory.add(r, maxStackOf(r))) p.drop(r);
    }
    this.consuming = false;
    this.slotsChanged(this.grid);
  }

  protected override isResultSlot(s: Slot): boolean {
    return s.container === this.result;
  }

  /** Would the whole stack fit into slots [start, end)? */
  protected canFit(stack: ItemStack, start: number, end: number): boolean {
    let left = stack.count;
    const max = maxStackOf(stack);
    for (let i = start; i < end && left > 0; i++) {
      const cur = this.slots[i]!.stack;
      if (cur.isEmpty()) left -= max;
      else if (cur.sameItemSameData(stack)) left -= max - cur.count;
    }
    return left <= 0;
  }

  /** Return grid contents to the player when the menu closes. */
  override removed(p: MenuPlayer): void {
    super.removed(p);
    for (let i = 0; i < this.grid.size; i++) {
      const s = this.grid.get(i);
      if (s.isEmpty()) continue;
      this.grid.set(i, ItemStack.empty());
      p.inventory.add(s, maxStackOf(s));
      if (!s.isEmpty()) p.drop(s);
    }
    this.grid.changed();
  }

  /** First/last menu indices of the grid, player inventory (main+hotbar). */
  abstract get gridRange(): [number, number];
  abstract get invRange(): [number, number];
}

// ---------------------------------------------------------------------------------------------
// Player inventory (window 0)
// ---------------------------------------------------------------------------------------------

export class InventoryMenu extends CraftingMenuBase {
  readonly inv: InventoryContainer;

  constructor(inventory: Inventory) {
    super('inventory', 0, 2, 2);
    this.inv = new InventoryContainer(inventory);
    this.addSlot(new ResultSlot(this, this.result, 154, 28));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) this.addSlot(new Slot(this.grid, r * 2 + c, 98 + c * 18, 18 + r * 18));
    for (let i = 0; i < 4; i++) this.addSlot(new ArmorSlot(this.inv, INV_ARMOR + 3 - i, 8, 8 + i * 18, 3 - i));
    this.addPlayerSlots(this.inv, 8, 84);
    this.addSlot(new Slot(this.inv, INV_OFFHAND, 77, 62));
  }

  get gridRange(): [number, number] { return [1, 5]; }
  get invRange(): [number, number] { return [9, 45]; }

  quickMoveStack(p: MenuPlayer, index: number): ItemStack {
    const slot = this.slots[index];
    if (!slot || !slot.hasItem()) return ItemStack.empty();
    const stack = slot.stack;
    const original = stack.copy();
    const armor = armorSlotOf(stack.id);
    if (index === 0) {
      if (!this.canFit(stack, 9, 45) || !this.moveItemStackTo(stack, 9, 45, true)) return ItemStack.empty();
      slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
      slot.onTake(p, original.copyWithCount(original.count - stack.count));
      return original;
    }
    if (index >= 1 && index < 9) {
      if (!this.moveItemStackTo(stack, 9, 45, false)) return ItemStack.empty();
    } else if (armor >= 0 && !this.slots[8 - armor]!.hasItem()) {
      if (!this.moveItemStackTo(stack, 8 - armor, 9 - armor, false)) return ItemStack.empty();
    } else if (stack.id === 'shield' && !this.slots[45]!.hasItem() && index !== 45) {
      if (!this.moveItemStackTo(stack, 45, 46, false)) return ItemStack.empty();
    } else if (index >= 9 && index < 36) {
      if (!this.moveItemStackTo(stack, 36, 45, false)) return ItemStack.empty();
    } else if (index >= 36 && index < 45) {
      if (!this.moveItemStackTo(stack, 9, 36, false)) return ItemStack.empty();
    } else if (!this.moveItemStackTo(stack, 9, 45, false)) return ItemStack.empty();
    slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
    return original;
  }
}

// ---------------------------------------------------------------------------------------------
// Crafting table
// ---------------------------------------------------------------------------------------------

export class CraftingMenu extends CraftingMenuBase {
  constructor(windowId: number, inventory: Inventory, private readonly valid: (p: MenuPlayer) => boolean = () => true) {
    super('crafting', windowId, 3, 3);
    const inv = new InventoryContainer(inventory);
    this.addSlot(new ResultSlot(this, this.result, 124, 35));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.addSlot(new Slot(this.grid, r * 3 + c, 30 + c * 18, 17 + r * 18));
    this.addPlayerSlots(inv, 8, 84);
  }

  get gridRange(): [number, number] { return [1, 10]; }
  get invRange(): [number, number] { return [10, 46]; }

  override stillValid(p: MenuPlayer): boolean {
    return this.valid(p);
  }

  quickMoveStack(p: MenuPlayer, index: number): ItemStack {
    const slot = this.slots[index];
    if (!slot || !slot.hasItem()) return ItemStack.empty();
    const stack = slot.stack;
    const original = stack.copy();
    if (index === 0) {
      if (!this.canFit(stack, 10, 46) || !this.moveItemStackTo(stack, 10, 46, true)) return ItemStack.empty();
      slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
      slot.onTake(p, original.copyWithCount(original.count - stack.count));
      return original;
    }
    if (index >= 10 && index < 46) {
      if (!this.moveItemStackTo(stack, 1, 10, false)) {
        if (index < 37) { if (!this.moveItemStackTo(stack, 37, 46, false)) return ItemStack.empty(); }
        else if (!this.moveItemStackTo(stack, 10, 37, false)) return ItemStack.empty();
      }
    } else if (!this.moveItemStackTo(stack, 10, 46, false)) return ItemStack.empty();
    slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
    return original;
  }
}

// ---------------------------------------------------------------------------------------------
// Recipe book placement
// ---------------------------------------------------------------------------------------------

/** Ingredient layout of a recipe for a w×h grid (null when it does not fit). */
export function recipeLayout(recipeId: string, w: number, h: number): Array<string | null> | null {
  const r = RECIPES.get(recipeId);
  if (!r) return null;
  const out: Array<string | null> = new Array(w * h).fill(null);
  if (r.type === 'shaped') {
    const sr = r as ShapedRecipe;
    const ph = sr.pattern.length, pw = Math.max(...sr.pattern.map((row) => row.length));
    if (pw > w || ph > h) return null;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const ch = sr.pattern[y]![x] ?? ' ';
      if (ch !== ' ') out[y * w + x] = sr.key[ch]!;
    }
    return out;
  }
  if (r.type === 'shapeless') {
    const sl = r as ShapelessRecipe;
    if (sl.ingredients.length > w * h) return null;
    sl.ingredients.forEach((ing, i) => { out[i] = ing; });
    return out;
  }
  return null;
}

/**
 * Fill the crafting grid for a recipe from the player's inventory (one set, or as many sets as
 * possible when `all`). Returns false when the ingredients are not available.
 */
export function placeRecipe(menu: CraftingMenuBase, recipeId: string, all: boolean, p: MenuPlayer): boolean {
  const grid = menu.grid;
  const layout = recipeLayout(recipeId, grid.width, grid.height);
  if (!layout) return false;
  const inv = p.inventory;
  // Return current grid contents
  for (let i = 0; i < grid.size; i++) {
    const s = grid.get(i);
    if (s.isEmpty()) continue;
    grid.set(i, ItemStack.empty());
    inv.add(s, maxStackOf(s));
    if (!s.isEmpty()) p.drop(s);
  }
  // How many sets can we make?
  const needed = layout.filter((x): x is string => x !== null);
  const counts = new Map<number, number>();
  const pick = (ing: string, reserve: Map<number, number>): number => {
    for (let i = 0; i < 36; i++) {
      const s = inv.get(i);
      if (s.isEmpty() || !matches(ing, s)) continue;
      const used = reserve.get(i) ?? 0;
      if (s.count - used > 0) return i;
    }
    return -1;
  };
  let sets = 0;
  const maxSets = all ? 64 : 1;
  const plan: number[][] = [];
  while (sets < maxSets) {
    const reserve = new Map(counts);
    const picks: number[] = [];
    let ok = true;
    for (const ing of needed) {
      const i = pick(ing, reserve);
      if (i < 0) { ok = false; break; }
      reserve.set(i, (reserve.get(i) ?? 0) + 1);
      picks.push(i);
    }
    if (!ok) break;
    // Stack limits of the grid slots
    if (picks.some((i) => sets + 1 > maxStackOf(inv.get(i)))) break;
    for (const [k, v] of reserve) counts.set(k, v);
    plan.push(picks);
    sets++;
  }
  if (sets === 0) {
    grid.changed();
    return false;
  }
  for (const picks of plan) {
    let k = 0;
    for (let slot = 0; slot < layout.length; slot++) {
      if (layout[slot] === null) continue;
      const from = picks[k++]!;
      const s = inv.get(from);
      const one = s.split(1);
      if (s.isEmpty()) inv.set(from, ItemStack.empty());
      const cur = grid.get(slot);
      if (cur.isEmpty()) grid.set(slot, one);
      else cur.grow(1);
    }
  }
  inv.revision++;
  grid.changed();
  return true;
}

/** Items used by each recipe (for recipe unlocking when items are obtained). */
export function recipeIngredientIds(recipeId: string): Set<string> {
  const out = new Set<string>();
  const r = RECIPES.get(recipeId);
  if (!r) return out;
  const add = (ing: string) => { for (const id of ingredientItems(ing)) out.add(id); };
  if (r.type === 'shaped') for (const v of Object.values(r.key)) add(v);
  else if (r.type === 'shapeless') for (const v of r.ingredients) add(v);
  else if ('ingredient' in r) add(r.ingredient);
  else if (r.type === 'smithing_transform' || r.type === 'smithing_trim') { add(r.template); add(r.base); add(r.addition); }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Registry (client mirrors server menus by kind)
// ---------------------------------------------------------------------------------------------

export interface MenuFactoryCtx {
  windowId: number;
  inventory: Inventory;
  /** Number of container slots (generic containers). */
  size: number;
  extra: Record<string, unknown>;
}

export const MENU_TYPES = new Map<string, (ctx: MenuFactoryCtx) => Menu>();

MENU_TYPES.set('crafting', (c) => new CraftingMenu(c.windowId, c.inventory));

/** Generic chest-like menu of `rows` × 9 slots. */
export class GenericMenu extends Menu {
  readonly rows: number;
  constructor(kind: string, windowId: number, readonly container: Container, inventory: Inventory, private readonly valid: (p: MenuPlayer) => boolean = () => true, cols = 9) {
    super(kind, windowId);
    this.rows = Math.ceil(container.size / cols);
    for (let i = 0; i < container.size; i++) this.addSlot(new Slot(container, i, 8 + (i % cols) * 18, 18 + Math.floor(i / cols) * 18));
    this.addPlayerSlots(new InventoryContainer(inventory), 8, 31 + this.rows * 18);
  }
  override stillValid(p: MenuPlayer): boolean {
    return this.valid(p);
  }
  quickMoveStack(_p: MenuPlayer, index: number): ItemStack {
    const slot = this.slots[index];
    if (!slot || !slot.hasItem()) return ItemStack.empty();
    const stack = slot.stack;
    const original = stack.copy();
    const n = this.container.size;
    if (index < n) { if (!this.moveItemStackTo(stack, n, this.slots.length, true)) return ItemStack.empty(); }
    else if (!this.moveItemStackTo(stack, 0, n, false)) return ItemStack.empty();
    slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
    return original;
  }
}

MENU_TYPES.set('generic', (c) => new GenericMenu('generic', c.windowId, new SimpleContainer(c.size), c.inventory));
