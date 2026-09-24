/**
 * Foxes: nocturnal hunters that sleep in the shade by day, stalk and pounce on chickens and
 * rabbits (faceplanting into snow), carry one item in their mouth (eating food after a while),
 * pick sweet berries, flee untrusted players and defend players who bred them.
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { getItem } from '../../../common/item/items';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, getValue, setValue, tryGetValue, stateFlags, F, getCollisionShape } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { addEffect } from '../../survival/living';
import { registerMob, Mob, mobOf } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import {
  FloatGoal, PanicGoal, BreedGoal, FollowParentGoal, RandomStrollGoal, LookAtPlayerGoal, AvoidEntityGoal, LeapAtTargetGoal,
  MeleeAttackGoal, NearestAttackableTargetGoal,
} from '../goallib';
import { babyTurtleOnLand } from './pets';
import { items, sounds } from './common';

const isSleeping = (m: Mob) => !!m.tmp['sleeping'];
const isSitting = (m: Mob) => !!m.tmp['sitting'];
const isCrouching = (m: Mob) => !!m.tmp['crouching'];
const isInterested = (m: Mob) => !!m.tmp['interested'];
const isPouncing = (m: Mob) => !!m.tmp['pouncing'];
const isFaceplanted = (m: Mob) => !!m.tmp['faceplanted'];
const isDefending = (m: Mob) => !!m.tmp['defending'];

function setFlag(m: Mob, flag: 'sleeping' | 'sitting' | 'crouching' | 'interested' | 'pouncing' | 'faceplanted' | 'defending', v: boolean): void {
  m.tmp[flag] = v;
  if (flag !== 'defending') m.setMeta(flag, v);
  if (flag === 'crouching' && !v) m.tmp['crouchAmount'] = 0;
}

function trusted(m: Mob): string[] {
  return (m.data['trusted'] as string[] | undefined) ?? [];
}

function trusts(m: Mob, e: Entity): boolean {
  return !!e.player && trusted(m).includes(e.player.name);
}

const STALKABLE = (e: Entity) => e.type === 'chicken' || e.type === 'rabbit';
const mouth = (m: Mob) => m.equipment[0]!;
const edible = (s: ItemStack) => !!getItem(s.id)?.food;

function wakeUp(m: Mob): void {
  setFlag(m, 'sleeping', false);
}

function clearStates(m: Mob): void {
  setFlag(m, 'interested', false);
  setFlag(m, 'crouching', false);
  setFlag(m, 'sitting', false);
  setFlag(m, 'sleeping', false);
  setFlag(m, 'defending', false);
  setFlag(m, 'faceplanted', false);
}

function canMove(m: Mob): boolean {
  return !isSleeping(m) && !isSitting(m) && !isFaceplanted(m);
}

/** Nothing solid between the fox and its prey for a pounce (reference Fox.isPathClear). */
function isPathClear(m: Mob, target: Entity): boolean {
  const t = target.transform!;
  const dz = t.z - m.z, dx = t.x - m.x;
  const ratio = dz / dx;
  for (let j = 0; j < 6; j++) {
    const oz = ratio === 0 ? 0 : dz * (j / 6);
    const ox = ratio === 0 ? dx * (j / 6) : oz / ratio;
    for (let k = 1; k < 4; k++) {
      const s = m.level.getBlockState(Math.floor(m.x + ox), Math.floor(m.y + k), Math.floor(m.z + oz));
      if (getCollisionShape(s).length && !(stateFlags[s]! & F.REPLACEABLE)) return false;
    }
  }
  return true;
}

/** A hostile mob or an untrusted, non-sneaking player nearby keeps a fox awake. */
function alertable(m: Mob): boolean {
  const box = m.box().inflate(12, 6, 12);
  return m.level.getEntities(box, (e) => {
    if (!e.living || e.living.dead || e === m.e) return false;
    if (e.player) return !trusts(m, e) && !e.input?.sneaking && e.player.gameMode !== 'spectator' && e.player.gameMode !== 'creative';
    return !!e['hostile'] || (e.type === 'wolf' && !mobOf(e)?.data['tamed']);
  }).some((e) => m.hasLineOfSight(e));
}

// ---- Goals -----------------------------------------------------------------------------------

class FoxPanicGoal extends PanicGoal {
  override canUse(): boolean {
    return !isDefending(this.m) && super.canUse();
  }
}

class StalkPreyGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const m = this.m;
    if (isSleeping(m)) return false;
    const t = m.getTarget();
    return !!t && !t.living?.dead && STALKABLE(t) && m.distanceToSqr(t) > 36 && !isCrouching(m) && !isInterested(m) && !m.e.input.jumping;
  }
  override start(): void {
    setFlag(this.m, 'sitting', false);
    setFlag(this.m, 'faceplanted', false);
  }
  override stop(): void {
    const t = this.m.getTarget();
    if (t && isPathClear(this.m, t)) {
      setFlag(this.m, 'interested', true);
      setFlag(this.m, 'crouching', true);
      this.m.nav.stop();
      this.m.look.setLookAtEntity(t, 10, 40);
    } else {
      setFlag(this.m, 'interested', false);
      setFlag(this.m, 'crouching', false);
    }
  }
  override tick(): void {
    const t = this.m.getTarget();
    if (!t) return;
    this.m.look.setLookAtEntity(t, 10, 40);
    if (this.m.distanceToSqr(t) <= 36) {
      setFlag(this.m, 'interested', true);
      setFlag(this.m, 'crouching', true);
      this.m.nav.stop();
    } else this.m.nav.moveToEntity(t, 1.5);
  }
}

class FoxPounceGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (!isCrouching(m) || ((m.tmp['crouchAmount'] as number | undefined) ?? 0) < 3) return false;
    const t = m.getTarget();
    if (!t || t.living?.dead) return false;
    // Pounce only while the prey is not running away (reference motion direction check)
    const tp = t.physics;
    if (tp && tp.vx * tp.vx + tp.vz * tp.vz > 0.0025) {
      const tt = t.transform!;
      const moveYaw = (Math.atan2(tp.vz, tp.vx) * 180) / Math.PI - 90;
      const d = Math.abs(((moveYaw - tt.yaw) % 360 + 540) % 360 - 180);
      if (d > 45) return false;
    }
    const clear = isPathClear(m, t);
    if (!clear) {
      m.nav.createPathToEntity(t, 0);
      setFlag(m, 'crouching', false);
      setFlag(m, 'interested', false);
    }
    return clear;
  }
  override canContinueToUse(): boolean {
    const m = this.m;
    const t = m.getTarget();
    if (!t || t.living?.dead) return false;
    const vy = m.e.physics.vy;
    return (!(vy * vy < 0.05) || !(Math.abs(m.e.transform.pitch) < 15) || !m.onGround) && !isFaceplanted(m);
  }
  override isInterruptable(): boolean {
    return false;
  }
  override start(): void {
    const m = this.m;
    m.e.input.jumping = true;
    setFlag(m, 'pouncing', true);
    setFlag(m, 'interested', false);
    const t = m.getTarget();
    if (t) {
      const tt = t.transform!;
      m.look.setLookAtEntity(t, 60, 30);
      const dx = tt.x - m.x, dy = tt.y - m.y, dz = tt.z - m.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const p = m.e.physics;
      p.vx += (dx / len) * 0.8;
      p.vy += 0.9;
      p.vz += (dz / len) * 0.8;
    }
    m.nav.stop();
  }
  override stop(): void {
    setFlag(this.m, 'crouching', false);
    setFlag(this.m, 'pouncing', false);
    this.m.e.input.jumping = false;
  }
  override tick(): void {
    const m = this.m, p = m.e.physics, t = m.e.transform;
    const target = m.getTarget();
    if (target) m.look.setLookAtEntity(target, 60, 30);
    if (!isFaceplanted(m)) {
      if (p.vy * p.vy < 0.03 && t.pitch !== 0) t.pitch += (0 - t.pitch) * 0.2;
      else {
        const h = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        const len = Math.sqrt(h * h + p.vy * p.vy) || 1;
        t.pitch = Math.sign(-p.vy) * Math.acos(Math.min(1, h / len)) * (180 / Math.PI);
      }
    }
    if (target && m.distanceToSqr(target) <= 4) {
      m.swing();
      m.level.hurtEntity(target, 'mob_attack', m.attr('attack_damage'), m.e);
    } else if (t.pitch > 0 && m.onGround && p.vy !== 0 && blockOf(m.level.getBlockState(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))).name === 'snow') {
      t.pitch = 60;
      m.setTarget(null);
      setFlag(m, 'faceplanted', true);
    }
  }
}

