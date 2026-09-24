/**
 * Wild animals: turtles (home beaches, egg laying, scutes), polar bears (protective mothers,
 * standing attacks), goats (long jumps, ramming, horns, screaming goats), bats (roosting under
 * blocks), armadillos (rolling up when scared, scutes, brushing) and sniffers (sniffing out
 * ancient seeds, laying eggs).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { blockOf, blockHasTag, stateFlags, F, getCollisionShape, getBlock, setValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { hurt, knockback } from '../../survival/living';
import { damagePlayerSlot } from '../../survival/interaction';
import { registerMob, Mob, mobOf, yawTo, rotlerp, wrapDegrees } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import { MoveControl, MoveOp } from '../controls';
import {
  FloatGoal, PanicGoal, BreedGoal, TemptGoal, FollowParentGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal,
  MeleeAttackGoal, HurtByTargetGoal, NearestAttackableTargetGoal, MoveToBlockGoal, isAngryAt, startAnger, tickAnger,
} from '../goallib';
import { PathType } from '../pathfinding';
import { defaultPosTowards, defaultRandomPos, nearestWater } from '../randompos';
import { handStack, exchangeItem, setAge, resetLove, isInLove } from '../actions';
import { attackablePlayer } from '../targeting';
import { items, sounds } from './common';

// =============================================================================================
// Shared: long jumps (goats, frogs)
// =============================================================================================

/** Leap to a random reachable spot up to `range` blocks away (reference LongJumpToRandomPos). */
export class LongJumpGoal extends Goal {
  private cooldown = 0;
  private target: [number, number, number] | null = null;
  private waiting = 0;
  constructor(private readonly m: Mob, private readonly minCooldown: number, private readonly maxCooldown: number, private readonly range: number, private readonly up: number, private readonly sound: string, private readonly acceptable: (x: number, y: number, z: number) => boolean = () => true) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP | Flag.LOOK;
    this.cooldown = minCooldown + m.random.nextInt(maxCooldown - minCooldown + 1);
  }
  canUse(): boolean {
    const m = this.m;
    if (--this.cooldown > 0) return false;
    this.cooldown = this.minCooldown + m.random.nextInt(this.maxCooldown - this.minCooldown + 1);
    if (!m.onGround || m.inWater || m.inLava || m.leashHolder || m.e['vehicle'] || m.getTarget()) return false;
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    for (let i = 0; i < 20; i++) {
      const dx = m.random.nextInt(this.range * 2 + 1) - this.range, dz = m.random.nextInt(this.range * 2 + 1) - this.range;
      const dy = m.random.nextInt(this.up * 2 + 1) - this.up;
      if (dx * dx + dz * dz < 9) continue;
      const x = bx + dx, y = by + dy, z = bz + dz;
      if (!this.standable(x, y, z) || !this.acceptable(x, y, z)) continue;
      if (!this.clearArc(x, y, z)) continue;
      this.target = [x, y, z];
      return true;
    }
    return false;
  }
  private standable(x: number, y: number, z: number): boolean {
    const level = this.m.level;
    const below = level.getBlockState(x, y - 1, z);
    if (!(stateFlags[below]! & F.SOLID) || stateFlags[below]! & F.LAVA) return false;
    const n = blockOf(below).name;
    if (n === 'powder_snow' || n === 'magma_block' || n === 'cactus') return false;
    for (let h = 0; h < Math.ceil(this.m.height); h++) if (getCollisionShape(level.getBlockState(x, y + h, z)).length || stateFlags[level.getBlockState(x, y + h, z)]! & F.WATER) return false;
    return true;
  }
  private clearArc(x: number, y: number, z: number): boolean {
    const m = this.m, level = m.level;
    const sx = m.x, sy = m.y, sz = m.z, ex = x + 0.5, ez = z + 0.5;
    const peak = Math.max(sy, y) + 1.5;
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const px = sx + (ex - sx) * t, pz = sz + (ez - sz) * t;
      const py = sy + (y - sy) * t + (peak - Math.max(sy, y)) * 4 * t * (1 - t);
      for (let h = 0; h < Math.ceil(m.height); h++) if (getCollisionShape(level.getBlockState(Math.floor(px), Math.floor(py + h), Math.floor(pz))).length) return false;
    }
    return true;
  }
  override canContinueToUse(): boolean {
    return this.waiting > 0 || !this.m.onGround;
  }
  override start(): void {
    const m = this.m, [x, y, z] = this.target!;
    const t = m.e.transform;
    t.yaw = t.bodyYaw = yawTo(x + 0.5 - m.x, z + 0.5 - m.z);
    m.nav.stop();
    // Ballistic launch: 16-tick flight with gravity 0.08 and 0.98 drag, solved without drag then boosted
    const ticks = 16;
    const dx = x + 0.5 - m.x, dz = z + 0.5 - m.z, dy = y - m.y;
    const p = m.e.physics;
    p.vx = (dx / ticks) * 1.1;
    p.vz = (dz / ticks) * 1.1;
    p.vy = (dy + 0.5 * 0.08 * ticks * ticks) / ticks;
    m.playSound(this.sound);
    this.waiting = 5;
  }
  override tick(): void {
    if (this.waiting > 0) this.waiting--;
  }
}

// =============================================================================================
// Turtle
// =============================================================================================

