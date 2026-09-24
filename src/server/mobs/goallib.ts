/**
 * Common goals (reference goal library): swimming, panic, breeding, tempting, following parents,
 * wandering, looking around, avoiding, eating grass, sun avoidance, melee combat, leaping,
 * targeting nearest enemies and retaliation.
 */
import type { Entity } from '../../common/entity/ecs';
import type { ItemStack } from '../../common/item/stack';
import { blockOf, stateFlags, F, getCollisionShape, getBlock } from '../../common/block/registry';
import { Goal, Flag, reducedTickDelay } from './goals';
import { Mob, mobOf } from './mob';
import type { Path } from './pathfinding';
import {
  defaultRandomPos, defaultPosAway, landRandomPos, hoverRandomPos, airAndWaterRandomPos, swimmablePos, nearestWater, Vec3,
} from './randompos';
import { canTarget, nearestPlayer, nearestEntity, withinMeleeRange, attackablePlayer, TargetOptions } from './targeting';
import { doHurtTarget, isInLove, canMate, breed, getAge } from './actions';

// ---------------------------------------------------------------------------------------------
// Movement and idle
// ---------------------------------------------------------------------------------------------

/** Swim upwards in water and lava. */
export class FloatGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.JUMP;
    m.nav.canFloat = true;
  }
  canUse(): boolean {
    const p = this.m.e.physics;
    const threshold = p.eyeHeight < 0.4 ? 0 : 0.4;
    return (p.inWater && p.waterHeight > threshold) || p.inLava;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    if (this.m.random.nextFloat() < 0.8) this.m.jump.jump();
  }
}

/** Run away when hurt, burning or freezing. */
export class PanicGoal extends Goal {
  private pos: Vec3 | null = null;
  constructor(protected readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  static shouldPanic(m: Mob): boolean {
    const hurtRecently = m.tickCount - ((m.tmp['lastHurtTick'] as number | undefined) ?? -1000) < 100 && m.tmp['lastHurtPanics'] === true;
    return hurtRecently || m.e.physics.frozenTicks > 0 && m.e.physics.inPowderSnow || m.e.physics.fireTicks > 0;
  }
  canUse(): boolean {
    if (!PanicGoal.shouldPanic(this.m)) return false;
    if (this.m.e.physics.fireTicks > 0 && getCollisionShape(this.m.level.getBlockState(Math.floor(this.m.x), Math.floor(this.m.y), Math.floor(this.m.z))).length === 0) {
      const w = nearestWater(this.m, 5, 1);
      if (w) {
        this.pos = w;
        return true;
      }
    }
    this.pos = defaultRandomPos(this.m, 5, 4);
    return this.pos !== null;
  }
  override start(): void {
    const [x, y, z] = this.pos!;
    this.m.nav.moveTo(x, y, z, this.speed);
    this.m.tmp['panicking'] = true;
  }
  override stop(): void {
    this.m.tmp['panicking'] = false;
  }
  override canContinueToUse(): boolean {
    return !this.m.nav.isDone();
  }
}

/** Wander to random positions (reference RandomStrollGoal / WaterAvoidingRandomStrollGoal). */
export class RandomStrollGoal extends Goal {
  protected wanted: Vec3 | null = null;
  forceTrigger = false;
  constructor(protected readonly m: Mob, protected readonly speed: number, protected interval = 120, private readonly checkNoAction = true, private readonly avoidWater = false) {
    super();
    this.flags = Flag.MOVE;
  }
  protected position(): Vec3 | null {
    if (this.avoidWater) {
      if (this.m.inWater) return landRandomPos(this.m, 15, 7) ?? defaultRandomPos(this.m, 10, 7);
      return this.m.random.nextFloat() >= 0.001 ? landRandomPos(this.m, 10, 7) : defaultRandomPos(this.m, 10, 7);
    }
    return defaultRandomPos(this.m, 10, 7);
  }
  canUse(): boolean {
    if (this.m.e['passengers']) return false;
    if (!this.forceTrigger) {
      if (this.checkNoAction && this.m.noActionTime >= 100) return false;
      if (this.m.random.nextInt(reducedTickDelay(this.interval)) !== 0) return false;
    }
    const v = this.position();
    if (!v) return false;
    this.wanted = v;
    this.forceTrigger = false;
    return true;
  }
  override canContinueToUse(): boolean {
    return !this.m.nav.isDone() && !this.m.e['passengers'];
  }
  override start(): void {
    const [x, y, z] = this.wanted!;
    this.m.nav.moveTo(x, y, z, this.speed);
  }
  override stop(): void {
    this.m.nav.stop();
  }
  trigger(): void {
    this.forceTrigger = true;
  }
}

/** Fish and squid: random swimmable positions. */
export class RandomSwimmingGoal extends RandomStrollGoal {
  constructor(m: Mob, speed: number, interval: number) {
    super(m, speed, interval, false);
  }
  protected override position(): Vec3 | null {
    return swimmablePos(this.m, 10, 7);
  }
}

/** Flyers: hover around in the direction they face (bees, parrots, allays). */
export class RandomFlyingGoal extends RandomStrollGoal {
  constructor(m: Mob, speed: number) {
    super(m, speed, 120, true);
  }
  protected override position(): Vec3 | null {
    const t = this.m.e.transform;
    const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
    const vx = -Math.sin(yaw) * Math.cos(pitch), vz = Math.cos(yaw) * Math.cos(pitch);
    if (this.m.inWater) return landRandomPos(this.m, 15, 15);
    return hoverRandomPos(this.m, 8, 7, vx, vz, Math.PI / 2, 3, 1) ?? airAndWaterRandomPos(this.m, 8, 4, -2, vx, vz, Math.PI / 2);
  }
}

/** Mobs stranded on land walk to the nearest water. */
export class TryFindWaterGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    return this.m.onGround && !(stateFlags[this.m.level.getBlockState(Math.floor(this.m.x), Math.floor(this.m.y), Math.floor(this.m.z))]! & F.WATER);
  }
  override start(): void {
    const w = nearestWater(this.m, 2, 1);
    if (w) this.m.nav.moveTo(w[0], w[1], w[2], 1);
  }
}

