/**
 * Mount inventory (horses, donkeys, mules, llamas, camels): saddle slot, body armour or carpet
 * slot and optional chest columns, shared by client and server.
 */
import { ItemStack } from '../item/stack';
import { getItem } from '../item/items';
import { Menu, MenuPlayer, FilteredSlot, Slot } from './menu';
import { SimpleContainer, InventoryContainer, Container } from './container';
import type { Inventory } from '../entity/player';
import { MENU_TYPES } from './menus';

export interface MountSlots {
  saddle: boolean;
  /** 'armor' (horses), 'carpet' (llamas) or none. */
  body: 'armor' | 'carpet' | null;
  /** Chest columns (0 = no chest). */
  columns: number;
}

const isCarpet = (s: ItemStack) => s.id.endsWith('_carpet') && !s.id.includes('moss');
const isHorseArmor = (s: ItemStack) => !!getItem(s.id)?.extra?.['horseArmor'];

export class MountMenu extends Menu {
  constructor(windowId: number, readonly container: Container, inventory: Inventory, readonly spec: MountSlots, private readonly valid: (p: MenuPlayer) => boolean = () => true) {
    super('mount', windowId);
    this.addSlot(new FilteredSlot(container, 0, 8, 18, (s) => spec.saddle && s.id === 'saddle', 1));
    this.addSlot(new FilteredSlot(container, 1, 8, 36, (s) => (spec.body === 'armor' ? isHorseArmor(s) : spec.body === 'carpet' ? isCarpet(s) : false), 1));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < spec.columns; c++) this.addSlot(new Slot(container, 2 + r * spec.columns + c, 80 + c * 18, 18 + r * 18));
    }
    this.addPlayerSlots(new InventoryContainer(inventory), 8, 84);
  }

  override stillValid(p: MenuPlayer): boolean {
    return this.valid(p);
  }

  quickMoveStack(_p: MenuPlayer, index: number): ItemStack {
    const slot = this.slots[index];
    if (!slot || !slot.hasItem()) return ItemStack.empty();
    const stack = slot.stack;
    const original = stack.copy();
    const n = 2 + this.spec.columns * 3;
    if (index < n) {
      if (!this.moveItemStackTo(stack, n, this.slots.length, true)) return ItemStack.empty();
    } else if (this.slots[1]!.mayPlace(stack) && !this.slots[1]!.hasItem()) {
      if (!this.moveItemStackTo(stack, 1, 2, false)) return ItemStack.empty();
    } else if (this.slots[0]!.mayPlace(stack) && !this.slots[0]!.hasItem()) {
      if (!this.moveItemStackTo(stack, 0, 1, false)) return ItemStack.empty();
    } else if (this.spec.columns === 0 || !this.moveItemStackTo(stack, 2, n, false)) {
      return ItemStack.empty();
    }
    slot.set(stack.isEmpty() ? ItemStack.empty() : stack);
    return original;
  }
}

MENU_TYPES.set('mount', (c) => {
  const spec = (c.extra['spec'] as MountSlots | undefined) ?? { saddle: true, body: null, columns: 0 };
  return new MountMenu(c.windowId, new SimpleContainer(2 + spec.columns * 3), c.inventory, spec);
});