type V3 = [number, number, number];
const home = (m: Mob): V3 => (m.data['home'] as V3 | undefined) ?? [Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)];
const nearHome = (m: Mob, r: number) => {
  const [x, y, z] = home(m);
  return (m.x - x - 0.5) ** 2 + (m.y - y) ** 2 + (m.z - z - 0.5) ** 2 < r * r;
};

/** Turtles swim smoothly, crawl slowly on land and tire away from home (reference TurtleMoveControl). */
class TurtleMoveControl extends MoveControl {
  private cur = 0;
  override tick(): void {
    const m = this.mob, inp = m.e.input, p = m.e.physics;
    if (m.inWater) {
      p.vy += 0.005;
      if (!nearHome(m, 16)) this.cur = Math.max(this.cur / 2, 0.08);
      if (m.isBaby) this.cur = Math.max(this.cur / 3, 0.06);
    } else if (m.onGround) this.cur = Math.max(this.cur / 2, 0.06);
    if (this.op === MoveOp.MOVE_TO && !m.nav.isDone()) {
      const dx = this.wantedX - m.x, dy = this.wantedY - m.y, dz = this.wantedZ - m.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-5) this.cur = 0;
      else {
        const t = m.e.transform;
        t.yaw = rotlerp(t.yaw, yawTo(dx, dz), 90);
        t.bodyYaw = t.yaw;
        const target = this.speedModifier * m.speed;
        this.cur += (target - this.cur) * 0.125;
        p.vy += this.cur * (dy / d) * 0.1;
      }
    } else this.cur = 0;
    inp.speed = this.cur;
    inp.speedModifier = 1;
    inp.forward = this.cur;
  }
}

class TurtleBreedGoal extends BreedGoal {
  constructor(private readonly t: Mob, speed: number) {
    super(t, speed);
  }
  override canUse(): boolean {
    return super.canUse() && !this.t.data['hasEgg'];
  }
}

/** Instead of a baby, one parent carries eggs back home (reference TurtleBreedGoal.breed). */
function turtleOffspring(m: Mob, partner: Mob): null {
  m.data['hasEgg'] = true;
  m.setMeta('hasEgg', true);
  setAge(partner, 6000);
  resetLove(partner);
  return null;
}

class TurtleLayEggGoal extends MoveToBlockGoal {
  private counter = 0;
  constructor(private readonly t: Mob, speed: number) {
    super(t, speed, 16);
  }
  override canUse(): boolean {
    return !!this.t.data['hasEgg'] && nearHome(this.t, 9) && super.canUse();
  }
  override canContinueToUse(): boolean {
    return super.canContinueToUse() && !!this.t.data['hasEgg'] && nearHome(this.t, 9);
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    const level = this.t.level;
    return blockHasTag(blockOf(level.getBlockState(x, y, z)), 'sand') && !!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR);
  }
  override tick(): void {
    super.tick();
    const t = this.t;
    if (!t.inWater && this.reachedTarget) {
      if (this.counter < 1) {
        t.setMeta('layingEgg', true);
      } else if (this.counter > this.adjustedTickDelay(200)) {
        const [x, y, z] = this.blockPos;
        t.level.playSound(x + 0.5, y + 1, z + 0.5, 'entity.turtle.lay_egg', 0.3, 0.9 + t.random.nextFloat() * 0.2);
        const state = setValue(getBlock('turtle_egg').defaultState, P.eggs, t.random.nextInt(4) + 1);
        t.level.setBlock(x, y + 1, z, state, 3);
        t.data['hasEgg'] = false;
        t.setMeta('hasEgg', false);
        t.setMeta('layingEgg', false);
        t.tmp['inLove'] = 600;
      }
      if (t.tmp['layingEgg'] !== false) this.counter++;
    }
  }
  override start(): void {
    super.start();
    this.counter = 0;
  }
  override stop(): void {
    this.t.setMeta('layingEgg', false);
  }
}

class TurtleGoToWaterGoal extends MoveToBlockGoal {
  constructor(private readonly t: Mob, speed: number) {
    super(t, speed, 24);
    this.verticalSearchStart = -1;
  }
  override canContinueToUse(): boolean {
    return !this.t.inWater && this.tryTicks <= 1200 && this.isValidTarget(...this.blockPos);
  }
  override canUse(): boolean {
    const t = this.t;
    if (t.isBaby && !t.inWater) return super.canUse();
    return !t.tmp['goingHome'] && !t.inWater && !t.data['hasEgg'] && super.canUse();
  }
  protected override nextStart(): number {
    return this.t.isBaby ? 0 : reducedTickDelay(200 + this.t.random.nextInt(200));
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    return !!(stateFlags[this.t.level.getBlockState(x, y, z)]! & F.WATER);
  }
  protected override moveTarget(): V3 {
    return [this.blockPos[0], this.blockPos[1], this.blockPos[2]];
  }
}

