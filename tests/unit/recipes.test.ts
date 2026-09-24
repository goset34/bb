import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries } from '../../src/common/init';
import { RECIPES, findCrafting, ingredientItems, findCooking, stonecutterOptions, findSmithing, craftingRemainders, CraftingGrid } from '../../src/common/recipe/recipes';
import { ItemStack } from '../../src/common/item/stack';
import { ITEMS } from '../../src/common/item/items';

beforeAll(() => initRegistries());

function grid(w: number, h: number, ids: Array<string | null>): CraftingGrid {
  return { width: w, height: h, items: ids.map((id) => (id ? new ItemStack(id, 1) : ItemStack.empty())) };
}

describe('Recipes', () => {
  it('only reference known items and non-empty ingredients', () => {
    const bad: string[] = [];
    for (const r of RECIPES.values()) {
      const check = (ing: string) => { if (ingredientItems(ing).size === 0) bad.push(`${r.id}: ${ing}`); };
      if (r.type === 'shaped') Object.values(r.key).forEach(check);
      if (r.type === 'shapeless') r.ingredients.forEach(check);
      if ('ingredient' in r) check(r.ingredient);
      if (r.type === 'smithing_transform' || r.type === 'smithing_trim') { check(r.template); check(r.base); check(r.addition); }
      if ('result' in r && r.result && !ITEMS.has(r.result.id)) bad.push(`${r.id}: result ${r.result.id}`);
    }
    expect(bad).toEqual([]);
    expect(RECIPES.size).toBeGreaterThan(900);
  });
  it('crafts planks, sticks and a crafting table', () => {
    expect(findCrafting(grid(2, 2, ['oak_log', null, null, null]))!.result.id).toBe('oak_planks');
    expect(findCrafting(grid(2, 2, ['oak_log', null, null, null]))!.result.count).toBe(4);
    expect(findCrafting(grid(2, 2, [null, 'birch_planks', null, 'birch_planks']))!.result.id).toBe('stick');
    expect(findCrafting(grid(2, 2, ['oak_planks', 'spruce_planks', 'oak_planks', 'oak_planks']))!.result.id).toBe('crafting_table');
  });
  it('matches mirrored shaped recipes', () => {
    const axe = grid(3, 3, ['iron_ingot', 'iron_ingot', null, 'iron_ingot', 'stick', null, null, 'stick', null]);
    const mirrored = grid(3, 3, [null, 'iron_ingot', 'iron_ingot', null, 'stick', 'iron_ingot', null, 'stick', null]);
    expect(findCrafting(axe)!.result.id).toBe('iron_axe');
    expect(findCrafting(mirrored)!.result.id).toBe('iron_axe');
  });
  it('leaves remainders (buckets) and dyes leather', () => {
    const cake = grid(3, 3, ['milk_bucket', 'milk_bucket', 'milk_bucket', 'sugar', 'egg', 'sugar', 'wheat', 'wheat', 'wheat']);
    const m = findCrafting(cake)!;
    expect(m.result.id).toBe('cake');
    expect(craftingRemainders(m, cake).filter((s) => s.id === 'bucket').length).toBe(3);
    const dyed = findCrafting(grid(2, 2, ['leather_helmet', 'red_dye', null, null]))!;
    expect(dyed.result.id).toBe('leather_helmet');
    expect(dyed.result.data.color).toBeDefined();
  });
  it('repairs tools and makes fireworks', () => {
    const a = new ItemStack('iron_pickaxe', 1); a.damage = 200;
    const b = new ItemStack('iron_pickaxe', 1); b.damage = 200;
    const m = findCrafting({ width: 2, height: 2, items: [a, b, ItemStack.empty(), ItemStack.empty()] })!;
    expect(m.result.damage).toBe(250 - (50 + 50 + 12));
    const rocket = findCrafting(grid(2, 2, ['paper', 'gunpowder', 'gunpowder', null]))!;
    expect(rocket.result.count).toBe(3);
    expect(rocket.result.data.fireworks!.flight).toBe(2);
  });
  it('smelts, cuts stone and upgrades gear', () => {
    expect(findCooking('smelting', new ItemStack('raw_iron', 1))!.result.id).toBe('iron_ingot');
    expect(findCooking('blasting', new ItemStack('deepslate_gold_ore', 1))!.result.id).toBe('gold_ingot');
    expect(findCooking('smoking', new ItemStack('beef', 1))!.result.id).toBe('cooked_beef');
    expect(findCooking('smelting', new ItemStack('oak_log', 1))!.result.id).toBe('charcoal');
    const opts = stonecutterOptions(new ItemStack('stone', 1)).map((r) => r.result.id);
    expect(opts).toContain('stone_bricks');
    expect(opts).toContain('stone_brick_stairs');
    const up = findSmithing(new ItemStack('infernium_upgrade_smithing_template', 1), new ItemStack('diamond_sword', 1), new ItemStack('infernium_ingot', 1))!;
    expect(up.result.id).toBe('infernium_sword');
    const trim = findSmithing(new ItemStack('coast_armor_trim_smithing_template', 1), new ItemStack('iron_chestplate', 1), new ItemStack('emerald', 1))!;
    expect(trim.result.data.trim).toEqual({ pattern: 'coast', material: 'emerald' });
  });
});

