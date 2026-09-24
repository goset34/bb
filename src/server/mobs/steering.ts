/**
 * Item-based steering (reference ItemBasedSteering): saddled pigs and striders follow where their
 * rider looks while the rider holds the steering item; using the item gives a speed boost that
 * swells and fades over 7–49 seconds.
 */
import type { Entity } from '../../common/entity/ecs';
import type { ServerPlayer } from '../player';
import { damagePlayerSlot } from '../survival/interaction';
import { ItemStack } from '../../common/item/stack';
import { vehicleOf, controllingPassenger } from '../entity/riding';
import type { Mob, RiderInput } from './mob';
import { mobOf } from './mob';

/** Rider holds the steering item in either hand. */
export function holdsSteeringItem(rider: Entity, item: string): boolean {
  const inv = rider.player?.inventory;
  return !!inv && (inv.mainHand.id === item || inv.get(40).id === item);
}

export function startBoost(m: Mob): boolean {
  if (m.tmp['boosting']) return false;
  m.tmp['boosting'] = true;
  m.tmp['boostTime'] = 0;
  m.tmp['boostTotal'] = m.random.nextInt(841) + 140;
  m.setMeta('boostTotal', m.tmp['boostTotal'] as number);
  m.broadcastEvent('boost');
  return true;
}

export function boostFactor(m: Mob): number {
  if (!m.tmp['boosting']) return 1;
  const t = (m.tmp['boostTime'] as number) / (m.tmp['boostTotal'] as number);
  return 1 + 1.15 * Math.sin(t * Math.PI);
}

function tickBoost(m: Mob): void {
  if (!m.tmp['boosting']) return;
  const t = (m.tmp['boostTime'] as number) + 1;
  m.tmp['boostTime'] = t;
  if (t > (m.tmp['boostTotal'] as number)) m.tmp['boosting'] = false;
}

/** Steered movement: face the rider's look direction and walk forward at `factor` × speed × boost. */
export function rideSteered(m: Mob, input: RiderInput, factor: number): void {
  const t = m.e.transform, inp = m.e.input;
  t.yaw = t.bodyYaw = t.headYaw = input.yaw;
  t.pitch = input.pitch * 0.5;
  inp.speed = m.speed * factor * boostFactor(m);
  inp.speedModifier = 1;
  inp.forward = 1;
  inp.strafe = 0;
  inp.jumping = false;
  tickBoost(m);
}

/** Using the steering item while riding: boost and wear the item (7 durability; broken → fishing rod). */
export function useSteeringItem(p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const v = vehicleOf(p.entity);
  const vm = mobOf(v);
  const slot = hand === 'main' ? p.inventory.selected : 40;
  const stack = p.inventory.get(slot);
  if (!v || !vm || !vm.def.steeringItem || stack.id !== vm.def.steeringItem || controllingPassenger(v) !== p.entity) return false;
  if (!startBoost(vm)) return false;
  damagePlayerSlot(p.level, p, slot, 7);
  if (p.inventory.get(slot).isEmpty() && p.data.gameMode !== 'creative') {
    const rod = new ItemStack('fishing_rod', 1);
    if (stack.data.enchants) rod.data.enchants = { ...stack.data.enchants };
    p.inventory.set(slot, rod);
  }
  return true;
}