class TurtleGoHomeGoal extends Goal {
  private stuck = false;
  private closeToHome = 0;
  constructor(private readonly t: Mob, private readonly speed: number) {
    super();
  }
  canUse(): boolean {
    const t = this.t;
    if (t.isBaby) return false;
    if (t.data['hasEgg']) return true;
    if (t.random.nextInt(reducedTickDelay(700)) !== 0) return false;
    return !nearHome(t, 64);
  }
  override start(): void {
    this.t.tmp['goingHome'] = true;
    this.stuck = false;
    this.closeToHome = 0;
  }
  override stop(): void {
    this.t.tmp['goingHome'] = false;
  }
  override canContinueToUse(): boolean {
    return !nearHome(this.t, 7) && !this.stuck && this.closeToHome <= this.adjustedTickDelay(600);
  }
  override tick(): void {
    const t = this.t;
    const [hx, hy, hz] = home(t);
    const close = nearHome(t, 16);
    if (close) this.closeToHome++;
    if (!t.nav.isDone()) return;
    const target: V3 = [hx + 0.5, hy, hz + 0.5];
    let v = defaultPosTowards(t, 16, 3, target, Math.PI / 10);
    if (!v) v = defaultPosTowards(t, 8, 7, target, Math.PI / 2);
    if (v && !close && (stateFlags[t.level.getBlockState(Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]))]! & F.WATER) === 0) {
      v = defaultPosTowards(t, 16, 5, target, Math.PI / 2);
    }
    if (!v) {
      this.stuck = true;
      return;
    }
    t.nav.moveTo(v[0], v[1], v[2], this.speed);
  }
}

class TurtleTravelGoal extends Goal {
  private travelPos: V3 = [0, 0, 0];
  private stuck = false;
  constructor(private readonly t: Mob, private readonly speed: number) {
    super();
  }
  canUse(): boolean {
    const t = this.t;
    return !t.tmp['goingHome'] && !t.data['hasEgg'] && t.inWater;
  }
  override start(): void {
    const t = this.t, r = t.random;
    const k = r.nextInt(1025) - 512;
    let l = r.nextInt(9) - 4;
    const i1 = r.nextInt(1025) - 512;
    if (l + t.y > 62) l = 0;
    this.travelPos = [k + t.x, l + t.y, i1 + t.z];
    t.tmp['travelling'] = true;
    this.stuck = false;
  }
  override tick(): void {
    const t = this.t;
    if (!t.nav.isDone()) return;
    let v = defaultPosTowards(t, 16, 3, this.travelPos, Math.PI / 10) ?? defaultPosTowards(t, 8, 7, this.travelPos, Math.PI / 2);
    if (v && (!t.level.isLoaded(Math.floor(v[0]) - 34, Math.floor(v[2]) - 34) || !t.level.isLoaded(Math.floor(v[0]) + 34, Math.floor(v[2]) + 34))) v = null;
    if (!v) {
      this.stuck = true;
      return;
    }
    t.nav.moveTo(v[0], v[1], v[2], this.speed);
  }
  override canContinueToUse(): boolean {
    const t = this.t;
    return !t.nav.isDone() && !this.stuck && !t.tmp['goingHome'] && !isInLove(t) && !t.data['hasEgg'];
  }
  override stop(): void {
    this.t.tmp['travelling'] = false;
  }
}

class TurtlePanicGoal extends PanicGoal {
  private wanted: V3 | null = null;
  override canUse(): boolean {
    if (!PanicGoal.shouldPanic(this.m)) return false;
    this.wanted = nearestWater(this.m, 7, 1);
    if (this.wanted) return true;
    this.wanted = defaultRandomPos(this.m, 5, 4);
    return !!this.wanted;
  }
  override start(): void {
    const [x, y, z] = this.wanted!;
    this.m.nav.moveTo(x, y, z, 1.2);
    this.m.tmp['panicking'] = true;
  }
}

