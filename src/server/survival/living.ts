/**
 * Server-side living entity logic shared by players and mobs: damage pipeline (invulnerability
 * window, armor, resistance, absorption, knockback, totems), healing, status effects with
 * attribute modifiers, and equipment attributes.
 */
import type { Entity } from '../../common/entity/ecs';
import type { LivingComp } from '../../common/entity/components';
import {
  Attributes, EffectInstance, applyArmor, applyProtection, damageInfo, scaleByDifficulty, addExhaustion, eatFood, effect,
} from '../../common/entity/living';
import { EFFECTS, EffectHost } from '../../common/effect/effects';
import { ItemStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import { INV_ARMOR, INV_OFFHAND } from '../../common/entity/player';
import type { ServerLevel } from '../level';

export function makeLiving(maxHealth = 20, attrs?: Record<string, number>): LivingComp {
  const a = new Attributes(attrs ?? {});
  a.get('max_health').setBase(maxHealth);
  return {
    health: maxHealth, absorption: 0, attrs: a, effects: new Map(), hurtTime: 0, invulnerable: 0, lastHurt: 0, deathTime: 0,
    dead: false, lastAttacker: 0, lastAttackerTick: 0, undead: false, equipKey: '',
  };
}

export function maxHealth(e: Entity): number {
  return e.living ? e.living.attrs.value('max_health') : 20;
}

/** Hooks that other systems (enchantments, entities, players) provide. */
export const livingHooks = {
  /** Enchantment protection factor for a damage type (filled by the enchanting module). */
  protectionFactor: (_e: Entity, _type: string): number => 0,
  /** Called when a living entity dies (drops, messages, player death screen). */
  onDeath: (_level: ServerLevel, _e: Entity, _type: string, _attacker: Entity | null): void => {},
  /** Called after damage was applied (thorns, anger, sounds). */
  onHurt: (_level: ServerLevel, _e: Entity, _type: string, _amount: number, _attacker: Entity | null): void => {},
  /** Called when an entity heals or takes damage (health packet for players). */
  onHealthChanged: (_e: Entity): void => {},
  /** Called when effects change (sync to clients). */
  onEffectsChanged: (_level: ServerLevel, _e: Entity): void => {},
  /** Items equipped in armor slots (players use their inventory). */
  armorItems: (e: Entity): ItemStack[] => {
    const inv = e.player?.inventory;
    if (!inv) return (e['equipment'] as ItemStack[] | undefined)?.slice(2, 6) ?? [];
    return [0, 1, 2, 3].map((i) => inv.get(INV_ARMOR + i));
  },
  /** Main-hand and off-hand items. */
  handItems: (e: Entity): [ItemStack, ItemStack] => {
    const inv = e.player?.inventory;
    if (!inv) {
      const eq = e['equipment'] as ItemStack[] | undefined;
      return [eq?.[0] ?? ItemStack.empty(), eq?.[1] ?? ItemStack.empty()];
    }
    return [inv.mainHand, inv.get(INV_OFFHAND)];
  },
  /** Damage an item held/worn by the entity (players lose the item when it breaks). */
  damageItem: (_level: ServerLevel, _e: Entity, _stack: ItemStack, _amount: number): void => {},
};

/** Recompute armor / weapon attribute modifiers when equipment changed. */
export function refreshEquipment(e: Entity): void {
  const l = e.living;
  if (!l) return;
  const armor = livingHooks.armorItems(e);
  const [main] = livingHooks.handItems(e);
  const key = armor.map((s) => s.id).join(',') + '|' + main.id;
  if (key === l.equipKey) return;
  l.equipKey = key;
  const a = l.attrs;
  let def = 0, tough = 0, kb = 0;
  for (const s of armor) {
    const d = getItem(s.id)?.armor;
    if (!d || s.isEmpty()) continue;
    def += d.defense;
    tough += d.toughness;
    kb += d.knockbackResistance;
  }
  a.get('armor').add({ id: 'equipment', amount: def, op: 'add' });
  a.get('armor_toughness').add({ id: 'equipment', amount: tough, op: 'add' });
  a.get('knockback_resistance').add({ id: 'equipment', amount: kb, op: 'add' });
  const tool = getItem(main.id)?.tool;
  if (tool && !main.isEmpty()) {
    a.get('attack_damage').add({ id: 'weapon', amount: tool.attackDamage - 1, op: 'add' });
    a.get('attack_speed').add({ id: 'weapon', amount: tool.attackSpeed - 4, op: 'add' });
  } else {
    a.get('attack_damage').remove('weapon');
    a.get('attack_speed').remove('weapon');
  }
  if (e.physics) e.physics.knockbackResistance = a.value('knockback_resistance');
}

export function heal(e: Entity, amount: number): void {
  const l = e.living;
  if (!l || l.dead || amount <= 0) return;
  const before = l.health;
  l.health = Math.min(maxHealth(e), l.health + amount);
  if (l.health !== before) livingHooks.onHealthChanged(e);
}

export function hasEffect(e: Entity, id: string): boolean {
  return !!e.living?.effects.has(id);
}

export function effectAmp(e: Entity, id: string): number {
  return e.living?.effects.get(id)?.amp ?? -1;
}

/** Knock an entity away from a point (reference strength ~0.4). */
export function knockback(e: Entity, strength: number, dx: number, dz: number): void {
  const p = e.physics;
  if (!p) return;
  strength *= 1 - (e.living?.attrs.value('knockback_resistance') ?? 0);
  if (strength <= 0) return;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return;
  p.vx = p.vx / 2 - (dx / len) * strength;
  p.vz = p.vz / 2 - (dz / len) * strength;
  if (p.onGround) p.vy = Math.min(0.4, p.vy / 2 + strength);
}

/**
 * Apply damage. Returns true when the entity was actually hurt (not blocked by invulnerability
 * or immunity).
 */
export function hurt(level: ServerLevel, e: Entity, type: string, amount: number, attacker: Entity | null = null): boolean {
  const l = e.living;
  if (!l || l.dead || e.removed) return false;
  const info = damageInfo(type);
  const player = e.player;
  if (player && player.abilities.invulnerable && !info.bypassInvulnerability) return false;
  if (info.isFire && (e.physics?.fireImmune || hasEffect(e, 'fire_resistance'))) return false;
  if (type === 'freeze' && e.type === 'player') {
    const armor = livingHooks.armorItems(e);
    if (armor.some((s) => s.id.startsWith('leather_'))) return false;
  }
  if (player && info.scalesWithDifficulty) amount = scaleByDifficulty(amount, level.getDifficulty());
  if (type === 'withering' && amount === 0) return false;
  if (amount <= 0) return false;
  // Invulnerability window: only the excess over the last hit applies
  let applied = amount;
  if (l.invulnerable > 10 && !info.bypassInvulnerability) {
    if (amount <= l.lastHurt) return false;
    applied = amount - l.lastHurt;
    l.lastHurt = amount;
  } else {
    l.lastHurt = amount;
    l.invulnerable = 20;
    l.hurtTime = 10;
  }
  // Armor
  if (!info.bypassArmor) {
    const armor = l.attrs.value('armor');
    const tough = l.attrs.value('armor_toughness');
    const before = applied;
    applied = applyArmor(applied, armor, tough);
    if (before >= 1 && !info.isFire) {
      const wear = Math.max(1, Math.floor(before / 4));
      for (const s of livingHooks.armorItems(e)) if (!s.isEmpty() && getItem(s.id)?.armor) livingHooks.damageItem(level, e, s, wear);
    }
  }
  // Resistance and enchanted protection
  if (!info.bypassEffects && !info.bypassResistance) {
    const r = effectAmp(e, 'resistance');
    if (r >= 0) applied = Math.max(0, applied * (1 - 0.2 * (r + 1)));
  }
  if (!info.bypassEffects) applied = applyProtection(applied, livingHooks.protectionFactor(e, type));
  if (e.food) addExhaustion(e.food, info.exhaustion);
  // Absorption
  const absorbed = Math.min(l.absorption, applied);
  l.absorption -= absorbed;
  applied -= absorbed;
  if (attacker) {
    l.lastAttacker = attacker.id;
    l.lastAttackerTick = level.getGameTime();
    if (!info.noKnockback && e.transform && attacker.transform) {
      knockback(e, 0.4, attacker.transform.x - e.transform.x, attacker.transform.z - e.transform.z);
    }
  }
  if (applied > 0) l.health = Math.max(0, l.health - applied);
  level.broadcastEntityEvent(e, 'hurt', 0);
  livingHooks.onHealthChanged(e);
  livingHooks.onHurt(level, e, type, applied, attacker);
  if (l.health <= 0) {
    if (!info.bypassInvulnerability || type !== 'out_of_world') {
      if (tryTotem(level, e)) return true;
    }
    die(level, e, type, attacker);
  }
  return true;
}

/** Totem of undying in either hand saves from death. */
function tryTotem(level: ServerLevel, e: Entity): boolean {
  const inv = e.player?.inventory;
  const hands = livingHooks.handItems(e);
  const idx = hands[0].id === 'totem_of_undying' ? 0 : hands[1].id === 'totem_of_undying' ? 1 : -1;
  if (idx < 0) return false;
  const stack = idx === 0 ? hands[0] : hands[1];
  stack.shrink(1);
  if (inv) {
    if (stack.isEmpty()) inv.set(idx === 0 ? inv.selected : INV_OFFHAND, ItemStack.empty());
    inv.revision++;
  }
  const l = e.living!;
  l.health = 1;
  for (const id of [...l.effects.keys()]) removeEffect(level, e, id);
  addEffect(level, e, effect('regeneration', 900, 1));
  addEffect(level, e, effect('absorption', 100, 1));
  addEffect(level, e, effect('fire_resistance', 800, 0));
  level.broadcastEntityEvent(e, 'totem', 0);
  livingHooks.onHealthChanged(e);
  return true;
}

export function die(level: ServerLevel, e: Entity, type: string, attacker: Entity | null): void {
  const l = e.living!;
  if (l.dead) return;
  l.dead = true;
  l.health = 0;
  l.deathTime = 0;
  level.broadcastEntityEvent(e, 'death', 0);
  livingHooks.onDeath(level, e, type, attacker);
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export function effectHost(level: ServerLevel): EffectHost {
  return {
    heal: (e, a) => heal(e, a),
    hurt: (e, t, a) => { hurt(level, e, t, a); },
    health: (e) => e.living?.health ?? 0,
    maxHealth: (e) => maxHealth(e),
    isUndead: (e) => !!e.living?.undead,
    addExhaustion: (e, a) => { if (e.food) addExhaustion(e.food, a); },
    feed: (e, n, s) => { if (e.food) eatFood(e.food, n, s); },
    setAbsorption: (e, a) => { if (e.living) { e.living.absorption = a; livingHooks.onHealthChanged(e); } },
    absorption: (e) => e.living?.absorption ?? 0,
  };
}

function applyEffectAttributes(e: Entity, inst: EffectInstance, add: boolean): void {
  const d = EFFECTS.get(inst.id);
  if (!d?.attributes || !e.living) return;
  for (const a of d.attributes) {
    const attr = e.living.attrs.get(a.attr);
    const id = `effect:${inst.id}`;
    if (add) attr.add({ id, amount: a.amount * (inst.amp + 1), op: a.op });
    else attr.remove(id);
  }
  if (e.living.health > maxHealth(e)) e.living.health = maxHealth(e);
}

/** Add or upgrade an effect (instant effects apply immediately). */
export function addEffect(level: ServerLevel, e: Entity, inst: EffectInstance): boolean {
  const l = e.living;
  const d = EFFECTS.get(inst.id);
  if (!l || !d || l.dead) return false;
  if (l.undead && (inst.id === 'regeneration' || inst.id === 'poison')) return false;
  if (d.instant) {
    d.applyInstant?.(effectHost(level), e, inst.amp, 1);
    return true;
  }
  const cur = l.effects.get(inst.id);
  if (cur) {
    if (inst.amp < cur.amp || (inst.amp === cur.amp && inst.dur !== -1 && cur.dur !== -1 && inst.dur <= cur.dur)) return false;
    applyEffectAttributes(e, cur, false);
  }
  l.effects.set(inst.id, { ...inst });
  applyEffectAttributes(e, inst, true);
  d.onAdded?.(effectHost(level), e, inst.amp);
  livingHooks.onEffectsChanged(level, e);
  return true;
}

export function removeEffect(level: ServerLevel, e: Entity, id: string): void {
  const l = e.living;
  const cur = l?.effects.get(id);
  if (!l || !cur) return;
  l.effects.delete(id);
  applyEffectAttributes(e, cur, false);
  EFFECTS.get(id)?.onRemoved?.(effectHost(level), e, cur.amp);
  livingHooks.onEffectsChanged(level, e);
}

export function clearEffects(level: ServerLevel, e: Entity): void {
  for (const id of [...(e.living?.effects.keys() ?? [])]) removeEffect(level, e, id);
}

/** Per-tick effect processing. */
export function tickEffects(level: ServerLevel, e: Entity): void {
  const l = e.living;
  if (!l || l.effects.size === 0) return;
  const host = effectHost(level);
  for (const inst of [...l.effects.values()]) {
    const d = EFFECTS.get(inst.id);
    if (d?.tick && (!d.shouldTick || d.shouldTick(inst.dur, inst.amp))) d.tick(host, e, inst.amp);
    if (inst.dur > 0) inst.dur--;
    if (inst.dur === 0) removeEffect(level, e, inst.id);
  }
}

/** Common per-tick bookkeeping for living entities. */
export function tickLiving(level: ServerLevel, e: Entity): void {
  const l = e.living;
  if (!l) return;
  if (l.hurtTime > 0) l.hurtTime--;
  if (l.invulnerable > 0) l.invulnerable--;
  if (l.dead) {
    l.deathTime++;
    return;
  }
  refreshEquipment(e);
  tickEffects(level, e);
}
