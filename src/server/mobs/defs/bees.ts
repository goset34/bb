/**
 * Bees and hives: bees pollinate flowers, carry nectar home (filling the hive's honey level),
 * grow crops they fly over, shelter at night and in rain, sting once (poison) and die later.
 * Hives keep up to three bees as saved entities; harvesting honey or breaking a hive without
 * smoke from a campfire below angers the bees.
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { blockOf, blockHasTag, getValue, setValue, tryGetValue, stateFlags, F } from '../../../common/block/registry';
import { IntProperty } from '../../../common/block/properties';
import { P } from '../../../common/block/properties';
import { DX, DZ, Direction } from '../../../common/world/direction';
import type { BlockEntityData } from '../../../common/world/chunk';
import type { ServerLevel } from '../../level';
import type { ServerPlayer } from '../../player';
import { saveEntity, loadEntity, SavedEntity } from '../../entity/persistence';
import { exchange, damagePlayerSlot } from '../../survival/interaction';
import { registerMob, Mob, mobOf } from '../mob';
import { Goal, Flag } from '../goals';
import {
  FloatGoal, BreedGoal, TemptGoal, FollowParentGoal, MeleeAttackGoal, HurtByTargetGoal, NearestAttackableTargetGoal, RandomFlyingGoal,
  isAngryAt, startAnger, tickAnger,
} from '../goallib';
import { PathType } from '../pathfinding';
import { hoverRandomPos, airAndWaterRandomPos, type Vec3 } from '../randompos';
import { ageUp, resetLove } from '../actions';
import { sounds } from './common';

type V3 = [number, number, number];

interface HiveBee {
  saved?: SavedEntity;
  entity?: string;
  ticksInHive: number;
  minTicks?: number;
}

const MAX_BEES = 3;
const FLOWER = (s: number) => {
  const b = blockOf(s);
  return blockHasTag(b, 'flowers') || b.name === 'flowering_azalea' || b.name === 'flowering_azalea_leaves' || b.name === 'cherry_leaves' || b.name === 'mangrove_propagule';
};
const BEE_FOOD = (s: ItemStack) => {
  const def = s.id;
  return ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'pink_petals', 'wildflowers', 'open_gazebloom', 'closed_gazebloom', 'blight_rose', 'flowering_azalea', 'cactus_flower'].includes(def);
};

const hivePos = (m: Mob): V3 | null => (m.data['hive'] as V3 | undefined) ?? null;
const hasNectar = (m: Mob) => !!m.data['nectar'];

function setNectar(m: Mob, v: boolean): void {
  m.data['nectar'] = v;
  m.setMeta('nectar', v);
}

function hasStung(m: Mob): boolean {
  return !!m.data['stung'];
}

function isHive(level: ServerLevel, [x, y, z]: V3): boolean {
  return blockHasTag(blockOf(level.getBlockState(x, y, z)), 'beehives');
}

function hiveBees(be: BlockEntityData): HiveBee[] {
  let list = be.data['bees'] as HiveBee[] | undefined;
  if (!list) {
    list = [];
    be.data['bees'] = list;
  }
  return list;
}

function hiveFull(level: ServerLevel, pos: V3): boolean {
  const be = level.getBlockEntity(pos[0], pos[1], pos[2]);
  return !!be && hiveBees(be).length >= MAX_BEES;
}

/** A lit campfire up to five blocks below calms the bees. */
export function isSedated(level: ServerLevel, x: number, y: number, z: number): boolean {
  for (let i = 1; i <= 5; i++) {
    const s = level.getBlockState(x, y - i, z);
    const n = blockOf(s).name;
    if ((n === 'campfire' || n === 'soul_campfire') && tryGetValue(s, P.lit) === true) return true;
    if (stateFlags[s]! & F.SOLID && !n.includes('campfire')) break;
  }
  return false;
}

function hiveNearFire(level: ServerLevel, pos: V3): boolean {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const n = blockOf(level.getBlockState(pos[0] + dx, pos[1] + dy, pos[2] + dz)).name;
    if (n === 'fire' || n === 'soul_fire') return true;
  }
  return false;
}

// ---- Hive storage ----------------------------------------------------------------------------

