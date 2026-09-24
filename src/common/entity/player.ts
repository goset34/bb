/** Player component data (shared by server simulation and client prediction). */
import { ItemStack } from '../item/stack';

export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';

export const GAME_MODES: readonly GameMode[] = ['survival', 'creative', 'adventure', 'spectator'];

export interface Abilities {
  invulnerable: boolean;
  flying: boolean;
  mayFly: boolean;
  instabuild: boolean;
  mayBuild: boolean;
  flySpeed: number;
  walkSpeed: number;
}

export function abilitiesFor(mode: GameMode): Abilities {
  return {
    invulnerable: mode === 'creative' || mode === 'spectator',
    flying: mode === 'spectator',
    mayFly: mode === 'creative' || mode === 'spectator',
    instabuild: mode === 'creative',
    mayBuild: mode === 'survival' || mode === 'creative',
    flySpeed: 0.05,
    walkSpeed: 0.1,
  };
}

/** Player inventory layout: 0-8 hotbar, 9-35 main, 36-39 armor (feet..head), 40 offhand. */
export const INV_HOTBAR = 0;
export const INV_MAIN = 9;
export const INV_ARMOR = 36;
export const INV_OFFHAND = 40;
export const INV_SIZE = 41;

export class Inventory {
  readonly slots: ItemStack[] = [];
  selected = 0;
  /** Incremented on every change (for syncing). */
  revision = 0;

  constructor(size = INV_SIZE) {
    for (let i = 0; i < size; i++) this.slots.push(ItemStack.empty());
  }

  get(i: number): ItemStack {
    return this.slots[i] ?? ItemStack.empty();
  }

  set(i: number, s: ItemStack): void {
    this.slots[i] = s.isEmpty() ? ItemStack.empty() : s;
    this.revision++;
  }

  get mainHand(): ItemStack {
    return this.get(this.selected);
  }

  get offHand(): ItemStack {
    return this.get(INV_OFFHAND);
  }

  armor(slot: 'feet' | 'legs' | 'chest' | 'head'): ItemStack {
    const idx = { feet: 0, legs: 1, chest: 2, head: 3 }[slot];
    return this.get(INV_ARMOR + idx);
  }

  /**
   * Insert a stack (hotbar first, then main inventory): merges into matching stacks, then
   * fills empty slots. `stack.count` is reduced by what was added; returns true if fully added.
   */
  add(stack: ItemStack, maxStack: number): boolean {
    if (stack.isEmpty()) return true;
    const order: number[] = [];
    for (let i = 0; i < INV_ARMOR; i++) order.push(i);
    for (const i of order) {
      const s = this.slots[i]!;
      if (s.isEmpty() || !s.sameItemSameData(stack) || s.count >= maxStack) continue;
      const n = Math.min(maxStack - s.count, stack.count);
      s.count += n;
      stack.count -= n;
      this.revision++;
      if (stack.count <= 0) return true;
    }
    for (const i of order) {
      if (!this.slots[i]!.isEmpty()) continue;
      const n = Math.min(maxStack, stack.count);
      this.slots[i] = stack.copyWithCount(n);
      stack.count -= n;
      this.revision++;
      if (stack.count <= 0) return true;
    }
    return false;
  }

  /** Count of an item across the inventory. */
  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.count;
    return n;
  }

  /** Remove up to `n` items of `id`; returns the number removed. */
  remove(id: string, n: number): number {
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i]!;
      if (s.id !== id || s.isEmpty()) continue;
      const k = Math.min(left, s.count);
      s.count -= k;
      left -= k;
      if (s.isEmpty()) this.slots[i] = ItemStack.empty();
    }
    if (left !== n) this.revision++;
    return n - left;
  }

  clear(): void {
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = ItemStack.empty();
    this.revision++;
  }

  toJSON() {
    return { selected: this.selected, slots: this.slots.map((s) => (s.isEmpty() ? null : s.toJSON())) };
  }

  load(o: { selected?: number; slots?: Array<ReturnType<ItemStack['toJSON']> | null> }): void {
    this.selected = o.selected ?? 0;
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = ItemStack.fromJSON(o.slots?.[i] ?? null);
    this.revision++;
  }
}

export interface PlayerData {
  name: string;
  gameMode: GameMode;
  abilities: Abilities;
  inventory: Inventory;
  /** Client-side prediction bookkeeping / server input seq. */
  lastInputSeq: number;
}
