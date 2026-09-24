/**
 * Eggs that hatch into mobs: turtle eggs (crack at night on sand, trampled by walkers),
 * sniffer eggs (hatch over two in-game days, twice as fast on moss) and frogspawn (hatches into
 * tadpoles on still water).
 */
import { BlockBehavior } from '../behavior';
import { P } from '../properties';
import { getValue, setValue, blockOf, blockHasTag, stateFlags, F, isBlock } from '../registry';
import type { LevelAccess } from '../../world/level';
import type { Entity } from '../../entity/ecs';
import type { Random } from '../../math/random';
import { StackingBehavior } from './placement';
import { registerBehaviorResolver } from './index';

const onSand = (level: LevelAccess, x: number, y: number, z: number): boolean => blockHasTag(blockOf(level.getBlockState(x, y - 1, z)), 'sand');

export class TurtleEggBehavior extends StackingBehavior {
  constructor() {
    super(P.eggs, false);
  }
  override onPlace(_s: number, level: LevelAccess, x: number, y: number, z: number): void {
    if (onSand(level, x, y, z)) level.levelEvent(2012, x, y, z, 0);
  }
  /** Eggs crack faster just before dawn (reference shouldUpdateHatchLevel). */
  private shouldHatch(level: LevelAccess, rng: Random): boolean {
    const t = level.getDayTime() % 24000;
    if (t > 21600 && t < 22560) return true;
    return rng.nextInt(500) === 0;
  }
  override randomTick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (!this.shouldHatch(level, rng) || !onSand(level, x, y, z)) return;
    const hatch = getValue(state, P.hatch);
    if (hatch < 2) {
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.turtle_egg.crack', 0.7, 0.9 + rng.nextFloat() * 0.2);
      level.setBlock(x, y, z, setValue(state, P.hatch, hatch + 1), 2);
      return;
    }
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.turtle_egg.hatch', 0.7, 0.9 + rng.nextFloat() * 0.2);
    level.removeBlock(x, y, z);
    for (let i = 0; i < getValue(state, P.eggs); i++) {
      level.levelEvent(2001, x, y, z, state);
      level.createEntity('turtle', x + 0.3 + i * 0.2, y, z + 0.3, { reason: 'breeding', baby: true, home: [x, y, z] });
    }
  }
  private canTrample(level: LevelAccess, e: Entity): boolean {
    if (e.type === 'turtle' || e.type === 'bat' || !e.living) return false;
    return !!e.player || level.getGameRule('mobGriefing') !== false;
  }
  private destroyEgg(state: number, level: LevelAccess, x: number, y: number, z: number, e: Entity, chance: number): void {
    if (!this.canTrample(level, e) || level.random.nextInt(chance) !== 0) return;
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.turtle_egg.break', 0.7, 0.9 + level.random.nextFloat() * 0.2);
    const eggs = getValue(state, P.eggs);
    if (eggs <= 1) level.destroyBlock(x, y, z, false);
    else {
      level.setBlock(x, y, z, setValue(state, P.eggs, eggs - 1), 2);
      level.levelEvent(2001, x, y, z, state);
    }
  }
  override stepOn(state: number, level: LevelAccess, x: number, y: number, z: number, e: Entity): void {
    if (e.input?.sneaking) return;
    this.destroyEgg(state, level, x, y, z, e, 100);
  }
  override fallOn(state: number, level: LevelAccess, x: number, y: number, z: number, e: Entity, fallDistance: number): number {
    if (e.type !== 'zombie' && e.type !== 'husk' && e.type !== 'drowned') this.destroyEgg(state, level, x, y, z, e, 3);
    return fallDistance;
  }
}

export class SnifferEggBehavior extends BlockBehavior {
  private boosted(level: LevelAccess, x: number, y: number, z: number): boolean {
    return blockOf(level.getBlockState(x, y - 1, z)).name === 'moss_block';
  }
  private schedule(level: LevelAccess, x: number, y: number, z: number, block: ReturnType<typeof blockOf>): void {
    const total = this.boosted(level, x, y, z) ? 12000 : 24000;
    level.scheduleTick(x, y, z, block, total / 3 + level.random.nextInt(300));
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number, old: number): void {
    if (isBlock(old, blockOf(state))) return;
    if (this.boosted(level, x, y, z)) level.levelEvent(3009, x, y, z, 0);
    this.schedule(level, x, y, z, blockOf(state));
  }
  override tick(state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    const hatch = getValue(state, P.eggsSniffer);
    if (hatch < 2) {
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.sniffer_egg.crack', 0.7, 0.9 + rng.nextFloat() * 0.2);
      level.setBlock(x, y, z, setValue(state, P.eggsSniffer, hatch + 1), 2);
      this.schedule(level, x, y, z, blockOf(state));
      return;
    }
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.sniffer_egg.hatch', 0.7, 0.9 + rng.nextFloat() * 0.2);
    level.destroyBlock(x, y, z, false);
    level.createEntity('sniffer', x + 0.5, y, z + 0.5, { reason: 'breeding', baby: true });
  }
}

export class FrogspawnBehavior extends BlockBehavior {
  override canSurvive(_s: number, level: LevelAccess, x: number, y: number, z: number): boolean {
    const below = level.getBlockState(x, y - 1, z);
    const here = level.getBlockState(x, y, z);
    return !!(stateFlags[below]! & F.WATER) && !(stateFlags[here]! & F.WATER);
  }
  override getStateForPlacement(ctx: Parameters<BlockBehavior['getStateForPlacement']>[0]): number | null {
    return this.canSurvive(0, ctx.level, ctx.x, ctx.y, ctx.z) ? ctx.block.defaultState : null;
  }
  override onPlace(state: number, level: LevelAccess, x: number, y: number, z: number): void {
    level.scheduleTick(x, y, z, blockOf(state), 3600 + level.random.nextInt(8400));
  }
  override updateShape(state: number, _d: number, _n: number, level: LevelAccess, x: number, y: number, z: number): number {
    return this.canSurvive(state, level, x, y, z) ? state : 0;
  }
  override entityInside(_s: number, level: LevelAccess, x: number, y: number, z: number, e: Entity): void {
    if (e.type === 'boat' || e.type === 'chest_boat') level.destroyBlock(x, y, z, true);
  }
  override tick(_state: number, level: LevelAccess, x: number, y: number, z: number, rng: Random): void {
    if (!this.canSurvive(0, level, x, y, z)) {
      level.destroyBlock(x, y, z, false);
      return;
    }
    level.destroyBlock(x, y, z, false);
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.frogspawn.hatch', 1, 1);
    const n = 2 + rng.nextInt(5);
    for (let i = 0; i < n; i++) {
      level.createEntity('tadpole', x + 0.2 + rng.nextFloat() * 0.6, y - 0.5, z + 0.2 + rng.nextFloat() * 0.6, { reason: 'breeding' });
    }
  }
}

export function registerEggBehaviors(): void {
  registerBehaviorResolver((b) => {
    switch (b.name) {
      case 'turtle_egg': return new TurtleEggBehavior();
      case 'sniffer_egg': return new SnifferEggBehavior();
      case 'frogspawn': return new FrogspawnBehavior();
      default: return null;
    }
  });
}