/** Look at a nearby player (or other entity) now and then. */
export class LookAtPlayerGoal extends Goal {
  private lookAt: Entity | null = null;
  private lookTime = 0;
  constructor(private readonly m: Mob, private readonly range: number, private readonly probability = 0.02, private readonly onlyHorizontal = false, private readonly filter?: (e: Entity) => boolean) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    if (this.m.random.nextFloat() >= this.probability) return false;
    const o: TargetOptions = { range: this.range, combat: false, lineOfSight: false, testInvisible: true };
    this.lookAt = this.m.getTarget();
    if (this.filter) this.lookAt = nearestEntity(this.m, this.range, 3, this.filter, o);
    else this.lookAt = nearestPlayer(this.m, o);
    return this.lookAt !== null;
  }
  override canContinueToUse(): boolean {
    const e = this.lookAt;
    if (!e || e.removed || e.living?.dead) return false;
    if (this.m.distanceToSqr(e) > this.range * this.range) return false;
    return this.lookTime > 0;
  }
  override start(): void {
    this.lookTime = this.adjustedTickDelay(40 + this.m.random.nextInt(40));
  }
  override stop(): void {
    this.lookAt = null;
  }
  override tick(): void {
    const e = this.lookAt;
    if (!e || e.removed) return;
    const t = e.transform!;
    const y = this.onlyHorizontal ? this.m.eyeY : t.y + (e.physics?.eyeHeight ?? 0);
    this.m.look.setLookAt(t.x, y, t.z);
    this.lookTime--;
  }
}

