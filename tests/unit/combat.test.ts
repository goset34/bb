import { describe, it, expect } from 'vitest';
import { startTestWorld, TestWorld } from './harness';
import { ItemStack } from '../../src/common/item/stack';
import { BLOCK_BY_NAME } from '../../src/common/block/registry';
import { mobOf, Mob } from '../../src/server/mobs/mob';
import { projOf } from '../../src/server/combat/projectiles';

async function summon(w: TestWorld, type: string, dx: number, dz = 0, data = ''): Promise<Mob> {
  const t = w.player.entity.transform;
  for (let i = 0; i < 60 && !w.player.level.isLoaded(Math.floor(t.x) + dx, Math.floor(t.z) + dz); i++) await w.tick();
  const before = new Set([...w.player.level.entities.all()].map((e) => e.id));
  await w.command(`summon ${type} ${Math.floor(t.x) + dx + 0.5} ${Math.floor(t.y)} ${Math.floor(t.z) + dz + 0.5}${data ? ' ' + data : ''}`);
  const e = [...w.player.level.entities.all()].find((x) => !before.has(x.id) && x.type === type);
  expect(e).toBeTruthy();
  return mobOf(e)!;
}

/** Aim the player at a point (server-side rotation used by projectiles). */
function aim(w: TestWorld, x: number, y: number, z: number): void {
  const t = w.player.entity.transform;
  const dx = x - t.x, dy = y - (t.y + w.player.entity.physics.eyeHeight), dz = z - t.z;
  t.yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
  t.pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

describe('Combat (in-process server)', () => {
  it('draws a bow, shoots an arrow that hurts a mob and consumes ammo', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const inv = w.player.inventory;
    inv.set(inv.selected, new ItemStack('bow', 1));
    inv.set(9, new ItemStack('arrow', 5));
    const cow = await summon(w, 'cow', 0, 8, '{"noAI":true}');
    aim(w, cow.x, cow.y + 0.7, cow.z);
    await w.send({ type: 'useItem', hand: 'main', seq: 1, yaw: w.player.entity.transform.yaw, pitch: w.player.entity.transform.pitch });
    for (let i = 0; i < 22; i++) {
      aim(w, cow.x, cow.y + 0.7, cow.z);
      await w.tick();
    }
    aim(w, cow.x, cow.y + 0.7, cow.z);
    await w.send({ type: 'action', action: 'release_use', x: 0, y: 0, z: 0, face: 0, seq: 2 });
    expect(inv.get(9).count).toBe(4);
    const arrow = [...w.player.level.entities.all()].find((e) => e.type === 'arrow');
    expect(arrow && projOf(arrow)?.crit).toBe(true);
    for (let i = 0; i < 20 && cow.e.living.health === 10; i++) await w.tick();
    expect(cow.e.living.health).toBeLessThan(10);
  });

  it('primed TNT explodes, breaking blocks and hurting nearby entities', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const level = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 6, z = Math.floor(t.z), y = Math.floor(t.y) - 1;
    const pig = await summon(w, 'pig', 8, 0, '{"noAI":true}');
    level.createEntity('tnt', x + 0.5, y + 1, z + 0.5, { fuse: 5 });
    await w.tick(10);
    expect(level.getBlockState(x, y, z)).toBe(0);
    expect(pig.e.living.health).toBeLessThan(10);
  });

  it('a hisser swells and explodes next to a survival player', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    await w.command('time set midnight');
    const h = await summon(w, 'hisser', 2);
    const l = w.player.entity.living!;
    for (let i = 0; i < 200 && !h.e.removed; i++) await w.tick();
    expect(h.e.removed).toBe(true);
    expect(l.health).toBeLessThan(20);
  });

  it('skeletons shoot arrows at players', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    await w.command('time set midnight');
    const s = await summon(w, 'skeleton', 10);
    expect(s.equipment[0]!.id).toBe('bow');
    let shot = false;
    for (let i = 0; i < 200 && !shot; i++) {
      await w.tick();
      shot = [...w.player.level.entities.all()].some((e) => e.type === 'arrow' && projOf(e)?.owner === s.e.id);
    }
    expect(shot).toBe(true);
  });

  it('a raised shield blocks a zombie hit', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    await w.command('time set midnight');
    const inv = w.player.inventory;
    inv.set(40, new ItemStack('shield', 1));
    await w.send({ type: 'useItem', hand: 'off', seq: 1, yaw: 0, pitch: 0 });
    const z = await summon(w, 'zombie', 0, 3);
    const t = w.player.entity.transform;
    const l = w.player.entity.living!;
    for (let i = 0; i < 120; i++) {
      aim(w, z.x, z.y + 1.5, z.z);
      t.headYaw = t.yaw;
      await w.tick();
    }
    expect(l.health).toBe(20);
    expect(inv.get(40).damage).toBeGreaterThan(0);
  });

  it('explosions respect blast resistance', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    const level = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 8, z = Math.floor(t.z), y = Math.floor(t.y);
    const obsidian = BLOCK_BY_NAME.get('obsidian')!.defaultState;
    level.setBlock(x + 1, y, z, obsidian);
    level.explode(null, x + 0.5, y + 0.5, z + 0.5, 4, false, 'tnt');
    expect(level.getBlockState(x + 1, y, z)).toBe(obsidian);
    expect(level.getBlockState(x, y - 1, z)).toBe(0);
  });
});
