/**
 * Mob runtime: the `Mob` object attached to mob entities (AI selectors, controls, navigation,
 * sensing, targets, persistent per-type data) and the registry of mob definitions.
 */
import type { Entity } from '../../common/entity/ecs';
import type { Components } from '../../common/entity/components';
import type { ItemStack } from '../../common/item/stack';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { Random } from '../../common/math/random';
import { raycastBlocks } from '../../common/world/raycast';
import { blockOf } from '../../common/block/registry';
import { AABB } from '../../common/math/geom';
import type { PathType } from './pathfinding';
import { GoalSelector } from './goals';
import type { MoveControl, LookControl, JumpControl, BodyRotation } from './controls';
import type { PathNavigation } from './navigation';

export type MobEntity = Entity & Required<Pick<Components, 'transform' | 'physics' | 'input' | 'living' | 'meta'>>;

export type SpawnReason =
  | 'natural' | 'chunk_generation' | 'spawner' | 'structure' | 'breeding' | 'spawn_egg' | 'command' | 'bucket' | 'conversion'
  | 'reinforcement' | 'trial_spawner' | 'patrol' | 'event' | 'dispenser' | 'triggered' | 'jockey' | 'mob_summoned';

export interface SpawnContext {
  reason: SpawnReason;
  /** Options passed to createEntity (bucket data, baby flag, variant…). */
  opts: Record<string, unknown>;
  /** Local difficulty 0..~6.75 (reference effective difficulty). */
  difficulty: number;
}

export type NavKind = 'ground' | 'fly' | 'swim' | 'amphibious' | 'climber';
export type MoveKind = 'ground' | 'fly' | 'swim' | 'hover' | 'slime' | 'none';

