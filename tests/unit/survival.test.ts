import { describe, it, expect } from 'vitest';
import { startTestWorld } from './harness';
import { ItemStack } from '../../src/common/item/stack';
import { BLOCK_BY_NAME } from '../../src/common/block/registry';
import { hurt } from '../../src/server/survival/living';

describe('Survival (in-process server)', () => {
  it('joins with health, food and a HUD sync', async () => {
    const w = await startTestWorld();
    const e = w.player.entity;
    expect(e.living?.health).toBe(20);
    expect(e.food?.food).toBe(20);
    await w.tick(2);
    expect(w.received('health').length).toBeGreaterThan(0);
  });

  it('takes fall damage when landing from high up', async () => {
    const w = await startTestWorld();
    const t = w.player.entity.transform;
    const ground = w.player.level.getHeight('motion', Math.floor(t.x), Math.floor(t.z));
    w.player.teleport(t.x, ground + 12, t.z);
    await w.send({ type: 'teleportConfirm', teleportId: 0 });
    await w.tick(60);
    expect(w.player.entity.living!.health).toBeLessThan(20);
    expect(w.player.entity.living!.health).toBeGreaterThan(10);
  });

  it('regenerates with a full food bar', async () => {
    const w = await startTestWorld();
    const l = w.player.entity.living!;
    l.health = 10;
    await w.tick(100);
    expect(l.health).toBeGreaterThan(10);
    expect(w.player.entity.food!.saturation).toBeLessThan(5);
  });

  it('dies, drops the inventory and respawns', async () => {
    const w = await startTestWorld();
    w.player.inventory.set(0, new ItemStack('diamond', 5));
    hurt(w.player.level, w.player.entity, 'generic_kill', 1000);
    expect(w.player.entity.living!.dead).toBe(true);
    await w.tick(2);
    expect(w.received('playerDeath').length).toBe(1);
    expect(w.player.inventory.count('diamond')).toBe(0);
    const items = [...w.player.level.entities.query('item')];
    expect(items.some((e) => e.item!.stack.id === 'diamond')).toBe(true);
    await w.send({ type: 'clientCommand', action: 'respawn' });
    expect(w.player.entity.living!.dead).toBe(false);
    expect(w.player.entity.living!.health).toBe(20);
  });

  it('drops an item with Q and picks it up again', async () => {
    const w = await startTestWorld();
    w.player.inventory.set(0, new ItemStack('apple', 3));
    const t = w.player.entity.transform;
    await w.send({ type: 'action', action: 'drop_item', x: 0, y: 0, z: 0, face: 0, seq: 1 });
    expect(w.player.inventory.count('apple')).toBe(2);
    const dropped = [...w.player.level.entities.query('item')][0]!;
    expect(dropped.item!.stack.count).toBe(1);
    // Move the item back onto the player; pickup happens after the delay
    dropped.transform!.x = t.x; dropped.transform!.y = t.y; dropped.transform!.z = t.z;
    dropped.physics!.vx = dropped.physics!.vz = 0;
    await w.tick(60);
    expect(w.player.inventory.count('apple')).toBe(3);
  });

  it('breaking stone with a pickaxe drops cobblestone and wears the tool', async () => {
    const w = await startTestWorld();
    const lvl = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 1, z = Math.floor(t.z), y = Math.floor(t.y);
    lvl.setBlock(x, y, z, BLOCK_BY_NAME.get('stone')!.defaultState, 3);
    w.player.inventory.set(0, new ItemStack('wooden_pickaxe', 1));
    w.player.breakBlock(x, y, z, true);
    const items = [...lvl.entities.query('item')].map((e) => e.item!.stack.id);
    expect(items).toContain('cobblestone');
    expect(w.player.inventory.get(0).damage).toBe(1);
    // Without the right tool stone drops nothing
    lvl.setBlock(x, y, z, BLOCK_BY_NAME.get('stone')!.defaultState, 3);
    w.player.inventory.set(0, ItemStack.empty());
    for (const e of [...lvl.entities.query('item')]) lvl.entities.remove(e);
    w.player.breakBlock(x, y, z, true);
    expect([...lvl.entities.query('item')].length).toBe(0);
  });

  it('eats food over 32 ticks', async () => {
    const w = await startTestWorld();
    w.player.entity.food!.food = 10;
    w.player.inventory.set(0, new ItemStack('bread', 2));
    await w.send({ type: 'useItem', hand: 'main', seq: 1, yaw: 0, pitch: 0 });
    await w.tick(40);
    expect(w.player.inventory.count('bread')).toBe(1);
    expect(w.player.entity.food!.food).toBe(15);
  });

  it('runs commands: give, gamemode, effect, time', async () => {
    const w = await startTestWorld();
    await w.command('give @s iron_ingot 70');
    expect(w.player.inventory.count('iron_ingot')).toBe(70);
    await w.command('gamemode creative');
    expect(w.player.data.gameMode).toBe('creative');
    await w.command('effect give @s speed 10 1');
    expect(w.player.entity.living!.effects.get('speed')?.amp).toBe(1);
    await w.command('time set night');
    expect(w.server.dayTime % 24000).toBe(13000);
    await w.command('xp add @s 5 levels');
    expect(w.player.entity.xp!.level).toBe(5);
    const suggestions = w.server.hooks;
    expect(suggestions).toBeTruthy();
  });

  it('suggests command completions', async () => {
    const w = await startTestWorld();
    w.clear();
    await w.send({ type: 'commandSuggest', requestId: 7, text: 'gamem' });
    const s = w.received('commandSuggestions')[0]!;
    expect(s['suggestions']).toContain('gamemode');
    await w.send({ type: 'commandSuggest', requestId: 8, text: 'give @s diamond_sw' });
    expect(w.received('commandSuggestions')[1]!['suggestions']).toContain('diamond_sword');
  });

  it('crafts through the inventory menu packets', async () => {
    const w = await startTestWorld();
    w.player.inventory.set(0, new ItemStack('oak_log', 1));
    await w.tick(1);
    const m = w.player.menus.inventory;
    await w.send({ type: 'containerClick', windowId: 0, stateId: m.stateId, slot: 36, button: 0, mode: 'pickup' });
    await w.send({ type: 'containerClick', windowId: 0, stateId: m.stateId, slot: 1, button: 0, mode: 'pickup' });
    await w.send({ type: 'containerClick', windowId: 0, stateId: m.stateId, slot: 0, button: 0, mode: 'quick_move' });
    expect(w.player.inventory.count('oak_planks')).toBe(4);
  });

  it('bone meal grows a sapling into a tree eventually', async () => {
    const w = await startTestWorld();
    const lvl = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 3, z = Math.floor(t.z) + 3;
    const y = lvl.getHeight('motion', x, z);
    lvl.setBlock(x, y, z, BLOCK_BY_NAME.get('oak_sapling')!.defaultState, 3);
    w.player.inventory.set(0, new ItemStack('bone_meal', 64));
    for (let i = 0; i < 40 && lvl.getBlockState(x, y, z) !== BLOCK_BY_NAME.get('oak_log')!.defaultState; i++) {
      await w.send({ type: 'useItemOn', x, y, z, face: 1, hx: 0.5, hy: 1, hz: 0.5, hand: 'main', seq: i, inside: false });
    }
    expect(lvl.getBlockState(x, y, z)).not.toBe(BLOCK_BY_NAME.get('oak_sapling')!.defaultState);
    expect(w.player.inventory.count('bone_meal')).toBeLessThan(64);
  });
});
