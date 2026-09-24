import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries } from '../../src/common/init';
import { Inventory } from '../../src/common/entity/player';
import { ItemStack } from '../../src/common/item/stack';
import { InventoryMenu, CraftingMenu, placeRecipe, GenericMenu } from '../../src/common/menu/menus';
import { SimpleContainer } from '../../src/common/menu/container';
import type { MenuPlayer } from '../../src/common/menu/menu';

beforeAll(() => initRegistries());

function player(creative = false): MenuPlayer & { dropped: ItemStack[] } {
  const dropped: ItemStack[] = [];
  return { inventory: new Inventory(), creative, drop: (s) => { dropped.push(s.copy()); }, dropped };
}

describe('Menus', () => {
  it('picks up, splits and places stacks', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(0, new ItemStack('stone', 10)); // hotbar 0 = menu slot 36
    m.clicked(36, 1, 'pickup', p); // right click takes half
    expect(m.carried.count).toBe(5);
    expect(m.slots[36]!.stack.count).toBe(5);
    m.clicked(9, 1, 'pickup', p); // right click places one
    expect(m.slots[9]!.stack.count).toBe(1);
    expect(m.carried.count).toBe(4);
    m.clicked(9, 0, 'pickup', p); // left click places all (merge)
    expect(m.slots[9]!.stack.count).toBe(5);
    expect(m.carried.isEmpty()).toBe(true);
  });

  it('swaps different items and throws outside', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(0, new ItemStack('stone', 3));
    p.inventory.set(1, new ItemStack('dirt', 2));
    m.clicked(36, 0, 'pickup', p);
    m.clicked(37, 0, 'pickup', p);
    expect(m.carried.id).toBe('dirt');
    expect(m.slots[37]!.stack.id).toBe('stone');
    m.clicked(-999, 1, 'pickup', p);
    expect(p.dropped[0]!.count).toBe(1);
    m.clicked(-999, 0, 'pickup', p);
    expect(m.carried.isEmpty()).toBe(true);
  });

  it('shift-clicks between hotbar, main inventory and armor', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(0, new ItemStack('stone', 64));
    m.clicked(36, 0, 'quick_move', p);
    expect(m.slots[9]!.stack.count).toBe(64);
    p.inventory.set(0, new ItemStack('iron_helmet', 1));
    m.clicked(36, 0, 'quick_move', p);
    expect(m.slots[5]!.stack.id).toBe('iron_helmet');
    expect(p.inventory.get(39).id).toBe('iron_helmet');
  });

  it('armor slots only accept matching pieces', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(0, new ItemStack('iron_boots', 1));
    m.clicked(36, 0, 'pickup', p);
    m.clicked(5, 0, 'pickup', p); // head slot rejects boots
    expect(m.slots[5]!.stack.isEmpty()).toBe(true);
    m.clicked(8, 0, 'pickup', p); // feet slot accepts
    expect(m.slots[8]!.stack.id).toBe('iron_boots');
  });

  it('crafts in the 2×2 grid and consumes ingredients', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(0, new ItemStack('oak_log', 2));
    m.clicked(36, 0, 'pickup', p);
    m.clicked(1, 0, 'pickup', p);
    expect(m.slots[0]!.stack.id).toBe('oak_planks');
    expect(m.slots[0]!.stack.count).toBe(4);
    m.clicked(0, 0, 'pickup', p);
    expect(m.carried.count).toBe(4);
    expect(m.slots[1]!.stack.count).toBe(1);
    // Picking again stacks onto the carried planks
    m.clicked(0, 0, 'pickup', p);
    expect(m.carried.count).toBe(8);
    expect(m.slots[1]!.stack.isEmpty()).toBe(true);
    expect(m.slots[0]!.stack.isEmpty()).toBe(true);
  });

  it('shift-click on the result crafts as many as possible', () => {
    const p = player();
    const m = new CraftingMenu(1, p.inventory);
    m.grid.set(0, new ItemStack('oak_planks', 5));
    m.grid.set(3, new ItemStack('oak_planks', 5));
    m.grid.changed();
    expect(m.slots[0]!.stack.id).toBe('stick');
    m.clicked(0, 0, 'quick_move', p);
    expect(p.inventory.count('stick')).toBe(20);
    expect(m.grid.get(0).isEmpty()).toBe(true);
  });

  it('leaves bucket remainders in the grid', () => {
    const p = player();
    const m = new CraftingMenu(1, p.inventory);
    const layout = ['milk_bucket', 'milk_bucket', 'milk_bucket', 'sugar', 'egg', 'sugar', 'wheat', 'wheat', 'wheat'];
    layout.forEach((id, i) => m.grid.set(i, new ItemStack(id, 1)));
    m.grid.changed();
    expect(m.slots[0]!.stack.id).toBe('cake');
    m.clicked(0, 0, 'pickup', p);
    expect(m.carried.id).toBe('cake');
    expect(m.grid.get(0).id).toBe('bucket');
    expect(m.grid.get(3).isEmpty()).toBe(true);
  });

  it('drag-distributes evenly (left) and one each (right)', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    m.carried = new ItemStack('dirt', 10);
    m.clicked(-999, 0, 'quick_craft', p);
    for (const s of [9, 10, 11]) m.clicked(s, 1, 'quick_craft', p);
    m.clicked(-999, 2, 'quick_craft', p);
    expect([9, 10, 11].map((i) => m.slots[i]!.stack.count)).toEqual([3, 3, 3]);
    expect(m.carried.count).toBe(1);
    m.carried = new ItemStack('sand', 5);
    m.clicked(-999, 0 | (1 << 2), 'quick_craft', p);
    for (const s of [18, 19]) m.clicked(s, 1 | (1 << 2), 'quick_craft', p);
    m.clicked(-999, 2 | (1 << 2), 'quick_craft', p);
    expect(m.slots[18]!.stack.count).toBe(1);
    expect(m.slots[19]!.stack.count).toBe(1);
    expect(m.carried.count).toBe(3);
  });

  it('double click collects matching items', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(9, new ItemStack('stone', 20));
    p.inventory.set(10, new ItemStack('stone', 30));
    m.carried = new ItemStack('stone', 5);
    m.clicked(11, 0, 'pickup_all', p);
    expect(m.carried.count).toBe(55);
  });

  it('number keys swap with the hotbar', () => {
    const p = player();
    const m = new InventoryMenu(p.inventory);
    p.inventory.set(9, new ItemStack('apple', 3));
    m.clicked(9, 4, 'swap', p);
    expect(p.inventory.get(4).id).toBe('apple');
    expect(p.inventory.get(9).isEmpty()).toBe(true);
  });

  it('fills the grid from the recipe book', () => {
    const p = player();
    const m = new CraftingMenu(1, p.inventory);
    p.inventory.set(3, new ItemStack('oak_planks', 8));
    expect(placeRecipe(m, 'crafting_table', false, p)).toBe(true);
    expect(m.slots[0]!.stack.id).toBe('crafting_table');
    expect(p.inventory.count('oak_planks')).toBe(4);
  });

  it('returns grid items to the player when closed', () => {
    const p = player();
    const m = new CraftingMenu(1, p.inventory);
    m.grid.set(4, new ItemStack('diamond', 2));
    m.removed(p);
    expect(p.inventory.count('diamond')).toBe(2);
  });

  it('generic containers move stacks both ways', () => {
    const p = player();
    const c = new SimpleContainer(27);
    const m = new GenericMenu('generic', 2, c, p.inventory);
    c.set(0, new ItemStack('gold_ingot', 12));
    m.clicked(0, 0, 'quick_move', p);
    expect(p.inventory.count('gold_ingot')).toBe(12);
    expect(c.get(0).isEmpty()).toBe(true);
    const idx = m.slots.findIndex((s) => s.stack.id === 'gold_ingot');
    m.clicked(idx, 0, 'quick_move', p);
    expect(c.get(0).count).toBe(12);
  });
});
