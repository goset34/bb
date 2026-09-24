/**
 * Mob actions shared by goals and definitions: melee attacks, love/breeding, growing up,
 * feeding, item use by players on mobs and equipment helpers.
 */
import type { Entity } from '../../common/entity/ecs';
import { ItemStack } from '../../common/item/stack';
import { knockback } from '../survival/living';
import { combatHooks } from '../survival/combat';
import { exchange } from '../survival/interaction';
import type { ServerPlayer } from '../player';
import { Mob, mobOf } from './mob';
import { spawnMob, updateSize } from './factory';

/** Reference Mob.doHurtTarget: attack damage + weapon bonuses, knockback, fire aspect. */
export function doHurtTarget(m: Mob, target: Entity): boolean {
  if (m.def.doHurtTarget) return m.def.doHurtTarget(m, target);
  return defaultHurtTarget(m, target);
}

export function defaultHurtTarget(m: Mob, target: Entity, damage = m.attr('attack_damage')): boolean {
  const weapon = m.equipment[0]!;
  let dmg = damage;
  if (!weapon.isEmpty()) dmg += combatHooks.enchantDamage(weapon, target);
  const kb = m.attr('attack_knockback') + (weapon.isEmpty() ? 0 : combatHooks.knockbackBonus(weapon));
  const ok = m.level.hurtEntity(target, 'mob_attack', dmg, m.e);
  if (!ok) return false;
  const yaw = (m.e.transform.yaw * Math.PI) / 180;
  if (kb > 0) {
    knockback(target, kb * 0.5, Math.sin(yaw), -Math.cos(yaw));
    m.e.physics.vx *= 0.6;
    m.e.physics.vz *= 0.6;
  }
  const fire = weapon.isEmpty() ? 0 : combatHooks.fireAspect(weapon);
  if (fire > 0) m.level.igniteEntity(target, fire * 4);
  if (!weapon.isEmpty()) combatHooks.afterHit(m.level, m.e, target, weapon, dmg);
  m.lastHurtMob = target;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Ageing and breeding
// ---------------------------------------------------------------------------------------------

export function getAge(m: Mob): number {
  return (m.data['age'] as number | undefined) ?? 0;
}

export function setAge(m: Mob, age: number): void {
  const wasBaby = m.isBaby;
  m.data['age'] = age;
  if (wasBaby !== m.isBaby) updateSize(m);
}

/** Speed up growth by `seconds` (feeding babies). */
export function ageUp(m: Mob, seconds: number, particles = false): void {
  const age = getAge(m);
  let next = age + seconds * 20;
  if (next > 0) next = 0;
  setAge(m, next);
  if (particles) m.broadcastEvent('villagerHappy');
}

export function isInLove(m: Mob): boolean {
  return (m.tmp['inLove'] as number | undefined ?? 0) > 0;
}

export function canFallInLove(m: Mob): boolean {
  return !isInLove(m);
}

export function setInLove(m: Mob, player: Entity | null): void {
  m.tmp['inLove'] = 600;
  m.tmp['loveCause'] = player?.id ?? 0;
  m.broadcastEvent('love');
}

export function resetLove(m: Mob): void {
  m.tmp['inLove'] = 0;
}

/** Per-tick ageing and love countdown (reference AgeableMob/Animal aiStep). */
export function tickAgeing(m: Mob): void {
  if (!m.def.ageable) return;
  const age = getAge(m);
  if (age < 0) setAge(m, age + 1);
  else if (age > 0) setAge(m, age - 1);
  if (getAge(m) !== 0) m.tmp['inLove'] = 0;
  const love = (m.tmp['inLove'] as number | undefined) ?? 0;
  if (love > 0) {
    m.tmp['inLove'] = love - 1;
    if (love % 10 === 0) m.broadcastEvent('love');
  }
}

export function canMate(m: Mob, other: Mob): boolean {
  if (m.def.canMate) return m.def.canMate(m, other);
  return other !== m && other.def === m.def && isInLove(m) && isInLove(other);
}

/** Two animals produce a baby (reference spawnChildFromBreeding). */
export function breed(m: Mob, partner: Mob): Mob | null {
  const off = m.def.offspring ? m.def.offspring(m, partner) : { type: m.def.id };
  setAge(m, 6000);
  setAge(partner, 6000);
  resetLove(m);
  resetLove(partner);
  if (!off) return null;
  const child = spawnMob(m.level, off.type, m.x, m.y, m.z, 'breeding', { baby: true, parent: m, partner });
  if (!child) return null;
  if (child.def.ageable) setAge(child, -24000);
  if (off.data) Object.assign(child.data, off.data);
  child.e.transform.yaw = child.e.transform.bodyYaw = 0;
  m.broadcastEvent('love');
  if (m.level.getGameRule('doMobLoot') !== false) m.level.spawnExperience(m.x, m.y, m.z, m.random.nextInt(7) + 1);
  const cause = m.level.entities.get(m.tmp['loveCause'] as number ?? 0);
  if (cause?.player) m.level.server.hooks.gameEvent(m.level, 'bred_animals', m.x, m.y, m.z, cause, 0);
  return child;
}

// ---------------------------------------------------------------------------------------------
// Player interactions
// ---------------------------------------------------------------------------------------------

export function handStack(p: ServerPlayer, hand: 'main' | 'off'): ItemStack {
  return hand === 'main' ? p.inventory.mainHand : p.inventory.get(40);
}

/** Consume one item unless the player is in creative mode. */
export function useItem(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): void {
  if (p.data.gameMode === 'creative') return;
  stack.shrink(1);
  if (stack.isEmpty()) {
    if (hand === 'main') p.inventory.set(p.inventory.selected, ItemStack.empty());
    else p.inventory.set(40, ItemStack.empty());
  }
  p.inventory.revision++;
}

/** Replace the held item with a result (bucket of milk, bowl of stew…). */
export function exchangeItem(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, result: ItemStack): void {
  exchange(p, hand, stack, result);
}

/** Feeding an animal: breed when adult, grow when baby (reference Animal.mobInteract). */
export function feedAnimal(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const stack = handStack(p, hand);
  if (!m.def.food || stack.isEmpty() || !m.def.food(stack)) return false;
  const age = getAge(m);
  if (age === 0 && canFallInLove(m)) {
    useItem(p, hand, stack);
    setInLove(m, p.entity);
    m.playSound(m.tmp['eatSound'] as string | undefined ?? 'entity.generic.eat');
    return true;
  }
  if (m.isBaby) {
    useItem(p, hand, stack);
    ageUp(m, Math.floor((-age / 20) * 0.1), true);
    m.playSound(m.tmp['eatSound'] as string | undefined ?? 'entity.generic.eat');
    return true;
  }
  return false;
}

/** Name tag, leads and buckets handled generically; returns true when consumed. */
export function genericInteract(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const stack = handStack(p, hand);
  if (stack.id === 'name_tag' && stack.data.name) {
    m.e['customName'] = typeof stack.data.name === 'string' ? stack.data.name : JSON.stringify(stack.data.name);
    m.setMeta('customName', m.e['customName'] as string);
    m.setPersistent();
    useItem(p, hand, stack);
    return true;
  }
  return false;
}

/** Other mobs of the same kind nearby (alerting, herding). */
export function nearbySameKind(m: Mob, range: number): Mob[] {
  const out: Mob[] = [];
  for (const e of m.level.getEntities(m.box().inflate(range, range / 2, range), (e) => mobOf(e)?.def === m.def, m.e)) out.push(mobOf(e)!);
  return out;
}