registerMob({
  id: 'turtle', attrs: { max_health: 30, movement_speed: 0.25 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  nav: 'amphibious', waterBreather: true, stepHeight: 1, food: items('seagrass'), ...sounds('turtle'),
  malus: { [PathType.WATER]: 0, [PathType.DOOR_IRON_CLOSED]: -1, [PathType.DOOR_WOOD_CLOSED]: -1, [PathType.DOOR_OPEN]: -1 },
  ambientFor(m) {
    return !m.inWater && m.onGround && !m.isBaby ? 'entity.turtle.ambient_land' : null;
  },
  setup(m) {
    m.move = new TurtleMoveControl(m);
    m.goals.add(0, new TurtlePanicGoal(m, 1.2));
    m.goals.add(1, new TurtleBreedGoal(m, 1));
    m.goals.add(1, new TurtleLayEggGoal(m, 1));
    m.goals.add(2, new TemptGoal(m, 1.1, items('seagrass'), false));
    m.goals.add(3, new TurtleGoToWaterGoal(m, 1));
    m.goals.add(4, new TurtleGoHomeGoal(m, 1));
    m.goals.add(7, new TurtleTravelGoal(m, 1));
    m.goals.add(8, new LookAtPlayerGoal(m, 10));
    m.goals.add(9, new (class extends RandomStrollGoal {
      override canUse(): boolean {
        return !m.inWater && !m.tmp['goingHome'] && !m.data['hasEgg'] && super.canUse();
      }
    })(m, 1, 100));
  },
  init(m, ctx) {
    m.data['home'] = (ctx.opts['home'] as V3 | undefined) ?? [Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)];
  },
  syncMeta(m) {
    m.setMeta('hasEgg', !!m.data['hasEgg']);
  },
  tick(m) {
    // Growing up sheds a scute
    const baby = m.isBaby;
    if (m.tmp['wasBaby'] === true && !baby && m.level.getGameRule('doMobLoot') !== false) {
      m.level.spawnItem(m.x, m.y + 0.2, m.z, new ItemStack('turtle_scute', 1));
    }
    m.tmp['wasBaby'] = baby;
  },
  offspring: turtleOffspring,
  canMate(m, other) {
    return canMateDefault(m, other) && !m.data['hasEgg'] && !other.data['hasEgg'];
  },
  onLightning(m) {
    m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('bowl', 1));
    return false;
  },
  walkTargetValue(m, x, y, z) {
    const [hx, hy, hz] = home(m);
    if (!m.tmp['goingHome'] && stateFlags[m.level.getBlockState(x, y, z)]! & F.WATER) return 10;
    if (blockHasTag(blockOf(m.level.getBlockState(x, y - 1, z)), 'sand')) return 10;
    return m.brightness(x, y, z) - 0.5 - ((x - hx) ** 2 + (y - hy) ** 2 + (z - hz) ** 2 > 4096 ? 1 : 0);
  },
  canSpawn(level, x, y, z) {
    return blockHasTag(blockOf(level.getBlockState(x, y - 1, z)), 'sand') && y < 67 && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

function canMateDefault(m: Mob, other: Mob): boolean {
  return other !== m && other.def === m.def && isInLove(m) && isInLove(other);
}

// =============================================================================================
// Polar bear
// =============================================================================================

class PolarBearMeleeGoal extends MeleeAttackGoal {
  protected override checkAndPerformAttack(t: Entity): void {
    const m = this.m;
    const reach = (m.width * 2) ** 2 + t.physics!.width;
    const d = m.distanceToSqr(t);
    if (d <= reach && this.ticksUntilAttack <= 0) {
      this.ticksUntilAttack = this.adjustedTickDelay(20);
      m.swing();
      m.level.hurtEntity(t, 'mob_attack', m.attr('attack_damage'), m.e);
      m.setMeta('standing', false);
    } else if (d <= reach * 2) {
      if (this.ticksUntilAttack <= 0) {
        m.setMeta('standing', false);
        this.ticksUntilAttack = this.adjustedTickDelay(20);
      }
      if (this.ticksUntilAttack <= 10) {
        if (!m.e.meta['standing']) m.playSound('entity.polar_bear.warning');
        m.setMeta('standing', true);
      }
    } else {
      this.ticksUntilAttack = this.adjustedTickDelay(20);
      m.setMeta('standing', false);
    }
  }
  override stop(): void {
    this.m.setMeta('standing', false);
    super.stop();
  }
}

const hasCubNearby = (m: Mob) => m.level.getEntities(m.box().inflate(8, 4, 8), (e) => e.type === 'polar_bear' && !!mobOf(e)?.isBaby).length > 0;

registerMob({
  id: 'polar_bear', attrs: { max_health: 30, follow_range: 20, movement_speed: 0.25, attack_damage: 6 }, ageable: true,
  xp: (m) => 1 + m.random.nextInt(3), food: () => false, ...sounds('polar_bear'),
  ambientFor(m) {
    return m.isBaby ? 'entity.polar_bear.ambient_baby' : 'entity.polar_bear.ambient';
  },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new PolarBearMeleeGoal(m, 1.25, true));
    m.goals.add(1, new (class extends PanicGoal {
      override canUse(): boolean {
        return (m.isBaby || m.e.physics.fireTicks > 0) && super.canUse();
      }
    })(m, 2));
    m.goals.add(4, new FollowParentGoal(m, 1.25));
    m.goals.add(5, new RandomStrollGoal(m, 1));
    m.goals.add(6, new LookAtPlayerGoal(m, 6));
    m.goals.add(7, new RandomLookAroundGoal(m));
    m.targets.add(1, new (class extends HurtByTargetGoal {
      override canUse(): boolean {
        return !m.isBaby && super.canUse();
      }
    })(m).setAlertOthers());
    m.targets.add(2, new (class extends NearestAttackableTargetGoal {
      override canUse(): boolean {
        return !m.isBaby && hasCubNearby(m) && super.canUse();
      }
    })(m, 'player', 20, true, true));
    m.targets.add(3, new NearestAttackableTargetGoal(m, 'player', 10, true, false, (e) => isAngryAt(m, e)));
    m.targets.add(4, new NearestAttackableTargetGoal(m, (e) => e.type === 'fox', 10, true, true));
  },
  init(m, ctx) {
    // First bear of a group is an adult, the rest are cubs
    if ((ctx.opts['groupIndex'] as number | undefined ?? 0) > 0) m.data['age'] = -24000;
  },
  tick: tickAnger,
  onHurt(m, _t, _a, attacker) {
    if (attacker?.player && !m.isBaby) startAnger(m, attacker);
  },
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z)).name;
    return (b === 'ice' || b === 'packed_ice' || b === 'snow_block' || b === 'snow' || b === 'grass_block') && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

// =============================================================================================
// Goat
// =============================================================================================

const GOAT_HORNS_NORMAL = ['ponder', 'sing', 'seek', 'feel'];
const GOAT_HORNS_SCREAMING = ['admire', 'call', 'yearn', 'dream'];
const HORN_BREAKERS = (n: string, s: number) => blockHasTag(blockOf(s), 'logs') || ['stone', 'packed_ice', 'iron_ore', 'copper_ore', 'emerald_ore', 'deepslate_iron_ore', 'deepslate_copper_ore', 'deepslate_emerald_ore'].includes(n);

const goatSound = (m: Mob, what: string) => `entity.goat.${m.data['screaming'] ? 'screaming.' : ''}${what}`;