/** A bee flies into its hive and is stored there (reference BeehiveBlockEntity.addOccupant). */
function enterHive(m: Mob, pos: V3): boolean {
  const level = m.level;
  const be = level.getBlockEntity(pos[0], pos[1], pos[2]);
  if (!be || hiveBees(be).length >= MAX_BEES) return false;
  m.nav.stop();
  m.setTarget(null);
  const nectar = hasNectar(m);
  const saved = saveEntity(m.e);
  if (!saved) return false;
  hiveBees(be).push({ saved, ticksInHive: 0, minTicks: nectar ? 2400 : 600 });
  level.blockEntityChanged(pos[0], pos[1], pos[2]);
  level.playSound(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5, 'block.beehive.enter', 1, 1);
  level.entities.remove(m.e);
  return true;
}

/** Let bees out: when their time is up in fair weather, or all at once in an emergency. */
function releaseBees(level: ServerLevel, be: BlockEntityData, emergency: boolean, angerAt: Entity | null): void {
  const list = hiveBees(be);
  const state = level.getBlockState(be.x, be.y, be.z);
  const keep: HiveBee[] = [];
  for (const b of list) {
    if (!emergency) {
      const done = b.ticksInHive > (b.minTicks ?? 600);
      const night = !level.isDay();
      if (!done || night || level.isRaining()) {
        keep.push(b);
        continue;
      }
    }
    if (!releaseOne(level, be, state, b, emergency, angerAt)) keep.push(b);
  }
  be.data['bees'] = keep;
  level.blockEntityChanged(be.x, be.y, be.z);
}

function releaseOne(level: ServerLevel, be: BlockEntityData, state: number, b: HiveBee, emergency: boolean, angerAt: Entity | null): boolean {
  const facing = (tryGetValue(state, P.facing) as Direction | undefined) ?? 3;
  const fx = be.x + DX[facing]!, fz = be.z + DZ[facing]!;
  const front = level.getBlockState(fx, be.y, fz);
  const blocked = !!(stateFlags[front]! & F.SOLID);
  if (blocked && !emergency) return false;
  let e: Entity | null;
  const x = blocked ? be.x + 0.5 : fx + 0.5, y = be.y + (blocked ? 1 : 0.1), z = blocked ? be.z + 0.5 : fz + 0.5;
  if (b.saved) {
    b.saved.pos = [x, y, z];
    b.saved.vel = [0, 0, 0];
    e = loadEntity(level, b.saved);
    if (e) level.addFreshEntity(e);
  } else {
    e = level.createEntity(b.entity ?? 'bee', x, y, z, { reason: 'chunk_generation' });
  }
  const m = mobOf(e);
  if (!m) return false;
  m.data['hive'] = [be.x, be.y, be.z];
  if (hasNectar(m)) {
    setNectar(m, false);
    const honey = getValue(state, P.honeyLevel);
    if (blockHasTag(blockOf(state), 'beehives') && honey < 5) {
      let k = level.random.nextInt(100) === 0 ? 2 : 1;
      if (honey + k > 5) k--;
      level.setBlock(be.x, be.y, be.z, setValue(state, P.honeyLevel, honey + k), 3);
    }
  }
  // Time in the hive counts towards growing up and cooling down
  if (b.ticksInHive > 0) {
    if (m.isBaby) ageUp(m, Math.floor(b.ticksInHive / 20));
    resetLove(m);
    m.e.living.health = Math.min(m.maxHealth, m.health + b.ticksInHive / 20);
  }
  m.tmp['stayOut'] = 400;
  m.data['ticksWithoutNectar'] = 0;
  if (angerAt && !isSedated(level, be.x, be.y, be.z)) {
    startAnger(m, angerAt);
    m.setTarget(angerAt);
    m.tmp['stayOut'] = 400;
  }
  level.playSound(x, y, z, 'block.beehive.exit', 1, 1);
  return true;
}

/** Hive ticking: occupants' time and release (reference BeehiveBlockEntity.serverTick). */
export function hiveSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  return {
    name: 'beehives',
    tick() {
      for (const h of level.chunks.holders.values()) {
        const c = h.chunk;
        if (!c || !c.blockEntities.size) continue;
        for (const be of c.blockEntities.values()) {
          if (be.type !== 'beehive') continue;
          const list = be.data['bees'] as HiveBee[] | undefined;
          if (!list?.length) continue;
          for (const b of list) b.ticksInHive++;
          releaseBees(level, be, false, null);
          if (level.random.nextFloat() < 0.005) level.playSound(be.x + 0.5, be.y + 0.5, be.z + 0.5, 'block.beehive.work', 1, 1);
        }
      }
    },
  };
}