/** Faceplanted foxes stay stuck in the snow for a moment. */
class FaceplantGoal extends Goal {
  private countdown = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.LOOK | Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    return isFaceplanted(this.m);
  }
  override canContinueToUse(): boolean {
    return this.canUse() && this.countdown > 0;
  }
  override start(): void {
    this.countdown = this.adjustedTickDelay(40);
  }
  override stop(): void {
    setFlag(this.m, 'faceplanted', false);
  }
  override tick(): void {
    this.countdown--;
    if (this.m.random.nextFloat() < 0.2) this.m.playSound('block.snow.break', 0.5);
  }
}

class SeekShelterGoal extends Goal {
  private interval = reducedTickDelay(100);
  private wanted: [number, number, number] | null = null;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (isSleeping(m) || m.getTarget() || !m.level.isThundering()) return false;
    if (!m.level.canSeeSky(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))) return false;
    if (--this.interval > 0) return false;
    this.interval = 100;
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    for (let i = 0; i < 10; i++) {
      const x = bx + m.random.nextInt(20) - 10, y = by + m.random.nextInt(6) - 3, z = bz + m.random.nextInt(20) - 10;
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
    clearStates(this.m);
    const [x, y, z] = this.wanted!;
    this.m.nav.moveTo(x, y, z, this.speed);
  }
}

class FoxMeleeAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    const m = this.m;
    return !isSitting(m) && !isSleeping(m) && !isCrouching(m) && !isFaceplanted(m) && super.canUse();
  }
  override start(): void {
    setFlag(this.m, 'interested', false);
    super.start();
  }
  protected override checkAndPerformAttack(t: Entity): void {
    // Foxes spit out a held item before attacking
    if (this.ticksUntilAttack <= 0 && this.m.distanceToSqr(t) <= 4) this.m.playSound('entity.fox.bite');
    super.checkAndPerformAttack(t);
  }
}

class SleepGoal extends Goal {
  private countdown = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
    this.countdown = m.random.nextInt(140);
  }
  private hasShelter(): boolean {
    const m = this.m;
    const x = Math.floor(m.x), y = Math.floor(m.y + m.height), z = Math.floor(m.z);
    return !m.level.canSeeSky(x, y, z) && m.walkTargetValue(x, y, z) >= 0;
  }
  private canSleep(): boolean {
    if (this.countdown > 0) {
      this.countdown--;
      return false;
    }
    const m = this.m;
    return m.level.isDay() && this.hasShelter() && !alertable(m) && !m.e.physics.inPowderSnow;
  }
  canUse(): boolean {
    const i = this.m.e.input;
    if (i.strafe !== 0 || i.forward !== 0 || i.up !== 0) return false;
    return this.canSleep() || isSleeping(this.m);
  }
  override canContinueToUse(): boolean {
    return this.canSleep();
  }
  override stop(): void {
    this.countdown = this.m.random.nextInt(140);
    clearStates(this.m);
  }
  override start(): void {
    const m = this.m;
    setFlag(m, 'sitting', false);
    setFlag(m, 'crouching', false);
    setFlag(m, 'interested', false);
    m.e.input.jumping = false;
    setFlag(m, 'sleeping', true);
    m.nav.stop();
    m.move.setWantedPosition(m.x, m.y, m.z, 0);
  }
}

class FoxFollowParentGoal extends FollowParentGoal {
  constructor(private readonly fox: Mob, speed: number) {
    super(fox, speed);
  }
  override canUse(): boolean {
    return !isDefending(this.fox) && super.canUse();
  }
  override canContinueToUse(): boolean {
    return !isDefending(this.fox) && super.canContinueToUse();
  }
  override start(): void {
    clearStates(this.fox);
    super.start();
  }
}