function dropHorn(m: Mob): boolean {
  const left = m.data['leftHorn'] !== false, right = m.data['rightHorn'] !== false;
  if (!left && !right) return false;
  const side = !left ? 'rightHorn' : !right ? 'leftHorn' : m.random.nextBool() ? 'leftHorn' : 'rightHorn';
  m.data[side] = false;
  m.setMeta(side, false);
  const pool = m.data['screaming'] ? GOAT_HORNS_SCREAMING : GOAT_HORNS_NORMAL;
  const t = m.e.transform;
  const yaw = (t.yaw * Math.PI) / 180;
  const drop = m.level.spawnItem(m.x - Math.sin(yaw) * 0.6, m.y + m.height * 0.8, m.z + Math.cos(yaw) * 0.6, new ItemStack('goat_horn', 1, { instrument: pool[m.random.nextInt(pool.length)] }));
  if (drop?.physics) drop.physics.vy = 0.2;
  return true;
}

/** Lower the head, then charge at a target and knock it back (reference RamTarget). */
class GoatRamGoal extends Goal {
  private cooldown = 0;
  private phase: 'prepare' | 'charge' | null = null;
  private timer = 0;
  private target: Entity | null = null;
  private dir: [number, number] = [0, 0];
  constructor(private readonly g: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
    this.resetCooldown();
  }
  private resetCooldown(): void {
    this.cooldown = this.g.data['screaming'] ? 100 + this.g.random.nextInt(201) : 600 + this.g.random.nextInt(5401);
  }
  canUse(): boolean {
    const g = this.g;
    if (--this.cooldown > 0 || !g.onGround || g.isBaby || g.leashHolder || g.inWater) return false;
    const box = g.box().inflate(16, 4, 16);
    const list = g.level.getEntities(box, (e) => !!e.living && !e.living.dead && e.type !== 'goat' && e.type !== 'armor_stand' && (!e.player || attackablePlayer(e)));
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of list) {
      const d = g.distanceToSqr(e);
      if (d < 4 || d > 256 || !g.hasLineOfSight(e)) continue;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) {
      this.cooldown = 20;
      return false;
    }
    this.target = best;
    return true;
  }
  override start(): void {
    this.phase = 'prepare';
    this.timer = 20;
    this.g.nav.stop();
    this.g.setMeta('ramming', true);
    this.g.playSound(goatSound(this.g, 'prepare_ram'));
  }
  override canContinueToUse(): boolean {
    return this.phase !== null && !!this.target && !this.target.removed;
  }
  override stop(): void {
    this.phase = null;
    this.g.setMeta('ramming', false);
    this.resetCooldown();
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const g = this.g, t = this.target!;
    const tt = t.transform!;
    if (this.phase === 'prepare') {
      g.look.setLookAtEntity(t, 30, 30);
      if (--this.timer <= 0) {
        const dx = tt.x - g.x, dz = tt.z - g.z;
        const len = Math.hypot(dx, dz) || 1;
        this.dir = [dx / len, dz / len];
        this.phase = 'charge';
        this.timer = 60;
      }
      return;
    }
    // Charging in a straight line
    const e = g.e, tr = e.transform;
    tr.yaw = tr.bodyYaw = yawTo(this.dir[0], this.dir[1]);
    e.input.speed = g.speed * 3;
    e.input.forward = e.input.speed;
    if (--this.timer <= 0) {
      this.phase = null;
      return;
    }
    const hit = g.level.getEntities(g.box().inflate(0.3), (o) => !!o.living && o !== e && o.type !== 'goat')[0];
    if (hit) {
      const speed = Math.hypot(e.physics.vx, e.physics.vz);
      const f1 = Math.min(3, Math.max(0.2, speed * 1.65 * 20 * 0.05)) + 0.25;
      const blocked = !!hit['blocking'];
      if (hurt(g.level, hit, 'mob_attack_no_aggro', g.attr('attack_damage'), e)) {
        knockback(hit, (blocked ? 0.5 : 1) * f1 * 2.5, -this.dir[0], -this.dir[1]);
      }
      g.playSound(goatSound(g, 'ram_impact'));
      this.phase = null;
      return;
    }
    if (e.physics.horizontalCollision) {
      const fx = Math.floor(g.x + this.dir[0] * (g.width / 2 + 0.5)), fz = Math.floor(g.z + this.dir[1] * (g.width / 2 + 0.5));
      for (const y of [Math.floor(g.y), Math.floor(g.y) + 1]) {
        const s = g.level.getBlockState(fx, y, fz);
        if (HORN_BREAKERS(blockOf(s).name, s)) {
          if (dropHorn(g)) g.playSound(goatSound(g, 'horn_break'));
          break;
        }
      }
      g.playSound(goatSound(g, 'ram_impact'));
      this.phase = null;
    }
  }
}