/** Shears (honeycomb) or a glass bottle (honey) on a full hive. */
export function harvestHive(p: ServerPlayer, hand: 'main' | 'off', x: number, y: number, z: number): boolean {
  const level = p.level;
  const s = level.getBlockState(x, y, z);
  if (!blockHasTag(blockOf(s), 'beehives') || getValue(s, P.honeyLevel) < 5) return false;
  const slot = hand === 'main' ? p.inventory.selected : 40;
  const stack = p.inventory.get(slot);
  if (stack.id === 'shears') {
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.beehive.shear', 1, 1);
    level.spawnItem(x + 0.5, y + 1, z + 0.5, new ItemStack('honeycomb', 3));
    damagePlayerSlot(level, p, slot, 1);
  } else if (stack.id === 'glass_bottle') {
    level.playSound(x + 0.5, y + 0.5, z + 0.5, 'item.bottle.fill', 1, 1);
    exchange(p, hand, stack, new ItemStack('honey_bottle', 1));
  } else return false;
  level.setBlock(x, y, z, setValue(s, P.honeyLevel, 0), 3);
  if (!isSedated(level, x, y, z)) {
    const be = level.getBlockEntity(x, y, z);
    if (be) releaseBees(level, be, true, p.entity);
    angerNearbyBees(level, x, y, z, p.entity);
  }
  return true;
}

function angerNearbyBees(level: ServerLevel, x: number, y: number, z: number, target: Entity): void {
  const e0 = { minX: x - 8, minY: y - 6, minZ: z - 8, maxX: x + 9, maxY: y + 7, maxZ: z + 9 };
  for (const e of level.entities.all()) {
    if (e.type !== 'bee' || !e.transform) continue;
    const t = e.transform;
    if (t.x < e0.minX || t.x > e0.maxX || t.y < e0.minY || t.y > e0.maxY || t.z < e0.minZ || t.z > e0.maxZ) continue;
    const m = mobOf(e);
    if (m && !m.getTarget()) {
      startAnger(m, target);
      m.setTarget(target);
    }
  }
}

/** Breaking a hive: silk touch keeps the bees inside the dropped item, otherwise they come out angry. */
export function hiveBroken(level: ServerLevel, be: BlockEntityData, oldState: number, breaker: Entity | null): void {
  const inv = breaker?.player?.inventory;
  const silk = !!inv && inv.mainHand.getEnchant('silk_touch') > 0;
  const name = blockOf(oldState).name;
  if (silk) {
    const stack = new ItemStack(name, 1, { bees: hiveBees(be) as unknown as Array<Record<string, unknown>>, honey: getValue(oldState, P.honeyLevel) });
    level.spawnItem(be.x + 0.5, be.y + 0.5, be.z + 0.5, stack);
    return;
  }
  if (breaker?.player && breaker.player.gameMode !== 'creative') {
    releaseBees(level, be, true, isSedated(level, be.x, be.y, be.z) ? null : breaker);
    if (!isSedated(level, be.x, be.y, be.z)) angerNearbyBees(level, be.x, be.y, be.z, breaker);
  } else releaseBees(level, be, true, null);
}

/** A hive item placed back keeps its bees and honey. */
export function hivePlaced(level: ServerLevel, x: number, y: number, z: number, stack: ItemStack): void {
  const bees = stack.data.bees as unknown as HiveBee[] | undefined;
  const s = level.getBlockState(x, y, z);
  if (!blockHasTag(blockOf(s), 'beehives')) return;
  let be = level.getBlockEntity(x, y, z);
  if (!be) {
    be = { type: 'beehive', x, y, z, data: {} };
    level.setBlockEntity(be);
  }
  if (bees) be.data['bees'] = bees.map((b) => ({ ...b }));
  const honey = stack.data.honey;
  if (honey) level.setBlock(x, y, z, setValue(s, P.honeyLevel, honey), 3);
  level.blockEntityChanged(x, y, z);
}

// ---- Goals -----------------------------------------------------------------------------------

function wantsToEnterHive(m: Mob): boolean {
  if (((m.tmp['stayOut'] as number | undefined) ?? 0) > 0 || m.tmp['pollinating'] || hasStung(m) || m.getTarget()) return false;
  const hive = hivePos(m);
  if (!hive) return false;
  const tired = ((m.data['ticksWithoutNectar'] as number | undefined) ?? 0) > 3600;
  const want = tired || m.level.isRaining() || !m.level.isDay() || hasNectar(m);
  return want && !hiveNearFire(m.level, hive);
}

