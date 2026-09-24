/**
 * Golems and helpers: iron golems (built from iron blocks and a carved pumpkin, defend against
 * monsters, fling targets upward, crack when hurt, repaired with iron ingots), snow golems
 * (built from snow blocks, throw snowballs, leave snow trails, melt in hot biomes) and allays
 * (collect items matching what they hold, deliver them to their player or a played note block,
 * dance to jukeboxes and duplicate with an amethyst shard).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, getBlock, stateFlags, F, tryGetValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { heal } from '../../survival/living';
import type { ServerLevel } from '../../level';
import type { ServerPlayer } from '../../player';
import { registerMob, Mob, mobOf } from '../mob';
import { addVibrationListener } from '../vibrations';
import { Goal, Flag } from '../goals';
import {
  MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestAttackableTargetGoal, RandomFlyingGoal,
  isAngryAt, startAnger, tickAnger,
} from '../goallib';
import { PathType } from '../pathfinding';
import { handStack, useItem } from '../actions';
import { RangedAttackGoal, mobThrow } from '../../combat/ranged';
import { sounds } from './common';

type V3 = [number, number, number];

/** Monsters golems go after (never hissers, which would blow up the village). */
const isEnemy = (e: Entity) => !!e['hostile'] && e.type !== 'hisser';

// =============================================================================================
// Iron golem
// =============================================================================================

/** Walk towards the current target from far away (reference MoveTowardsTargetGoal). */
class MoveTowardsTargetGoal extends Goal {
  private target: Entity | null = null;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly within: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    this.target = this.m.getTarget();
    if (!this.target) return false;
    const d = this.m.distanceToSqr(this.target);
    return d <= this.within * this.within;
  }
  override canContinueToUse(): boolean {
    const t = this.target;
    return !!t && !this.m.nav.isDone() && !t.living?.dead && this.m.distanceToSqr(t) < this.within * this.within;
  }
  override start(): void {
    const t = this.target!.transform!;
    this.m.nav.moveTo(t.x, t.y, t.z, this.speed);
  }
  override stop(): void {
    this.target = null;
  }
}

function crackiness(m: Mob): number {
  const f = m.health / m.maxHealth;
  return f < 0.25 ? 3 : f < 0.5 ? 2 : f < 0.75 ? 1 : 0;
}

registerMob({
  id: 'iron_golem', attrs: { max_health: 100, movement_speed: 0.25, knockback_resistance: 1, attack_damage: 15 }, stepHeight: 1,
  noFallDamage: true, persistent: true, xp: 0, hurtSound: 'entity.iron_golem.hurt', deathSound: 'entity.iron_golem.death', stepSound: 'entity.iron_golem.step',
  leashable: true,
  setup(m) {
    m.goals.add(1, new MeleeAttackGoal(m, 1, true));
    m.goals.add(2, new MoveTowardsTargetGoal(m, 0.9, 32));
    m.goals.add(4, new RandomStrollGoal(m, 0.6, 120, true, true));
    m.goals.add(7, new LookAtPlayerGoal(m, 6));
    m.goals.add(8, new RandomLookAroundGoal(m));
    m.targets.add(2, new HurtByTargetGoal(m));
    m.targets.add(3, new NearestAttackableTargetGoal(m, 'player', 10, true, false, (e) => isAngryAt(m, e)));
    m.targets.add(3, new NearestAttackableTargetGoal(m, isEnemy, 5, false, false));
  },
  tick(m) {
    tickAnger(m);
    const c = crackiness(m);
    m.setMeta('crack', c);
    const at = (m.tmp['attackAnim'] as number | undefined) ?? 0;
    if (at > 0) m.tmp['attackAnim'] = at - 1;
  },
  doHurtTarget(m, target) {
    // Reference damage: half to one-and-a-half times the attack damage, and a toss upwards
    const base = m.attr('attack_damage');
    const dmg = base > 0 ? base / 2 + m.random.nextInt(Math.floor(base)) : base;
    m.tmp['attackAnim'] = 10;
    m.broadcastEvent('golemAttack');
    const ok = m.level.hurtEntity(target, 'mob_attack', dmg, m.e);
    if (ok && target.physics) target.physics.vy += 0.4;
    m.playSound('entity.iron_golem.attack');
    return ok;
  },
  onHurt(m, _t, _a, attacker) {
    if (attacker?.player && !(m.data['playerCreated'] && attacker.player.gameMode === 'creative')) startAnger(m, attacker);
    const before = (m.tmp['lastCrack'] as number | undefined) ?? 0;
    const now = crackiness(m);
    if (now > before) m.playSound('entity.iron_golem.damage');
    m.tmp['lastCrack'] = now;
  },
  canAttack(m, target) {
    // Player-built golems leave players alone unless provoked
    if (target.player && m.data['playerCreated'] && !isAngryAt(m, target)) return false;
    return target.type !== 'iron_golem' && target.type !== 'hisser';
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id !== 'iron_ingot' || m.health >= m.maxHealth) return false;
    heal(m.e, 25);
    if (m.health === m.maxHealth) m.playSound('entity.iron_golem.repair');
    else m.playSound('entity.iron_golem.repair', 1, 1 + (m.random.nextFloat() - m.random.nextFloat()) * 0.2);
    useItem(p, hand, s);
    return true;
  },
  syncMeta(m) {
    m.setMeta('crack', crackiness(m));
  },
});

