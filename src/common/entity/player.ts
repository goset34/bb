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