class BeeEnterHiveGoal extends Goal {
  constructor(private readonly b: Mob) {
    super();
  }
  canUse(): boolean {
    const b = this.b, hive = hivePos(b);
    if (!hive || !wantsToEnterHive(b)) return false;
    if ((b.x - hive[0] - 0.5) ** 2 + (b.y - hive[1] - 0.5) ** 2 + (b.z - hive[2] - 0.5) ** 2 > 4) return false;
    if (!isHive(b.level, hive)) {
      delete b.data['hive'];
      return false;
    }
    if (hiveFull(b.level, hive)) {
      delete b.data['hive'];
      return false;
    }
    return true;
  }
  override canContinueToUse(): boolean {
    return false;
  }
  override start(): void {
    const hive = hivePos(this.b);
    if (hive) enterHive(this.b, hive);
  }
}

class BeeLocateHiveGoal extends Goal {
  constructor(private readonly b: Mob) {
    super();
  }
  canUse(): boolean {
    const b = this.b;
    return b.tickCount % 200 === 0 && !hivePos(b) && !b.tmp['pollinating'];
  }
  override canContinueToUse(): boolean {
    return false;
  }
  override start(): void {
    const b = this.b, level = b.level;
    const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z);
    const black = (b.tmp['blacklist'] as string[] | undefined) ?? [];
    let best: V3 | null = null;
    let bd = Infinity;
    for (let dx = -20; dx <= 20; dx++) for (let dy = -6; dy <= 6; dy++) for (let dz = -20; dz <= 20; dz++) {
      const x = bx + dx, y = by + dy, z = bz + dz;
      if (!blockHasTag(blockOf(level.getBlockState(x, y, z)), 'beehives')) continue;
      if (black.includes(`${x},${y},${z}`) || hiveFull(level, [x, y, z]) || hiveNearFire(level, [x, y, z])) continue;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = [x, y, z];
      }
    }
    if (best) b.data['hive'] = best;
  }
}

class BeeGoToHiveGoal extends Goal {
  private travelling = 0;
  constructor(private readonly b: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const b = this.b, hive = hivePos(b);
    return !!hive && !b.nav.path && wantsToEnterHive(b) && (b.x - hive[0]) ** 2 + (b.z - hive[2]) ** 2 > 4;
  }
  override canContinueToUse(): boolean {
    return this.canUse() && this.travelling < 2400;
  }
  override start(): void {
    this.travelling = 0;
  }
  override stop(): void {
    this.b.nav.stop();
  }
  override tick(): void {
    const b = this.b, hive = hivePos(b)!;
    this.travelling++;
    if (this.travelling > 2400) {
      // Give up on unreachable hives
      const k = `${hive[0]},${hive[1]},${hive[2]}`;
      b.tmp['blacklist'] = [...((b.tmp['blacklist'] as string[] | undefined) ?? []), k].slice(-3);
      delete b.data['hive'];
      return;
    }
    if (!b.nav.isInProgress()) {
      const d2 = (b.x - hive[0]) ** 2 + (b.y - hive[1]) ** 2 + (b.z - hive[2]) ** 2;
      if (d2 > 256 * 4) {
        const v = hoverRandomPos(b, 8, 6, hive[0] + 0.5 - b.x, hive[2] + 0.5 - b.z, Math.PI / 2, 3, 1);
        if (v) b.nav.moveTo(v[0], v[1], v[2], 1);
      } else b.nav.moveTo(hive[0] + 0.5, hive[1] + 0.5, hive[2] + 0.5, 1, 0);
    }
  }
}