// =============================================================================================
// Snow golem
// =============================================================================================

registerMob({
  id: 'snow_golem', attrs: { max_health: 4, movement_speed: 0.2 }, hurtByWater: true, persistent: true, xp: 0, ...sounds('snow_golem'),
  malus: { [PathType.WATER]: -1 },
  setup(m) {
    m.goals.add(1, new RangedAttackGoal(m, 1.25, 20, 20, 10, (mm, t) => {
      mobThrow(mm, t, 'snowball', 1.6, 12);
      mm.playSound('entity.snow_golem.shoot', 1, 0.4 / (mm.random.nextFloat() * 0.4 + 0.8));
    }));
    m.goals.add(2, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(3, new LookAtPlayerGoal(m, 6));
    m.goals.add(4, new RandomLookAroundGoal(m));
    m.targets.add(1, new NearestAttackableTargetGoal(m, isEnemy, 10, true, false));
  },
  init(m) {
    m.data['pumpkin'] = true;
  },
  syncMeta(m) {
    m.setMeta('pumpkin', m.data['pumpkin'] !== false);
  },
  tick(m) {
    const level = m.level;
    const b = BIOMES[level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
    // Hot biomes melt snow golems
    if ((b?.temperature ?? 0.8) > 1) level.hurtEntity(m.e, 'on_fire', 1);
    if (level.getGameRule('mobGriefing') === false || (b?.temperature ?? 0.8) >= 0.8) return;
    // Leave a trail of snow
    const snow = getBlock('snow').defaultState;
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(m.x + ((i % 2) * 2 - 1) * 0.25), y = Math.floor(m.y), z = Math.floor(m.z + ((Math.floor(i / 2) % 2) * 2 - 1) * 0.25);
      if (!(stateFlags[level.getBlockState(x, y, z)]! & F.AIR)) continue;
      if (!getBlock('snow').behavior.canSurvive(snow, level, x, y, z)) continue;
      level.setBlock(x, y, z, snow, 3);
      level.gameEvent('block_place', x, y, z, m.e, snow);
    }
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'shears' && m.data['pumpkin'] !== false) {
      m.data['pumpkin'] = false;
      m.setMeta('pumpkin', false);
      m.playSound('entity.snow_golem.shear');
      m.level.spawnItem(m.x, m.y + 1.7, m.z, new ItemStack('carved_pumpkin', 1));
      return true;
    }
    return false;
  },
});

// =============================================================================================
// Construction patterns
// =============================================================================================

function isBlockAt(level: ServerLevel, x: number, y: number, z: number, name: string): boolean {
  return blockOf(level.getBlockState(x, y, z)).name === name;
}

function clearPattern(level: ServerLevel, cells: V3[]): void {
  for (const [x, y, z] of cells) {
    const s = level.getBlockState(x, y, z);
    level.setBlock(x, y, z, 0, 2);
    level.levelEvent(2001, x, y, z, s);
  }
  for (const [x, y, z] of cells) level.updateNeighborsAt(x, y, z, getBlock('air'));
}

/** Check for golem shapes when a carved pumpkin or jack o'lantern completes one. */
export function trySpawnGolem(level: ServerLevel, x: number, y: number, z: number, builder: ServerPlayer | null): boolean {
  const head = blockOf(level.getBlockState(x, y, z)).name;
  if (head !== 'carved_pumpkin' && head !== 'jack_o_lantern') return false;
  // Snow golem: two snow blocks under the head
  if (isBlockAt(level, x, y - 1, z, 'snow_block') && isBlockAt(level, x, y - 2, z, 'snow_block')) {
    clearPattern(level, [[x, y, z], [x, y - 1, z], [x, y - 2, z]]);
    level.createEntity('snow_golem', x + 0.5, y - 2 + 0.05, z + 0.5, { reason: 'mob_summoned' });
    return true;
  }
  // Iron golem: T of iron blocks (arms along x or z), air in the lower corners
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    const cells: V3[] = [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + ax, y - 1, z + az], [x - ax, y - 1, z - az]];
    if (!cells.slice(1).every(([cx, cy, cz]) => isBlockAt(level, cx, cy, cz, 'iron_block'))) continue;
    const corners: V3[] = [[x + ax, y - 2, z + az], [x - ax, y - 2, z - az]];
    if (!corners.every(([cx, cy, cz]) => stateFlags[level.getBlockState(cx, cy, cz)]! & (F.AIR | F.REPLACEABLE))) continue;
    clearPattern(level, cells);
    const e = level.createEntity('iron_golem', x + 0.5, y - 2 + 0.05, z + 0.5, { reason: 'mob_summoned' });
    const g = mobOf(e);
    if (g) g.data['playerCreated'] = true;
    if (builder) level.server.hooks.gameEvent(level, 'summoned_entity', x, y, z, builder.entity, 0);
    return true;
  }
  return false;
}

