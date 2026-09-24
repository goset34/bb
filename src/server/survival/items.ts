/**
 * Dropped items and experience orbs: spawning, physics, merging, burning, despawning and
 * pickup by players.
 */
import type { Entity } from '../../common/entity/ecs';
import { makePhysics, makeTransform } from '../../common/entity/components';
import { tickItemPhysics } from '../../common/entity/physics';
import { ItemStack, SerializedStack } from '../../common/item/stack';
import { ENTITY_CODECS } from '../entity/persistence';
import { getItem } from '../../common/item/items';
import { addXpPoints, orbValues } from '../../common/entity/living';
import { stateFlags, F, blockOf } from '../../common/block/registry';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';

const DESPAWN = 6000;

export function createItemEntity(level: ServerLevel, x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number, pickupDelay = 10): Entity | null {
  if (stack.isEmpty()) return null;
  const r = level.random;
  const physics = makePhysics(0.25, 0.25, 0.2125);
  physics.gravity = 0.04;
  physics.stepHeight = 0;
  physics.floats = true;
  physics.fireImmune = !!getItem(stack.id)?.fireResistant;
  physics.vx = vx ?? r.nextDouble() * 0.2 - 0.1;
  physics.vy = vy ?? 0.2;
  physics.vz = vz ?? r.nextDouble() * 0.2 - 0.1;
  const e: Entity = {
    id: 0, type: 'item', removed: false,
    transform: makeTransform(x, y, z, r.nextFloat() * 360, 0),
    physics,
    item: { stack: stack.copy(), pickupDelay, age: 0, bob: r.nextFloat() * Math.PI * 2, health: 5 },
  };
  level.addFreshEntity(e);
  return e;
}

export function createXpOrb(level: ServerLevel, x: number, y: number, z: number, value: number): Entity {
  const r = level.random;
  const physics = makePhysics(0.5, 0.5, 0.25);
  physics.gravity = 0.03;
  physics.stepHeight = 0;
  physics.floats = true;
  physics.vx = (r.nextDouble() * 0.2 - 0.1) * 2;
  physics.vy = r.nextDouble() * 0.2 * 2;
  physics.vz = (r.nextDouble() * 0.2 - 0.1) * 2;
  const e: Entity = {
    id: 0, type: 'xp_orb', removed: false,
    transform: makeTransform(x, y, z, r.nextFloat() * 360, 0),
    physics,
    xpOrb: { value, age: 0, count: 1 },
  };
  level.addFreshEntity(e);
  return e;
}

export function spawnExperience(level: ServerLevel, x: number, y: number, z: number, amount: number): void {
  for (const v of orbValues(amount)) createXpOrb(level, x, y, z, v);
}

/** Hooks for other systems (mending repairs with orb experience). */
export const itemHooks = {
  repairWithXp: (_p: ServerPlayer, amount: number): number => amount,
  onPickup: (_p: ServerPlayer, _stack: ItemStack, _count: number): void => {},
};

function removeEntity(level: ServerLevel, e: Entity): void {
  level.entities.remove(e);
}

function mergeItems(level: ServerLevel, e: Entity): void {
  const it = e.item!;
  const max = getItem(it.stack.id)?.maxStack ?? 64;
  if (it.stack.count >= max) return;
  const t = e.transform!;
  for (const o of level.entities.query('item')) {
    if (o === e || o.removed) continue;
    const ot = o.transform!;
    if (Math.abs(ot.x - t.x) > 0.5 || Math.abs(ot.y - t.y) > 0.5 || Math.abs(ot.z - t.z) > 0.5) continue;
    const oi = o.item!;
    if (!oi.stack.sameItemSameData(it.stack)) continue;
    const room = max - it.stack.count;
    if (room <= 0) return;
    const n = Math.min(room, oi.stack.count);
    it.stack.count += n;
    oi.stack.count -= n;
    it.pickupDelay = Math.max(it.pickupDelay, oi.pickupDelay);
    it.age = Math.min(it.age, oi.age);
    if (oi.stack.count <= 0) removeEntity(level, o);
    if (e.net) e.net.metaDirty = true;
  }
}

