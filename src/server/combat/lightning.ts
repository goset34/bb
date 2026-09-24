/**
 * Lightning bolts (reference LightningBolt): a few flashes that set fire around the impact,
 * strike entities (damage, ignition, mob-specific reactions through `mob.def.onLightning`) and
 * natural strikes during thunderstorms, including skeleton horse traps.
 */
import type { Entity } from '../../common/entity/ecs';
import { makeTransform } from '../../common/entity/components';
import { AABB } from '../../common/math/geom';
import { stateFlags, F, getBlock, blockOf } from '../../common/block/registry';
import type { Chunk } from '../../common/world/chunk';
import type { ServerLevel } from '../level';
import { hurt } from '../survival/living';
import { mobOf } from '../mobs/mob';
import { localDifficulty } from '../mobs/factory';

interface BoltState {
  life: number;
  flashes: number;
  visualOnly: boolean;
  cause: number;
  hit: Set<number>;
}

export function spawnLightning(level: ServerLevel, x: number, y: number, z: number, visualOnly = false, cause: Entity | null = null): Entity {
  const e: Entity = {
    id: 0, type: 'lightning_bolt', removed: false, transform: makeTransform(x, y, z),
    meta: { seed: level.random.nextInt(0x7fffffff) }, noSave: true,
    bolt: { life: 2, flashes: level.random.nextInt(3) + 1, visualOnly, cause: cause?.id ?? 0, hit: new Set<number>() } satisfies BoltState,
  };
  level.addFreshEntity(e);
  return e;
}

function placeFire(level: ServerLevel, x: number, y: number, z: number): void {
  if (!(stateFlags[level.getBlockState(x, y, z)]! & F.AIR)) return;
  const below = level.getBlockState(x, y - 1, z);
  if (!(stateFlags[below]! & F.SOLID)) return;
  level.setBlock(x, y, z, getBlock('fire').defaultState, 3);
}

function spawnFire(level: ServerLevel, e: Entity, extra: number): void {
  const b = e['bolt'] as BoltState;
  if (b.visualOnly || level.getDifficulty() === 0 || level.getGameRule('doFireTick') === false) return;
  const t = e.transform!;
  const x = Math.floor(t.x), y = Math.floor(t.y), z = Math.floor(t.z);
  placeFire(level, x, y, z);
  const r = level.random;
  for (let i = 0; i < extra; i++) placeFire(level, x + r.nextInt(3) - 1, y + r.nextInt(3) - 1, z + r.nextInt(3) - 1);
}

/** Default reaction of an entity struck by lightning (reference Entity.thunderHit). */
function thunderHit(level: ServerLevel, target: Entity, bolt: Entity): void {
  const m = mobOf(target);
  if (m?.def.onLightning?.(m, bolt)) return;
  const p = target.physics;
  if (p) {
    p.fireTicks++;
    if (p.fireTicks === 1) level.igniteEntity(target, 8);
  }
  if (target.living) hurt(level, target, 'lightning_bolt', 5, null);
  else if (target.item && !target.removed) level.entities.remove(target);
}

export function tickLightning(level: ServerLevel, e: Entity): void {
  const b = e['bolt'] as BoltState;
  const t = e.transform!;
  if (b.life === 2) {
    level.broadcastNear(t.x, t.y, t.z, 10000, { type: 'sound', sound: 'entity.lightning_bolt.thunder', x: t.x, y: t.y, z: t.z, volume: 10000, pitch: 0.8 + level.random.nextFloat() * 0.2, category: 'weather' });
    level.playSound(t.x, t.y, t.z, 'entity.lightning_bolt.impact', 2, 0.5 + level.random.nextFloat() * 0.2);
    spawnFire(level, e, 4);
    lightningHooks.strike(level, Math.floor(t.x), Math.floor(t.y - 1e-6), Math.floor(t.z));
    level.gameEvent('lightning_strike', t.x, t.y, t.z, e);
  }
  b.life--;
  if (b.life < 0) {
    if (b.flashes === 0) {
      level.entities.remove(e);
      return;
    }
    if (b.life < -level.random.nextInt(10)) {
      b.flashes--;
      b.life = 1;
      e.meta!['seed'] = level.random.nextInt(0x7fffffff);
      if (e.net) e.net.metaDirty = true;
      spawnFire(level, e, 0);
    }
  }
  if (b.life >= 0 && !b.visualOnly) {
    const box = new AABB(t.x - 3, t.y - 3, t.z - 3, t.x + 3, t.y + 9, t.z + 3);
    for (const o of level.getEntities(box, (o) => !o.removed && !o.living?.dead && o.type !== 'lightning_bolt', e)) {
      thunderHit(level, o, e);
      b.hit.add(o.id);
    }
  }
}

/** Hooks: lightning rods and copper deoxidation (redstone module). */
export const lightningHooks = {
  strike: (_level: ServerLevel, _x: number, _y: number, _z: number): void => {},
  /** Lightning rod position near a strike target (null = none). */
  findRod: (_level: ServerLevel, _x: number, _y: number, _z: number): [number, number, number] | null => null,
};

/** Natural strikes during thunderstorms (reference ServerLevel.tickChunk). */
export function tickChunkLightning(level: ServerLevel, c: Chunk): void {
  if (!level.isThundering()) return;
  const r = level.random;
  if (r.nextInt(100000) !== 0) return;
  let x = (c.x << 4) + r.nextInt(16), z = (c.z << 4) + r.nextInt(16);
  let y = level.getHeight('motion', x, z);
  const rod = lightningHooks.findRod(level, x, y, z);
  if (rod) [x, y, z] = rod;
  else {
    const box = new AABB(x - 3, y - 3, z - 3, x + 4, level.maxY + 4, z + 4);
    const targets = level.getEntities(box, (e) => !!e.living && !e.living.dead && level.canSeeSky(Math.floor(e.transform!.x), Math.floor(e.transform!.y), Math.floor(e.transform!.z)));
    if (targets.length) {
      const t = targets[r.nextInt(targets.length)]!.transform!;
      x = Math.floor(t.x); y = Math.floor(t.y); z = Math.floor(t.z);
    } else if (y === level.minY - 1) y += 2;
  }
  if (!level.isRainingAt(x, y, z)) return;
  const trap = level.getGameRule('doMobSpawning') !== false && r.nextDouble() < localDifficulty(level, x, z) * 0.01
    && blockOf(level.getBlockState(x, y - 1, z)).name !== 'lightning_rod';
  if (trap) level.createEntity('skeleton_horse', x + 0.5, y, z + 0.5, { reason: 'event', trap: true });
  spawnLightning(level, x + 0.5, y, z + 0.5, trap);
}
