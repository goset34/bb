import { describe, it, expect } from 'vitest';
import { startTestWorld, TestWorld } from './harness';
import { ItemStack } from '../../src/common/item/stack';
import { BLOCK_BY_NAME } from '../../src/common/block/registry';
import { CraftingMenu, placeRecipe } from '../../src/common/menu/menus';

/** Break a block of `name` placed next to the player with the held item; collect its drops. */
async function mine(w: TestWorld, name: string): Promise<void> {
  const lvl = w.player.level;
  const t = w.player.entity.transform;
  const x = Math.floor(t.x) + 1, y = Math.floor(t.y), z = Math.floor(t.z);
  lvl.setBlock(x, y, z, BLOCK_BY_NAME.get(name)!.defaultState, 3);
  w.player.breakBlock(x, y, z, true);
  // Pull the drops onto the player and let pickup happen
  for (const e of [...lvl.entities.query('item')]) {
    e.transform!.x = t.x; e.transform!.y = t.y; e.transform!.z = t.z;
    e.physics!.vx = e.physics!.vz = 0;
    e.item!.pickupDelay = 0;
  }
  await w.tick(3);
}

/** Craft a recipe at a crafting table using the recipe book placement and a shift-click. */
function craft(w: TestWorld, recipe: string, all = false): void {
  const mp = w.player.menus.menuPlayer;
  const m = new CraftingMenu(1, w.player.inventory);
  expect(placeRecipe(m, recipe, all, mp), `ingredients for ${recipe}`).toBe(true);
  m.clicked(0, 0, 'quick_move', mp);
  m.removed(mp);
}

function hold(w: TestWorld, id: string): void {
  const inv = w.player.inventory;
  for (let i = 0; i < 36; i++) {
    if (inv.get(i).id !== id) continue;
    const cur = inv.get(0);
    inv.set(0, inv.get(i));
    inv.set(i, cur);
    inv.selected = 0;
    return;
  }
  throw new Error('not in inventory: ' + id);
}

describe('Survival progression (acceptance H3)', () => {
  it('wood → stone → iron → diamond with real loot tables, recipes and smelting', async () => {
    const w = await startTestWorld();
    const inv = w.player.inventory;
    // Wood by hand
    for (let i = 0; i < 4; i++) await mine(w, 'oak_log');
    expect(inv.count('oak_log')).toBe(4);
    craft(w, 'oak_planks', true);
    expect(inv.count('oak_planks')).toBe(16);
    craft(w, 'crafting_table');
    craft(w, 'stick');
    expect(inv.count('stick')).toBe(4);
    craft(w, 'wooden_pickaxe');
    expect(inv.count('wooden_pickaxe')).toBe(1);
    // Stone needs a pickaxe
    hold(w, 'wooden_pickaxe');
    for (let i = 0; i < 3; i++) await mine(w, 'stone');
    expect(inv.count('cobblestone')).toBe(3);
    craft(w, 'stone_pickaxe');
    expect(inv.count('stone_pickaxe')).toBe(1);
    // Iron ore needs stone tier
    for (let i = 0; i < 8; i++) await mine(w, 'cobblestone');
    craft(w, 'furnace');
    hold(w, 'stone_pickaxe');
    for (let i = 0; i < 3; i++) await mine(w, 'iron_ore');
    await mine(w, 'coal_ore');
    expect(inv.count('raw_iron')).toBeGreaterThanOrEqual(3);
    expect(inv.count('coal')).toBeGreaterThanOrEqual(1);
    // Smelt in a placed furnace
    const lvl = w.player.level;
    const t = w.player.entity.transform;
    const fx = Math.floor(t.x) - 2, fz = Math.floor(t.z), fy = Math.floor(t.y);
    lvl.setBlock(fx, fy, fz, BLOCK_BY_NAME.get('furnace')!.defaultState, 3);
    w.server.hooks.blockPlaced(w.player, fx, fy, fz, lvl.getBlockState(fx, fy, fz), new ItemStack('furnace', 1), 'main');
    lvl.openMenu(w.player.entity, 'furnace', fx, fy, fz);
    const fm = w.player.menus.open!;
    const mp = w.player.menus.menuPlayer;
    // Shift-click raw iron and coal from the inventory into the furnace
    const idx = (id: string) => fm.slots.findIndex((s, i) => i >= 3 && s.stack.id === id);
    fm.clicked(idx('raw_iron'), 0, 'quick_move', mp);
    fm.clicked(idx('coal'), 0, 'quick_move', mp);
    await w.tick(3 * 200 + 10);
    fm.clicked(2, 0, 'quick_move', mp);
    w.player.menus.close(true);
    expect(inv.count('iron_ingot')).toBe(3);
    craft(w, 'stick');
    craft(w, 'iron_pickaxe');
    hold(w, 'iron_pickaxe');
    await mine(w, 'diamond_ore');
    expect(inv.count('diamond')).toBe(1);
    // Diamond ore with a stone pickaxe drops nothing
    hold(w, 'stone_pickaxe');
    await mine(w, 'diamond_ore');
    expect(inv.count('diamond')).toBe(1);
    expect(w.player.entity.xp!.total).toBeGreaterThan(0);
  });
});
