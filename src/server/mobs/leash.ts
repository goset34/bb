/**
 * Leads: players tie leashable mobs, tie them to fences with a knot, pull them along (elastic
 * pull beyond 6 blocks, snapping beyond 10) and untie them. The holder id is synchronised so
 * clients can draw the rope.
 */
import type { Entity } from '../../common/entity/ecs';
import { makeTransform } from '../../common/entity/components';
import { ItemStack } from '../../common/item/stack';
import { blockOf, blockHasTag } from '../../common/block/registry';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { ENTITY_CODECS } from '../entity/persistence';
import { Mob, mobOf } from './mob';
import { Flag } from './goals';
import { handStack, useItem } from './actions';

export function leashable(m: Mob): boolean {
  if (m.def.leashable !== undefined) return m.def.leashable;
  return !!m.def.ageable || m.def.id === 'iron_golem' || m.def.id === 'snow_golem' || m.def.id === 'allay';
}

export function setLeashHolder(m: Mob, holder: Entity | null): void {
  m.leashHolder = holder;
  m.setMeta('leashHolder', holder ? holder.id : 0);
  if (holder) m.setPersistent();
}

/** Drop the leash (optionally as an item). */
export function dropLeash(m: Mob, dropItem: boolean): void {
  if (!m.leashHolder) return;
  const knot = m.leashHolder;
  setLeashHolder(m, null);
  delete m.data['leash'];
  m.goals.setControlFlag(Flag.MOVE, true);
  m.clearRestriction();
  if (dropItem) m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('lead', 1));
  if (knot.type === 'leash_knot') cleanupKnot(m.level, knot);
}

function mobsLedBy(level: ServerLevel, holder: Entity, range: number): Mob[] {
  const t = holder.transform!;
  const box = { minX: t.x - range, minY: t.y - range, minZ: t.z - range, maxX: t.x + range, maxY: t.y + range, maxZ: t.z + range };
  const out: Mob[] = [];
  for (const e of level.entities.all()) {
    const m = mobOf(e);
    if (!m || m.leashHolder !== holder || !e.transform) continue;
    const et = e.transform;
    if (et.x < box.minX || et.x > box.maxX || et.y < box.minY || et.y > box.maxY || et.z < box.minZ || et.z > box.maxZ) continue;
    out.push(m);
  }
  return out;
}

function knotAt(level: ServerLevel, x: number, y: number, z: number): Entity | null {
  for (const e of level.entities.all()) {
    if (e.type !== 'leash_knot' || e.removed) continue;
    const p = e['knotPos'] as [number, number, number];
    if (p[0] === x && p[1] === y && p[2] === z) return e;
  }
  return null;
}

function makeKnot(x: number, y: number, z: number): Entity {
  return {
    id: 0, type: 'leash_knot', removed: false, transform: makeTransform(x + 0.5, y + 0.375, z + 0.5), knotPos: [x, y, z], meta: {},
  };
}

function cleanupKnot(level: ServerLevel, knot: Entity): void {
  if (knot.removed) return;
  if (!mobsLedBy(level, knot, 12).length) level.entities.remove(knot);
}

/** Player right-clicks a mob holding (or not) a lead. Returns true when consumed. */
export function leashInteract(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  if (m.leashHolder === p.entity) {
    dropLeash(m, p.data.gameMode !== 'creative');
    return true;
  }
  const stack = handStack(p, hand);
  if (stack.id !== 'lead' || !leashable(m) || m.leashHolder) return false;
  setLeashHolder(m, p.entity);
  useItem(p, hand, stack);
  m.level.playSound(m.x, m.y, m.z, 'item.lead.tied', 1, 1);
  return true;
}

/** Player right-clicks a fence: tie every mob they lead to a knot there. */
export function leashToFence(p: ServerPlayer, x: number, y: number, z: number): boolean {
  const level = p.level;
  const s = level.getBlockState(x, y, z);
  if (!blockHasTag(blockOf(s), 'fences')) return false;
  const led = mobsLedBy(level, p.entity, 7);
  const existing = knotAt(level, x, y, z);
  if (!led.length) {
    // Clicking a knot with nothing in hand releases what is tied there
    if (existing && handStack(p, 'main').isEmpty()) {
      for (const m of mobsLedBy(level, existing, 12)) dropLeash(m, p.data.gameMode !== 'creative');
      level.entities.remove(existing);
      return true;
    }
    return false;
  }
  let knot = existing;
  if (!knot) {
    knot = makeKnot(x, y, z);
    level.addFreshEntity(knot);
  }
  for (const m of led) setLeashHolder(m, knot);
  level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.lead.tied', 1, 1);
  return true;
}

