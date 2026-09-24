import { describe, it, expect } from 'vitest';
import { ItemStack } from '../../src/common/item/stack';
import { BLOCK_BY_NAME } from '../../src/common/block/registry';
import { startTestWorld, TestWorld } from './harness';
import { mobOf, Mob } from '../../src/server/mobs/mob';
import { hurt } from '../../src/server/survival/living';
import { setEntityOnShoulder } from '../../src/server/mobs/defs/parrot';

async function summon(w: TestWorld, type: string, dx = 3, extra = ''): Promise<Mob> {
  const t = w.player.entity.transform;
  for (let i = 0; i < 60 && !w.player.level.isLoaded(Math.floor(t.x) + dx, Math.floor(t.z)); i++) await w.tick();
  const before = new Set([...w.player.level.entities.all()].map((e) => e.id));
  await w.command(`summon ${type} ${Math.floor(t.x) + dx + 0.5} ${Math.floor(t.y)} ${Math.floor(t.z) + 0.5}${extra ? ' ' + extra : ''}`);
  const e = [...w.player.level.entities.all()].find((x) => !before.has(x.id) && x.type === type);
  expect(e).toBeTruthy();
  return mobOf(e)!;
}

async function interact(w: TestWorld, m: Mob, item: string | null): Promise<void> {
  const inv = w.player.inventory;
  inv.set(inv.selected, item ? new ItemStack(item, 1) : ItemStack.empty());
  await w.send({ type: 'interact', entityId: m.e.id, kind: 'interact', hand: 'main' });
}

describe('Pets, leads and pickup', () => {
  it('tames a wolf with bones, sits on command and follows the owner', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const wolf = await summon(w, 'wolf', 2);
    for (let i = 0; i < 60 && !wolf.data['tamed']; i++) await interact(w, wolf, 'bone');
    expect(wolf.data['tamed']).toBe(true);
    expect(wolf.data['owner']).toBe(w.player.name);
    expect(wolf.maxHealth).toBe(40);
    expect(wolf.data['sitting']).toBe(true);
    // Owner right-click toggles sitting
    await interact(w, wolf, null);
    expect(wolf.data['sitting']).toBe(false);
    // Dyeing the collar
    await interact(w, wolf, 'blue_dye');
    expect(wolf.data['collar']).toBe('blue');
    // Owner walks away: the wolf teleports back to them
    const t = w.player.entity.transform;
    await w.command(`tp @s ${t.x + 20} ${t.y} ${t.z}`);
    for (let i = 0; i < 200 && wolf.distanceToSqr(w.player.entity) > 144; i++) await w.tick();
    expect(wolf.distanceToSqr(w.player.entity)).toBeLessThan(144);
  });

  it('wolf armour absorbs hits and pets never target their owner', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const wolf = await summon(w, 'wolf', 2);
    for (let i = 0; i < 60 && !wolf.data['tamed']; i++) await interact(w, wolf, 'bone');
    await interact(w, wolf, 'wolf_armor');
    expect(wolf.data['bodyArmor']).toBeTruthy();
    const hp = wolf.health;
    hurt(w.player.level, wolf.e, 'player_attack', 6, w.player.entity);
    expect(wolf.health).toBe(hp);
    await w.tick(5);
    expect(wolf.getTarget()).not.toBe(w.player.entity);
  });

  it('leads pull animals and tie them to fence knots', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const cow = await summon(w, 'cow', 2);
    await interact(w, cow, 'lead');
    expect(cow.leashHolder).toBe(w.player.entity);
    expect(w.player.inventory.mainHand.isEmpty()).toBe(true);
    // A fence next to the player
    const t = w.player.entity.transform;
    const fx = Math.floor(t.x), fy = Math.floor(t.y), fz = Math.floor(t.z) + 2;
    w.player.level.setBlock(fx, fy, fz, BLOCK_BY_NAME.get('oak_fence')!.defaultState);
    await w.send({ type: 'useItemOn', x: fx, y: fy, z: fz, face: 1, hand: 'main', hx: 0.5, hy: 1, hz: 0.5 });
    expect(cow.leashHolder?.type).toBe('leash_knot');
    // Knots persist and let the cow wander only nearby
    for (let i = 0; i < 100; i++) await w.tick();
    expect(Math.hypot(cow.x - fx - 0.5, cow.z - fz - 0.5)).toBeLessThan(10);
    // Breaking the fence drops the lead
    w.player.level.setBlock(fx, fy, fz, 0);
    await w.tick(2);
    expect(cow.leashHolder).toBeNull();
    expect([...w.player.level.entities.all()].some((e) => e.item?.stack.id === 'lead')).toBe(true);
  });

  it('parrots ride on shoulders and fly off when the player is hurt', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const parrot = await summon(w, 'parrot', 1);
    for (let i = 0; i < 200 && !parrot.data['tamed']; i++) await interact(w, parrot, 'wheat_seeds');
    expect(parrot.data['tamed']).toBe(true);
    await w.tick(3);
    expect(setEntityOnShoulder(w.player, parrot)).toBe(true);
    expect(parrot.e.removed).toBe(true);
    expect(w.player.entity.meta?.['shoulderLeft']).toBeTruthy();
    const saved = w.server.hooks.savePlayer(w.player);
    expect(saved['shoulders']).toBeTruthy();
    await w.tick(25);
    hurt(w.player.level, w.player.entity, 'generic', 1, null);
    const back = [...w.player.level.entities.all()].find((e) => e.type === 'parrot');
    expect(back).toBeTruthy();
    expect(mobOf(back)?.data['owner']).toBe(w.player.name);
    expect(w.player.entity.meta?.['shoulderLeft']).toBe('');
  });

  it('monsters that pick up loot equip better armour', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    await w.command('time set midnight');
    const z = await summon(w, 'zombie', 3);
    z.canPickUpLoot = true;
    w.player.level.spawnItem(z.x, z.y + 0.2, z.z, new ItemStack('diamond_helmet', 1), 0, 0, 0, 0);
    for (let i = 0; i < 40 && z.equipment[5]!.isEmpty(); i++) await w.tick();
    expect(z.equipment[5]!.id).toBe('diamond_helmet');
    expect(z.guaranteedDrops[5]).toBe(true);
  });

  it('foxes carry items in their mouth', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    const fox = await summon(w, 'fox', 3);
    fox.equipment[0] = ItemStack.empty();
    w.player.level.spawnItem(fox.x, fox.y + 0.2, fox.z, new ItemStack('emerald', 3), 0, 0, 0, 0);
    for (let i = 0; i < 40 && fox.equipment[0]!.isEmpty(); i++) await w.tick();
    expect(fox.equipment[0]!.id).toBe('emerald');
    expect(fox.equipment[0]!.count).toBe(1);
  });
});