/** Walk to ripe sweet berry bushes or glow-berry vines and pick them (reference FoxEatBerriesGoal). */
class FoxEatBerriesGoal extends Goal {
  private target: [number, number, number] | null = null;
  private ticks = 0;
  private nextStart = 0;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly range: number, private readonly vRange: number) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
  }
  private ripe(x: number, y: number, z: number): boolean {
    const s = this.m.level.getBlockState(x, y, z);
    const b = blockOf(s);
    if (b.name === 'sweet_berry_bush') return getValue(s, P.age3) >= 2;
    return (b.name === 'cave_vines' || b.name === 'cave_vines_plant') && tryGetValue(s, P.berries) === true;
  }
  canUse(): boolean {
    const m = this.m;
    if (isSleeping(m) || m.getTarget()) return false;
    if (this.nextStart > 0) {
      this.nextStart--;
      return false;
    }
    this.nextStart = reducedTickDelay(200 + m.random.nextInt(200));
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    for (let dy = -this.vRange; dy <= this.vRange; dy++) {
      for (let r = 0; r < this.range; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (this.ripe(bx + dx, by + dy, bz + dz)) {
              this.target = [bx + dx, by + dy, bz + dz];
              return true;
            }
          }
        }
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return !!this.target && this.ticks < 1200 && this.ripe(...this.target) && !isSleeping(this.m);
  }
  override start(): void {
    const [x, y, z] = this.target!;
    this.m.nav.moveTo(x + 0.5, y, z + 0.5, this.speed);
    this.ticks = 0;
    setFlag(this.m, 'sitting', false);
  }
  override stop(): void {
    this.target = null;
  }
  override tick(): void {
    const [x, y, z] = this.target!;
    this.ticks++;
    this.m.look.setLookAt(x + 0.5, y + 0.5, z + 0.5, 10, 40);
    const d = (this.m.x - x - 0.5) ** 2 + (this.m.y - y) ** 2 + (this.m.z - z - 0.5) ** 2;
    if (d > 2.25) {
      if (this.ticks % 40 === 0) this.m.nav.moveTo(x + 0.5, y, z + 0.5, this.speed);
      return;
    }
    if (this.ticks < 40) return;
    this.pick(x, y, z);
    this.target = null;
  }
  private pick(x: number, y: number, z: number): void {
    const level = this.m.level;
    if (level.getGameRule('mobGriefing') === false) return;
    const s = level.getBlockState(x, y, z);
    const b = blockOf(s);
    let count: number;
    let berry: string;
    if (b.name === 'sweet_berry_bush') {
      const age = getValue(s, P.age3);
      count = 1 + level.random.nextInt(2) + (age === 3 ? 1 : 0);
      berry = 'sweet_berries';
      level.setBlock(x, y, z, setValue(s, P.age3, 1), 2);
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.sweet_berry_bush.pick_berries', 1, 1);
    } else {
      count = 1;
      berry = 'glow_berries';
      level.setBlock(x, y, z, setValue(s, P.berries, false), 2);
      level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.cave_vines.pick_berries', 1, 1);
    }
    const m = this.m;
    // One berry goes into an empty mouth, the rest drops
    if (mouth(m).isEmpty()) {
      m.equipment[0] = new ItemStack(berry, 1);
      m.guaranteedDrops[0] = true;
      count--;
    }
    if (count > 0) level.spawnItem(x + 0.5, y + 0.5, z + 0.5, new ItemStack(berry, count));
  }
}

class FoxSearchForItemsGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  private items(): Entity[] {
    return this.m.level.getEntities(this.m.box().inflate(8), (e) => !!e.item && e.item.pickupDelay <= 0 && !e.item.stack.isEmpty() && e.item.thrower !== this.m.e.id);
  }
  canUse(): boolean {
    const m = this.m;
    if (!mouth(m).isEmpty() || m.getTarget() || m.getLastHurtBy() || !canMove(m)) return false;
    if (m.random.nextInt(reducedTickDelay(10)) !== 0) return false;
    return this.items().length > 0;
  }
  override start(): void {
    const list = this.items();
    if (list.length) this.m.nav.moveToEntity(list[0]!, 1.2);
  }
  override tick(): void {
    const list = this.items();
    if (mouth(this.m).isEmpty() && list.length) this.m.nav.moveToEntity(list[0]!, 1.2);
  }
}

/** Sit down and look around (reference PerchAndSearchGoal). */
class PerchAndSearchGoal extends Goal {
  private relX = 0;
  private relZ = 0;
  private looksRemaining = 0;
  private lookTime = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const m = this.m;
    return !m.getLastHurtBy() && m.random.nextFloat() < 0.02 && !isSleeping(m) && !m.getTarget() && m.nav.isDone() && !isPouncing(m) && !isCrouching(m) && !isFaceplanted(m);
  }
  override canContinueToUse(): boolean {
    return this.looksRemaining > 0;
  }
  override start(): void {
    this.resetLook();
    this.looksRemaining = 2 + this.m.random.nextInt(3);
    setFlag(this.m, 'sitting', true);
    this.m.nav.stop();
  }
  override stop(): void {
    setFlag(this.m, 'sitting', false);
  }
  override tick(): void {
    if (--this.lookTime <= 0) {
      this.looksRemaining--;
      this.resetLook();
    }
    this.m.look.setLookAt(this.m.x + this.relX, this.m.eyeY, this.m.z + this.relZ, 10, 40);
  }
  private resetLook(): void {
    const a = Math.PI * 2 * this.m.random.nextDouble();
    this.relX = Math.cos(a);
    this.relZ = Math.sin(a);
    this.lookTime = this.adjustedTickDelay(80 + this.m.random.nextInt(20));
  }
}