function tryPickup(level: ServerLevel, e: Entity, players: ServerPlayer[]): void {
  const it = e.item!;
  if (it.pickupDelay > 0) return;
  const t = e.transform!;
  for (const p of players) {
    const pe = p.entity;
    if (pe.living?.dead || p.data.gameMode === 'spectator' || p.disconnected) continue;
    const pt = pe.transform, ph = pe.physics;
    if (Math.abs(pt.x - t.x) > 0.3 + 1 + 0.125 || Math.abs(pt.z - t.z) > 0.3 + 1 + 0.125) continue;
    if (t.y + 0.25 < pt.y - 0.5 || t.y > pt.y + ph.height + 0.5) continue;
    const max = getItem(it.stack.id)?.maxStack ?? 64;
    const before = it.stack.count;
    p.inventory.add(it.stack, max);
    const taken = before - it.stack.count;
    if (taken <= 0) continue;
    level.tracker.broadcast(e, { type: 'takeItem', item: e.id, collector: pe.id, count: taken });
    level.playSound(t.x, t.y, t.z, 'entity.item.pickup', 0.2, ((level.random.nextFloat() - level.random.nextFloat()) * 0.7 + 1) * 2);
    itemHooks.onPickup(p, it.stack, taken);
    if (it.stack.count <= 0) {
      removeEntity(level, e);
      return;
    }
    if (e.net) e.net.metaDirty = true;
  }
}

function tickOrb(level: ServerLevel, e: Entity, players: ServerPlayer[]): void {
  const o = e.xpOrb!;
  const t = e.transform!, ph = e.physics!;
  o.age++;
  if (o.age >= DESPAWN || t.y < level.minY - 64) {
    removeEntity(level, e);
    return;
  }
  // Follow the nearest player within 8 blocks
  let target: ServerPlayer | null = null, best = 64;
  for (const p of players) {
    if (p.entity.living?.dead || p.data.gameMode === 'spectator') continue;
    const pt = p.entity.transform;
    const d = (pt.x - t.x) ** 2 + (pt.y + p.entity.physics.eyeHeight / 2 - t.y) ** 2 + (pt.z - t.z) ** 2;
    if (d < best) { best = d; target = p; }
  }
  if (target) {
    const pt = target.entity.transform;
    const dx = pt.x - t.x, dy = pt.y + target.entity.physics.eyeHeight / 2 - t.y, dz = pt.z - t.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = 1 - d / 8;
    if (f > 0) {
      const k = (f * f * 0.1) / Math.max(d, 1e-3);
      ph.vx += dx * k; ph.vy += dy * k; ph.vz += dz * k;
    }
    if (d < 1.2 && ((target.ext['xpCooldown'] as number | undefined) ?? 0) <= 0) {
      target.ext['xpCooldown'] = 2;
      let amount = o.value;
      amount = itemHooks.repairWithXp(target, amount);
      if (amount > 0 && target.entity.xp) {
        addXpPoints(target.entity.xp, amount);
        target.ext['xpDirty'] = true;
      }
      level.tracker.broadcast(e, { type: 'takeItem', item: e.id, collector: target.entity.id, count: 1 });
      level.playSound(t.x, t.y, t.z, 'entity.experience_orb.pickup', 0.1, 0.5 + level.random.nextFloat());
      if (--o.count <= 0) removeEntity(level, e);
      return;
    }
  }
  tickItemPhysics(level, e as Entity & Required<Pick<Entity, 'transform' | 'physics'>>);
}