export class RandomLookAroundGoal extends Goal {
  private relX = 0;
  private relZ = 0;
  private lookTime = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return this.m.random.nextFloat() < 0.02;
  }
  override canContinueToUse(): boolean {
    return this.lookTime >= 0;
  }
  override start(): void {
    const a = Math.PI * 2 * this.m.random.nextDouble();
    this.relX = Math.cos(a);
    this.relZ = Math.sin(a);
    this.lookTime = this.adjustedTickDelay(20 + this.m.random.nextInt(20));
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    this.lookTime--;
    this.m.look.setLookAt(this.m.x + this.relX, this.m.eyeY, this.m.z + this.relZ);
  }
}

// ---------------------------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------------------------

export class BreedGoal extends Goal {
  private partner: Mob | null = null;
  private loveTime = 0;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    if (!isInLove(this.m)) return false;
    this.partner = this.freePartner();
    return this.partner !== null;
  }
  override canContinueToUse(): boolean {
    const p = this.partner;
    return !!p && p.alive && isInLove(p) && this.loveTime < 60 && !p.tmp['panicking'];
  }
  override stop(): void {
    this.partner = null;
    this.loveTime = 0;
  }
  override tick(): void {
    const p = this.partner!;
    this.m.look.setLookAtEntity(p.e, 10, 40);
    this.m.nav.moveToEntity(p.e, this.speed);
    this.loveTime++;
    if (this.loveTime >= this.adjustedTickDelay(60) && this.m.distanceToSqr(p.e) < 9) breed(this.m, p);
  }
  private freePartner(): Mob | null {
    let best: Mob | null = null;
    let bd = Infinity;
    for (const e of this.m.level.getEntities(this.m.box().inflate(8), (e) => !!mobOf(e), this.m.e)) {
      const o = mobOf(e)!;
      if (!o.alive || !canMate(this.m, o) || o.tmp['panicking']) continue;
      const d = this.m.distanceToSqr(e);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
}

/** Follow players holding a tempting item (reference TemptGoal). */
export class TemptGoal extends Goal {
  private player: Entity | null = null;
  private calmDown = 0;
  private px = 0; private py = 0; private pz = 0; private pPitch = 0; private pYaw = 0;
  running = false;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly items: (s: ItemStack) => boolean, private readonly canScare: boolean) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  private holds(e: Entity): boolean {
    const inv = e.player?.inventory;
    return !!inv && (this.items(inv.mainHand) || this.items(inv.get(40)));
  }
  canUse(): boolean {
    if (this.calmDown > 0) {
      this.calmDown--;
      return false;
    }
    this.player = nearestPlayer(this.m, { range: this.m.attr('tempt_range'), combat: false, lineOfSight: false, testInvisible: true, selector: (e) => this.holds(e) });
    return this.player !== null;
  }
  override canContinueToUse(): boolean {
    const p = this.player;
    if (this.canScare && p) {
      const t = p.transform!;
      if (this.m.distanceToSqr(p) < 36) {
        if ((t.x - this.px) ** 2 + (t.y - this.py) ** 2 + (t.z - this.pz) ** 2 > 0.010000000000000002) return false;
        if (Math.abs(t.pitch - this.pPitch) > 5 || Math.abs(t.yaw - this.pYaw) > 5) return false;
      } else {
        this.px = t.x; this.py = t.y; this.pz = t.z;
      }
      this.pPitch = t.pitch;
      this.pYaw = t.yaw;
    }
    return this.canUse();
  }
  override start(): void {
    const t = this.player!.transform!;
    this.px = t.x; this.py = t.y; this.pz = t.z;
    this.running = true;
  }
  override stop(): void {
    this.player = null;
    this.m.nav.stop();
    this.calmDown = reducedTickDelay(100);
    this.running = false;
  }
  override tick(): void {
    const p = this.player!;
    this.m.look.setLookAtEntity(p, 95, 40);
    if (this.m.distanceToSqr(p) < 6.25) this.m.nav.stop();
    else this.m.nav.moveToEntity(p, this.speed);
  }
}