registerMob({
  id: 'goat', attrs: { max_health: 10, movement_speed: 0.2, attack_damage: 2 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('wheat'), malus: { [PathType.POWDER_SNOW]: -1, [PathType.DANGER_POWDER_SNOW]: -1 },
  hurtSound: 'entity.goat.hurt', deathSound: 'entity.goat.death', stepSound: 'entity.goat.step',
  ambientFor: (m) => goatSound(m, 'ambient'),
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new PanicGoal(m, 2));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new GoatRamGoal(m));
    m.goals.add(4, new TemptGoal(m, 1.25, items('wheat'), false));
    m.goals.add(5, new LongJumpGoal(m, 600, 1200, 5, 5, 'entity.goat.long_jump'));
    m.goals.add(6, new FollowParentGoal(m, 1.25));
    m.goals.add(7, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(8, new LookAtPlayerGoal(m, 6));
    m.goals.add(9, new RandomLookAroundGoal(m));
  },
  init(m, ctx) {
    m.data['screaming'] = (ctx.opts['screaming'] as boolean | undefined) ?? m.random.nextFloat() < 0.02;
    // A few goats spawn without one of their horns
    if (m.random.nextFloat() < 0.1) m.data[m.random.nextBool() ? 'leftHorn' : 'rightHorn'] = false;
  },
  syncMeta(m) {
    m.setMeta('screaming', !!m.data['screaming']);
    m.setMeta('leftHorn', m.data['leftHorn'] !== false);
    m.setMeta('rightHorn', m.data['rightHorn'] !== false);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'bucket' && !m.isBaby) {
      m.playSound(goatSound(m, 'milk'));
      exchangeItem(p, hand, s, new ItemStack('milk_bucket', 1));
      return true;
    }
    return false;
  },
  offspring(m, partner) {
    return { type: 'goat', data: { screaming: m.random.nextFloat() < 0.02 || (!!m.data['screaming'] && !!partner.data['screaming'] && m.random.nextBool()) } };
  },
  hurtFilter(_m, type, amount) {
    // Goats shrug off ten blocks worth of falling
    return type === 'fall' ? Math.max(0, amount - 10) : amount;
  },
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z)).name;
    return ['stone', 'snow', 'snow_block', 'packed_ice', 'gravel', 'grass_block', 'powder_snow'].includes(b) && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

// =============================================================================================
// Bat
// =============================================================================================

function nearHalloween(): boolean {
  const d = new Date();
  const m = d.getMonth() + 1, day = d.getDate();
  return (m === 10 && day >= 20) || (m === 11 && day <= 3);
}

const conductorAbove = (m: Mob) => !!(stateFlags[m.level.getBlockState(Math.floor(m.x), Math.floor(m.y + m.height) + 0, Math.floor(m.z))]! & F.SOLID)
  || !!(stateFlags[m.level.getBlockState(Math.floor(m.x), Math.floor(m.y) + 1, Math.floor(m.z))]! & F.SOLID);

registerMob({
  id: 'bat', attrs: { max_health: 6 }, move: 'none', noFallDamage: true, xp: 0, loot: null, soundVolume: 0.1,
  hurtSound: 'entity.bat.hurt', deathSound: 'entity.bat.death',
  ambientFor(m) {
    return m.tmp['resting'] && m.random.nextInt(4) !== 0 ? null : 'entity.bat.ambient';
  },
  setup(m) {
    m.tmp['resting'] = false;
  },
  tick(m) {
    const p = m.e.physics, t = m.e.transform, level = m.level;
    if (m.tmp['resting']) {
      p.vx = p.vy = p.vz = 0;
      t.y = Math.floor(t.y) + 1 - m.height;
      if (conductorAbove(m)) {
        if (m.random.nextInt(200) === 0) t.headYaw = m.random.nextInt(360);
        const near = level.players.some((pl) => attackablePlayer(pl.entity) && m.distanceToSqr(pl.entity) < 16);
        if (near) {
          m.tmp['resting'] = false;
          m.setMeta('resting', false);
          level.levelEvent(1025, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), 0);
        }
      } else {
        m.tmp['resting'] = false;
        m.setMeta('resting', false);
        level.levelEvent(1025, Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), 0);
      }
      return;
    }
    p.vy *= 0.6;
    let tp = m.tmp['targetPos'] as V3 | undefined;
    if (tp && (!(stateFlags[level.getBlockState(tp[0], tp[1], tp[2])]! & F.AIR) || tp[1] <= level.minY)) tp = undefined;
    if (!tp || m.random.nextInt(30) === 0 || (tp[0] + 0.5 - m.x) ** 2 + (tp[1] + 0.5 - m.y) ** 2 + (tp[2] + 0.5 - m.z) ** 2 < 4) {
      tp = [Math.floor(m.x + m.random.nextInt(7) - m.random.nextInt(7)), Math.floor(m.y + m.random.nextInt(6) - 2), Math.floor(m.z + m.random.nextInt(7) - m.random.nextInt(7))];
    }
    m.tmp['targetPos'] = tp;
    const dx = tp[0] + 0.5 - m.x, dy = tp[1] + 0.1 - m.y, dz = tp[2] + 0.5 - m.z;
    p.vx += (Math.sign(dx) * 0.5 - p.vx) * 0.1;
    p.vy += (Math.sign(dy) * 0.7 - p.vy) * 0.1;
    p.vz += (Math.sign(dz) * 0.5 - p.vz) * 0.1;
    const f = yawTo(p.vx, p.vz);
    t.yaw += wrapDegrees(f - t.yaw);
    t.bodyYaw = t.headYaw = t.yaw;
    m.e.input.forward = 0.5;
    m.e.input.speed = 0;
    if (m.random.nextInt(100) === 0 && conductorAbove(m)) {
      m.tmp['resting'] = true;
      m.setMeta('resting', true);
    }
  },
  canSpawn(level, x, y, z, _reason, r) {
    if (y >= 63) return false;
    const light = level.getMaxLocalRawBrightness(x, y, z);
    const max = nearHalloween() ? 7 : 4;
    return light <= r.nextInt(max);
  },
  hurtFilter(m, _type, amount) {
    if (m.tmp['resting']) {
      m.tmp['resting'] = false;
      m.setMeta('resting', false);
    }
    return amount;
  },
});