import { rollLoot, lootTable } from '../../src/common/loot/loot';
import { blockExperience } from '../../src/common/loot/blocks';
import { Random } from '../../src/common/math/random';
import { BLOCKS, S, setValue } from '../../src/common/block/registry';
import { P } from '../../src/common/block/properties';

describe('Loot tables', () => {
  const pick = new ItemStack('diamond_pickaxe', 1);
  const silk = new ItemStack('diamond_pickaxe', 1); silk.data.enchants = { silk_touch: 1 };
  const fortune = new ItemStack('diamond_pickaxe', 1); fortune.data.enchants = { fortune: 3 };
  it('generates a table for every block with an item', () => {
    let n = 0;
    for (const b of BLOCKS) if (b.item && lootTable(`blocks/${b.name}`)) n++;
    expect(n).toBeGreaterThan(900);
  });
  it('drops cobblestone from stone and stone with silk touch', () => {
    expect(rollLoot('blocks/stone', { rng: new Random(1), tool: pick, state: S('stone') })[0]!.id).toBe('cobblestone');
    expect(rollLoot('blocks/stone', { rng: new Random(1), tool: silk, state: S('stone') })[0]!.id).toBe('stone');
  });
  it('applies fortune to ores and gives experience', () => {
    let total = 0;
    for (let i = 0; i < 200; i++) total += rollLoot('blocks/diamond_ore', { rng: new Random(i), tool: fortune, state: S('diamond_ore') }).reduce((a, s) => a + s.count, 0);
    expect(total / 200).toBeGreaterThan(1.8);
    expect(blockExperience('deepslate_diamond_ore', new Random(3), false)).toBeGreaterThanOrEqual(3);
    expect(blockExperience('diamond_ore', new Random(3), true)).toBe(0);
  });
  it('drops mature crops with seeds and young crops as seeds', () => {
    const mature = rollLoot('blocks/wheat', { rng: new Random(5), state: setValue(S('wheat'), P.age7, 7) });
    expect(mature.some((s) => s.id === 'wheat')).toBe(true);
    const young = rollLoot('blocks/wheat', { rng: new Random(5), state: S('wheat') });
    expect(young.map((s) => s.id)).toEqual(['wheat_seeds']);
  });
  it('drops two slabs from a double slab and nothing from glass', () => {
    const d = rollLoot('blocks/oak_slab', { rng: new Random(1), state: setValue(S('oak_slab'), P.slabType, 'double') });
    expect(d[0]!.count).toBe(2);
    expect(rollLoot('blocks/glass', { rng: new Random(1), state: S('glass') })).toEqual([]);
  });
  it('fills the dungeon chest', () => {
    const items = rollLoot('chests/simple_dungeon', { rng: new Random(9) });
    expect(items.length).toBeGreaterThan(4);
  });
});