// =============================================================================================
// Allay
// =============================================================================================

function nearPlayingJukebox(m: Mob): boolean {
  const level = m.level;
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  for (let dx = -8; dx <= 8; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -8; dz <= 8; dz++) {
    const s = level.getBlockState(bx + dx, by + dy, bz + dz);
    if (blockOf(s).name === 'jukebox' && tryGetValue(s, P.hasRecord) === true) return true;
  }
  return false;
}

const likedPlayer = (m: Mob): ServerPlayer | null => {
  const name = m.data['liked'] as string | undefined;
  return name ? m.level.players.find((p) => p.name === name) ?? null : null;
};

function stored(m: Mob): ItemStack {
  const s = m.data['inv'] as Record<string, unknown> | undefined;
  return s ? ItemStack.fromJSON(s as never) : ItemStack.empty();
}

function setStored(m: Mob, s: ItemStack): void {
  if (s.isEmpty()) delete m.data['inv'];
  else m.data['inv'] = s.toJSON();
}

/** Where to deliver: a recently played note block, else the liked player. */
function deliveryTarget(m: Mob): V3 | null {
  const nb = m.data['noteBlock'] as [number, number, number, number] | undefined;
  if (nb && m.level.getGameTime() - nb[3] < 600 && blockOf(m.level.getBlockState(nb[0], nb[1], nb[2])).name === 'note_block') return [nb[0] + 0.5, nb[1] + 1, nb[2] + 0.5];
  const p = likedPlayer(m);
  if (p && !p.entity.living?.dead) {
    const t = p.entity.transform;
    return [t.x, t.y + 1, t.z];
  }
  return null;
}

class AllayCollectGoal extends Goal {
  private item: Entity | null = null;
  constructor(private readonly a: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const a = this.a, held = a.equipment[0]!;
    if (held.isEmpty() || ((a.tmp['pickupCooldown'] as number | undefined) ?? 0) > 0) return false;
    const inv = stored(a);
    if (!inv.isEmpty() && inv.count >= (inv.id === held.id ? 64 : 0)) return false;
    const list = a.level.getEntities(a.box().inflate(32, 16, 32), (e) => !!e.item && e.item.pickupDelay <= 0 && e.item.stack.id === held.id && e.item.thrower !== a.e.id);
    list.sort((x, y) => a.distanceToSqr(x) - a.distanceToSqr(y));
    this.item = list[0] ?? null;
    return !!this.item;
  }
  override canContinueToUse(): boolean {
    return !!this.item && !this.item.removed && this.canUse();
  }
  override tick(): void {
    if (this.item) this.a.nav.moveToEntity(this.item, 1.75);
  }
}