export class FollowParentGoal extends Goal {
  private parent: Mob | null = null;
  private recalc = 0;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
  }
  canUse(): boolean {
    if (getAge(this.m) >= 0) return false;
    let best: Mob | null = null;
    let bd = Infinity;
    for (const e of this.m.level.getEntities(this.m.box().inflate(8, 4, 8), (e) => mobOf(e)?.def === this.m.def, this.m.e)) {
      const o = mobOf(e)!;
      if (getAge(o) < 0) continue;
      const d = this.m.distanceToSqr(e);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    if (!best || bd < 9) return false;
    this.parent = best;
    return true;
  }
  override canContinueToUse(): boolean {
    if (getAge(this.m) >= 0 || !this.parent?.alive) return false;
    const d = this.m.distanceToSqr(this.parent.e);
    return d >= 9 && d <= 256;
  }
  override start(): void {
    this.recalc = 0;
  }
  override stop(): void {
    this.parent = null;
  }
  override tick(): void {
    if (--this.recalc <= 0) {
      this.recalc = this.adjustedTickDelay(10);
      this.m.nav.moveToEntity(this.parent!.e, this.speed);
    }
  }
}

/** Sheep graze grass (reference EatBlockGoal). */
export class EatBlockGoal extends Goal {
  eatTick = 0;
  constructor(private readonly m: Mob, private readonly onAte: (m: Mob) => void) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
  }
  canUse(): boolean {
    if (this.m.random.nextInt(this.m.isBaby ? 50 : 1000) !== 0) return false;
    const x = Math.floor(this.m.x), y = Math.floor(this.m.y), z = Math.floor(this.m.z);
    if (blockOf(this.m.level.getBlockState(x, y, z)).name === 'short_grass') return true;
    return blockOf(this.m.level.getBlockState(x, y - 1, z)).name === 'grass_block';
  }
  override start(): void {
    this.eatTick = this.adjustedTickDelay(40);
    this.m.broadcastEvent('eatGrass');
    this.m.nav.stop();
  }
  override stop(): void {
    this.eatTick = 0;
  }
  override canContinueToUse(): boolean {
    return this.eatTick > 0;
  }
  override tick(): void {
    this.eatTick = Math.max(0, this.eatTick - 1);
    if (this.eatTick !== this.adjustedTickDelay(4)) return;
    const level = this.m.level;
    const x = Math.floor(this.m.x), y = Math.floor(this.m.y), z = Math.floor(this.m.z);
    const griefing = level.getGameRule('mobGriefing') !== false;
    if (blockOf(level.getBlockState(x, y, z)).name === 'short_grass') {
      if (griefing) level.destroyBlock(x, y, z, false);
      this.onAte(this.m);
      return;
    }
    const below = level.getBlockState(x, y - 1, z);
    if (blockOf(below).name === 'grass_block') {
      if (griefing) {
        level.levelEvent(2001, x, y - 1, z, below);
        level.setBlock(x, y - 1, z, getBlock('dirt')!.defaultState, 2);
      }
      this.onAte(this.m);
    }
  }
}

/** Flee from nearby entities matching a filter (creepers from cats, skeletons from wolves…). */
export class AvoidEntityGoal extends Goal {
  private toAvoid: Entity | null = null;
  private path: Path | null = null;
  constructor(private readonly m: Mob, private readonly filter: (e: Entity) => boolean, private readonly maxDist: number, private readonly walkSpeed: number, private readonly sprintSpeed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    this.toAvoid = nearestEntity(this.m, this.maxDist, 3, this.filter, { range: this.maxDist, combat: false, lineOfSight: true, testInvisible: true });
    if (!this.toAvoid) return false;
    const t = this.toAvoid.transform!;
    const v = defaultPosAway(this.m, 16, 7, [t.x, t.y, t.z]);
    if (!v) return false;
    if ((t.x - v[0]) ** 2 + (t.y - v[1]) ** 2 + (t.z - v[2]) ** 2 < this.m.distanceToSqr(this.toAvoid)) return false;
    this.path = this.m.nav.createPathTo(v[0], v[1], v[2], 0);
    return this.path !== null;
  }
  override canContinueToUse(): boolean {
    return !this.m.nav.isDone();
  }
  override start(): void {
    this.m.nav.moveAlong(this.path, this.walkSpeed);
  }
  override stop(): void {
    this.toAvoid = null;
  }
  override tick(): void {
    if (!this.toAvoid) return;
    this.m.nav.setSpeedModifier(this.m.distanceToSqr(this.toAvoid) < 49 ? this.sprintSpeed : this.walkSpeed);
  }
}