/** Attack whatever hurt a trusted player (reference DefendTrustedTargetGoal). */
class DefendTrustedTargetGoal extends NearestAttackableTargetGoal {
  private timestamp = 0;
  private attacker: Entity | null = null;
  constructor(private readonly fox: Mob) {
    super(fox, () => false, 10, false);
  }
  override canUse(): boolean {
    const m = this.fox;
    if (m.random.nextInt(reducedTickDelay(10)) !== 0) return false;
    for (const name of trusted(m)) {
      const p = m.level.players.find((pl) => pl.name === name);
      const l = p?.entity.living;
      if (!p || !l || !l.lastAttacker) continue;
      const a = m.level.entities.get(l.lastAttacker) ?? null;
      if (!a || a.removed || l.lastAttackerTick === this.timestamp) continue;
      if (this.canAttack(a, { range: 0, combat: true, lineOfSight: false, testInvisible: false })) {
        this.attacker = a;
        this.timestamp = l.lastAttackerTick;
        return true;
      }
    }
    return false;
  }
  override start(): void {
    this.fox.setTarget(this.attacker);
    this.targetMob = this.attacker;
    this.fox.playSound('entity.fox.aggro');
    setFlag(this.fox, 'defending', true);
    wakeUp(this.fox);
  }
}

// ---- Definition ------------------------------------------------------------------------------

function spawnItem(m: Mob): ItemStack {
  const f = m.random.nextFloat();
  if (f < 0.05) return new ItemStack('emerald', 1);
  if (f < 0.2) return new ItemStack('egg', 1);
  if (f < 0.4) return new ItemStack(m.random.nextBool() ? 'rabbit_foot' : 'rabbit_hide', 1);
  if (f < 0.6) return new ItemStack('wheat', 1);
  if (f < 0.8) return new ItemStack('leather', 1);
  return new ItemStack('feather', 1);
}

function snowy(m: Mob): boolean {
  const b = BIOMES[m.level.getBiome(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))];
  return !!b && (b.precipitation === 'snow' || b.category === 'icy');
}

