/**
 * Furnace-family menus (furnace, blast furnace, smoker) and the smelting logic shared by the
 * server block entity: fuel burning, cooking progress, output stacking and stored experience.
 */
import { ItemStack } from '../item/stack';
import { getItem } from '../item/items';
import type { Inventory } from '../entity/player';
import { Container, InventoryContainer, SimpleContainer, maxStackOf } from './container';
import { Menu, MenuPlayer, Slot, FilteredSlot } from './menu';
import { findCooking, CookingKind, CookingRecipe, RECIPES } from '../recipe/recipes';
import { MENU_TYPES } from './menus';

export const FURNACE_KINDS: Record<string, CookingKind> = { furnace: 'smelting', blast_furnace: 'blasting', smoker: 'smoking' };

/** Data slots: 0 burn time left, 1 burn total, 2 cook progress, 3 cook total. */
export const FD = { BURN: 0, BURN_TOTAL: 1, COOK: 2, COOK_TOTAL: 3 } as const;

export function fuelTicks(stack: ItemStack): number {
  if (stack.isEmpty()) return 0;
  return getItem(stack.id)?.fuel ?? 0;
}

export class FurnaceOutputSlot extends Slot {
  constructor(container: Container, slot: number, x: number, y: number, private readonly onOutput: (p: MenuPlayer, stack: ItemStack) => void) {
    super(container, slot, x, y);
  }
  override mayPlace(): boolean {
    return false;
  }
  override onTake(p: MenuPlayer, stack: ItemStack): void {
    this.onOutput(p, stack);
    super.onTake(p, stack);
  }
}

export class FurnaceMenu extends Menu {
  readonly cooking: CookingKind;

  constructor(kind: string, windowId: number, readonly container: Container, inventory: Inventory, private readonly valid: (p: MenuPlayer) => boolean = () => true, onOutput: (p: MenuPlayer, stack: ItemStack) => void = () => {}) {
    super(kind, windowId);
    this.cooking = FURNACE_KINDS[kind] ?? 'smelting';
    this.addSlot(new FilteredSlot(container, 0, 56, 17, () => true));
    this.addSlot(new FilteredSlot(container, 1, 56, 53, (s) => fuelTicks(s) > 0 || s.id === 'bucket'));
    this.addSlot(new FurnaceOutputSlot(container, 2, 116, 35, onOutput));
    this.addPlayerSlots(new InventoryContainer(inventory), 8, 84);
    this.data.push(0, 0, 0, 0);
  }

  override stillValid(p: MenuPlayer): boolean {
    return this.valid(p);
  }

  protected override isResultSlot(s: Slot): boolean {
    return s.index === 2;
  }

  quickMoveStack(p: MenuPlayer, index: number): ItemStack {
    const slot = this.slots[index];
    if (!slot || !slot.hasItem()) return ItemStack.empty();
    const stack = slot.stack;
    const original = stack.copy();
    if (index === 2) {
      if (!this.moveItemStackTo(stack, 3, 39, true)) return ItemStack.empty();
      slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
      slot.onTake(p, original.copyWithCount(original.count - stack.count));
      return original;
    }
    if (index >= 3) {
      if (findCooking(this.cooking, stack)) {
        if (!this.moveItemStackTo(stack, 0, 1, false)) return ItemStack.empty();
      } else if (fuelTicks(stack) > 0) {
        if (!this.moveItemStackTo(stack, 1, 2, false)) return ItemStack.empty();
      } else if (index < 30) {
        if (!this.moveItemStackTo(stack, 30, 39, false)) return ItemStack.empty();
      } else if (!this.moveItemStackTo(stack, 3, 30, false)) return ItemStack.empty();
    } else if (!this.moveItemStackTo(stack, 3, 39, false)) return ItemStack.empty();
    slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
    return original;
  }

  /** Burn progress 0..1 (flame). */
  get burnProgress(): number {
    const total = this.data[FD.BURN_TOTAL] || 200;
    return Math.max(0, Math.min(1, (this.data[FD.BURN] ?? 0) / total));
  }

  /** Cook progress 0..1 (arrow). */
  get cookProgress(): number {
    const total = this.data[FD.COOK_TOTAL] ?? 0;
    return total > 0 ? Math.max(0, Math.min(1, (this.data[FD.COOK] ?? 0) / total)) : 0;
  }
}