// ---------------------------------------------------------------------------------------------
// Sunlight (undead)
// ---------------------------------------------------------------------------------------------

function headEmpty(m: Mob): boolean {
  return m.equipment[5]!.isEmpty();
}

export class RestrictSunGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    return this.m.level.isDay() && headEmpty(this.m) && this.m.def.nav !== 'fly';
  }
  override start(): void {
    this.m.nav.avoidSun = true;
  }
  override stop(): void {
    this.m.nav.avoidSun = false;
  }
}

export class FleeSunGoal extends Goal {
  private wanted: Vec3 | null = null;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (m.getTarget() || !m.level.isDay() || m.e.physics.fireTicks <= 0) return false;
    if (!m.level.canSeeSky(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)) || !headEmpty(m)) return false;
    const r = m.random;
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    for (let i = 0; i < 10; i++) {
      const x = bx + r.nextInt(20) - 10, y = by + r.nextInt(6) - 3, z = bz + r.nextInt(20) - 10;
      if (!m.level.canSeeSky(x, y, z) && m.walkTargetValue(x, y, z) < 0) {
        this.wanted = [x + 0.5, y, z + 0.5];
        return true;
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return !this.m.nav.isDone();
  }
  override start(): void {
    const [x, y, z] = this.wanted!;
    this.m.nav.moveTo(x, y, z, this.speed);
  }
}

// ---------------------------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------------------------

export class MeleeAttackGoal extends Goal {
  protected path: Path | null = null;
  private ptx = 0; private pty = 0; private ptz = 0;
  private recalc = 0;
  protected ticksUntilAttack = 0;
  private lastCanUse = -100;
  constructor(protected readonly m: Mob, protected readonly speed: number, private readonly followUnseen: boolean) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const now = this.m.gameTime;
    if (now - this.lastCanUse < 20) return false;
    this.lastCanUse = now;
    const t = this.m.getTarget();
    if (!t) return false;
    this.path = this.m.nav.createPathToEntity(t, 0);
    if (this.path) return true;
    return withinMeleeRange(this.m, t);
  }
  override canContinueToUse(): boolean {
    const t = this.m.getTarget();
    if (!t) return false;
    if (!this.followUnseen) return !this.m.nav.isDone();
    const tt = t.transform!;
    if (!this.m.isWithinRestriction(Math.floor(tt.x), Math.floor(tt.y), Math.floor(tt.z))) return false;
    return attackablePlayer(t);
  }
  override start(): void {
    this.m.nav.moveAlong(this.path, this.speed);
    this.m.aggressive = true;
    this.m.setMeta('aggressive', true);
    this.recalc = 0;
    this.ticksUntilAttack = 0;
  }
  override stop(): void {
    const t = this.m.getTarget();
    if (t && !attackablePlayer(t)) this.m.setTarget(null);
    this.m.aggressive = false;
    this.m.setMeta('aggressive', false);
    this.m.nav.stop();
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const t = this.m.getTarget();
    if (!t) return;
    const tt = t.transform!;
    this.m.look.setLookAtEntity(t, 30, 30);
    this.recalc = Math.max(this.recalc - 1, 0);
    if ((this.followUnseen || this.m.hasLineOfSight(t)) && this.recalc <= 0
      && ((this.ptx === 0 && this.pty === 0 && this.ptz === 0) || (tt.x - this.ptx) ** 2 + (tt.y - this.pty) ** 2 + (tt.z - this.ptz) ** 2 >= 1 || this.m.random.nextFloat() < 0.05)) {
      this.ptx = tt.x; this.pty = tt.y; this.ptz = tt.z;
      this.recalc = 4 + this.m.random.nextInt(7);
      const d = this.m.distanceToSqr(t);
      if (d > 1024) this.recalc += 10;
      else if (d > 256) this.recalc += 5;
      if (!this.m.nav.moveToEntity(t, this.speed)) this.recalc += 15;
      this.recalc = this.adjustedTickDelay(this.recalc);
    }
    this.ticksUntilAttack = Math.max(this.ticksUntilAttack - 1, 0);
    this.checkAndPerformAttack(t);
  }
  protected checkAndPerformAttack(t: Entity): void {
    if (this.ticksUntilAttack <= 0 && withinMeleeRange(this.m, t) && this.m.hasLineOfSight(t)) {
      this.ticksUntilAttack = this.adjustedTickDelay(20);
      this.m.swing();
      doHurtTarget(this.m, t);
    }
  }
}