export interface MobDef {
  id: string;
  /** Base attribute values (max_health, movement_speed, attack_damage, follow_range…). */
  attrs: Record<string, number>;
  nav?: NavKind;
  move?: MoveKind;
  /** Swimming style for move: 'swim' (fish ease their speed; smooth swimmers pitch into the water). */
  swimStyle?: 'fish' | 'smooth';
  /** Swimmers may leave the water surface while pathing (dolphins). */
  canBreach?: boolean;
  /** Maximum head turn speed (degrees/tick) for the look control. */
  headSpeed?: number;
  malus?: Partial<Record<PathType, number>>;
  canOpenDoors?: boolean;
  /** Mob fits through open doors (default true). */
  canPassDoors?: boolean;
  /** Mob floats in water while pathing (default true for ground mobs). */
  canFloat?: boolean;
  maxFall?: number;
  stepHeight?: number;
  undead?: boolean;
  arthropod?: boolean;
  illager?: boolean;
  fireImmune?: boolean;
  /** Breathes underwater (drowning disabled). */
  waterBreather?: boolean;
  /** Aquatic mob: suffocates out of water. */
  aquatic?: boolean;
  /** Takes damage in water / rain (voidwalkers). */
  hurtByWater?: boolean;
  /** Burns in direct sunlight unless wearing a helmet. */
  burnsInDay?: boolean;
  /** Immune to fall damage. */
  noFallDamage?: boolean;
  noGravity?: boolean;
  /** Experience dropped on death. */
  xp?: number | ((m: Mob) => number);
  /** Loot table id (default entities/<id>; null = none). */
  loot?: string | null;
  /** Never despawns naturally (golems, bosses, tamed mobs set this dynamically). */
  persistent?: boolean;
  /** Removed in peaceful difficulty. */
  hostile?: boolean;
  /** Ageable mob (babies grow up in 20 minutes). */
  ageable?: boolean;
  /** Items used to breed / feed (ageable animals). */
  food?: (stack: ItemStack) => boolean;
  /** Ambient sound id and interval. */
  ambient?: string;
  /** State-dependent ambient sound (growling when angry, purring when tamed…); null = silent. */
  ambientFor?(m: Mob): string | null;
  hurtSound?: string;
  deathSound?: string;
  stepSound?: string;
  /** Sound volume / pitch base. */
  soundVolume?: number;
  /** Register goals. */
  setup(m: Mob): void;
  /** Initial state on spawn (variants, equipment, babies). */
  init?(m: Mob, ctx: SpawnContext): void;
  /** Extra behaviour each tick (reference aiStep / customServerAiStep). */
  tick?(m: Mob): void;
  /** Player right-click; return true when consumed. */
  interact?(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean;
  /** Adjust incoming damage (return the new amount; 0 cancels). */
  hurtFilter?(m: Mob, type: string, amount: number, attacker: Entity | null): number;
  onHurt?(m: Mob, type: string, amount: number, attacker: Entity | null): void;
  onDeath?(m: Mob, type: string, killer: Entity | null): void;
  /** Called after loading from disk. */
  loaded?(m: Mob): void;
  /** Size override (slimes, babies are handled generically). */
  size?(m: Mob): [number, number, number] | null;
  /** Attack a target in melee (default: attack_damage with knockback). */
  doHurtTarget?(m: Mob, target: Entity): boolean;
  /** Natural spawn rule (position already has a valid floor). */
  canSpawn?(level: ServerLevel, x: number, y: number, z: number, reason: SpawnReason, r: Random): boolean;
  /** Mob may be leashed (default: animals). */
  leashable?: boolean;
  /** Head item that halves this mob's detection range when worn by a player. */
  headItem?: string;
  /** Preference of random walk targets (default: animals like grass and light, monsters darkness). */
  walkTargetValue?(m: Mob, x: number, y: number, z: number): number;
  /** Offspring when two mobs breed (default: same type). */
  offspring?(m: Mob, partner: Mob): { type: string; data?: MobData } | null;
  /** A rider steers this mob (saddled horses, pigs with a carrot on a stick). */
  controlledBy?(m: Mob, rider: Entity): boolean;
  /** Item a rider holds to steer this mob (carrot on a stick…). */
  steeringItem?: string;
  /** Turn rider input into this mob's movement (yaw, forward speed, jumps). */
  ridden?(m: Mob, rider: Entity, input: RiderInput): void;
  /** This mob killed another entity (charged hisser heads, wither roses…). */
  onKill?(m: Mob, victim: Entity): void;
  /** Struck by lightning; return true to replace the default damage and ignition. */
  onLightning?(m: Mob, bolt: Entity): boolean;
  /** Flags passed to the loot table (sheep colour, sheared, variant…). */
  lootFlags?(m: Mob): Record<string, unknown>;
  /** Copy saved state to synchronised metadata (after spawn and after loading). */
  syncMeta?(m: Mob): void;
  /** Can this mob mate with another (default: same type, both in love). */
  canMate?(m: Mob, other: Mob): boolean;
  /** Items this mob picks up (default: better weapons and armour). */
  wantsToPickUp?(m: Mob, stack: ItemStack): boolean;
  /** Custom pickup (foxes carry items in their mouth, allays collect copies…). */
  pickUp?(m: Mob, item: Entity): void;
  /** Items this mob may hold at all. */
  canHoldItem?(m: Mob, stack: ItemStack): boolean;
  /** Extra hostile targeting rule (pets sparing their owner's other pets…). */
  canAttack?(m: Mob, target: Entity): boolean;
}

/** Input of a player controlling a vehicle this tick. */
export interface RiderInput {
  forward: number;
  strafe: number;
  jumping: boolean;
  sprinting: boolean;
  yaw: number;
  pitch: number;
}

export const MOB_DEFS = new Map<string, MobDef>();

export function registerMob(def: MobDef): MobDef {
  MOB_DEFS.set(def.id, def);
  return def;
}

// ---------------------------------------------------------------------------------------------
// Angle helpers (degrees)
// ---------------------------------------------------------------------------------------------

export function wrapDegrees(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Rotate `from` towards `to` by at most `max` degrees. */
export function rotlerp(from: number, to: number, max: number): number {
  let d = wrapDegrees(to - from);
  if (d > max) d = max;
  if (d < -max) d = -max;
  let r = from + d;
  if (r < 0) r += 360;
  else if (r > 360) r -= 360;
  return r;
}

export function rotateTowards(from: number, to: number, max: number): number {
  const d = wrapDegrees(to - from);
  return from + Math.max(-max, Math.min(max, d));
}

/** Keep `value` within `max` degrees of `around`. */
export function rotateIfNecessary(value: number, around: number, max: number): number {
  const d = wrapDegrees(value - around);
  if (d < -max) return around - max;
  if (d > max) return around + max;
  return value;
}

/** Yaw (degrees, reference convention) looking from (x,z) towards (tx,tz). */
export function yawTo(dx: number, dz: number): number {
  return (Math.atan2(dz, dx) * 180) / Math.PI - 90;
}

export function pitchTo(dx: number, dy: number, dz: number): number {
  return -((Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180) / Math.PI);
}

// ---------------------------------------------------------------------------------------------
// Sensing
// ---------------------------------------------------------------------------------------------

/** Line-of-sight cache, cleared every tick. */
export class Sensing {
  private readonly seen = new Set<number>();
  private readonly unseen = new Set<number>();

  constructor(private readonly mob: Mob) {}

  tick(): void {
    this.seen.clear();
    this.unseen.clear();
  }

  hasLineOfSight(e: Entity): boolean {
    if (this.seen.has(e.id)) return true;
    if (this.unseen.has(e.id)) return false;
    const v = this.mob.canSee(e);
    (v ? this.seen : this.unseen).add(e.id);
    return v;
  }
}

// ---------------------------------------------------------------------------------------------
// Mob
// ---------------------------------------------------------------------------------------------

/** Persistent per-mob data: saved as JSON with the entity. */
export type MobData = Record<string, any>;

export class Mob {
  readonly goals = new GoalSelector();
  readonly targets = new GoalSelector();
  move!: MoveControl;
  look!: LookControl;
  jump!: JumpControl;
  body!: BodyRotation;
  nav!: PathNavigation;
  readonly sensing: Sensing;
  /** Saved state (variant, owner, age, flags…). */
  data: MobData = {};
  /** Transient state (cooldowns, cached references). */
  tmp: MobData = {};
  target: Entity | null = null;
  lastHurtBy: Entity | null = null;
  lastHurtByTime = -1000;
  lastHurtByPlayerTime = -1000;
  lastHurtByPlayer: Entity | null = null;
  lastHurtMob: Entity | null = null;
  noActionTime = 0;
  tickCount = 0;
  ambientSoundTime = 0;
  /** Home restriction (golems, villagers). */
  restrictCenter: [number, number, number] | null = null;
  restrictRadius = -1;
  /** Chance each equipment slot drops on death (main, off, feet, legs, chest, head). */
  dropChances = [0.085, 0.085, 0.085, 0.085, 0.085, 0.085];
  /** Equipment slot was picked up / given (always drops, makes the mob persistent). */
  guaranteedDrops = [false, false, false, false, false, false];
  canPickUpLoot = false;
  /** Speed multiplier of the current MoveControl operation (for animations). */
  aggressive = false;
  /** Remaining ticks before another melee attack. */
  attackCooldown = 0;
  /** Mob is being controlled by a rider or leash (AI goals with MOVE disabled). */
  leashHolder: Entity | null = null;

  constructor(readonly e: MobEntity, readonly def: MobDef, public level: ServerLevel) {
    this.sensing = new Sensing(this);
  }

  get random(): Random {
    return this.level.random;
  }

  get x(): number { return this.e.transform.x; }
  get y(): number { return this.e.transform.y; }
  get z(): number { return this.e.transform.z; }
  get eyeY(): number { return this.e.transform.y + this.e.physics.eyeHeight; }
  get width(): number { return this.e.physics.width; }
  get height(): number { return this.e.physics.height; }
  get onGround(): boolean { return this.e.physics.onGround; }
  get inWater(): boolean { return this.e.physics.inWater; }
  get inLava(): boolean { return this.e.physics.inLava; }
  get alive(): boolean { return !this.e.removed && !this.e.living.dead; }
  get health(): number { return this.e.living.health; }
  get maxHealth(): number { return this.e.living.attrs.value('max_health'); }
  get gameTime(): number { return this.level.getGameTime(); }

  attr(name: string): number {
    return this.e.living.attrs.value(name);
  }

  /** Movement speed attribute (blocks/tick scale). */
  get speed(): number {
    return this.attr('movement_speed');
  }

  /** Ageable mobs are babies while their age is negative; others (zombies) use a flag. */
  get isBaby(): boolean {
    return (this.data['age'] ?? 0) < 0 || this.data['baby'] === true;
  }

  get noAi(): boolean {
    return this.data['noAI'] === true;
  }

  get persistent(): boolean {
    return this.data['persistent'] === true || this.def.persistent === true || !!this.e['customName'] || !!this.leashHolder;
  }

  setPersistent(): void {
    this.data['persistent'] = true;
  }

  /** Set a synchronised metadata field (sent to clients when changed). */
  setMeta(key: string, value: number | string | boolean): void {
    if (this.e.meta[key] === value) return;
    this.e.meta[key] = value;
    if (this.e.net) this.e.net.metaDirty = true;
  }

  distanceToSqr(e: Entity): number {
    const t = e.transform!;
    const dx = t.x - this.x, dy = t.y - this.y, dz = t.z - this.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceToPosSqr(x: number, y: number, z: number): number {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Bounding box of the mob. */
  box(): AABB {
    const hw = this.width / 2;
    return new AABB(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw);
  }

  /** Eye-to-eye line of sight without solid blocks in between (max 128 blocks). */
  canSee(e: Entity): boolean {
    const t = e.transform;
    if (!t || e.removed) return false;
    const ex = t.x, ey = t.y + (e.physics?.eyeHeight ?? 0), ez = t.z;
    const dx = ex - this.x, dy = ey - this.eyeY, dz = ez - this.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 128) return false;
    if (d < 1e-6) return true;
    return raycastBlocks(this.level, this.x, this.eyeY, this.z, dx / d, dy / d, dz / d, d, 'collision') === null;
  }

  hasLineOfSight(e: Entity): boolean {
    return this.sensing.hasLineOfSight(e);
  }

  /** Current target if still valid. */
  getTarget(): Entity | null {
    const t = this.target;
    if (t && (t.removed || t.living?.dead)) this.target = null;
    return this.target;
  }

  setTarget(e: Entity | null): void {
    this.target = e;
  }

  setLastHurtBy(e: Entity | null): void {
    this.lastHurtBy = e;
    this.lastHurtByTime = this.tickCount;
  }

  /** Last attacker within the 100-tick memory window. */
  getLastHurtBy(): Entity | null {
    const e = this.lastHurtBy;
    if (e && (e.removed || e.living?.dead || this.tickCount - this.lastHurtByTime > 100)) this.lastHurtBy = null;
    return this.lastHurtBy;
  }

  isWithinRestriction(x: number, y: number, z: number): boolean {
    if (this.restrictRadius < 0 || !this.restrictCenter) return true;
    const [cx, cy, cz] = this.restrictCenter;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    return dx * dx + dy * dy + dz * dz < this.restrictRadius * this.restrictRadius;
  }

  hasRestriction(): boolean {
    return this.restrictRadius >= 0;
  }

  restrictTo(x: number, y: number, z: number, radius: number): void {
    this.restrictCenter = [x, y, z];
    this.restrictRadius = radius;
  }

  clearRestriction(): void {
    this.restrictRadius = -1;
  }

  /** Light-level preference used by random walks (reference getWalkTargetValue). */
  walkTargetValue(x: number, y: number, z: number): number {
    const kind = this.tmp['walkPreference'] as ('animal' | 'monster' | 'none' | undefined) ?? (this.def.hostile ? 'monster' : this.def.ageable ? 'animal' : 'none');
    if (kind === 'none') return 0;
    if (kind === 'animal') {
      const below = this.level.getBlockState(x, y - 1, z);
      if (blockOf(below).name === 'grass_block') return 10;
      return this.brightness(x, y, z) - 0.5;
    }
    return 0.5 - this.brightness(x, y, z);
  }

  /** Reference light-level dependent magic value (0..1 brightness curve). */
  brightness(x: number, y: number, z: number): number {
    const l = this.level.getMaxLocalRawBrightness(x, y, z) / 15;
    const f = l / (4 - 3 * l);
    const a = this.level.dim.ambientLight;
    return a + (1 - a) * f;
  }

  lookAtEntity(e: Entity, yMax: number, xMax: number): void {
    const t = e.transform!;
    const ey = e.living ? t.y + (e.physics?.eyeHeight ?? 0) : t.y + (e.physics?.height ?? 0) / 2;
    const dx = t.x - this.x, dz = t.z - this.z, dy = ey - this.eyeY;
    this.e.transform.pitch = rotateTowards(this.e.transform.pitch, pitchTo(dx, dy, dz), xMax);
    this.e.transform.yaw = rotateTowards(this.e.transform.yaw, yawTo(dx, dz), yMax);
  }

  playSound(sound: string, volume = 1, pitch?: number): void {
    const p = pitch ?? (this.random.nextFloat() - this.random.nextFloat()) * 0.2 + (this.isBaby ? 1.5 : 1);
    this.level.playSound(this.x, this.y, this.z, sound, volume * (this.def.soundVolume ?? 1), p);
  }

  /** Swing the main arm (attack animation on clients). */
  swing(offhand = false): void {
    this.level.tracker.broadcast(this.e, { type: 'entityAnimation', id: this.e.id, anim: offhand ? 3 : 0 });
  }

  broadcastEvent(event: string, data = 0): void {
    this.level.broadcastEntityEvent(this.e, event, data);
  }

  /** Equipment: main, off, feet, legs, chest, head. */
  get equipment(): ItemStack[] {
    return this.e['equipment'] as ItemStack[];
  }

  isPlayer(e: Entity | null): e is Entity & Required<Pick<Components, 'player'>> {
    return !!e?.player;
  }
}

export function mobOf(e: Entity | null | undefined): Mob | undefined {
  return e ? (e['mob'] as Mob | undefined) : undefined;
}
