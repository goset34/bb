/**
 * Ranged weapons and shields for players and mobs: bows (charge power, infinity, flame, punch,
 * power), crossbows (loading, multishot, piercing, quick charge), tridents (throwing, loyalty,
 * riptide), throwables (snowballs, eggs, void pearls, experience bottles, wind charges), goat
 * horns, spyglasses and shield blocking; mob bow and generic ranged attack goals.
 */
import type { Entity } from '../../common/entity/ecs';
import { AABB } from '../../common/math/geom';
import { ItemStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import { stackEffects } from '../../common/effect/potions';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import { hurt, knockback } from '../survival/living';
import { airUseHandlers, damagePlayerSlot, setCooldown } from '../survival/interaction';
import { startUsingFor, stopUsing, usingState, useHooks } from '../survival/player';
import { createProjectile, shoot, shootFromRotation, ProjectileKind } from './projectiles';
import { Goal, Flag } from '../mobs/goals';
import type { Mob } from '../mobs/mob';

// ---------------------------------------------------------------------------------------------
// Ammunition
// ---------------------------------------------------------------------------------------------

const isArrow = (s: ItemStack) => s.id === 'arrow' || s.id === 'spectral_arrow' || s.id === 'tipped_arrow';
const isCrossbowAmmo = (s: ItemStack) => isArrow(s) || s.id === 'firework_rocket';

/** Slot of the ammunition a player would use (off hand, main hand, then inventory order). */
function findAmmo(p: ServerPlayer, test: (s: ItemStack) => boolean): number {
  const inv = p.inventory;
  if (test(inv.get(40))) return 40;
  if (test(inv.mainHand)) return inv.selected;
  for (let i = 0; i < 36; i++) if (test(inv.get(i))) return i;
  return -1;
}

function creative(p: ServerPlayer): boolean {
  return p.data.gameMode === 'creative';
}

function slotOfHand(p: ServerPlayer, hand: 'main' | 'off'): number {
  return hand === 'main' ? p.inventory.selected : 40;
}

/** Arrow entity for an ammunition stack (reference ArrowItem.createArrow). */
function arrowFor(level: ServerLevel, shooter: Entity, ammo: ItemStack, x: number, y: number, z: number, pickup: number, extra: { crit?: boolean; damage?: number } = {}) {
  const kind: ProjectileKind = ammo.id === 'spectral_arrow' ? 'spectral_arrow' : 'arrow';
  const effects = ammo.id === 'tipped_arrow' ? stackEffects(ammo.data.potion, ammo.data.customEffects) : [];
  return createProjectile(level, kind, x, y, z, {
    owner: shooter, stack: ammo.copyWithCount(1), pickup, crit: extra.crit, damage: extra.damage ?? 2, effects,
  });
}

/** Reference BowItem.getPowerForTime. */
export function bowPower(ticks: number): number {
  let f = ticks / 20;
  f = (f * f + f * 2) / 3;
  return Math.min(1, f);
}

// ---------------------------------------------------------------------------------------------
// Player bows
// ---------------------------------------------------------------------------------------------

function releaseBow(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', bow: ItemStack, ticks: number): void {
  const power = bowPower(ticks);
  if (power < 0.1) return;
  const infinity = bow.getEnchant('infinity') > 0;
  const slot = findAmmo(p, isArrow);
  if (slot < 0 && !creative(p)) return;
  const ammo = slot >= 0 ? p.inventory.get(slot) : new ItemStack('arrow', 1);
  const free = creative(p) || (infinity && ammo.id === 'arrow');
  const e = p.entity, t = e.transform;
  const arrow = arrowFor(level, e, ammo, t.x, t.y + e.physics.eyeHeight - 0.1, t.z, free ? 2 : 1, { crit: power >= 1 });
  const pw = bow.getEnchant('power');
  if (pw > 0) arrow.proj.damage += pw * 0.5 + 0.5;
  arrow.proj.punch = bow.getEnchant('punch');
  if (bow.getEnchant('flame') > 0) arrow.physics!.fireTicks = 2000;
  shootFromRotation(level, arrow, e, t.pitch, t.yaw, 0, power * 3, 1);
  level.addFreshEntity(arrow);
  damagePlayerSlot(level, p, slotOfHand(p, hand), 1);
  level.playSound(t.x, t.y, t.z, 'entity.arrow.shoot', 1, 1 / (level.random.nextFloat() * 0.4 + 1.2) + power * 0.5);
  if (!free && slot >= 0) {
    ammo.shrink(1);
    if (ammo.isEmpty()) p.inventory.set(slot, ItemStack.empty());
    p.inventory.revision++;
  }
}

// ---------------------------------------------------------------------------------------------
// Crossbows
// ---------------------------------------------------------------------------------------------

export function crossbowChargeTicks(stack: ItemStack): number {
  const q = stack.getEnchant('quick_charge');
  return q === 0 ? 25 : 25 - 5 * q;
}

function loadCrossbow(level: ServerLevel, p: ServerPlayer, stack: ItemStack): boolean {
  const slot = findAmmo(p, isCrossbowAmmo);
  if (slot < 0 && !creative(p)) return false;
  const ammo = slot >= 0 ? p.inventory.get(slot) : new ItemStack('arrow', 1);
  const n = stack.getEnchant('multishot') > 0 ? 3 : 1;
  const loaded: ItemStack[] = [];
  for (let i = 0; i < n; i++) {
    const one = ammo.copyWithCount(1);
    // Multishot extras are never picked up
    if (i > 0) one.data.extra = { ...(one.data.extra ?? {}), multishotCopy: true };
    loaded.push(one);
  }
  if (!creative(p) && slot >= 0) {
    ammo.shrink(1);
    if (ammo.isEmpty()) p.inventory.set(slot, ItemStack.empty());
  }
  stack.data.charged = loaded.map((s) => s.toJSON());
  p.inventory.revision++;
  const t = p.entity.transform;
  level.playSound(t.x, t.y, t.z, 'item.crossbow.loading_end', 1, 1 / (level.random.nextFloat() * 0.5 + 1) + 0.2);
  return true;
}

function fireCrossbow(level: ServerLevel, shooter: Entity, stack: ItemStack, velocity: number, inaccuracy: number, target: Entity | null, onFired: () => void): void {
  const charged = stack.data.charged ?? [];
  if (!charged.length) return;
  const t = shooter.transform!, eye = shooter.physics?.eyeHeight ?? 1.5;
  const angles = charged.length === 1 ? [0] : [0, -10, 10];
  charged.forEach((sj, i) => {
    const ammo = ItemStack.fromJSON(sj);
    const creativeShot = !!shooter.player && shooter.player.gameMode === 'creative';
    const pickup = ammo.data.extra?.['multishotCopy'] || creativeShot ? 2 : 1;
    if (ammo.data.extra) delete ammo.data.extra['multishotCopy'];
    const arrow = arrowFor(level, shooter, ammo, t.x, t.y + eye - 0.15, t.z, pickup, { crit: true });
    arrow.proj.pierce = stack.getEnchant('piercing');
    if (target) {
      const tt = target.transform!;
      const dx = tt.x - t.x, dz = tt.z - t.z;
      const dy = tt.y + (target.physics?.height ?? 1) / 3 - arrow.transform!.y;
      const h = Math.sqrt(dx * dx + dz * dz);
      // Rotate the aim horizontally for multishot spread
      const a = (angles[i]! * Math.PI) / 180;
      const rx = dx * Math.cos(a) - dz * Math.sin(a), rz = dx * Math.sin(a) + dz * Math.cos(a);
      shoot(level, arrow, rx, dy + h * 0.2, rz, velocity, inaccuracy);
    } else {
      shootFromRotation(level, arrow, shooter, t.pitch, t.yaw + angles[i]!, 0, velocity, inaccuracy);
    }
    level.addFreshEntity(arrow);
    level.playSound(t.x, t.y, t.z, 'item.crossbow.shoot', 1, i === 0 ? 1 : 1 / (level.random.nextFloat() * 0.4 + 0.8) + (i === 1 ? 0.4 : -0.4));
  });
  delete stack.data.charged;
  onFired();
}

// ---------------------------------------------------------------------------------------------
// Tridents
// ---------------------------------------------------------------------------------------------

function releaseTrident(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, ticks: number): void {
  if (ticks < 10) return;
  const e = p.entity, t = e.transform;
  const riptide = stack.getEnchant('riptide');
  if (riptide > 0) {
    const wet = e.physics.inWater || level.isRainingAt(Math.floor(t.x), Math.floor(t.y + 1), Math.floor(t.z));
    if (!wet) return;
    damagePlayerSlot(level, p, slotOfHand(p, hand), 1);
    const D = Math.PI / 180;
    let x = -Math.sin(t.yaw * D) * Math.cos(t.pitch * D), y = -Math.sin(t.pitch * D), z = Math.cos(t.yaw * D) * Math.cos(t.pitch * D);
    const len = Math.sqrt(x * x + y * y + z * z);
    const f5 = 3 * ((1 + riptide) / 4);
    x *= f5 / len; y *= f5 / len; z *= f5 / len;
    const ph = e.physics;
    ph.vx += x; ph.vy += y; ph.vz += z;
    if (ph.onGround) ph.vy += 1.2;
    p.ext['spinAttack'] = { ticks: 20, damage: 8, hit: [] as number[] };
    p.send({ type: 'entityVelocity', id: e.id, vx: ph.vx, vy: ph.vy, vz: ph.vz });
    level.playSound(t.x, t.y, t.z, `item.trident.riptide_${Math.min(3, riptide)}`, 1, 1);
    return;
  }
  damagePlayerSlot(level, p, slotOfHand(p, hand), 1);
  const cur = hand === 'main' ? p.inventory.mainHand : p.inventory.offHand;
  if (cur.isEmpty()) return;
  const thrown = cur.copyWithCount(1);
  const tr = createProjectile(level, 'trident', t.x, t.y + e.physics.eyeHeight - 0.1, t.z, {
    owner: e, stack: thrown, pickup: creative(p) ? 2 : 1, damage: 8 + impalingBonus(stack), loyalty: stack.getEnchant('loyalty'),
  });
  shootFromRotation(level, tr, e, t.pitch, t.yaw, 0, 2.5, 1);
  level.addFreshEntity(tr);
  level.playSound(t.x, t.y, t.z, 'item.trident.throw', 1, 1);
  if (!creative(p)) {
    p.inventory.set(slotOfHand(p, hand), ItemStack.empty());
    p.inventory.revision++;
  }
}

/** Impaling adds 2.5 per level (against aquatic mobs the enchanting module refines it). */
function impalingBonus(stack: ItemStack): number {
  return stack.getEnchant('impaling') * 2.5;
}

/** Riptide spin: hurt entities touched while launched. */
export function tickSpinAttack(level: ServerLevel, p: ServerPlayer): void {
  const s = p.ext['spinAttack'] as { ticks: number; damage: number; hit: number[] } | undefined;
  if (!s) return;
  if (--s.ticks <= 0 || p.entity.physics.onGround && s.ticks < 16) {
    delete p.ext['spinAttack'];
    return;
  }
  const e = p.entity, t = e.transform;
  const box = new AABB(t.x - 0.8, t.y, t.z - 0.8, t.x + 0.8, t.y + 1.8, t.z + 0.8);
  for (const o of level.getEntities(box, (o) => !!o.living && !o.living.dead && !s.hit.includes(o.id), e)) {
    s.hit.push(o.id);
    hurt(level, o, 'player_attack', s.damage, e);
    const ph = e.physics;
    ph.vx *= -0.2; ph.vy *= -0.2; ph.vz *= -0.2;
    p.send({ type: 'entityVelocity', id: e.id, vx: ph.vx, vy: ph.vy, vz: ph.vz });
    delete p.ext['spinAttack'];
    break;
  }
}

// ---------------------------------------------------------------------------------------------
// Throwables and other held items
// ---------------------------------------------------------------------------------------------

const THROWN: Record<string, { kind: ProjectileKind; velocity: number; roll: number; sound: string; cooldown?: number }> = {
  snowball: { kind: 'snowball', velocity: 1.5, roll: 0, sound: 'entity.snowball.throw' },
  egg: { kind: 'egg', velocity: 1.5, roll: 0, sound: 'entity.egg.throw' },
  brown_egg: { kind: 'egg', velocity: 1.5, roll: 0, sound: 'entity.egg.throw' },
  blue_egg: { kind: 'egg', velocity: 1.5, roll: 0, sound: 'entity.egg.throw' },
  void_pearl: { kind: 'void_pearl', velocity: 1.5, roll: 0, sound: 'entity.void_pearl.throw', cooldown: 20 },
  experience_bottle: { kind: 'experience_bottle', velocity: 0.7, roll: -20, sound: 'entity.experience_bottle.throw' },
  wind_charge: { kind: 'wind_charge', velocity: 1.5, roll: 0, sound: 'entity.wind_charge.throw', cooldown: 10 },
};

function throwItem(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const spec = THROWN[stack.id];
  if (!spec) return false;
  const level = p.level, e = p.entity, t = e.transform;
  const proj = createProjectile(level, spec.kind, t.x, t.y + e.physics.eyeHeight - 0.1, t.z, { owner: e, stack: stack.copyWithCount(1) });
  shootFromRotation(level, proj, e, t.pitch, t.yaw, spec.roll, spec.velocity, 1);
  level.addFreshEntity(proj);
  level.playSound(t.x, t.y, t.z, spec.sound, 0.5, 0.4 / (level.random.nextFloat() * 0.4 + 0.8));
  if (spec.cooldown) setCooldown(p, stack.id, spec.cooldown);
  if (!creative(p)) {
    stack.shrink(1);
    if (stack.isEmpty()) p.inventory.set(slotOfHand(p, hand), ItemStack.empty());
    p.inventory.revision++;
  }
  p.level.server.hooks.swing(p, hand);
  return true;
}

const HORN_SOUNDS = ['ponder', 'sing', 'seek', 'feel', 'admire', 'call', 'yearn', 'dream'];

function useHeld(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const level = p.level, t = p.entity.transform;
  switch (stack.id) {
    case 'bow':
      if (findAmmo(p, isArrow) < 0 && !creative(p) && stack.getEnchant('infinity') === 0) return false;
      return startUsingFor(p, hand, stack, 72000);
    case 'crossbow':
      if (stack.data.charged?.length) {
        const cost = stack.data.charged.length > 1 ? 3 : 1;
        fireCrossbow(level, p.entity, stack, stack.data.charged.some((s) => s.id === 'firework_rocket') ? 1.6 : 3.15, 1, null, () => {
          damagePlayerSlot(level, p, slotOfHand(p, hand), cost);
          p.inventory.revision++;
        });
        return true;
      }
      if (findAmmo(p, isCrossbowAmmo) < 0 && !creative(p)) return false;
      return startUsingFor(p, hand, stack, crossbowChargeTicks(stack) + 3);
    case 'trident':
      if (stack.damage >= (getItem('trident')?.maxDamage ?? 250) - 1) return false;
      if (stack.getEnchant('riptide') > 0 && !(p.entity.physics.inWater || level.isRainingAt(Math.floor(t.x), Math.floor(t.y + 1), Math.floor(t.z)))) return false;
      return startUsingFor(p, hand, stack, 72000);
    case 'shield':
      return startUsingFor(p, hand, stack, 72000);
    case 'spyglass':
      level.playSound(t.x, t.y, t.z, 'item.spyglass.use', 1, 1);
      return startUsingFor(p, hand, stack, 1200);
    case 'goat_horn': {
      const inst = stack.data.instrument ?? 'ponder';
      level.playSound(t.x, t.y, t.z, `item.goat_horn.sound.${Math.max(0, HORN_SOUNDS.indexOf(inst))}`, 16, 1);
      level.gameEvent('instrument_play', t.x, t.y, t.z, p.entity);
      setCooldown(p, 'goat_horn', 140);
      return startUsingFor(p, hand, stack, 140);
    }
  }
  return throwItem(p, hand, stack);
}

function release(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, ticks: number): void {
  switch (stack.id) {
    case 'bow': releaseBow(level, p, hand, stack, ticks); break;
    case 'crossbow':
      if (ticks >= crossbowChargeTicks(stack) && !stack.data.charged?.length) loadCrossbow(level, p, stack);
      break;
    case 'trident': releaseTrident(level, p, hand, stack, ticks); break;
    case 'spyglass': level.playSound(p.entity.transform.x, p.entity.transform.y, p.entity.transform.z, 'item.spyglass.stop_using', 1, 1); break;
  }
}

function useTick(level: ServerLevel, p: ServerPlayer, stack: ItemStack, ticks: number): void {
  if (stack.id !== 'crossbow' || stack.data.charged?.length) return;
  const total = crossbowChargeTicks(stack);
  const t = p.entity.transform;
  if (ticks === Math.floor(total * 0.2)) level.playSound(t.x, t.y, t.z, 'item.crossbow.loading_start', 0.5, 1);
  if (ticks === Math.floor(total * 0.5)) level.playSound(t.x, t.y, t.z, 'item.crossbow.loading_middle', 0.5, 1);
}

// ---------------------------------------------------------------------------------------------
// Shields
// ---------------------------------------------------------------------------------------------

const UNBLOCKABLE = new Set([
  'fall', 'fly_into_wall', 'drown', 'in_fire', 'campfire', 'on_fire', 'lava', 'hot_floor', 'in_wall', 'cramming', 'starve', 'out_of_world',
  'outside_border', 'magic', 'indirect_magic', 'withering', 'freeze', 'stalagmite', 'dragon_breath', 'sonic_boom', 'generic_kill', 'thorns',
]);

/** Blocking starts five ticks after raising the shield. */
export function isBlocking(p: ServerPlayer): boolean {
  const u = usingState(p);
  return !!u && u.item === 'shield' && u.total - u.left >= 5;
}

/** Damage adjustment for blocking players (returns the remaining damage). */
export function shieldBlock(level: ServerLevel, p: ServerPlayer, type: string, amount: number, attacker: Entity | null): number {
  if (!isBlocking(p) || UNBLOCKABLE.has(type) || !attacker?.transform) return amount;
  const t = p.entity.transform, at = attacker.transform;
  const D = Math.PI / 180;
  const lx = -Math.sin(t.headYaw * D), lz = Math.cos(t.headYaw * D);
  let dx = t.x - at.x, dz = t.z - at.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  dx /= len; dz /= len;
  if (dx * lx + dz * lz >= 0) return amount;
  const u = usingState(p)!;
  if (amount >= 3) damagePlayerSlot(level, p, u.hand === 'main' ? p.inventory.selected : 40, 1 + Math.floor(amount));
  level.playSound(t.x, t.y, t.z, 'item.shield.block', 1, 0.8 + level.random.nextFloat() * 0.4);
  // Melee attackers are pushed back; axes disable the shield
  const weapon = attacker.player ? attacker.player.inventory.mainHand : (attacker['equipment'] as ItemStack[] | undefined)?.[0];
  const melee = type === 'mob_attack' || type === 'mob_attack_no_aggro' || type === 'player_attack';
  if (melee) {
    knockback(attacker, 0.5, t.x - at.x, t.z - at.z);
    const disabler = !!(attacker['mob'] as { def?: { disablesShield?: boolean } } | undefined)?.def?.disablesShield;
    if (disabler || (weapon && weapon.id.endsWith('_axe') && (attacker.player || level.random.nextFloat() < 0.25))) {
      stopUsing(p);
      setCooldown(p, 'shield', 100);
      level.broadcastEntityEvent(p.entity, 'shieldDisabled', 0);
      level.playSound(t.x, t.y, t.z, 'item.shield.break', 0.8, 0.8 + level.random.nextFloat() * 0.4);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Mob ranged attacks
// ---------------------------------------------------------------------------------------------

/** Skeleton-style arrow shot at a target (reference AbstractSkeleton.performRangedAttack). */
export function mobShootArrow(m: Mob, target: Entity, power: number): void {
  const level = m.level;
  const bow = m.equipment[0]!;
  const ammo = new ItemStack(m.tmp['arrowItem'] as string | undefined ?? 'arrow', 1);
  if (m.tmp['arrowPotion']) ammo.data.potion = m.tmp['arrowPotion'] as string;
  const diff = level.getDifficulty();
  const arrow = arrowFor(level, m.e, ammo, m.x, m.eyeY - 0.1, m.z, 0, { damage: power * 2 + level.random.triangle(diff * 0.11, 0.57425) });
  if (bow.getEnchant('power') > 0) arrow.proj.damage += bow.getEnchant('power') * 0.5 + 0.5;
  arrow.proj.punch = bow.getEnchant('punch');
  if (bow.getEnchant('flame') > 0 || m.e.physics.fireTicks > 0) arrow.physics!.fireTicks = 2000;
  const t = target.transform!;
  const dx = t.x - m.x, dz = t.z - m.z;
  const dy = t.y + (target.physics?.height ?? 1) / 3 - arrow.transform!.y;
  const h = Math.sqrt(dx * dx + dz * dz);
  shoot(level, arrow, dx, dy + h * 0.2, dz, 1.6, 14 - diff * 4);
  level.addFreshEntity(arrow);
  m.playSound(m.tmp['shootSound'] as string | undefined ?? 'entity.skeleton.shoot', 1, 1 / (m.random.nextFloat() * 0.4 + 0.8));
}

/** Throw a projectile at a target (snow golems, witches, llamas, gustlings). */
export function mobThrow(m: Mob, target: Entity, kind: ProjectileKind, velocity: number, inaccuracy: number, stack?: ItemStack): void {
  const level = m.level;
  const proj = createProjectile(level, kind, m.x, m.eyeY - 0.1, m.z, { owner: m.e, stack: stack ?? null });
  const t = target.transform!;
  const dx = t.x - m.x, dz = t.z - m.z;
  const dy = t.y + (target.physics?.eyeHeight ?? 1) - 1.1 - proj.transform!.y;
  const h = Math.sqrt(dx * dx + dz * dz);
  shoot(level, proj, dx, dy + h * 0.2, dz, velocity, inaccuracy);
  level.addFreshEntity(proj);
}

/** Reference RangedBowAttackGoal: keep distance, strafe, draw and release. */
export class RangedBowAttackGoal extends Goal {
  private attackTime = -1;
  private seeTime = 0;
  private strafingClockwise = false;
  private strafingBackwards = false;
  private strafingTime = -1;
  private readonly radiusSqr: number;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly interval: () => number, radius: number, private readonly holds = (m: Mob) => m.equipment[0]!.id === 'bow') {
    super();
    this.radiusSqr = radius * radius;
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return !!this.m.getTarget() && this.holds(this.m);
  }
  override canContinueToUse(): boolean {
    return (this.canUse() || !this.m.nav.isDone()) && this.holds(this.m);
  }
  override start(): void {
    this.m.aggressive = true;
    this.m.setMeta('aggressive', true);
  }
  override stop(): void {
    this.m.aggressive = false;
    this.m.setMeta('aggressive', false);
    this.seeTime = 0;
    this.attackTime = -1;
    this.m.tmp['usingTicks'] = -1;
    this.m.setMeta('using', false);
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const m = this.m;
    const target = m.getTarget();
    if (!target) return;
    const d = m.distanceToSqr(target);
    const sees = m.hasLineOfSight(target);
    if (sees !== this.seeTime > 0) this.seeTime = 0;
    if (sees) this.seeTime++;
    else this.seeTime--;
    if (d <= this.radiusSqr && this.seeTime >= 20) {
      m.nav.stop();
      this.strafingTime++;
    } else {
      m.nav.moveToEntity(target, this.speed);
      this.strafingTime = -1;
    }
    if (this.strafingTime >= 20) {
      if (m.random.nextFloat() < 0.3) this.strafingClockwise = !this.strafingClockwise;
      if (m.random.nextFloat() < 0.3) this.strafingBackwards = !this.strafingBackwards;
      this.strafingTime = 0;
    }
    if (this.strafingTime > -1) {
      if (d > this.radiusSqr * 0.75) this.strafingBackwards = false;
      else if (d < this.radiusSqr * 0.25) this.strafingBackwards = true;
      m.move.strafe(this.strafingBackwards ? -0.5 : 0.5, this.strafingClockwise ? 0.5 : -0.5);
      m.lookAtEntity(target, 30, 30);
    } else m.look.setLookAtEntity(target, 30, 30);
    const using = (m.tmp['usingTicks'] as number | undefined) ?? -1;
    if (using >= 0) {
      if (!sees && this.seeTime < -60) {
        m.tmp['usingTicks'] = -1;
        m.setMeta('using', false);
      } else if (sees) {
        m.tmp['usingTicks'] = using + 1;
        if (using + 1 >= 20) {
          m.tmp['usingTicks'] = -1;
          m.setMeta('using', false);
          mobShootArrow(m, target, bowPower(using + 1));
          this.attackTime = this.interval();
        }
      }
    } else if (--this.attackTime <= 0 && this.seeTime >= -60) {
      m.tmp['usingTicks'] = 0;
      m.setMeta('using', true);
    }
  }
}

/** Reference RangedAttackGoal: fire every interval while the target is seen. */
export class RangedAttackGoal extends Goal {
  private target: Entity | null = null;
  private attackTime = -1;
  private seeTime = 0;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly minInterval: number, private readonly maxInterval: number, private readonly radius: number, private readonly attack: (m: Mob, target: Entity, power: number) => void) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.m.getTarget();
    if (t && !t.living?.dead) {
      this.target = t;
      return true;
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return this.canUse() || (!!this.target && !this.target.living?.dead && !this.m.nav.isDone());
  }
  override stop(): void {
    this.target = null;
    this.seeTime = 0;
    this.attackTime = -1;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const m = this.m, t = this.target!;
    const d = m.distanceToSqr(t);
    const sees = m.hasLineOfSight(t);
    this.seeTime = sees ? this.seeTime + 1 : 0;
    if (d <= this.radius * this.radius && this.seeTime >= 5) m.nav.stop();
    else m.nav.moveToEntity(t, this.speed);
    m.look.setLookAtEntity(t, 30, 30);
    if (--this.attackTime === 0) {
      if (!sees) return;
      const f = Math.sqrt(d) / this.radius;
      this.attack(m, t, Math.max(0.1, Math.min(1, f)));
      this.attackTime = Math.floor(f * (this.maxInterval - this.minInterval) + this.minInterval);
    } else if (this.attackTime < 0) {
      this.attackTime = Math.floor(Math.sqrt(d) / this.radius * (this.maxInterval - this.minInterval) + this.minInterval);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------------------------

export function installRanged(): void {
  airUseHandlers.push(useHeld);
  const prevRelease = useHooks.release;
  useHooks.release = (level, p, hand, stack, ticks) => {
    prevRelease(level, p, hand, stack, ticks);
    release(level, p, hand, stack, ticks);
  };
  const prevTick = useHooks.tick;
  useHooks.tick = (level, p, stack, ticks) => {
    prevTick(level, p, stack, ticks);
    useTick(level, p, stack, ticks);
  };
}

export { fireCrossbow, loadCrossbow };
