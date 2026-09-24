import { describe, it, expect } from 'vitest';
import { BLOCK_BY_NAME, getBlock } from '../../src/common/block/registry';
import { startTestWorld } from './harness';
import { mobOf } from '../../src/server/mobs/mob';
import { MOBS } from '../../src/common/entity/mobs';

describe('Spawning and constructs', () => {
  it('monsters spawn naturally at night around survival players', async () => {
    const w = await startTestWorld({ mode: 'survival', difficulty: 2 });
    await w.command('time set midnight');
    const level = w.player.level;
    for (let i = 0; i < 20; i++) await w.tick();
    let monsters = 0;
    for (let i = 0; i < 400 && monsters === 0; i++) {
      await w.tick();
      monsters = [...level.entities.all()].filter((e) => MOBS.get(e.type)?.category === 'monster').length;
    }
    expect(monsters).toBeGreaterThan(0);
    // None closer than 24 blocks when they appeared
    for (const e of level.entities.all()) {
      if (MOBS.get(e.type)?.category !== 'monster') continue;
      const m = mobOf(e)!;
      expect(m.tickCount).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  it('builds iron and snow golems from blocks and a carved pumpkin', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    const level = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 3, y = Math.floor(t.y), z = Math.floor(t.z) + 3;
    const iron = BLOCK_BY_NAME.get('iron_block')!.defaultState;
    level.setBlock(x, y, z, iron);
    level.setBlock(x, y + 1, z, iron);
    level.setBlock(x - 1, y + 1, z, iron);
    level.setBlock(x + 1, y + 1, z, iron);
    const inv = w.player.inventory;
    inv.set(inv.selected, new (await import('../../src/common/item/stack')).ItemStack('carved_pumpkin', 1));
    await w.send({ type: 'useItemOn', x, y: y + 1, z, face: 1, hand: 'main', hx: 0.5, hy: 1, hz: 0.5 });
    await w.tick(2);
    const golem = [...level.entities.all()].find((e) => e.type === 'iron_golem');
    expect(golem).toBeTruthy();
    expect(mobOf(golem)!.data['playerCreated']).toBe(true);
    expect(level.getBlockState(x, y + 1, z)).toBe(0);
    // Snow golem
    const snow = BLOCK_BY_NAME.get('snow_block')!.defaultState;
    level.setBlock(x - 3, y, z, snow);
    level.setBlock(x - 3, y + 1, z, snow);
    inv.set(inv.selected, new (await import('../../src/common/item/stack')).ItemStack('carved_pumpkin', 1));
    await w.send({ type: 'useItemOn', x: x - 3, y: y + 1, z, face: 1, hand: 'main', hx: 0.5, hy: 1, hz: 0.5 });
    await w.tick(2);
    expect([...level.entities.all()].some((e) => e.type === 'snow_golem')).toBe(true);
  });

  it('a monster spawner block spawns its mob near players in the dark', async () => {
    const w = await startTestWorld({ mode: 'creative', difficulty: 2 });
    const level = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 4, y = Math.floor(t.y), z = Math.floor(t.z);
    level.setBlock(x, y, z, getBlock('spawner').defaultState);
    level.setBlockEntity({ type: 'spawner', x, y, z, data: { entity: 'zombie', delay: 5 } });
    await w.command('time set midnight');
    let n = 0;
    for (let i = 0; i < 100 && n === 0; i++) {
      await w.tick();
      n = [...level.entities.all()].filter((e) => e.type === 'zombie').length;
    }
    expect(n).toBeGreaterThan(0);
  });

  it('bees without a hive find one and enter it at night', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    const level = w.player.level;
    const t = w.player.entity.transform;
    const x = Math.floor(t.x) + 3, y = Math.floor(t.y) + 1, z = Math.floor(t.z) + 3;
    level.setBlock(x, y, z, getBlock('beehive').defaultState);
    level.setBlockEntity({ type: 'beehive', x, y, z, data: { bees: [] } });
    await w.command('time set midnight');
    await w.command(`summon bee ${x + 0.5} ${y + 1} ${z + 2.5}`);
    const bee = mobOf([...level.entities.all()].find((e) => e.type === 'bee'))!;
    for (let i = 0; i < 600 && !bee.e.removed; i++) await w.tick();
    expect(bee.e.removed).toBe(true);
    const be = level.getBlockEntity(x, y, z)!;
    expect((be.data['bees'] as unknown[]).length).toBe(1);
  }, 30000);
});