/** Pounce at the target from 2–4 blocks away (spiders, ocelots, wolves). */
export class LeapAtTargetGoal extends Goal {
  private target: Entity | null = null;
  constructor(private readonly m: Mob, private readonly yd: number) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    if (this.m.e['passengers']) return false;
    this.target = this.m.getTarget();
    if (!this.target) return false;
    const d = this.m.distanceToSqr(this.target);
    if (d < 4 || d > 16 || !this.m.onGround) return false;
    return this.m.random.nextInt(reducedTickDelay(5)) === 0;
  }
  override canContinueToUse(): boolean {
    return !this.m.onGround;
  }
  override start(): void {
    const p = this.m.e.physics, t = this.target!.transform!;
    let vx = t.x - this.m.x, vz = t.z - this.m.z;
    const len = Math.sqrt(vx * vx + vz * vz);
    if (len * len > 1e-7) {
      vx = (vx / len) * 0.4 + p.vx * 0.2;
      vz = (vz / len) * 0.4 + p.vz * 0.2;
    }
    p.vx = vx;
    p.vy = this.yd;
    p.vz = vz;
  }
}

// ---------------------------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------------------------

abstract class TargetGoal extends Goal {
  protected targetMob: Entity | null = null;
  private unseenTicks = 0;
  protected unseenMemoryTicks = 60;
  private reachCache = 0;
  private reachCacheTime = 0;
  constructor(protected readonly m: Mob, protected readonly mustSee: boolean, protected readonly mustReach = false) {
    super();
    this.flags = Flag.TARGET;
  }
  protected followDistance(): number {
    return this.m.attr('follow_range');
  }
  override canContinueToUse(): boolean {
    const t = this.m.getTarget() ?? this.targetMob;
    if (!t || t.removed || t.living?.dead) return false;
    if (!attackablePlayer(t) && t.player) return false;
    const d = this.followDistance();
    if (this.m.distanceToSqr(t) > d * d) return false;
    if (this.mustSee) {
      if (this.m.hasLineOfSight(t)) this.unseenTicks = 0;
      else if (++this.unseenTicks > reducedTickDelay(this.unseenMemoryTicks)) return false;
    }
    this.m.setTarget(t);
    return true;
  }
  override start(): void {
    this.reachCache = 0;
    this.reachCacheTime = 0;
    this.unseenTicks = 0;
  }
  override stop(): void {
    this.m.setTarget(null);
    this.targetMob = null;
  }
  protected canAttack(target: Entity | null, o: TargetOptions): boolean {
    if (!target || !canTarget(this.m, target, o)) return false;
    const t = target.transform!;
    if (!this.m.isWithinRestriction(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))) return false;
    if (this.mustReach) {
      if (--this.reachCacheTime <= 0) this.reachCache = 0;
      if (this.reachCache === 0) this.reachCache = this.canReach(target) ? 1 : 2;
      if (this.reachCache === 2) return false;
    }
    return true;
  }
  private canReach(target: Entity): boolean {
    this.reachCacheTime = reducedTickDelay(10 + this.m.random.nextInt(5));
    const path = this.m.nav.createPathToEntity(target, 0);
    const end = path?.end;
    if (!end) return false;
    const t = target.transform!;
    const i = end.x - Math.floor(t.x), j = end.z - Math.floor(t.z);
    return i * i + j * j <= 2.25;
  }
}

