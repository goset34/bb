/**
 * Melee combat shared by players (and reused by mobs): attack cooldown scaling, critical hits,
 * sprint knockback, sword sweeps, weapon durability and exhaustion. Enchantment bonuses are
 * provided through `combatHooks` by the enchanting system.
 */
import type { Entity } from '../../common/entity/ecs';
import { getItem } from '../../common/item/items';
import type { ItemStack } from '../../common/item/stack';
import { addExhaustion } from '../../common/entity/living';
import { AABB } from '../../common/math/geom';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { hurt, knockback, hasEffect } from './living';
import { damagePlayerSlot } from './interaction';

export const combatHooks = {
  /** Extra damage from enchantments (sharpness, smite, bane…) against a target. */
  enchantDamage: (_weapon: ItemStack, _target: Entity): number => 0,
  /** Extra knockback levels (knockback enchantment). */
  knockbackBonus: (_weapon: ItemStack): number => 0,
  /** Fire aspect seconds. */
  fireAspect: (_weapon: ItemStack): number => 0,
  /** Sweeping edge ratio (0 without the enchantment). */
  sweepRatio: (_weapon: ItemStack): number => 0,
  /** Called after a successful hit (thorns, durability of special weapons, advancements). */
  afterHit: (_level: ServerLevel, _attacker: Entity, _target: Entity, _weapon: ItemStack, _damage: number): void => {},
  /** Right click on an entity (trading, leashing, riding, shearing…). Return true if handled. */
  interact: (_p: ServerPlayer, _target: Entity, _hand: 'main' | 'off'): boolean => false,
  /** Can this entity be attacked by players (armor stands, item frames…). */
  attackable: (e: Entity): boolean => !!e.living && !e.living.dead,
  /** Attack on a non-living entity (boats, minecarts, item frames, end crystals). */
  attackObject: (_p: ServerPlayer, _target: Entity): boolean => false,
};

/** Ticks for a full attack charge: 20 / attack_speed. */
export function attackDelay(e: Entity): number {
  const speed = e.living?.attrs.value('attack_speed') ?? 4;
  return 20 / Math.max(0.01, speed);
}

/** Attack strength 0..1 at the current tick (`ticker` counts ticks since the last swing). */
export function attackStrength(e: Entity, ticker: number, partial = 0.5): number {
  return Math.max(0, Math.min(1, (ticker + partial) / attackDelay(e)));
}

function ticker(p: ServerPlayer): number {
  return (p.ext['attackTicker'] as number | undefined) ?? 100;
}

export function resetAttackTicker(p: ServerPlayer): void {
  p.ext['attackTicker'] = 0;
}

export function tickAttack(p: ServerPlayer): void {
  const held = p.inventory.mainHand.id;
  if (p.ext['attackItem'] !== held) {
    p.ext['attackItem'] = held;
    resetAttackTicker(p);
  }
  p.ext['attackTicker'] = ticker(p) + 1;
}

/** Player attacks `target` with the main hand. */
export function playerAttack(p: ServerPlayer, target: Entity): void {
  const level = p.level;
  const e = p.entity;
  if (target === e || e.living?.dead || p.data.gameMode === 'spectator') return;
  if (!combatHooks.attackable(target)) {
    if (combatHooks.attackObject(p, target)) resetAttackTicker(p);
    return;
  }
  if (target.player && (level.getGameRule('pvp') === false || target.player.abilities.invulnerable)) return;
  const weapon = p.inventory.mainHand;
  const strength = attackStrength(e, ticker(p));
  resetAttackTicker(p);
  let damage = e.living?.attrs.value('attack_damage') ?? 1;
  let bonus = combatHooks.enchantDamage(weapon, target);
  damage *= 0.2 + strength * strength * 0.8;
  bonus *= strength;
  if (damage <= 0 && bonus <= 0) return;
  const t = e.transform, ph = e.physics;
  const full = strength > 0.9;
  let kb = combatHooks.knockbackBonus(weapon);
  let sprintHit = false;
  if (e.input.sprinting && full) {
    level.playSound(t.x, t.y, t.z, 'entity.player.attack.knockback', 1, 1);
    kb++;
    sprintHit = true;
  }
  const crit = full && ph.fallDistance > 0 && !ph.onGround && !ph.inWater && !hasEffect(e, 'blindness') && !e.input.sprinting && !e.input.flying;
  if (crit) damage *= 1.5;
  damage += bonus;
  const def = getItem(weapon.id);
  const walked = Math.abs(ph.walkDist - ph.prevWalkDist);
  const sweep = full && !crit && !sprintHit && ph.onGround && walked < attackDelay(e) * 0.01 + 0.25 && def?.tool?.type === 'sword';
  const fire = combatHooks.fireAspect(weapon);
  if (fire > 0 && target.physics && !target.physics.fireImmune) level.igniteEntity(target, 1);
  const hpBefore = target.living!.health;
  const ok = hurt(level, target, 'player_attack', damage, e);
  if (!ok) {
    level.playSound(t.x, t.y, t.z, 'entity.player.attack.nodamage', 1, 1);
    return;
  }
  if (kb > 0 && target.transform) {
    const yaw = (t.yaw * Math.PI) / 180;
    knockback(target, kb * 0.5, Math.sin(yaw), -Math.cos(yaw));
    ph.vx *= 0.6;
    ph.vz *= 0.6;
    e.input.sprinting = false;
  }
  if (sweep) {
    const tt = target.transform!;
    const box = new AABB(tt.x - 1, tt.y - 0.25, tt.z - 1, tt.x + 1, tt.y + (target.physics?.height ?? 1) + 0.25, tt.z + 1);
    const sweepDamage = 1 + combatHooks.sweepRatio(weapon) * damage;
    for (const o of level.getEntities(box, (x) => x !== e && x !== target && !!x.living && !x.living.dead)) {
      const ot = o.transform!;
      if ((ot.x - t.x) ** 2 + (ot.z - t.z) ** 2 >= 9) continue;
      if (o.player && level.getGameRule('pvp') === false) continue;
      const yaw = (t.yaw * Math.PI) / 180;
      knockback(o, 0.4, Math.sin(yaw), -Math.cos(yaw));
      hurt(level, o, 'player_attack', sweepDamage, e);
    }
    level.playSound(t.x, t.y, t.z, 'entity.player.attack.sweep', 1, 1);
    level.broadcastEntityEvent(e, 'sweep', 0);
  }
  if (crit) {
    level.playSound(t.x, t.y, t.z, 'entity.player.attack.crit', 1, 1);
    level.broadcastEntityEvent(target, 'crit', 0);
  } else if (!sweep) {
    level.playSound(t.x, t.y, t.z, full ? 'entity.player.attack.strong' : 'entity.player.attack.weak', 1, 1);
  }
  if (bonus > 0) level.broadcastEntityEvent(target, 'magic_crit', 0);
  if (fire > 0) level.igniteEntity(target, fire * 4);
  const dealt = hpBefore - (target.living?.health ?? 0);
  combatHooks.afterHit(level, e, target, weapon, dealt);
  if (def?.maxDamage && def.tool) damagePlayerSlot(level, p, p.inventory.selected, def.tool.type === 'sword' || def.tool.type === 'mace' || def.tool.type === 'trident' ? 1 : 2);
  if (e.food) addExhaustion(e.food, 0.1);
}
