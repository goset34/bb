/**
 * Menus (open container screens). The same code runs on the server (authoritative) and on the
 * client (prediction), so clicks behave identically on both sides.
 *
 * Click modes: pickup (left/right), quick_move (shift), swap (number keys / off-hand), clone
 * (middle click, creative), throw (Q / Ctrl+Q), quick_craft (drag distribute) and pickup_all
 * (double click).
 */
import { ItemStack } from '../item/stack';
import type { Inventory } from '../entity/player';
import { Container, maxStackOf } from './container';

export type ClickMode = 'pickup' | 'quick_move' | 'swap' | 'clone' | 'throw' | 'quick_craft' | 'pickup_all';

export const SLOT_OUTSIDE = -999;

/** What the menu needs to know about the player using it. */
export interface MenuPlayer {
  readonly inventory: Inventory;
  readonly creative: boolean;
  /** Throw a stack out of the menu (server spawns an item entity; client ignores). */
  drop(stack: ItemStack): void;
  /** Called when items are crafted/taken from a result slot (stats, recipe unlocks, xp). */
  onCrafted?(stack: ItemStack, amount: number): void;
}

export class Slot {
  /** Index of this slot in its menu. */
  index = -1;
  constructor(readonly container: Container, readonly slot: number, readonly x: number, readonly y: number) {}

  get stack(): ItemStack {
    return this.container.get(this.slot);
  }

  set(s: ItemStack): void {
    this.container.set(this.slot, s);
    this.container.changed();
  }

  hasItem(): boolean {
    return !this.stack.isEmpty();
  }

  mayPlace(_s: ItemStack): boolean {
    return true;
  }

  mayPickup(_p: MenuPlayer): boolean {
    return true;
  }

  maxStack(s?: ItemStack): number {
    return s ? Math.min(this.container.maxStack, maxStackOf(s)) : this.container.maxStack;
  }

  /** Remove up to n items from the slot. */
  remove(n: number): ItemStack {
    const s = this.stack;
    if (s.isEmpty()) return ItemStack.empty();
    const out = s.split(n);
    this.set(s.isEmpty() ? ItemStack.empty() : s);
    return out;
  }

  onTake(_p: MenuPlayer, _stack: ItemStack): void {
    this.container.changed();
  }

  /** Active slots are drawn and clickable (creative tabs hide some). */
  isActive(): boolean {
    return true;
  }

  /** Place as much of `s` as fits; returns the remainder. */
  safeInsert(s: ItemStack, n = s.count): ItemStack {
    if (s.isEmpty() || !this.mayPlace(s)) return s;
    const cur = this.stack;
    const room = Math.min(n, this.maxStack(s) - (cur.isEmpty() ? 0 : cur.count));
    if (room <= 0) return s;
    if (cur.isEmpty()) this.set(s.split(room));
    else if (cur.sameItemSameData(s)) {
      s.shrink(room);
      cur.grow(room);
      this.set(cur);
    }
    return s;
  }

  /** Take up to n items respecting mayPickup. */
  tryRemove(n: number, limit: number, p: MenuPlayer): ItemStack | null {
    if (!this.mayPickup(p)) return null;
    const take = Math.min(n, limit);
    const out = this.remove(take);
    return out.isEmpty() ? null : out;
  }
}

/** Slots that only accept items for which `test` is true (and have a stack limit). */
export class FilteredSlot extends Slot {
  constructor(container: Container, slot: number, x: number, y: number, private readonly test: (s: ItemStack) => boolean, private readonly limit = 64) {
    super(container, slot, x, y);
  }
  override mayPlace(s: ItemStack): boolean {
    return this.test(s);
  }
  override maxStack(s?: ItemStack): number {
    return Math.min(this.limit, super.maxStack(s));
  }
}

/** Output-only slot (furnace output, stonecutter result…). */
export class OutputSlot extends Slot {
  override mayPlace(): boolean {
    return false;
  }
}

