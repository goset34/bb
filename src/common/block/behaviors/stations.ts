/** Blocks whose use opens a menu (crafting table and, in later milestones, other stations). */
import { BlockBehavior, InteractionResult } from '../behavior';
import type { LevelAccess, UseContext } from '../../world/level';
import { registerBehaviorResolver } from './index';

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
  crafting_table: 'crafting',
};

export function registerStationBehaviors(): void {
  registerBehaviorResolver((b) => {
    const kind = MENU_BLOCKS[b.name];
    return kind ? new MenuBlockBehavior(kind) : null;
  });
}
