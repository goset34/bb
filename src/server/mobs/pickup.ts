/**
 * Mobs picking up items (reference Mob.aiStep pickup + equipItemIfPossible): monsters that may
 * pick up loot equip better weapons and armour; special pickers (foxes, allays…) use their own
 * rules through MobDef.wantsToPickUp / MobDef.pickUp.
 */
import type { Entity } from '../../common/entity/ecs';
import { ItemStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import type { Mob } from './mob';

const ARMOR_SLOT: Record<string, number> = { feet: 2, legs: 3, chest: 4, head: 5 };

/** Equipment slot an item goes into: armour slots, otherwise the main hand. */
export function slotForItem(s: ItemStack): number {
  const a = getItem(s.id)?.armor;
  if (a && a.slot in ARMOR_SLOT) return ARMOR_SLOT[a.slot]!;
  if (s.id === 'carved_pumpkin' || s.id.endsWith('_head') || s.id.endsWith('_skull')) return 5;
  if (s.id === 'shield') return 1;
  return 0;
}

function damageOf(s: ItemStack): number {
  return getItem(s.id)?.tool?.attackDamage ?? 0;
}

function durabilityLeft(s: ItemStack): number {
  const max = getItem(s.id)?.maxDamage ?? 0;
  return max - s.damage;
}

/** Same kind of item: the one with more durability or enchantments wins (reference canReplaceEqualItem). */
function betterEqual(n: ItemStack, c: ItemStack): boolean {
  if (durabilityLeft(n) !== durabilityLeft(c)) return durabilityLeft(n) > durabilityLeft(c);
  return Number(n.hasEnchants()) > Number(c.hasEnchants());
}

const isSword = (s: ItemStack) => getItem(s.id)?.tool?.type === 'sword';
const isDigger = (s: ItemStack) => ['axe', 'pickaxe', 'shovel', 'hoe'].includes(getItem(s.id)?.tool?.type ?? '');

/** Reference Mob.canReplaceCurrentItem. */
export function canReplaceCurrentItem(n: ItemStack, c: ItemStack): boolean {
  if (c.isEmpty()) return true;
  if (isSword(n)) {
    if (!isSword(c)) return true;
    return damageOf(n) !== damageOf(c) ? damageOf(n) > damageOf(c) : betterEqual(n, c);
  }
  if ((n.id === 'bow' && c.id === 'bow') || (n.id === 'crossbow' && c.id === 'crossbow')) return betterEqual(n, c);
  const na = getItem(n.id)?.armor;
  if (na) {
    if (c.getEnchant('binding_curse') > 0) return false;
    const ca = getItem(c.id)?.armor;
    if (!ca) return true;
    if (na.defense !== ca.defense) return na.defense > ca.defense;
    if (na.toughness !== ca.toughness) return na.toughness > ca.toughness;
    return betterEqual(n, c);
  }
  if (isDigger(n)) {
    if (getItem(c.id)?.block) return true;
    if (isDigger(c)) return damageOf(n) !== damageOf(c) ? damageOf(n) > damageOf(c) : betterEqual(n, c);
  }
  return false;
}

/** Try to equip a stack; returns the part taken (empty when refused). */
export function equipItemIfPossible(m: Mob, stack: ItemStack): ItemStack {
  let slot = slotForItem(stack);
  let current = m.equipment[slot]!;
  let ok = canReplaceCurrentItem(stack, current);
  if (slot >= 2 && !ok) {
    slot = 0;
    current = m.equipment[0]!;
    ok = current.isEmpty();
  }
  if (!ok || (m.def.canHoldItem && !m.def.canHoldItem(m, stack))) return ItemStack.empty();
  const chance = m.dropChances[slot] ?? 0.085;
  if (!current.isEmpty() && Math.max(m.random.nextFloat() - 0.1, 0) < chance) m.level.spawnItem(m.x, m.y + 0.5, m.z, current);
  const taken = slot >= 2 ? stack.copyWithCount(1) : stack.copy();
  m.equipment[slot] = taken;
  m.guaranteedDrops[slot] = true;
  m.setPersistent();
  return taken;
}

function wantsToPickUp(m: Mob, s: ItemStack): boolean {
  if (m.def.wantsToPickUp) return m.def.wantsToPickUp(m, s);
  const slot = slotForItem(s);
  return canReplaceCurrentItem(s, m.equipment[slot]!) || (slot >= 2 && m.equipment[0]!.isEmpty());
}

/** Per-tick loot pickup for mobs that may pick up items. */
export function tickPickup(m: Mob): void {
  if (!m.canPickUpLoot) return;
  if (m.level.getGameRule('mobGriefing') === false) return;
  const box = m.box().inflate(1, 0, 1);
  for (const e of m.level.getEntities(box, (e) => !!e.item)) {
    const it = e.item!;
    if (e.removed || it.stack.isEmpty() || it.pickupDelay > 0) continue;
    if (!wantsToPickUp(m, it.stack)) continue;
    pickUp(m, e);
    if (m.e.removed) return;
  }
}

function pickUp(m: Mob, e: Entity): void {
  const it = e.item!;
  const before = it.stack.count;
  if (m.def.pickUp) m.def.pickUp(m, e);
  else {
    const taken = equipItemIfPossible(m, it.stack);
    if (!taken.isEmpty()) it.stack.shrink(taken.count);
  }
  const n = before - it.stack.count;
  if (n <= 0) return;
  m.level.tracker.broadcast(e, { type: 'takeItem', item: e.id, collector: m.e.id, count: n });
  if (it.stack.isEmpty()) m.level.entities.remove(e);
  else if (e.net) e.net.metaDirty = true;
}
