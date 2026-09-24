/**
 * Helpers shared by mob definitions: standard goal sets, item predicates and equipment.
 */
import { ItemStack } from '../../../common/item/stack';
import { getItem } from '../../../common/item/items';
import type { Mob } from '../mob';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, FollowParentGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal,
} from '../goallib';

export const items = (...ids: string[]) => (s: ItemStack): boolean => ids.includes(s.id);
export const itemTag = (tag: string) => (s: ItemStack): boolean => !!getItem(s.id)?.tags.includes(tag);

export interface AnimalGoals {
  panic: number;
  breed?: number;
  tempt?: number;
  temptItems?: (s: ItemStack) => boolean;
  follow?: number;
  stroll?: number;
  look?: number;
}

/** Reference goal list of a basic farm animal. */
export function animalGoals(m: Mob, g: AnimalGoals): void {
  let p = 0;
  m.goals.add(p++, new FloatGoal(m));
  m.goals.add(p++, new PanicGoal(m, g.panic));
  if (g.breed !== undefined) m.goals.add(p++, new BreedGoal(m, g.breed));
  const tempt = g.temptItems ?? m.def.food;
  if (g.tempt !== undefined && tempt) m.goals.add(p++, new TemptGoal(m, g.tempt, tempt, false));
  if (g.follow !== undefined) m.goals.add(p++, new FollowParentGoal(m, g.follow));
  m.goals.add(p++, new RandomStrollGoal(m, g.stroll ?? 1, 120, true, true));
  m.goals.add(p++, new LookAtPlayerGoal(m, g.look ?? 6));
  m.goals.add(p++, new RandomLookAroundGoal(m));
}

/** Put an item in an equipment slot (0 main, 1 off, 2 feet, 3 legs, 4 chest, 5 head). */
export function equip(m: Mob, slot: number, id: string): void {
  m.equipment[slot] = new ItemStack(id, 1);
}

/** Reference random armor for monsters by local difficulty. */
export function populateArmor(m: Mob, difficulty: number): void {
  const r = m.random;
  const clamped = Math.max(0, Math.min(1, (difficulty - 2) / 2));
  if (r.nextFloat() >= 0.15 * clamped) return;
  let tier = r.nextInt(2);
  const f = m.level.getDifficulty() === 3 ? 0.1 : 0.25;
  if (r.nextFloat() < 0.095) tier++;
  if (r.nextFloat() < 0.095) tier++;
  if (r.nextFloat() < 0.095) tier++;
  const mats = ['leather', 'golden', 'chainmail', 'iron', 'diamond'];
  const mat = mats[Math.min(tier, 4)]!;
  const pieces: Array<[number, string]> = [[5, 'helmet'], [4, 'chestplate'], [3, 'leggings'], [2, 'boots']];
  let first = true;
  for (const [slot, piece] of pieces) {
    if (!first && r.nextFloat() < f) break;
    first = false;
    if (m.equipment[slot]!.isEmpty()) {
      const id = `${mat}_${piece}`;
      if (getItem(id)) equip(m, slot, id);
    }
  }
}

/** Sound names follow `entity.<mob>.<event>`. */
export function sounds(id: string, ambient = true): { ambient?: string; hurtSound: string; deathSound: string; stepSound: string } {
  return {
    ...(ambient ? { ambient: `entity.${id}.ambient` } : {}),
    hurtSound: `entity.${id}.hurt`,
    deathSound: `entity.${id}.death`,
    stepSound: `entity.${id}.step`,
  };
}