registerMob({
  id: 'fox', attrs: { max_health: 10, movement_speed: 0.3, attack_damage: 2, follow_range: 32 }, ageable: true,
  xp: (m) => 1 + m.random.nextInt(3), food: items('sweet_berries', 'glow_berries'), loot: null, ...sounds('fox', false),
  ambientFor(m) {
    if (isSleeping(m)) return 'entity.fox.sleep';
    if (!m.level.isDay() && m.random.nextFloat() < 0.1) {
      const near = m.level.getEntities(m.box().inflate(16), (e) => !!e.player).length;
      if (!near) return 'entity.fox.screech';
    }
    return 'entity.fox.ambient';
  },
  setup(m) {
    m.canPickUpLoot = true;
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new FaceplantGoal(m));
    m.goals.add(2, new FoxPanicGoal(m, 2.2));
    m.goals.add(3, new BreedGoal(m, 1));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => !!e.player && !trusts(m, e) && !isDefending(m) && !e.input?.sneaking, 16, 1.6, 1.4));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => e.type === 'wolf' && !mobOf(e)?.data['tamed'] && !isDefending(m), 8, 1.6, 1.4));
    m.goals.add(4, new AvoidEntityGoal(m, (e) => e.type === 'polar_bear' && !mobOf(e)?.aggressive && !isDefending(m), 8, 1.6, 1.4));
    m.goals.add(5, new StalkPreyGoal(m));
    m.goals.add(6, new FoxPounceGoal(m));
    m.goals.add(6, new SeekShelterGoal(m, 1.25));
    m.goals.add(7, new FoxMeleeAttackGoal(m, 1.2, true));
    m.goals.add(7, new SleepGoal(m));
    m.goals.add(8, new FoxFollowParentGoal(m, 1.25));
    m.goals.add(10, new FoxEatBerriesGoal(m, 1.2, 12, 1));
    m.goals.add(10, new LeapAtTargetGoal(m, 0.4));
    m.goals.add(11, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(11, new FoxSearchForItemsGoal(m));
    m.goals.add(12, new (class extends LookAtPlayerGoal {
      override canUse(): boolean {
        return !isSleeping(m) && !isFaceplanted(m) && super.canUse();
      }
    })(m, 24));
    m.goals.add(13, new PerchAndSearchGoal(m));
    m.targets.add(1, new NearestAttackableTargetGoal(m, STALKABLE, 10, false));
    m.targets.add(1, new NearestAttackableTargetGoal(m, babyTurtleOnLand, 10, false));
    m.targets.add(1, new NearestAttackableTargetGoal(m, (e) => e.type === 'cod' || e.type === 'salmon' || e.type === 'tropical_fish', 20, false));
    m.targets.add(3, new DefendTrustedTargetGoal(m));
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? (snowy(m) ? 'snow' : 'red');
    if (ctx.reason !== 'breeding' && m.random.nextFloat() < 0.2) m.equipment[0] = spawnItem(m);
    // Later members of a spawned group are cubs
    if ((ctx.opts['groupIndex'] as number | undefined ?? 0) >= 2) m.data['age'] = -24000;
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'red');
  },
  tick(m) {
    const t = m.e.transform;
    // Crouch progress, sleeping immobility and eating what is carried
    if (isCrouching(m)) m.tmp['crouchAmount'] = Math.min(3, ((m.tmp['crouchAmount'] as number | undefined) ?? 0) + 1);
    if (isSleeping(m) || isFaceplanted(m)) {
      m.e.input.jumping = false;
      m.e.input.forward = m.e.input.strafe = 0;
      m.nav.stop();
    }
    if (!isPouncing(m) && !isFaceplanted(m) && t.pitch !== 0 && m.onGround) t.pitch = 0;
    const eaten = ((m.tmp['ticksSinceEaten'] as number | undefined) ?? 0) + 1;
    m.tmp['ticksSinceEaten'] = eaten;
    const s = mouth(m);
    if (edible(s) && !m.getTarget() && m.onGround && !isSleeping(m)) {
      if (eaten > 600) {
        const food = getItem(s.id)!.food!;
        for (const fx of food.effects ?? []) if (m.random.nextFloat() < fx.chance) addEffect(m.level, m.e, { id: fx.id, amp: fx.amp, dur: fx.dur, ambient: false, particles: true, icon: true });
        m.equipment[0] = food.remainder ? new ItemStack(food.remainder, 1) : ItemStack.empty();
        m.tmp['ticksSinceEaten'] = 0;
      } else if (eaten > 560 && m.random.nextFloat() < 0.1) {
        m.playSound('entity.fox.eat');
        m.broadcastEvent('eatItem');
      }
    }
    // Wake up when something alarming comes near
    if (isSleeping(m) && m.tickCount % 20 === 0 && alertable(m)) wakeUp(m);
  },
  wantsToPickUp(m, s) {
    const cur = mouth(m);
    return cur.isEmpty() || (((m.tmp['ticksSinceEaten'] as number | undefined) ?? 0) > 0 && edible(s) && !edible(cur));
  },
  pickUp(m, e) {
    const it = e.item!;
    const cur = mouth(m);
    if (!cur.isEmpty()) {
      // Drop what was held (thrown forward, flagged so the fox does not grab it again)
      const drop = m.level.spawnItem(m.x, m.eyeY - 0.1, m.z, cur);
      if (drop?.item) {
        drop.item.pickupDelay = 40;
        drop.item.thrower = m.e.id;
      }
    }
    m.equipment[0] = it.stack.split(1);
    m.guaranteedDrops[0] = true;
    m.tmp['ticksSinceEaten'] = 0;
  },
  onHurt(m) {
    clearStates(m);
  },
  offspring(m, partner) {
    const love = m.level.entities.get(m.tmp['loveCause'] as number ?? 0);
    const love2 = m.level.entities.get(partner.tmp['loveCause'] as number ?? 0);
    const names = [love?.player?.name, love2?.player?.name].filter((n): n is string => !!n);
    return { type: 'fox', data: { variant: m.random.nextBool() ? m.data['variant'] : partner.data['variant'], trusted: [...new Set(names)] } };
  },
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z));
    return (b.name === 'grass_block' || b.name === 'snow_block' || b.name === 'snow' || b.name === 'podzol' || b.name === 'coarse_dirt') && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});