export abstract class Menu {
  readonly slots: Slot[] = [];
  carried = ItemStack.empty();
  /** Synced numeric properties (furnace progress, enchantment costs…). */
  readonly data: number[] = [];
  stateId = 0;
  private qcStatus = 0;
  private qcType = -1;
  private readonly qcSlots = new Set<Slot>();

  constructor(readonly kind: string, readonly windowId: number) {}

  addSlot<S extends Slot>(s: S): S {
    s.index = this.slots.length;
    this.slots.push(s);
    return s;
  }

  /** Add the 36 player inventory slots (main 27 then hotbar 9) at the given origin. */
  addPlayerSlots(inv: Container, x: number, y: number): void {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) this.addSlot(new Slot(inv, 9 + r * 9 + c, x + c * 18, y + r * 18));
    for (let c = 0; c < 9; c++) this.addSlot(new Slot(inv, c, x + c * 18, y + 58));
  }

  /** Shift-click behaviour; returns what was moved (empty when nothing moved). */
  abstract quickMoveStack(p: MenuPlayer, index: number): ItemStack;

  stillValid(_p: MenuPlayer): boolean {
    return true;
  }

  /** Menu closed: return the carried stack and temporary grid contents. */
  removed(p: MenuPlayer): void {
    if (!this.carried.isEmpty()) {
      const s = this.carried;
      this.carried = ItemStack.empty();
      p.inventory.add(s, maxStackOf(s));
      if (!s.isEmpty()) p.drop(s);
    }
  }

  /** Called when a container of this menu changed (crafting result updates). */
  slotsChanged(_c: Container): void {}

  /** Button pressed in the screen (stonecutter recipe, enchant option…). */
  clickButton(_p: MenuPlayer, _id: number): boolean {
    return false;
  }

  setData(i: number, v: number): void {
    this.data[i] = v;
  }

  /**
   * Move a stack into slots [start, end) (reverse order optional). Merges into existing stacks
   * first, then empty slots. Returns true if anything moved.
   */
  moveItemStackTo(stack: ItemStack, start: number, end: number, reverse: boolean): boolean {
    let moved = false;
    const order = (fn: (i: number) => boolean) => {
      if (reverse) { for (let i = end - 1; i >= start; i--) if (fn(i)) return; }
      else { for (let i = start; i < end; i++) if (fn(i)) return; }
    };
    if (maxStackOf(stack) > 1) {
      order((i) => {
        if (stack.isEmpty()) return true;
        const slot = this.slots[i]!;
        const cur = slot.stack;
        if (cur.isEmpty() || !cur.sameItemSameData(stack) || !slot.mayPlace(stack)) return false;
        const max = slot.maxStack(cur);
        const n = Math.min(max - cur.count, stack.count);
        if (n > 0) {
          cur.grow(n);
          stack.shrink(n);
          slot.set(cur);
          moved = true;
        }
        return stack.isEmpty();
      });
    }
    if (!stack.isEmpty()) {
      order((i) => {
        const slot = this.slots[i]!;
        if (!slot.stack.isEmpty() || !slot.mayPlace(stack)) return false;
        const n = Math.min(slot.maxStack(stack), stack.count);
        slot.set(stack.split(n));
        moved = true;
        return stack.isEmpty();
      });
    }
    return moved;
  }

  // ------------------------------------------------------------------------------------------
  // Clicks
  // ------------------------------------------------------------------------------------------

  clicked(index: number, button: number, mode: ClickMode, p: MenuPlayer): void {
    if (mode === 'quick_craft') return this.quickCraft(index, button, p);
    if (this.qcStatus !== 0) this.resetQuickCraft();
    const slot = index >= 0 ? this.slots[index] : undefined;
    switch (mode) {
      case 'pickup': {
        if (index === SLOT_OUTSIDE) {
          if (this.carried.isEmpty()) return;
          if (button === 0) { p.drop(this.carried); this.carried = ItemStack.empty(); }
          else p.drop(this.carried.split(1));
          if (this.carried.isEmpty()) this.carried = ItemStack.empty();
          return;
        }
        if (!slot || !slot.isActive()) return;
        this.pickup(slot, button, p);
        return;
      }
      case 'quick_move': {
        if (!slot || !slot.mayPickup(p)) return;
        // Repeat while the result keeps producing the same item (crafting outputs)
        let moved = this.quickMoveStack(p, index);
        let guard = 0;
        while (!moved.isEmpty() && slot.stack.sameItemSameData(moved) && guard++ < 64 && this.isResultSlot(slot)) moved = this.quickMoveStack(p, index);
        return;
      }
      case 'swap': {
        if (!slot) return;
        const invIdx = button === 40 ? 40 : button;
        if (invIdx < 0 || (invIdx > 8 && invIdx !== 40)) return;
        const inv = p.inventory;
        const other = inv.get(invIdx);
        const cur = slot.stack;
        if (other.isEmpty() && cur.isEmpty()) return;
        if (other.isEmpty()) {
          if (!slot.mayPickup(p)) return;
          const taken = slot.remove(cur.count);
          inv.set(invIdx, taken);
          slot.onTake(p, taken);
        } else if (cur.isEmpty()) {
          if (!slot.mayPlace(other)) return;
          const max = slot.maxStack(other);
          if (other.count > max) slot.set(other.split(max));
          else { slot.set(other); inv.set(invIdx, ItemStack.empty()); }
        } else if (slot.mayPickup(p) && slot.mayPlace(other)) {
          const max = slot.maxStack(other);
          if (other.count > max) {
            slot.set(other.split(max));
            slot.onTake(p, cur);
            if (!inv.add(cur, maxStackOf(cur))) p.drop(cur);
          } else {
            inv.set(invIdx, cur);
            slot.set(other);
            slot.onTake(p, cur);
          }
        }
        inv.revision++;
        return;
      }
      case 'clone': {
        if (!p.creative || !this.carried.isEmpty() || !slot || !slot.hasItem()) return;
        this.carried = slot.stack.copyWithCount(maxStackOf(slot.stack));
        return;
      }
      case 'throw': {
        if (!slot || !this.carried.isEmpty() || !slot.hasItem() || !slot.mayPickup(p)) return;
        const n = button === 0 ? 1 : slot.stack.count;
        const out = slot.remove(n);
        slot.onTake(p, out);
        p.drop(out);
        return;
      }
      case 'pickup_all': {
        if (!slot || this.carried.isEmpty()) return;
        if (slot.hasItem() && slot.mayPickup(p)) return;
        const max = maxStackOf(this.carried);
        // Two passes: partial stacks first, then full ones
        for (let pass = 0; pass < 2; pass++) {
          for (let i = button === 0 ? 0 : this.slots.length - 1; button === 0 ? i < this.slots.length : i >= 0; i += button === 0 ? 1 : -1) {
            if (this.carried.count >= max) return;
            const s = this.slots[i]!;
            const st = s.stack;
            if (st.isEmpty() || !st.sameItemSameData(this.carried) || !s.mayPickup(p) || this.isResultSlot(s)) continue;
            if (pass === 0 && st.count === maxStackOf(st)) continue;
            const took = s.remove(Math.min(max - this.carried.count, st.count));
            this.carried.grow(took.count);
            s.onTake(p, took);
          }
        }
        return;
      }
    }
  }

  /** Result slots are output-only slots whose take consumes ingredients. */
  protected isResultSlot(_s: Slot): boolean {
    return false;
  }

  private pickup(slot: Slot, button: number, p: MenuPlayer): void {
    const cur = slot.stack;
    const carried = this.carried;
    if (cur.isEmpty()) {
      if (carried.isEmpty() || !slot.mayPlace(carried)) return;
      const n = button === 0 ? carried.count : 1;
      slot.safeInsert(carried, n);
      if (carried.isEmpty()) this.carried = ItemStack.empty();
      return;
    }
    if (!slot.mayPickup(p)) return;
    if (carried.isEmpty()) {
      const n = button === 0 ? cur.count : Math.ceil(cur.count / 2);
      const taken = slot.remove(Math.min(n, maxStackOf(cur)));
      this.carried = taken;
      slot.onTake(p, taken);
      return;
    }
    if (slot.mayPlace(carried)) {
      if (cur.sameItemSameData(carried)) {
        const n = button === 0 ? carried.count : 1;
        slot.safeInsert(carried, n);
        if (carried.isEmpty()) this.carried = ItemStack.empty();
      } else if (carried.count <= slot.maxStack(carried)) {
        // Swap
        const taken = slot.remove(cur.count);
        slot.set(carried);
        this.carried = taken;
        slot.onTake(p, taken);
      }
      return;
    }
    // Output slots: pick up more of the same item if it fits
    if (cur.sameItemSameData(carried) && carried.count + cur.count <= maxStackOf(carried)) {
      const taken = slot.remove(cur.count);
      carried.grow(taken.count);
      slot.onTake(p, taken);
    }
  }

  // ---- drag distribution -------------------------------------------------------------------

  private resetQuickCraft(): void {
    this.qcStatus = 0;
    this.qcSlots.clear();
  }

  /** button = stage (0 start, 1 add slot, 2 end) | type << 2 (0 even split, 1 one each, 2 creative clone). */
  private quickCraft(index: number, button: number, p: MenuPlayer): void {
    const stage = button & 3;
    const type = (button >> 2) & 3;
    const prev = this.qcStatus;
    this.qcStatus = stage;
    if ((prev !== 1 || stage !== 2) && prev !== stage) {
      this.resetQuickCraft();
      if (stage !== 0) return;
      this.qcStatus = 0;
    }
    if (this.carried.isEmpty()) {
      this.resetQuickCraft();
      return;
    }
    if (stage === 0) {
      if (type === 2 && !p.creative) { this.resetQuickCraft(); return; }
      this.qcType = type;
      this.qcStatus = 1;
      this.qcSlots.clear();
      return;
    }
    if (stage === 1) {
      const slot = this.slots[index];
      if (!slot) return;
      const cur = slot.stack;
      const fits = (cur.isEmpty() || cur.sameItemSameData(this.carried)) && slot.mayPlace(this.carried) && (this.qcType === 2 || this.carried.count > this.qcSlots.size);
      if (fits) this.qcSlots.add(slot);
      this.qcStatus = 1;
      return;
    }
    // stage 2: apply
    if (this.qcSlots.size === 1) {
      const only = [...this.qcSlots][0]!;
      this.resetQuickCraft();
      this.clicked(only.index, this.qcType, 'pickup', p);
      return;
    }
    const carried = this.carried;
    let left = carried.count;
    const each = this.qcType === 0 ? Math.floor(carried.count / Math.max(1, this.qcSlots.size)) : this.qcType === 1 ? 1 : maxStackOf(carried);
    for (const slot of this.qcSlots) {
      const cur = slot.stack;
      if (!(cur.isEmpty() || cur.sameItemSameData(carried)) || !slot.mayPlace(carried)) continue;
      const have = cur.isEmpty() ? 0 : cur.count;
      const max = slot.maxStack(carried);
      const target = Math.min(have + each, max);
      const add = this.qcType === 2 ? target - have : Math.min(target - have, left);
      if (add <= 0) continue;
      if (this.qcType !== 2) left -= add;
      slot.set(carried.copyWithCount(have + add));
    }
    if (this.qcType !== 2) {
      carried.count = left;
      if (carried.isEmpty()) this.carried = ItemStack.empty();
    }
    this.resetQuickCraft();
  }

  /** Snapshot of all slot stacks (for change detection / sync). */
  snapshot(): ItemStack[] {
    return this.slots.map((s) => s.stack.copy());
  }
}
