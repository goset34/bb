/** Mining speed / harvest rules (reference formulas), shared by server and client. */
import { blockOf, hasTag } from '../block/registry';
import type { ItemStack } from './stack';
import { getItem } from './items';

export interface MiningModifiers {
  /** Efficiency enchantment level on the tool. */
  efficiency: number;
  haste: number; // amplifier+1, 0 = none
  miningFatigue: number; // amplifier+1, 0 = none
  inWater: boolean;
  aquaAffinity: boolean;
  onGround: boolean;
  /** Block break speed attribute (1 = normal). */
  breakSpeed: number;
}

export const NO_MODIFIERS: MiningModifiers = { efficiency: 0, haste: 0, miningFatigue: 0, inWater: false, aquaAffinity: false, onGround: true, breakSpeed: 1 };

/** Destroy speed multiplier of an item against a block state. */
export function toolSpeed(stack: ItemStack | null, state: number): number {
  const b = blockOf(state);
  if (!stack || stack.isEmpty()) return 1;
  const def = getItem(stack.id);
  const name = b.name;
  if (def?.id === 'shears') {
    if (name === 'cobweb' || hasTag(state, 'leaves')) return 15;
    if (hasTag(state, 'wool')) return 5;
    if (name === 'vine' || name === 'glow_lichen') return 2;
    return 1;
  }
  const tool = def?.tool;
  if (!tool) return 1;
  if (tool.type === 'sword') {
    if (name === 'cobweb') return 15;
    if (b.settings.swordFast || hasTag(state, 'leaves') || name === 'bamboo') return 1.5;
    return 1;
  }
  if (b.settings.tool === tool.type) return tool.tier.speed;
  if (tool.type === 'hoe' && hasTag(state, 'leaves')) return tool.tier.speed;
  return 1;
}

/** Can the item harvest (get drops from) the block. */
export function canHarvest(stack: ItemStack | null, state: number): boolean {
  const b = blockOf(state);
  if (!b.settings.requiresTool) return true;
  if (!stack || stack.isEmpty()) return false;
  const def = getItem(stack.id);
  if (def?.id === 'shears') return b.name === 'cobweb' || b.name === 'redstone_wire' || b.name === 'tripwire';
  const tool = def?.tool;
  if (!tool) return false;
  if (tool.type === 'sword' && b.name === 'cobweb') return true;
  if (b.settings.tool !== tool.type) return false;
  return tool.tier.level >= (b.settings.tier ?? 0);
}

/**
 * Fraction of the block destroyed per tick (1 = instant). Reference:
 * speed / hardness / (canHarvest ? 30 : 100)
 */
export function destroyProgressPerTick(stack: ItemStack | null, state: number, mods: MiningModifiers = NO_MODIFIERS): number {
  const hardness = blockOf(state).hardness;
  if (hardness < 0) return 0;
  if (hardness === 0) return 1;
  let speed = toolSpeed(stack, state);
  if (speed > 1 && mods.efficiency > 0) speed += mods.efficiency * mods.efficiency + 1;
  if (mods.haste > 0) speed *= 1 + mods.haste * 0.2;
  if (mods.miningFatigue > 0) {
    const f = [0.3, 0.09, 0.0027, 8.1e-4][Math.min(3, mods.miningFatigue - 1)]!;
    speed *= f;
  }
  speed *= mods.breakSpeed;
  if (mods.inWater && !mods.aquaAffinity) speed /= 5;
  if (!mods.onGround) speed /= 5;
  return speed / hardness / (canHarvest(stack, state) ? 30 : 100);
}

/** Ticks needed to break (Infinity for unbreakable). */
export function ticksToBreak(stack: ItemStack | null, state: number, mods: MiningModifiers = NO_MODIFIERS): number {
  const p = destroyProgressPerTick(stack, state, mods);
  if (p <= 0) return Infinity;
  if (p >= 1) return 0;
  return Math.ceil(1 / p);
}
