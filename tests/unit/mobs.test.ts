import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries } from '../../src/common/init';
import { BLOCK_BY_NAME } from '../../src/common/block/registry';
import { ItemStack } from '../../src/common/item/stack';
import { PathSearch, PathMode, PathMob, PathWorld, malusTable, staticPathType, PathType } from '../../src/server/mobs/pathfinding';
import { startTestWorld, TestWorld } from './harness';
import { mobOf, Mob } from '../../src/server/mobs/mob';
import { hurt } from '../../src/server/survival/living';
import { storeChunkEntities, restoreChunkEntities } from '../../src/server/entity/persistence';

/** Tiny in-memory world: a stone floor at y=0 plus placed blocks. */
class TestGrid implements PathWorld {
  readonly minY = -64;
  readonly maxY = 320;
  private readonly blocks = new Map<string, number>();
  constructor(private readonly floor: number) {}
  set(x: number, y: number, z: number, name: string): void {
    this.blocks.set(`${x},${y},${z}`, BLOCK_BY_NAME.get(name)!.defaultState);
  }
  del(x: number, y: number, z: number): void {
    this.blocks.delete(`${x},${y},${z}`);
  }
  getBlockState(x: number, y: number, z: number): number {
    const b = this.blocks.get(`${x},${y},${z}`);
    if (b !== undefined) return b;
    return y === 0 ? this.floor : 0;
  }
}

const walker = (): PathMob => ({
  mode: PathMode.WALK, width: 0.6, height: 1.95, stepHeight: 0.6, maxFall: 3, canOpenDoors: false, canPassDoors: true,
  canFloat: true, canBreach: false, malus: malusTable(),
});

function wall(g: TestGrid, x: number, z0: number, z1: number, h: number, name = 'stone'): void {
  for (let z = z0; z <= z1; z++) for (let y = 1; y <= h; y++) g.set(x, y, z, name);
}

describe('Pathfinding', () => {
  beforeAll(() => initRegistries());
  const q = (tx: number, tz: number, ty = 1) => ({ targets: [[tx, ty, tz] as [number, number, number]], reach: 0, maxVisited: 2000, maxRange: 40 });

  it('walks straight on flat ground', () => {
    const g = new TestGrid(BLOCK_BY_NAME.get('stone')!.defaultState);
    const p = new PathSearch().find(g, walker(), { x: 0.5, y: 1, z: 0.5, onGround: true, inWater: false }, q(8, 0));
    expect(p?.reached).toBe(true);
    expect(p!.end).toMatchObject({ x: 8, y: 1, z: 0 });
    expect(p!.nodes.length).toBe(9);
  });

  it('goes around a two-block wall through a gap', () => {
    const g = new TestGrid(BLOCK_BY_NAME.get('stone')!.defaultState);
    wall(g, 4, -10, 10, 2);
    // Gap at z = 6
    for (let y = 1; y <= 2; y++) g.del(4, y, 6);
    const p = new PathSearch().find(g, walker(), { x: 0.5, y: 1, z: 0.5, onGround: true, inWater: false }, q(8, 0));
    expect(p?.reached).toBe(true);
    expect(p!.nodes.some((n) => n.x === 4 && n.z === 6)).toBe(true);
    expect(p!.nodes.every((n) => n.y === 1)).toBe(true);
  });

  it('steps up one block but not over fences', () => {
    const g = new TestGrid(BLOCK_BY_NAME.get('stone')!.defaultState);
    wall(g, 4, -3, 3, 1);
    const up = new PathSearch().find(g, walker(), { x: 0.5, y: 1, z: 0.5, onGround: true, inWater: false }, q(4, 0, 2));
    expect(up?.reached).toBe(true);
    expect(up!.end!.y).toBe(2);
    const f = new TestGrid(BLOCK_BY_NAME.get('stone')!.defaultState);
    wall(f, 4, -30, 30, 1, 'oak_fence');
    const blocked = new PathSearch().find(f, walker(), { x: 0.5, y: 1, z: 0.5, onGround: true, inWater: false }, q(8, 0));
    expect(blocked?.reached).toBe(false);
  });

  it('refuses long drops and avoids cactus', () => {
    const stone = BLOCK_BY_NAME.get('stone')!.defaultState;
    const g = new TestGrid(stone);
    for (let x = -2; x <= 3; x++) for (let z = -2; z <= 2; z++) for (let y = 1; y <= 5; y++) g.set(x, y, z, 'stone');
    const p = new PathSearch().find(g, walker(), { x: 0.5, y: 6, z: 0.5, onGround: true, inWater: false }, q(8, 0, 1));
    expect(p?.reached).toBe(false);
    const c = new TestGrid(stone);
    c.set(1, 1, 0, 'cactus');
    expect(staticPathType(c, 1, 1, 1)).toBe(PathType.DANGER_OTHER);
    const around = new PathSearch().find(c, walker(), { x: 0.5, y: 1, z: 0.5, onGround: true, inWater: false }, q(3, 0));
    expect(around!.nodes.some((n) => n.x === 1 && n.z === 0)).toBe(false);
  });

  it('swimmers stay in water and flyers cross gaps', () => {
    const g = new TestGrid(BLOCK_BY_NAME.get('stone')!.defaultState);
    for (let x = -1; x <= 8; x++) for (let z = -1; z <= 1; z++) for (let y = 1; y <= 3; y++) g.set(x, y, z, 'water');
    const fish: PathMob = { ...walker(), mode: PathMode.SWIM, width: 0.5, height: 0.3, malus: malusTable({ [PathType.WATER]: 0 }) };
    const p = new PathSearch().find(g, fish, { x: 0.5, y: 2, z: 0.5, onGround: false, inWater: true }, { targets: [[7, 2, 0]], reach: 0, maxVisited: 1000, maxRange: 20 });
    expect(p?.reached).toBe(true);
    const bird: PathMob = { ...walker(), mode: PathMode.FLY, width: 0.5, height: 0.9 };
    const air = new TestGrid(0);
    const f = new PathSearch().find(air, bird, { x: 0.5, y: 10, z: 0.5, onGround: false, inWater: false }, { targets: [[6, 12, 3]], reach: 0, maxVisited: 1000, maxRange: 20 });
    expect(f?.reached).toBe(true);
  });
});