// =============================================================================================
// Armadillo
// =============================================================================================

type ArmadilloState = 'idle' | 'rolling' | 'scared' | 'unrolling';
const armState = (m: Mob) => (m.tmp['armState'] as ArmadilloState | undefined) ?? 'idle';

function setArmState(m: Mob, s: ArmadilloState): void {
  m.tmp['armState'] = s;
  m.tmp['armStateTicks'] = 0;
  m.setMeta('state', s);
}

function scaresArmadillo(m: Mob, e: Entity): boolean {
  if (!e.living || e.living.dead || e === m.e) return false;
  if (e.player) return attackablePlayer(e) && (!!e.input?.sprinting || !!e['vehicle']);
  if (mobOf(e)?.def.undead) return true;
  return m.getLastHurtBy() === e;
}

function threatened(m: Mob): boolean {
  return m.level.getEntities(m.box().inflate(7, 2, 7), (e) => scaresArmadillo(m, e)).length > 0;
}

function rollUp(m: Mob): void {
  if (armState(m) === 'scared' || armState(m) === 'rolling') return;
  m.nav.stop();
  m.playSound('entity.armadillo.roll');
  setArmState(m, 'rolling');
}

registerMob({
  id: 'armadillo', attrs: { max_health: 12, movement_speed: 0.14 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('spider_eye'), ...sounds('armadillo'),
  ambientFor(m) {
    return armState(m) === 'idle' ? 'entity.armadillo.ambient' : null;
  },
  setup(m) {
    const idle = () => armState(m) === 'idle';
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new (class extends PanicGoal {
      override canUse(): boolean {
        return idle() && super.canUse();
      }
    })(m, 2));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new (class extends TemptGoal {
      override canUse(): boolean {
        return idle() && super.canUse();
      }
    })(m, 1.25, items('spider_eye'), false));
    m.goals.add(4, new FollowParentGoal(m, 1.25));
    m.goals.add(5, new (class extends RandomStrollGoal {
      override canUse(): boolean {
        return idle() && super.canUse();
      }
    })(m, 1));
    m.goals.add(6, new (class extends LookAtPlayerGoal {
      override canUse(): boolean {
        return idle() && super.canUse();
      }
    })(m, 6));
  },
  init(m) {
    m.data['scuteTime'] = 6000 + m.random.nextInt(6001);
  },
  tick(m) {
    const st = armState(m);
    const ticks = ((m.tmp['armStateTicks'] as number | undefined) ?? 0) + 1;
    m.tmp['armStateTicks'] = ticks;
    if (st !== 'idle') {
      m.nav.stop();
      m.e.input.forward = m.e.input.strafe = 0;
    }
    if (st === 'rolling' && ticks >= 10) setArmState(m, 'scared');
    else if (st === 'scared') {
      // Peek out after a while once nothing is around
      if (ticks > 60 && m.tickCount % 20 === 0 && !threatened(m)) {
        setArmState(m, 'unrolling');
        m.playSound('entity.armadillo.unroll_start');
      }
    } else if (st === 'unrolling' && ticks >= 30) {
      if (threatened(m)) setArmState(m, 'scared');
      else {
        setArmState(m, 'idle');
        m.playSound('entity.armadillo.unroll_finish');
      }
    } else if (st === 'idle' && m.tickCount % 5 === 0 && !m.isBaby && threatened(m)) rollUp(m);
    // Shedding scutes every five to ten minutes
    if (!m.isBaby) {
      const s = ((m.data['scuteTime'] as number | undefined) ?? 6000) - 1;
      m.data['scuteTime'] = s;
      if (s <= 0) {
        m.playSound('entity.armadillo.scute_drop');
        m.level.spawnItem(m.x, m.y + 0.2, m.z, new ItemStack('armadillo_scute', 1));
        m.data['scuteTime'] = 6000 + m.random.nextInt(6001);
      }
    }
  },
  hurtFilter(m, _type, amount) {
    return armState(m) === 'scared' || armState(m) === 'rolling' ? Math.max(0, (amount - 1) / 2) : amount;
  },
  onHurt(m, _t, _a, attacker) {
    if (attacker && !m.isBaby) rollUp(m);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'brush' && !m.isBaby) {
      m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('armadillo_scute', 1));
      m.playSound('entity.armadillo.brush');
      if (p.data.gameMode !== 'creative') damagePlayerSlot(m.level, p, hand === 'main' ? p.inventory.selected : 40, 16);
      return true;
    }
    return false;
  },
  syncMeta(m) {
    m.setMeta('state', armState(m));
  },
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z)).name;
    return ['grass_block', 'red_sand', 'coarse_dirt', 'sand', 'terracotta'].some((n) => b === n || b.endsWith('terracotta')) && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

// =============================================================================================
// Sniffer
// =============================================================================================