/** Tick all items and orbs of a level. */
export function tickDrops(level: ServerLevel): void {
  const players = level.players.filter((p) => p.joined);
  for (const e of level.entities.query('item').toArray()) {
    if (e.removed) continue;
    const it = e.item!;
    it.age++;
    if (it.pickupDelay > 0 && it.pickupDelay < 32767) it.pickupDelay--;
    const t = e.transform!;
    if (it.age >= DESPAWN || t.y < level.minY - 64) {
      removeEntity(level, e);
      continue;
    }
    tickItemPhysics(level, e as Entity & Required<Pick<Entity, 'transform' | 'physics'>>);
    // Destroyed by fire, lava and cacti (unless fire resistant)
    const inside = level.getBlockState(Math.floor(t.x), Math.floor(t.y + 0.1), Math.floor(t.z));
    const n = blockOf(inside).name;
    if (!e.physics!.fireImmune && ((stateFlags[inside]! & F.LAVA) || n === 'fire' || n === 'soul_fire')) {
      level.playSound(t.x, t.y, t.z, 'entity.generic.burn', 0.4, 2 + level.random.nextFloat() * 0.4);
      removeEntity(level, e);
      continue;
    }
    if (n === 'cactus' && level.random.nextInt(5) === 0) {
      removeEntity(level, e);
      continue;
    }
    if ((it.age + e.id) % 20 === 0) mergeItems(level, e);
    if (!e.removed) tryPickup(level, e, players);
  }
  for (const e of level.entities.query('xpOrb').toArray()) if (!e.removed) tickOrb(level, e, players);
  for (const p of players) {
    const cd = (p.ext['xpCooldown'] as number | undefined) ?? 0;
    if (cd > 0) p.ext['xpCooldown'] = cd - 1;
  }
}

/** Throw an item from a player (Q / inventory drop). */
export function dropFromPlayer(level: ServerLevel, p: ServerPlayer, stack: ItemStack, randomly = false): Entity | null {
  const t = p.entity.transform;
  const y = t.y + p.entity.physics.eyeHeight - 0.3;
  const r = level.random;
  let vx: number, vy: number, vz: number;
  if (randomly) {
    const f = r.nextFloat() * 0.5, a = r.nextFloat() * Math.PI * 2;
    vx = -Math.sin(a) * f; vz = Math.cos(a) * f; vy = 0.2;
  } else {
    const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
    const f = 0.3;
    vx = -Math.sin(yaw) * Math.cos(pitch) * f;
    vz = Math.cos(yaw) * Math.cos(pitch) * f;
    vy = -Math.sin(pitch) * f + 0.1;
    const a = r.nextFloat() * Math.PI * 2, g = 0.02 * r.nextFloat();
    vx += Math.cos(a) * g; vy += (r.nextFloat() - r.nextFloat()) * 0.1; vz += Math.sin(a) * g;
  }
  const e = createItemEntity(level, t.x, y, t.z, stack, vx, vy, vz, 40);
  if (e?.item) e.item.thrower = p.entity.id;
  return e;
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

ENTITY_CODECS.set('item', {
  save: (e) => ({ item: e.item!.stack.toJSON(), age: e.item!.age, pickupDelay: e.item!.pickupDelay }),
  load: (level, s) => {
    const stack = ItemStack.fromJSON(s.data['item'] as SerializedStack);
    if (stack.isEmpty()) return null;
    const e = createItemEntity(level, s.pos[0], s.pos[1], s.pos[2], stack, 0, 0, 0, (s.data['pickupDelay'] as number) ?? 0);
    if (!e) return null;
    level.entities.remove(e);
    e.item!.age = (s.data['age'] as number) ?? 0;
    return e;
  },
});

ENTITY_CODECS.set('xp_orb', {
  save: (e) => ({ value: e.xpOrb!.value, age: e.xpOrb!.age, count: e.xpOrb!.count }),
  load: (level, s) => {
    const e = createXpOrb(level, s.pos[0], s.pos[1], s.pos[2], (s.data['value'] as number) ?? 1);
    level.entities.remove(e);
    e.xpOrb!.age = (s.data['age'] as number) ?? 0;
    e.xpOrb!.count = (s.data['count'] as number) ?? 1;
    return e;
  },
});