/** Target the nearest player (or entity matching a filter). */
export class NearestAttackableTargetGoal extends TargetGoal {
  private target: Entity | null = null;
  private readonly randomInterval: number;
  constructor(m: Mob, private readonly kind: 'player' | ((e: Entity) => boolean), randomInterval = 10, mustSee = true, mustReach = false, private readonly selector?: (e: Entity) => boolean) {
    super(m, mustSee, mustReach);
    this.randomInterval = reducedTickDelay(randomInterval);
  }
  private options(): TargetOptions {
    return { range: this.followDistance(), combat: true, lineOfSight: this.mustSee, testInvisible: true, selector: this.selector };
  }
  canUse(): boolean {
    if (this.randomInterval > 0 && this.m.random.nextInt(this.randomInterval) !== 0) return false;
    this.findTarget();
    return this.target !== null;
  }
  protected findTarget(): void {
    const o = this.options();
    if (this.kind === 'player') {
      const p = nearestPlayer(this.m, o);
      this.target = p && this.canAttack(p, o) ? p : null;
    } else {
      const d = this.followDistance();
      const e = nearestEntity(this.m, d, 4, this.kind, o);
      this.target = e && this.canAttack(e, o) ? e : null;
    }
  }
  override start(): void {
    this.m.setTarget(this.target);
    super.start();
  }
}

/** Retaliate against the last attacker, optionally alerting mobs of the same kind. */
export class HurtByTargetGoal extends TargetGoal {
  private timestamp = -1;
  private alertSameType = false;
  private ignore: string[] = [];
  constructor(m: Mob, ...ignore: string[]) {
    super(m, true);
    this.ignore = ignore;
  }
  setAlertOthers(): this {
    this.alertSameType = true;
    return this;
  }
  canUse(): boolean {
    const e = this.m.getLastHurtBy();
    if (this.m.lastHurtByTime === this.timestamp || !e) return false;
    if (e.player && this.m.level.getGameRule('universalAnger') === true) return false;
    if (this.ignore.includes(e.type)) return false;
    return this.canAttack(e, { range: 0, combat: true, lineOfSight: false, testInvisible: false });
  }
  override start(): void {
    this.m.setTarget(this.m.getLastHurtBy());
    this.targetMob = this.m.getTarget();
    this.timestamp = this.m.lastHurtByTime;
    this.unseenMemoryTicks = 300;
    if (this.alertSameType) this.alertOthers();
    super.start();
  }
  private alertOthers(): void {
    const d = this.followDistance();
    const attacker = this.m.getLastHurtBy();
    if (!attacker) return;
    const box = this.m.box().inflate(d, 10, d);
    for (const e of this.m.level.getEntities(box, (e) => mobOf(e)?.def === this.m.def, this.m.e)) {
      const o = mobOf(e)!;
      if (o.getTarget() || o.data['owner'] !== this.m.data['owner']) continue;
      if (this.ignore.includes(attacker.type)) continue;
      o.setTarget(attacker);
    }
  }
}

/** Anger bookkeeping for neutral mobs (wolves, bees, golems, pigmen…). */
export function isAngryAt(m: Mob, e: Entity): boolean {
  if (((m.data['anger'] as number | undefined) ?? 0) <= 0) return false;
  return m.tmp['angerTarget'] === e.id || (!!e.player && m.level.getGameRule('universalAnger') === true);
}

export function startAnger(m: Mob, target: Entity | null, minSeconds = 20, maxSeconds = 39): void {
  m.data['anger'] = (minSeconds + m.random.nextInt(maxSeconds - minSeconds + 1)) * 20;
  m.tmp['angerTarget'] = target?.id ?? 0;
  m.setMeta('angry', true);
}