const SNIFFER_DIGGABLE = new Set(['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'rooted_dirt', 'moss_block', 'mud', 'muddy_mangrove_roots']);
type SnifferState = 'idle' | 'happy' | 'scenting' | 'sniffing' | 'searching' | 'digging' | 'rising';

function snifferState(m: Mob): SnifferState {
  return (m.tmp['sniffState'] as SnifferState | undefined) ?? 'idle';
}

function setSnifferState(m: Mob, s: SnifferState): void {
  m.tmp['sniffState'] = s;
  m.tmp['sniffTicks'] = 0;
  m.setMeta('state', s);
}

function canDigAt(m: Mob, x: number, y: number, z: number): boolean {
  const level = m.level;
  if (!SNIFFER_DIGGABLE.has(blockOf(level.getBlockState(x, y - 1, z)).name)) return false;
  if (!(stateFlags[level.getBlockState(x, y, z)]! & F.AIR)) return false;
  const explored = (m.data['explored'] as V3[] | undefined) ?? [];
  return !explored.some((p) => p[0] === x && p[1] === y && p[2] === z);
}

/** Sniff, walk to a fresh diggable block, dig up an ancient seed (reference sniffer brain). */
class SnifferSearchGoal extends Goal {
  private target: V3 | null = null;
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
  }
  canUse(): boolean {
    const s = this.s;
    if (s.isBaby || s.inWater || !s.onGround || s.e['passengers'] || s.leashHolder) return false;
    if (((s.data['digCooldown'] as number | undefined) ?? 0) > 0) return false;
    return s.random.nextInt(reducedTickDelay(40)) === 0;
  }
  override canContinueToUse(): boolean {
    return snifferState(this.s) !== 'idle';
  }
  override start(): void {
    setSnifferState(this.s, 'sniffing');
    this.s.nav.stop();
    this.s.playSound('entity.sniffer.sniffing');
    this.target = null;
  }
  override stop(): void {
    if (snifferState(this.s) !== 'idle') setSnifferState(this.s, 'idle');
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const s = this.s;
    const ticks = ((s.tmp['sniffTicks'] as number | undefined) ?? 0) + 1;
    s.tmp['sniffTicks'] = ticks;
    switch (snifferState(s)) {
      case 'sniffing':
        if (ticks >= 40) {
          this.target = this.findDigSpot();
          if (!this.target) {
            setSnifferState(s, 'idle');
            s.data['digCooldown'] = 200;
            return;
          }
          setSnifferState(s, 'searching');
          s.nav.moveTo(this.target[0] + 0.5, this.target[1], this.target[2] + 0.5, 1.25);
        }
        break;
      case 'searching': {
        const [x, , z] = this.target!;
        if ((s.x - x - 0.5) ** 2 + (s.z - z - 0.5) ** 2 < 1.5 || (s.nav.isDone() && ticks > 20)) {
          if (!canDigAt(s, Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))) {
            setSnifferState(s, 'idle');
            return;
          }
          setSnifferState(s, 'digging');
          s.nav.stop();
        } else if (ticks > 600) setSnifferState(s, 'idle');
        break;
      }
      case 'digging':
        if (ticks % 10 === 0) s.playSound('entity.sniffer.digging');
        if (ticks >= 120) {
          const x = Math.floor(s.x), y = Math.floor(s.y), z = Math.floor(s.z);
          const t = s.e.transform, yaw = (t.yaw * Math.PI) / 180;
          s.level.spawnItem(s.x - Math.sin(yaw) * 2.25, s.y + 0.2, s.z + Math.cos(yaw) * 2.25, new ItemStack(s.random.nextBool() ? 'torchflower_seeds' : 'pitcher_pod', 1));
          s.playSound('entity.sniffer.drop_seed');
          const explored = ((s.data['explored'] as V3[] | undefined) ?? []).concat([[x, y, z]]);
          s.data['explored'] = explored.slice(-20);
          setSnifferState(s, 'rising');
        }
        break;
      case 'rising':
        if (ticks >= 30) {
          setSnifferState(s, 'idle');
          s.data['digCooldown'] = 9600;
          s.playSound('entity.sniffer.happy');
        }
        break;
      default:
        break;
    }
  }
  private findDigSpot(): V3 | null {
    const s = this.s;
    const bx = Math.floor(s.x), by = Math.floor(s.y), bz = Math.floor(s.z);
    for (let i = 0; i < 16; i++) {
      const x = bx + s.random.nextInt(21) - 10, z = bz + s.random.nextInt(21) - 10;
      for (let dy = 3; dy >= -3; dy--) if (canDigAt(s, x, by + dy, z)) return [x, by + dy, z];
    }
    return null;
  }
}

registerMob({
  id: 'sniffer', attrs: { max_health: 14, movement_speed: 0.1 }, ageable: true, xp: (m) => 1 + m.random.nextInt(3),
  food: items('torchflower_seeds'), ...sounds('sniffer'), stepHeight: 1,
  ambientFor(m) {
    return snifferState(m) === 'idle' ? 'entity.sniffer.idle' : null;
  },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new PanicGoal(m, 2));
    m.goals.add(2, new BreedGoal(m, 1));
    m.goals.add(3, new TemptGoal(m, 1.25, items('torchflower_seeds'), false));
    m.goals.add(4, new SnifferSearchGoal(m));
    m.goals.add(5, new FollowParentGoal(m, 1.1));
    m.goals.add(6, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(7, new LookAtPlayerGoal(m, 6));
  },
  tick(m) {
    const c = (m.data['digCooldown'] as number | undefined) ?? 0;
    if (c > 0) m.data['digCooldown'] = c - 1;
  },
  offspring(m, partner) {
    // Sniffers lay an egg instead of giving birth
    const drop = m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack('sniffer_egg', 1));
    if (drop?.item) drop.item.pickupDelay = 10;
    m.playSound('block.sniffer_egg.plop');
    setAge(partner, 6000);
    resetLove(partner);
    return null;
  },
  syncMeta(m) {
    m.setMeta('state', snifferState(m));
  },
});