async function summon(w: TestWorld, type: string, dx = 3, extra = ''): Promise<Mob> {
  const t = w.player.entity.transform;
  for (let i = 0; i < 60 && !w.player.level.isLoaded(Math.floor(t.x) + dx, Math.floor(t.z)); i++) await w.tick();
  const before = new Set([...w.player.level.entities.all()].map((e) => e.id));
  await w.command(`summon ${type} ${Math.floor(t.x) + dx + 0.5} ${Math.floor(t.y)} ${Math.floor(t.z) + 0.5}${extra ? ' ' + extra : ''}`);
  const e = [...w.player.level.entities.all()].find((x) => !before.has(x.id) && x.type === type);
  expect(e).toBeTruthy();
  return mobOf(e)!;
}

describe('Mobs (in-process server)', () => {
  it('summons a cow that wanders and persists with its chunk', async () => {
    const w = await startTestWorld({ mode: 'creative' });
    const cow = await summon(w, 'cow');
    expect(cow.e.living.health).toBe(10);
    const x0 = cow.x, z0 = cow.z;
    // Force a stroll and let it walk
    for (let i = 0; i < 400 && Math.hypot(cow.x - x0, cow.z - z0) < 1; i++) await w.tick();
    expect(Math.hypot(cow.x - x0, cow.z - z0)).toBeGreaterThan(1);
    // Save and restore through the chunk
    const level = w.player.level;
    cow.data['variant'] = 'cold';
    const c = level.chunks.getFull(Math.floor(cow.x) >> 4, Math.floor(cow.z) >> 4)!;
    storeChunkEntities(level, c, true);
    expect(cow.e.removed).toBe(true);
    restoreChunkEntities(level, c);
    const back = [...level.entities.all()].find((e) => e.type === 'cow');
    expect(mobOf(back)?.data['variant']).toBe('cold');
  });

  it('milks cows, shears sheep and breeds with wheat', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const inv = w.player.inventory;
    const cow = await summon(w, 'cow', 2);
    inv.set(inv.selected, new ItemStack('bucket', 1));
    await w.send({ type: 'interact', entityId: cow.e.id, kind: 'interact', hand: 'main' });
    expect(inv.mainHand.id).toBe('milk_bucket');
    const sheep = await summon(w, 'sheep', -2, '{"data":{"color":"red"}}');
    inv.set(inv.selected, new ItemStack('shears', 1));
    await w.send({ type: 'interact', entityId: sheep.e.id, kind: 'interact', hand: 'main' });
    expect(sheep.data['sheared']).toBe(true);
    await w.tick(3);
    const wool = [...w.player.level.entities.all()].filter((e) => e.item?.stack.id === 'red_wool');
    expect(wool.length).toBeGreaterThan(0);
    // Breeding
    const cow2 = await summon(w, 'cow', 3);
    for (const c of [cow, cow2]) {
      inv.set(inv.selected, new ItemStack('wheat', 1));
      await w.send({ type: 'interact', entityId: c.e.id, kind: 'interact', hand: 'main' });
    }
    let baby: Mob | undefined;
    for (let i = 0; i < 300 && !baby; i++) {
      await w.tick();
      baby = [...w.player.level.entities.all()].map((e) => mobOf(e)).find((m) => m?.def.id === 'cow' && m.isBaby);
    }
    expect(baby).toBeTruthy();
    expect(baby!.e.physics.height).toBeLessThan(1);
  });

  it('drops loot and experience when killed by a player', async () => {
    const w = await startTestWorld({ mode: 'survival' });
    const pig = await summon(w, 'pig', 2);
    hurt(w.player.level, pig.e, 'player_attack', 100, w.player.entity);
    expect(pig.e.living.dead).toBe(true);
    await w.tick(25);
    expect(pig.e.removed).toBe(true);
    const all = [...w.player.level.entities.all()];
    expect(all.some((e) => e.item?.stack.id === 'porkchop' || e.item?.stack.id === 'cooked_porkchop')).toBe(true);
    expect(all.some((e) => e.type === 'xp_orb') || w.player.entity.xp!.total > 0).toBe(true);
  });

  it('zombies hunt and hurt survival players at night', async () => {
    const w = await startTestWorld({ mode: 'survival', difficulty: 2 });
    await w.command('time set midnight');
    const z = await summon(w, 'zombie', 6);
    const l = w.player.entity.living!;
    for (let i = 0; i < 300 && l.health === 20; i++) await w.tick();
    expect(z.getTarget()).toBe(w.player.entity);
    expect(l.health).toBeLessThan(20);
  });

  it('zombies burn in daylight and peaceful removes monsters', async () => {
    const w = await startTestWorld({ mode: 'creative', difficulty: 2 });
    await w.command('time set noon');
    const z = await summon(w, 'zombie', 4);
    for (let i = 0; i < 200 && z.e.physics.fireTicks === 0; i++) await w.tick();
    expect(z.e.physics.fireTicks).toBeGreaterThan(0);
    await w.command('difficulty peaceful');
    await w.tick(2);
    expect(z.e.removed).toBe(true);
  });
});
