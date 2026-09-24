/**
 * Target selection rules (reference TargetingConditions): who can be attacked or looked at,
 * visibility reductions (sneaking, invisibility, matching mob heads) and nearest-entity queries
 * through the level's spatial grid.
 */
import type { Entity } from '../../common/entity/ecs';
import { AABB } from '../../common/math/geom';
import { hasEffect } from '../survival/living';
import type { ItemStack } from '../../common/item/stack';
import { mobOf, type Mob } from './mob';

/** Player that can be attacked (not creative/spectator, alive). */
export function attackablePlayer(e: Entity): boolean {
  const p = e.player;
  if (!p) return true;
  return p.gameMode !== 'creative' && p.gameMode !== 'spectator' && !p.abilities.invulnerable;
}

/** Entity can be seen by mobs at all (not spectators, alive). */
export function seenByAnyone(e: Entity): boolean {
  if (e.removed || e.living?.dead) return false;
  return !(e.player && e.player.gameMode === 'spectator');
}

function headItem(e: Entity): ItemStack | undefined {
  const inv = e.player?.inventory;
  if (inv) return inv.get(39);
  return (e['equipment'] as ItemStack[] | undefined)?.[5];
}

/** Fraction of the normal detection range at which `e` is noticed by `looker`. */
export function visibilityPercent(e: Entity, looker: Mob | null): number {
  let d = 1;
  if (e.input?.sneaking) d *= 0.8;
  if (hasEffect(e, 'invisibility')) {
    const inv = e.player?.inventory;
    let worn = 0;
    if (inv) for (let i = 36; i < 40; i++) if (!inv.get(i).isEmpty()) worn++;
    d *= 0.7 * Math.max(0.1, worn / 4);
  }
  if (looker?.def.headItem) {
    const h = headItem(e);
    if (h && h.id === looker.def.headItem) d *= 0.5;
  }
  return d;
}

export interface TargetOptions {
  /** Detection range (0 = unlimited). */
  range: number;
  /** Hostile targeting (peaceful difficulty, creative players and allies are excluded). */
  combat: boolean;
  lineOfSight: boolean;
  testInvisible: boolean;
  selector?: (e: Entity) => boolean;
}

export function canTarget(m: Mob, target: Entity, o: TargetOptions): boolean {
  if (target === m.e || !seenByAnyone(target) || !target.transform) return false;
  if (o.selector && !o.selector(target)) return false;
  if (o.combat) {
    if (!attackablePlayer(target)) return false;
    if (target.player && m.level.getDifficulty() === 0) return false;
    if (m.def.id === mobOf(target)?.def.id && !m.tmp['attacksOwnKind']) return false;
    // Tamed mobs never turn on their owner
    const owner = m.data['owner'];
    if (owner && target.player?.name === owner) return false;
    if (m.def.canAttack && !m.def.canAttack(m, target)) return false;
  }
  if (o.range > 0) {
    const v = o.testInvisible ? visibilityPercent(target, m) : 1;
    const r = Math.max(o.range * v, 2);
    if (m.distanceToSqr(target) > r * r) return false;
  }
  if (o.lineOfSight && !m.hasLineOfSight(target)) return false;
  return true;
}

/** Nearest player satisfying the options (range measured from the mob's eyes). */
export function nearestPlayer(m: Mob, o: TargetOptions): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const p of m.level.players) {
    const e = p.entity;
    if (!canTarget(m, e, o)) continue;
    const d = m.distanceToSqr(e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Nearest entity in a box around the mob matching a filter and the options. */
export function nearestEntity(m: Mob, h: number, v: number, filter: (e: Entity) => boolean, o: TargetOptions): Entity | null {
  const box = m.box().inflate(h, v, h);
  let best: Entity | null = null;
  let bd = Infinity;
  for (const e of m.level.getEntities(box, filter, m.e)) {
    if (!canTarget(m, e, o)) continue;
    const d = m.distanceToSqr(e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Entities of the same mob type around a mob. */
export function sameKindAround(m: Mob, h: number, v: number): Mob[] {
  const out: Mob[] = [];
  const box = m.box().inflate(h, v, h);
  for (const e of m.level.getEntities(box, (e) => mobOf(e)?.def === m.def, m.e)) {
    const o = mobOf(e);
    if (o && o.alive) out.push(o);
  }
  return out;
}

/** Hitbox of any entity. */
export function hitbox(e: Entity): AABB {
  const t = e.transform!, p = e.physics;
  const hw = (p?.width ?? 0.5) / 2;
  return new AABB(t.x - hw, t.y, t.z - hw, t.x + hw, t.y + (p?.height ?? 0.5), t.z + hw);
}

/** Reference default melee reach: the attacker box inflated horizontally by √2.04 − 0.6. */
export const ATTACK_REACH = Math.sqrt(2.04) - 0.6;

export function withinMeleeRange(m: Mob, target: Entity, extra = 0): boolean {
  const r = ATTACK_REACH + extra;
  return m.box().inflate(r, 0, r).intersects(hitbox(target));
}