class BeePollinateGoal extends Goal {
  private flower: V3 | null = null;
  private ticks = 0;
  private cooldown = 0;
  constructor(private readonly b: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const b = this.b;
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    if (hasNectar(b) || b.level.isRaining() || b.getTarget()) return false;
    const f = this.findFlower();
    if (!f) {
      this.cooldown = 20 + b.random.nextInt(40);
      return false;
    }
    this.flower = f;
    b.data['flower'] = f;
    return true;
  }
  override canContinueToUse(): boolean {
    const b = this.b;
    if (!this.flower || b.level.isRaining() || hasNectar(b) || b.getTarget()) return false;
    if (!FLOWER(b.level.getBlockState(...this.flower))) return false;
    return this.ticks < 600;
  }
  override start(): void {
    this.ticks = 0;
    this.b.tmp['pollinating'] = true;
    const [x, y, z] = this.flower!;
    this.b.nav.moveTo(x + 0.5, y + 0.6, z + 0.5, 1.2, 0);
  }
  override stop(): void {
    const b = this.b;
    if (this.ticks > 400) setNectar(b, true);
    b.tmp['pollinating'] = false;
    b.nav.stop();
    this.cooldown = 200;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const b = this.b, [x, y, z] = this.flower!;
    const d = (b.x - x - 0.5) ** 2 + (b.y - y - 0.6) ** 2 + (b.z - z - 0.5) ** 2;
    if (d < 1) {
      this.ticks++;
      // Hover around the blossom
      if (b.random.nextFloat() < 0.05) {
        b.move.setWantedPosition(x + 0.5 + (b.random.nextFloat() - 0.5) * 0.66, y + 0.6, z + 0.5 + (b.random.nextFloat() - 0.5) * 0.66, 0.35);
      }
      if (b.random.nextFloat() < 0.05) b.playSound('entity.bee.pollinate');
      b.look.setLookAt(x + 0.5, y + 0.5, z + 0.5);
    } else if (!b.nav.isInProgress()) {
      b.nav.moveTo(x + 0.5, y + 0.6, z + 0.5, 1.2, 0);
      this.ticks++;
    }
  }
  private findFlower(): V3 | null {
    const b = this.b, level = b.level;
    const saved = b.data['flower'] as V3 | undefined;
    if (saved && FLOWER(level.getBlockState(...saved)) && (b.x - saved[0]) ** 2 + (b.z - saved[2]) ** 2 < 400) return saved;
    const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z);
    for (let r = 0; r <= 5; r++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (FLOWER(level.getBlockState(bx + dx, by + dy, bz + dz))) return [bx + dx, by + dy, bz + dz];
          }
        }
      }
    }
    return null;
  }
}

/** With nectar, bees speed up crops beneath them (reference BeeGrowCropGoal). */
class BeeGrowCropGoal extends Goal {
  constructor(private readonly b: Mob) {
    super();
  }
  canUse(): boolean {
    const b = this.b;
    if (((b.data['cropsGrown'] as number | undefined) ?? 0) >= 10 || b.random.nextFloat() < 0.3) return false;
    return hasNectar(b) && !!hivePos(b);
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override tick(): void {
    const b = this.b, level = b.level;
    if (b.random.nextInt(this.adjustedTickDelay(30)) !== 0) return;
    for (let i = 1; i <= 2; i++) {
      const x = Math.floor(b.x), y = Math.floor(b.y) - i, z = Math.floor(b.z);
      const s = level.getBlockState(x, y, z);
      const blk = blockOf(s);
      let next = -1;
      if (blockHasTag(blk, 'bee_growables') || ['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'sweet_berry_bush', 'torchflower_crop', 'pitcher_crop'].includes(blk.name)) {
        const age = blk.props.find((p) => p.name === 'age') as IntProperty | undefined;
        if (age) {
          const v = getValue(s, age);
          if (v < age.max) next = setValue(s, age, v + 1);
        }
      } else if (blk.name === 'cave_vines' || blk.name === 'cave_vines_plant') {
        if (tryGetValue(s, P.berries) === false) next = setValue(s, P.berries, true);
      }
      if (next >= 0) {
        level.levelEvent(2005, x, y, z, 0);
        level.setBlock(x, y, z, next, 3);
        b.data['cropsGrown'] = ((b.data['cropsGrown'] as number | undefined) ?? 0) + 1;
      }
    }
  }
}

class BeeWanderGoal extends RandomFlyingGoal {
  override canUse(): boolean {
    return this.m.nav.isDone() && this.m.random.nextInt(10) === 0 && super.canUse();
  }
  protected override position(): Vec3 | null {
    const b = this.m, hive = hivePos(b);
    let vx: number, vz: number;
    if (hive && (b.x - hive[0]) ** 2 + (b.z - hive[2]) ** 2 > 22 * 22) {
      vx = hive[0] + 0.5 - b.x;
      vz = hive[2] + 0.5 - b.z;
    } else {
      const yaw = (b.e.transform.yaw * Math.PI) / 180;
      vx = -Math.sin(yaw);
      vz = Math.cos(yaw);
    }
    return hoverRandomPos(b, 8, 7, vx, vz, Math.PI / 2, 3, 1) ?? airAndWaterRandomPos(b, 8, 4, -2, vx, vz, Math.PI / 2);
  }
}

class BeeAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    return super.canUse() && ((this.m.data['anger'] as number | undefined) ?? 0) > 0 && !hasStung(this.m);
  }
  override canContinueToUse(): boolean {
    return super.canContinueToUse() && ((this.m.data['anger'] as number | undefined) ?? 0) > 0 && !hasStung(this.m);
  }
}