export function tickAnger(m: Mob): void {
  const a = (m.data['anger'] as number | undefined) ?? 0;
  if (a <= 0) return;
  const t = m.getTarget();
  if (t && t.player && m.distanceToSqr(t) <= 64 && m.tmp['angerTarget'] === t.id) return;
  m.data['anger'] = a - 1;
  if (a - 1 <= 0) {
    m.tmp['angerTarget'] = 0;
    m.setMeta('angry', false);
    if (m.getTarget() && !m.getTarget()!.living?.dead) m.setTarget(null);
  }
}

/** Target the entity the mob is angry at (reference NearestAttackableTargetGoal with isAngryAt). */
export class AngerTargetGoal extends NearestAttackableTargetGoal {
  constructor(m: Mob) {
    super(m, 'player', 10, true, false, (e) => isAngryAt(m, e));
  }
}

/** Walk to a block matching a predicate (reference MoveToBlockGoal with its spiral search). */
export abstract class MoveToBlockGoal extends Goal {
  protected nextStartTick = 0;
  protected tryTicks = 0;
  private maxStayTicks = 0;
  blockPos: Vec3 = [0, 0, 0];
  reachedTarget = false;
  protected verticalSearchStart = 0;
  constructor(protected readonly m: Mob, protected readonly speed: number, protected readonly searchRange: number, protected readonly verticalRange = 1) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP;
  }
  protected abstract isValidTarget(x: number, y: number, z: number): boolean;
  protected nextStart(): number {
    return reducedTickDelay(200 + this.m.random.nextInt(200));
  }
  canUse(): boolean {
    if (this.nextStartTick > 0) {
      this.nextStartTick--;
      return false;
    }
    this.nextStartTick = this.nextStart();
    return this.findNearestBlock();
  }
  override canContinueToUse(): boolean {
    return this.tryTicks >= -this.maxStayTicks && this.tryTicks <= 1200 && this.isValidTarget(...this.blockPos);
  }
  override start(): void {
    this.moveMobToBlock();
    this.tryTicks = 0;
    this.maxStayTicks = this.m.random.nextInt(this.m.random.nextInt(1200) + 1200) + 1200;
  }
  protected moveMobToBlock(): void {
    const [x, y, z] = this.moveTarget();
    this.m.nav.moveTo(x + 0.5, y, z + 0.5, this.speed);
  }
  protected acceptedDistance(): number {
    return 1;
  }
  /** Where the mob stands (default: on top of the block). */
  protected moveTarget(): Vec3 {
    return [this.blockPos[0], this.blockPos[1] + 1, this.blockPos[2]];
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const [x, y, z] = this.moveTarget();
    const d = (this.m.x - x - 0.5) ** 2 + (this.m.y - y - 0.5) ** 2 + (this.m.z - z - 0.5) ** 2;
    const a = this.acceptedDistance();
    if (d > a * a) {
      this.reachedTarget = false;
      this.tryTicks++;
      if (this.tryTicks % 40 === 0) this.m.nav.moveTo(x + 0.5, y, z + 0.5, this.speed);
    } else {
      this.reachedTarget = true;
      this.tryTicks--;
    }
  }
  protected findNearestBlock(): boolean {
    const bx = Math.floor(this.m.x), by = Math.floor(this.m.y), bz = Math.floor(this.m.z);
    const r = this.searchRange, v = this.verticalRange;
    for (let k = this.verticalSearchStart; k <= v; k = k > 0 ? -k : 1 - k) {
      for (let l = 0; l < r; l++) {
        for (let i = 0; i <= l; i = i > 0 ? -i : 1 - i) {
          for (let j = i < l && i > -l ? l : 0; j <= l; j = j > 0 ? -j : 1 - j) {
            const x = bx + i, y = by + k - 1, z = bz + j;
            if (this.m.isWithinRestriction(x, y, z) && this.isValidTarget(x, y, z)) {
              this.blockPos = [x, y, z];
              return true;
            }
          }
        }
      }
    }
    return false;
  }
}
