/** Blocks whose use opens a menu (crafting table and, in later milestones, other stations). */
import { BlockBehavior, InteractionResult } from '../behavior';
import type { LevelAccess, UseContext } from '../../world/level';
import { registerBehaviorResolver } from './index';
import { BLOCKS, Block, blockHasTag } from '../registry';

export class MenuBlockBehavior extends BlockBehavior {
  constructor(readonly kind: string) {
    super();
  }

  override use(_state: number, level: LevelAccess, x: number, y: number, z: number, ctx: UseContext): InteractionResult {
    if (!level.isClient) level.openMenu(ctx.player, this.kind, x, y, z);
    return 'success';
  }
}

/** Menu kinds by block name; later milestones add their stations here before behaviours attach. */
export const MENU_BLOCKS: Record<string, string> = {
  crafting_table: 'crafting', chest: 'chest', trapped_chest: 'chest', barrel: 'barrel', void_chest: 'void_chest',
  furnace: 'furnace', blast_furnace: 'blast_furnace', smoker: 'smoker',
};

/** Menu kind for a block (name table, then tags). */
export function menuKindOf(b: Block): string | undefined {
  const k = MENU_BLOCKS[b.name];
  if (k) return k;
  if (blockHasTag(b, 'copper_chests')) return 'chest';
  if (blockHasTag(b, 'shell_boxes')) return 'shell_box';
  return undefined;
}

export function registerStationBehaviors(): void {
  // Blocks without a placement behaviour get the menu behaviour directly
  registerBehaviorResolver((b) => (b.name === 'crafting_table' ? new MenuBlockBehavior('crafting') : null));
}

/**
 * After behaviours are attached: give container blocks (which keep their placement behaviour,
 * e.g. double chests, facing barrels) a `use` that opens their menu.
 */
export function wrapStationBehaviors(): void {
  for (const b of BLOCKS) {
    const kind = menuKindOf(b);
    if (!kind || b.behavior instanceof MenuBlockBehavior) continue;
    const inner = b.behavior;
    const wrapped = Object.create(inner) as BlockBehavior;
    wrapped.use = function (_state, level, x, y, z, ctx) {
      if (!level.isClient) level.openMenu(ctx.player, kind, x, y, z);
      return 'success';
    };
    b.behavior = wrapped;
  }
}
