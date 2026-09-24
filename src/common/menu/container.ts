/** Item containers used by menus: simple arrays, the player inventory, crafting grids. */
import { ItemStack } from '../item/stack';
import type { Inventory } from '../entity/player';
import type { CraftingGrid } from '../recipe/recipes';
import { getItem } from '../item/items';

export interface Container {
  readonly size: number;
  get(i: number): ItemStack;
  set(i: number, s: ItemStack): void;
  /** Contents changed (listeners recompute results, block entities mark dirty). */
  changed(): void;
  /** Per-slot stack limit (64 by default). */
  readonly maxStack: number;
}

export function maxStackOf(s: ItemStack): number {
  return getItem(s.id)?.maxStack ?? 64;
}

export class SimpleContainer implements Container {
  readonly items: ItemStack[];
  private readonly listeners: Array<(c: SimpleContainer) => void> = [];
  maxStack = 64;

  constructor(readonly size: number) {
    this.items = Array.from({ length: size }, () => ItemStack.empty());
  }

  get(i: number): ItemStack {
    return this.items[i] ?? ItemStack.empty();
  }

  set(i: number, s: ItemStack): void {
    this.items[i] = s.isEmpty() ? ItemStack.empty() : s;
  }

  changed(): void {
    for (const l of this.listeners) l(this);
  }

  onChange(l: (c: SimpleContainer) => void): void {
    this.listeners.push(l);
  }

  isEmpty(): boolean {
    return this.items.every((s) => s.isEmpty());
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.items[i] = ItemStack.empty();
  }

  /** Insert a stack (merging first); returns the remainder. */
  add(stack: ItemStack): ItemStack {
    const s = stack.copy();
    for (let i = 0; i < this.size && !s.isEmpty(); i++) {
      const cur = this.items[i]!;
      if (cur.isEmpty() || !cur.sameItemSameData(s)) continue;
      const max = Math.min(this.maxStack, maxStackOf(cur));
      const n = Math.min(max - cur.count, s.count);
      if (n > 0) { cur.count += n; s.count -= n; }
    }
    for (let i = 0; i < this.size && !s.isEmpty(); i++) {
      if (!this.items[i]!.isEmpty()) continue;
      const n = Math.min(Math.min(this.maxStack, maxStackOf(s)), s.count);
      this.items[i] = s.copyWithCount(n);
      s.count -= n;
    }
    this.changed();
    return s;
  }

  toJSON(): Array<ReturnType<ItemStack['toJSON']> | null> {
    return this.items.map((s) => (s.isEmpty() ? null : s.toJSON()));
  }

  load(arr: Array<ReturnType<ItemStack['toJSON']> | null> | undefined): void {
    for (let i = 0; i < this.size; i++) this.items[i] = ItemStack.fromJSON(arr?.[i] ?? null);
  }
}

/** The player inventory as a container (41 slots, inventory indices). */
export class InventoryContainer implements Container {
  readonly size: number;
  readonly maxStack = 64;
  constructor(readonly inv: Inventory) {
    this.size = inv.slots.length;
  }
  get(i: number): ItemStack {
    return this.inv.get(i);
  }
  set(i: number, s: ItemStack): void {
    this.inv.set(i, s);
  }
  changed(): void {
    this.inv.revision++;
  }
}

/** Crafting grid container (w × h) exposing the CraftingGrid view for recipe matching. */
export class CraftingContainer extends SimpleContainer implements CraftingGrid {
  constructor(readonly width: number, readonly height: number) {
    super(width * height);
  }
}

/** Single result slot. */
export class ResultContainer extends SimpleContainer {
  /** Recipe that produced the current result (for remainders / recipe book). */
  recipeId: string | null = null;
  constructor() {
    super(1);
  }
}