// ---- Definition ------------------------------------------------------------------------------

registerMob({
  id: 'bee', attrs: { max_health: 10, flying_speed: 0.6, movement_speed: 0.3, attack_damage: 2, follow_range: 48 },
  nav: 'fly', move: 'fly', ageable: true, noFallDamage: true, xp: (m) => 1 + m.random.nextInt(3), food: BEE_FOOD,
  malus: { [PathType.DANGER_FIRE]: -1, [PathType.WATER]: -1, [PathType.WATER_BORDER]: 16, [PathType.COCOA]: -1, [PathType.FENCE]: -1 },
  canPassDoors: false, canFloat: false, ...sounds('bee', false), loot: null,
  ambientFor: () => null,
  setup(m) {
    m.goals.add(0, new BeeAttackGoal(m, 1.4, true));
    m.goals.add(1, new BeeEnterHiveGoal(m));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new TemptGoal(m, 1.25, BEE_FOOD, false));
    m.goals.add(4, new BeePollinateGoal(m));
    m.goals.add(5, new FollowParentGoal(m, 1.25));
    m.goals.add(5, new BeeLocateHiveGoal(m));
    m.goals.add(5, new BeeGoToHiveGoal(m));
    m.goals.add(7, new BeeGrowCropGoal(m));
    m.goals.add(8, new BeeWanderGoal(m, 1));
    m.goals.add(9, new FloatGoal(m));
    m.targets.add(1, new (class extends HurtByTargetGoal {
      override canContinueToUse(): boolean {
        return ((m.data['anger'] as number | undefined) ?? 0) > 0 && super.canContinueToUse();
      }
    })(m).setAlertOthers());
    m.targets.add(2, new (class extends NearestAttackableTargetGoal {
      override canUse(): boolean {
        return ((m.data['anger'] as number | undefined) ?? 0) > 0 && !hasStung(m) && super.canUse();
      }
    })(m, 'player', 10, true, false, (e) => isAngryAt(m, e)));
  },
  tick(m) {
    tickAnger(m);
    m.setMeta('angry', ((m.data['anger'] as number | undefined) ?? 0) > 0);
    const stay = (m.tmp['stayOut'] as number | undefined) ?? 0;
    if (stay > 0) m.tmp['stayOut'] = stay - 1;
    if (!hasNectar(m)) m.data['ticksWithoutNectar'] = ((m.data['ticksWithoutNectar'] as number | undefined) ?? 0) + 1;
    // Bees that stung die some time later
    if (hasStung(m)) {
      const t = ((m.data['sinceSting'] as number | undefined) ?? 0) + 1;
      m.data['sinceSting'] = t;
      if (t % 5 === 0 && m.random.nextInt(Math.max(1, Math.min(1200, 1200 - t))) === 0) m.level.hurtEntity(m.e, 'generic', m.health);
    }
    // Nectar particles drip while carrying pollen
    if (hasNectar(m) && m.random.nextFloat() < 0.05) m.broadcastEvent('nectar');
    // Water hurts bees
    if (m.inWater) m.level.hurtEntity(m.e, 'drown', 1);
  },
  doHurtTarget(m, target) {
    const ok = m.level.hurtEntity(target, 'sting', m.attr('attack_damage'), m.e);
    if (!ok) return false;
    const d = m.level.getDifficulty();
    const secs = d === 2 ? 10 : d === 3 ? 18 : 0;
    if (secs > 0 && target.living) m.level.addEntityEffect(target, 'poison', secs * 20, 0);
    m.data['stung'] = true;
    m.setMeta('stung', true);
    m.data['anger'] = 0;
    m.setTarget(null);
    m.playSound('entity.bee.sting');
    return true;
  },
  onHurt(m, _type, _a, attacker) {
    if (attacker && attacker.living && !hasStung(m)) startAnger(m, attacker);
    m.tmp['pollinating'] = false;
  },
  syncMeta(m) {
    m.setMeta('nectar', hasNectar(m));
    m.setMeta('stung', hasStung(m));
  },
});