/** Furnace state persisted in the block entity. */
export interface FurnaceState {
  burn: number;
  burnTotal: number;
  cook: number;
  cookTotal: number;
  /** Stored experience per recipe id (awarded when output is taken). */
  xp: Record<string, number>;
  /** Input item of the current cooking progress (changing it restarts). */
  input?: string;
}

export function newFurnaceState(): FurnaceState {
  return { burn: 0, burnTotal: 0, cook: 0, cookTotal: 0, xp: {} };
}

/** Can the recipe's result be merged into the output slot? */
function canBurn(recipe: CookingRecipe | null, c: Container): boolean {
  if (!recipe) return false;
  const out = c.get(2);
  if (out.isEmpty()) return true;
  if (out.id !== recipe.result.id) return false;
  return out.count + recipe.result.count <= maxStackOf(out);
}

/**
 * One tick of a furnace. Returns true when the lit state changed (block state update) and
 * whether contents changed (save).
 */
export function tickFurnace(kind: CookingKind, s: FurnaceState, c: Container): { litChanged: boolean; changed: boolean } {
  const wasLit = s.burn > 0;
  let changed = false;
  if (s.burn > 0) s.burn--;
  const input = c.get(0), fuel = c.get(1);
  const recipe = input.isEmpty() ? null : findCooking(kind, input);
  if (s.input !== (input.isEmpty() ? undefined : input.id)) {
    s.input = input.isEmpty() ? undefined : input.id;
    s.cook = 0;
  }
  const speed = kind === 'smelting' ? 1 : 2;
  if (s.burn > 0 || (!fuel.isEmpty() && !input.isEmpty())) {
    if (s.burn <= 0 && canBurn(recipe, c)) {
      const ft = Math.floor(fuelTicks(fuel) / speed);
      s.burn = ft;
      s.burnTotal = ft;
      if (ft > 0) {
        changed = true;
        const rem = getItem(fuel.id)?.craftRemainder;
        fuel.shrink(1);
        if (fuel.isEmpty()) c.set(1, rem ? new ItemStack(rem, 1) : ItemStack.empty());
        else c.set(1, fuel);
      }
    }
    if (s.burn > 0 && canBurn(recipe, c)) {
      s.cookTotal = Math.max(1, recipe!.time);
      s.cook++;
      if (s.cook >= s.cookTotal) {
        s.cook = 0;
        const out = c.get(2);
        if (out.isEmpty()) c.set(2, new ItemStack(recipe!.result.id, recipe!.result.count, recipe!.result.data ? JSON.parse(JSON.stringify(recipe!.result.data)) : {}));
        else { out.grow(recipe!.result.count); c.set(2, out); }
        // Wet sponge + empty bucket in the fuel slot fills the bucket
        if (input.id === 'wet_sponge' && c.get(1).id === 'bucket') c.set(1, new ItemStack('water_bucket', 1));
        input.shrink(1);
        c.set(0, input.isEmpty() ? ItemStack.empty() : input);
        s.xp[recipe!.id] = (s.xp[recipe!.id] ?? 0) + 1;
        changed = true;
      }
    } else s.cook = 0;
  } else if (s.cook > 0) {
    s.cook = Math.max(0, s.cook - 2);
  }
  if (!recipe) { s.cook = 0; s.cookTotal = 0; }
  const lit = s.burn > 0;
  if (lit !== wasLit) changed = true;
  return { litChanged: lit !== wasLit, changed };
}

/** Experience for stored recipes (fractional parts become a random extra point). */
export function furnaceXp(s: FurnaceState, rng: () => number): number {
  let total = 0;
  for (const [id, n] of Object.entries(s.xp)) {
    const r = RECIPES.get(id);
    const per = r && 'xp' in r ? r.xp : 0;
    const v = per * n;
    const whole = Math.floor(v);
    total += whole + (rng() < v - whole ? 1 : 0);
  }
  s.xp = {};
  return total;
}

for (const kind of Object.keys(FURNACE_KINDS)) {
  MENU_TYPES.set(kind, (c) => new FurnaceMenu(kind, c.windowId, new SimpleContainer(3), c.inventory));
}