/** Player right-clicks a knot entity: tie what they lead to it, or release what is tied there. */
export function knotInteract(p: ServerPlayer, knot: Entity): boolean {
  if (knot.type !== 'leash_knot' || knot.removed) return false;
  const level = p.level;
  const led = mobsLedBy(level, p.entity, 7);
  if (led.length) {
    for (const m of led) setLeashHolder(m, knot);
  } else {
    for (const m of mobsLedBy(level, knot, 12)) dropLeash(m, p.data.gameMode !== 'creative');
    level.entities.remove(knot);
  }
  level.playSound(knot.transform!.x, knot.transform!.y, knot.transform!.z, led.length ? 'item.lead.tied' : 'item.lead.untied', 1, 1);
  return true;
}

/** A player leaving keeps their leashed mobs: the link is stored and restored when they return. */
export function detachPlayerLeashes(p: ServerPlayer): void {
  for (const e of p.level.entities.all()) {
    const m = mobOf(e);
    if (!m || m.leashHolder !== p.entity) continue;
    m.data['leash'] = { player: p.name };
    m.leashHolder = null;
    m.setMeta('leashHolder', 0);
    m.goals.setControlFlag(Flag.MOVE, true);
    m.clearRestriction();
  }
}

/** Per-tick leash physics (reference Leashable.tickLeash). */
export function tickLeash(m: Mob): void {
  if (!m.leashHolder && m.data['leash'] && m.tickCount % 20 === 0) leashRestore(m);
  const h = m.leashHolder;
  if (!h) return;
  if (h.removed || h.living?.dead || (h.player && h.player.gameMode === 'spectator')) {
    dropLeash(m, true);
    return;
  }
  if (h.type === 'leash_knot') {
    const [kx, ky, kz] = h['knotPos'] as [number, number, number];
    if (!blockHasTag(blockOf(m.level.getBlockState(kx, ky, kz)), 'fences')) {
      m.level.entities.remove(h);
      dropLeash(m, true);
      return;
    }
  }
  const t = h.transform!;
  const dx = t.x - m.x, dy = t.y - m.y, dz = t.z - m.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  m.restrictTo(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z), 5);
  if (d > 10) {
    dropLeash(m, true);
    return;
  }
  const p = m.e.physics;
  if (d > 6) {
    const k = 1 / d;
    p.vx += Math.sign(dx) * (dx * k) * (dx * k) * 0.4;
    p.vy += Math.sign(dy) * (dy * k) * (dy * k) * 0.4;
    p.vz += Math.sign(dz) * (dz * k) * (dz * k) * 0.4;
    m.goals.setControlFlag(Flag.MOVE, false);
  } else {
    if (d > 2.5 && m.nav.isDone()) m.nav.moveTo(t.x - (dx / d) * 2, t.y, t.z - (dz / d) * 2, 1);
  }
}

/** Knots and leash links survive reloads (holders are found again by player name or knot position). */
ENTITY_CODECS.set('leash_knot', {
  save: (e) => ({ pos: e['knotPos'] }),
  load: (_level, s) => {
    const [x, y, z] = s.data['pos'] as [number, number, number];
    return makeKnot(x, y, z);
  },
});

export function leashSave(m: Mob): Record<string, unknown> | undefined {
  const h = m.leashHolder;
  if (!h) return undefined;
  if (h.player) return { player: h.player.name };
  if (h.type === 'leash_knot') return { knot: h['knotPos'] };
  return undefined;
}

/** Reconnect a saved leash once its holder exists (players join, knots load with the chunk). */
export function leashRestore(m: Mob): void {
  const s = m.data['leash'] as { player?: string; knot?: [number, number, number] } | undefined;
  if (!s || m.leashHolder) return;
  const level = m.level;
  if (s.player) {
    const p = level.players.find((pl) => pl.name === s.player);
    if (p) setLeashHolder(m, p.entity);
  } else if (s.knot) {
    const [x, y, z] = s.knot;
    let k = knotAt(level, x, y, z);
    if (!k && level.isLoaded(x, z) && blockHasTag(blockOf(level.getBlockState(x, y, z)), 'fences')) {
      k = makeKnot(x, y, z);
      level.addFreshEntity(k);
    }
    if (k) setLeashHolder(m, k);
  }
  if (m.leashHolder) delete m.data['leash'];
}