class AllayDeliverGoal extends Goal {
  private dest: V3 | null = null;
  constructor(private readonly a: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    if (stored(this.a).isEmpty()) return false;
    this.dest = deliveryTarget(this.a);
    return !!this.dest;
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override tick(): void {
    const a = this.a, [x, y, z] = this.dest!;
    const d = (a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2;
    if (d > 16) {
      a.nav.moveTo(x, y, z, 2.25, 0);
      return;
    }
    a.nav.stop();
    // Toss everything collected towards the destination
    const s = stored(a);
    setStored(a, ItemStack.empty());
    const dx = x - a.x, dy = y - a.y, dz = z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const drop = a.level.spawnItem(a.x, a.y + 0.3, a.z, s, (dx / len) * 0.3, 0.1 + (dy / len) * 0.3, (dz / len) * 0.3);
    if (drop?.item) {
      drop.item.thrower = a.e.id;
      drop.item.pickupDelay = 40;
    }
    a.playSound('entity.allay.item_thrown');
    a.tmp['pickupCooldown'] = 60;
  }
}

/** Stay near the liked player (reference StayCloseToTarget, 16 blocks). */
class AllayFollowGoal extends Goal {
  constructor(private readonly a: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const p = likedPlayer(this.a);
    return !!p && this.a.distanceToSqr(p.entity) > 64 && stored(this.a).isEmpty();
  }
  override tick(): void {
    const p = likedPlayer(this.a);
    if (p) this.a.nav.moveToEntity(p.entity, 2.25);
  }
}

registerMob({
  id: 'allay', attrs: { max_health: 20, flying_speed: 0.1, movement_speed: 0.1, attack_damage: 2, follow_range: 48 }, nav: 'fly', move: 'fly',
  noFallDamage: true, persistent: false, xp: 0, loot: null, canPassDoors: false, ...sounds('allay'),
  ambientFor(m) {
    return m.equipment[0]!.isEmpty() ? 'entity.allay.ambient_without_item' : 'entity.allay.ambient_with_item';
  },
  setup(m) {
    m.canPickUpLoot = true;
    m.goals.add(1, new AllayDeliverGoal(m));
    m.goals.add(2, new AllayCollectGoal(m));
    m.goals.add(3, new AllayFollowGoal(m));
    m.goals.add(5, new RandomFlyingGoal(m, 1));
    m.goals.add(6, new LookAtPlayerGoal(m, 6));
  },
  tick(m) {
    const c = (m.tmp['pickupCooldown'] as number | undefined) ?? 0;
    if (c > 0) m.tmp['pickupCooldown'] = c - 1;
    const d = (m.data['dupeCooldown'] as number | undefined) ?? 0;
    if (d > 0) m.data['dupeCooldown'] = d - 1;
    if (m.tickCount % 20 === 0) m.setMeta('dancing', nearPlayingJukebox(m));
    if (!m.onGround && m.e.physics.vy < 0) m.e.physics.vy *= 0.8;
  },
  wantsToPickUp(m, s) {
    const held = m.equipment[0]!;
    if (held.isEmpty() || s.id !== held.id || ((m.tmp['pickupCooldown'] as number | undefined) ?? 0) > 0) return false;
    const inv = stored(m);
    return inv.isEmpty() || (inv.id === s.id && inv.count < 64);
  },
  pickUp(m, e) {
    const it = e.item!;
    const inv = stored(m);
    const room = inv.isEmpty() ? 64 : 64 - inv.count;
    const n = Math.min(room, it.stack.count);
    const add = it.stack.split(n);
    if (inv.isEmpty()) setStored(m, add);
    else {
      inv.count += add.count;
      setStored(m, inv);
    }
    m.playSound('entity.item.pickup', 0.2);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    const held = m.equipment[0]!;
    // Dancing allays duplicate with an amethyst shard
    if (s.id === 'amethyst_shard' && m.e.meta['dancing'] && ((m.data['dupeCooldown'] as number | undefined) ?? 0) <= 0) {
      const e = m.level.createEntity('allay', m.x, m.y, m.z, { reason: 'breeding' });
      const n = mobOf(e);
      if (n) n.setPersistent();
      m.data['dupeCooldown'] = 6000;
      m.broadcastEvent('heart');
      m.playSound('entity.allay.duplicate');
      useItem(p, hand, s);
      return true;
    }
    if (held.isEmpty() && !s.isEmpty()) {
      m.equipment[0] = s.copyWithCount(1);
      useItem(p, hand, s);
      m.data['liked'] = p.name;
      m.setPersistent();
      m.playSound('entity.allay.item_given');
      return true;
    }
    if (!held.isEmpty() && s.isEmpty() && hand === 'main') {
      m.equipment[0] = ItemStack.empty();
      p.inventory.set(p.inventory.selected, held);
      p.inventory.revision++;
      const inv = stored(m);
      if (!inv.isEmpty()) {
        m.level.spawnItem(m.x, m.y, m.z, inv);
        setStored(m, ItemStack.empty());
      }
      delete m.data['liked'];
      m.playSound('entity.allay.item_taken');
      return true;
    }
    return false;
  },
  onDeath(m) {
    const inv = stored(m);
    if (!inv.isEmpty()) m.level.spawnItem(m.x, m.y, m.z, inv);
  },
  canAttack: () => false,
});

/** Note blocks played near an allay become its delivery spot for 30 seconds. */
export function noteBlockPlayed(level: ServerLevel, x: number, y: number, z: number): void {
  for (const e of level.entities.all()) {
    if (e.type !== 'allay' || !e.transform) continue;
    const t = e.transform;
    if ((t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2 > 256) continue;
    const m = mobOf(e);
    if (m) m.data['noteBlock'] = [x, y, z, level.getGameTime()];
  }
}

addVibrationListener((level, v) => {
  if (v.type === 'note_block_play') noteBlockPlayed(level, Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));
});
