/** PlaceContext implementation shared by server placement and client prediction. */
import type { LevelAccess, PlaceContext } from './level';
import type { Block } from '../block/registry';
import { setValue, blockOf, tryGetValue, stateFlags, F } from '../block/registry';
import { P } from '../block/properties';
import { Direction, dirFromYaw, orderedByNearest } from './direction';
import type { Entity } from '../entity/ecs';
import type { ItemStack } from '../item/stack';

export class BlockPlaceContext implements PlaceContext {
  constructor(
    readonly level: LevelAccess,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly face: Direction,
    readonly hitX: number,
    readonly hitY: number,
    readonly hitZ: number,
    readonly block: Block,
    readonly yaw: number,
    readonly pitch: number,
    readonly sneaking: boolean,
    readonly replacingClicked: boolean,
    readonly player: Entity | null,
    readonly stack: ItemStack | null,
  ) {}

  horizontalDirection(): Direction {
    return dirFromYaw(this.yaw);
  }

  nearestLookingDirections(): Direction[] {
    return orderedByNearest(this.yaw, this.pitch);
  }

  inWater(): boolean {
    const s = this.level.getBlockState(this.x, this.y, this.z);
    const b = blockOf(s);
    if (b.name === 'water') return (tryGetValue(s, P.level15) ?? 1) === 0;
    return (stateFlags[s]! & F.WATERLOGGED) !== 0 && !b.hasProp(P.slabType);
  }

  defaultStateWithWater(): number {
    const s = this.block.defaultState;
    return this.block.hasProp(P.waterlogged) ? setValue(s, P.waterlogged, this.inWater()) : s;
  }
}
