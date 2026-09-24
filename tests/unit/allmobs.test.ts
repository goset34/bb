import { describe, it, expect } from 'vitest';
import { startTestWorld } from './harness';
import { MOB_DEFS, mobOf } from '../../src/server/mobs/mob';
import { MOBS } from '../../src/common/entity/mobs';
import { storeChunkEntities, restoreChunkEntities } from '../../src/server/entity/persistence';

describe('Every mob', () => {
  it('has a shared definition, spawns, runs its AI, saves and reloads', async () => {
    const w = await startTestWorld({ mode: 'creative', difficulty: 2 });
    const level = w.player.level;
    const t = w.player.entity.transform;
    for (let i = 0; i < 60 && !level.isLoaded(Math.floor(t.x) + 8, Math.floor(t.z) + 8); i++) await w.tick();
    const ids = [...MOB_DEFS.keys()];
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) expect(MOBS.has(id), `${id} missing from MOBS`).toBe(true);
    let dx = 0;
    const spawned: Array<[string, number]> = [];
    for (const id of ids) {
      const e = level.createEntity(id, Math.floor(t.x) + (dx % 8) + 0.5, Math.floor(t.y), Math.floor(t.z) + Math.floor(dx / 8) + 0.5, { reason: 'command' });
      dx++;
      expect(e, id).toBeTruthy();
      spawned.push([id, e!.id]);
    }
    for (let i = 0; i < 100; i++) await w.tick();
    // Survivors round-trip through chunk storage
    const c = level.chunks.getFull(Math.floor(t.x) >> 4, Math.floor(t.z) >> 4)!;
    storeChunkEntities(level, c, true);
    restoreChunkEntities(level, c);
    for (let i = 0; i < 20; i++) await w.tick();
    const alive = [...level.entities.all()].filter((e) => mobOf(e));
    expect(alive.length).toBeGreaterThan(ids.length / 2);
  }, 60000);
});
