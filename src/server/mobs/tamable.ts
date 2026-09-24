/**
 * Tamable animals (reference TamableAnimal): owners, sitting on command, following the owner
 * (teleporting when left behind), defending the owner and attacking what the owner attacks.
 */
import type { Entity } from '../../common/entity/ecs';
import { stateFlags, F, getCollisionShape, blockOf, blockHasTag } from '../../common/block/registry';
import type { ServerPlayer } from '../player';
import type { TextComponent } from '../../common/lang/i18n';
import { deathMessageFor } from '../survival/player';
import { Goal, Flag } from './goals';
import { Mob, mobOf } from './mob';
import { PanicGoal, NearestAttackableTargetGoal } from './goallib';
import { PathType } from './pathfinding';

export function isTame(m: Mob): boolean {
  return !!m.data['tamed'];
}

export function ownerName(m: Mob): string | undefined {
  return isTame(m) ? (m.data['owner'] as string | undefined) : undefined;
}

/** The owner's entity when the owner is online in the same dimension. */
export function ownerOf(m: Mob): Entity | null {
  const name = ownerName(m);
  if (!name) return null;
  return m.level.players.find((p) => p.name === name)?.entity ?? null;
}

export function ownerPlayer(m: Mob): ServerPlayer | null {
  const name = ownerName(m);
  return name ? m.level.players.find((p) => p.name === name) ?? null : null;
}

export function isOwnedBy(m: Mob, e: Entity): boolean {
  const name = ownerName(m);
  return !!name && e.player?.name === name;
}

export function tame(m: Mob, owner: Entity): void {
  m.data['tamed'] = true;
  m.data['owner'] = owner.player?.name ?? '';
  m.setPersistent();
  m.setMeta('tamed', true);
  m.broadcastEvent('tamed');
  m.level.server.hooks.gameEvent(m.level, 'tame_animal', m.x, m.y, m.z, owner, 0);
}

export function isOrderedToSit(m: Mob): boolean {
  return !!m.data['sitting'];
}

export function setOrderedToSit(m: Mob, sit: boolean): void {
  m.data['sitting'] = sit;
  setInSittingPose(m, sit);
}

export function setInSittingPose(m: Mob, sit: boolean): void {
  m.tmp['sittingPose'] = sit;
  m.setMeta('sitting', sit);
}

export function isInSittingPose(m: Mob): boolean {
  return !!m.tmp['sittingPose'];
}

/** Reference tame outcome: hearts on success, smoke on failure. */
export function tameAttempt(m: Mob, p: ServerPlayer, chance: number): boolean {
  if (m.random.nextInt(chance) === 0) {
    tame(m, p.entity);
    m.nav.stop();
    m.setTarget(null);
    setOrderedToSit(m, true);
    return true;
  }
  m.broadcastEvent('tameFailed');
  return false;
}

/** Owner right-clicked a tamed pet without a special item: toggle sitting. */
export function toggleSit(m: Mob, p: ServerPlayer): boolean {
  if (!isOwnedBy(m, p.entity)) return false;
  setOrderedToSit(m, !isOrderedToSit(m));
  m.e.input.jumping = false;
  m.nav.stop();
  m.setTarget(null);
  return true;
}

/** Common pet rule: do not attack the owner's other pets, tamed horses or hissers. */
export function wantsToAttack(m: Mob, target: Entity): boolean {
  if (target.type === 'hisser' || target.type === 'ghast' || target.type === 'armor_stand') return false;
  const o = mobOf(target);
  if (o) {
    const owner = ownerName(m);
    if (owner && o.data['tamed'] && o.data['owner'] === owner) return false;
    if (o.data['tamed'] && ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'camel'].includes(o.def.id)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------------------------

export class SitWhenOrderedToGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  override canContinueToUse(): boolean {
    return isOrderedToSit(this.m);
  }
  canUse(): boolean {
    const m = this.m;
    if (!isTame(m) || m.inWater || !m.onGround) return false;
    const owner = ownerOf(m);
    if (!owner) return true;
    // A pet whose owner is being attacked nearby stands up to help
    const l = owner.living;
    const hurtRecently = !!l && l.lastAttacker !== 0 && m.level.getGameTime() - l.lastAttackerTick < 100;
    if (m.distanceToSqr(owner) < 144 && hurtRecently) return false;
    return isOrderedToSit(m);
  }
  override start(): void {
    this.m.nav.stop();
    setInSittingPose(this.m, true);
  }
  override stop(): void {
    setInSittingPose(this.m, false);
  }
}

/** Tamed pets only panic from environmental harm (fire, freezing). */
export class TamablePanicGoal extends PanicGoal {
  override canUse(): boolean {
    if (isTame(this.m)) {
      const p = this.m.e.physics;
      if (p.fireTicks <= 0 && !(p.frozenTicks > 0 && p.inPowderSnow)) return false;
    }
    return super.canUse();
  }
}

/** Walk (or fly) after the owner, teleporting next to them when more than 12 blocks away. */
export class FollowOwnerGoal extends Goal {
  private owner: Entity | null = null;
  private recalc = 0;
  private oldWaterMalus = 0;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly startDist: number, private readonly stopDist: number, private readonly flying = false) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  private unableToMove(): boolean {
    return isOrderedToSit(this.m) || !!this.m.e['vehicle'] || !!this.m.leashHolder;
  }
  canUse(): boolean {
    const o = ownerOf(this.m);
    if (!o || o.player?.gameMode === 'spectator' || this.unableToMove()) return false;
    if (this.m.distanceToSqr(o) < this.startDist * this.startDist) return false;
    this.owner = o;
    return true;
  }
  override canContinueToUse(): boolean {
    if (this.m.nav.isDone() || this.unableToMove() || !this.owner || this.owner.removed) return false;
    return this.m.distanceToSqr(this.owner) > this.stopDist * this.stopDist;
  }
  override start(): void {
    this.recalc = 0;
    this.oldWaterMalus = this.m.nav.malus[PathType.WATER]!;
    this.m.nav.setMalus(PathType.WATER, 0);
  }
  override stop(): void {
    this.owner = null;
    this.m.nav.stop();
    this.m.nav.setMalus(PathType.WATER, this.oldWaterMalus);
  }
  override tick(): void {
    const o = this.owner!;
    const tp = this.m.distanceToSqr(o) >= 144;
    if (!tp) this.m.look.setLookAtEntity(o, 10, 40);
    if (--this.recalc > 0) return;
    this.recalc = this.adjustedTickDelay(10);
    if (tp) teleportToOwner(this.m, o, this.flying);
    else this.m.nav.moveToEntity(o, this.speed);
  }
}

/** Reference TamableAnimal.teleportToAroundBlockPos: up to 10 random spots near the owner. */
export function teleportToOwner(m: Mob, owner: Entity, flying: boolean): boolean {
  const t = owner.transform!;
  const bx = Math.floor(t.x), by = Math.floor(t.y), bz = Math.floor(t.z);
  for (let i = 0; i < 10; i++) {
    const dx = m.random.nextInt(7) - 3, dy = m.random.nextInt(3) - 1, dz = m.random.nextInt(7) - 3;
    if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
    const x = bx + dx, y = by + dy, z = bz + dz;
    if (!canTeleportTo(m, x, y, z, flying)) continue;
    const e = m.e, et = e.transform;
    et.x = x + 0.5; et.y = y; et.z = z + 0.5;
    et.px = et.x; et.py = et.y; et.pz = et.z;
    e.physics.vx = e.physics.vy = e.physics.vz = 0;
    if (e.net) e.net.forceSync = true;
    m.nav.stop();
    return true;
  }
  return false;
}

function canTeleportTo(m: Mob, x: number, y: number, z: number, flying: boolean): boolean {
  const level = m.level;
  const below = level.getBlockState(x, y - 1, z);
  const bb = blockOf(below);
  if (!flying && (!(stateFlags[below]! & F.SOLID) || blockHasTag(bb, 'leaves'))) return false;
  if (!flying && (bb.name === 'magma_block' || bb.name === 'campfire' || bb.name === 'soul_campfire' || stateFlags[below]! & F.LAVA)) return false;
  const w = m.width / 2;
  for (let yy = y; yy < y + Math.ceil(m.height); yy++) {
    for (const [ox, oz] of [[-w, -w], [w, -w], [-w, w], [w, w]] as const) {
      const s = level.getBlockState(Math.floor(x + 0.5 + ox), yy, Math.floor(z + 0.5 + oz));
      if (getCollisionShape(s).length || stateFlags[s]! & (F.LAVA | F.WATER)) return false;
    }
  }
  return true;
}

/** Attack whoever hurt the owner. */
export class OwnerHurtByTargetGoal extends NearestAttackableTargetGoal {
  private timestamp = 0;
  private attacker: Entity | null = null;
  constructor(private readonly pet: Mob) {
    super(pet, () => false, 0, false);
  }
  override canUse(): boolean {
    if (!isTame(this.pet) || isOrderedToSit(this.pet)) return false;
    const o = ownerOf(this.pet);
    const l = o?.living;
    if (!o || !l || !l.lastAttacker) return false;
    const a = this.pet.level.entities.get(l.lastAttacker) ?? null;
    if (!a || a.removed || l.lastAttackerTick === this.timestamp) return false;
    if (this.pet.level.getGameTime() - l.lastAttackerTick > 100) return false;
    if (!wantsToAttack(this.pet, a) || a === this.pet.e) return false;
    this.attacker = a;
    return this.canAttack(a, { range: 0, combat: true, lineOfSight: false, testInvisible: false });
  }
  override start(): void {
    this.pet.setTarget(this.attacker);
    const l = ownerOf(this.pet)?.living;
    if (l) this.timestamp = l.lastAttackerTick;
    this.targetMob = this.attacker;
  }
}

/** Attack whatever the owner attacks. */
export class OwnerHurtTargetGoal extends NearestAttackableTargetGoal {
  private timestamp = 0;
  private victim: Entity | null = null;
  constructor(private readonly pet: Mob) {
    super(pet, () => false, 0, false);
  }
  override canUse(): boolean {
    if (!isTame(this.pet) || isOrderedToSit(this.pet)) return false;
    const o = ownerOf(this.pet);
    if (!o) return false;
    const id = o['lastHurtMob'] as number | undefined, tick = (o['lastHurtMobTick'] as number | undefined) ?? 0;
    if (!id || tick === this.timestamp || this.pet.level.getGameTime() - tick > 100) return false;
    const v = this.pet.level.entities.get(id) ?? null;
    if (!v || v.removed || v === this.pet.e || !wantsToAttack(this.pet, v)) return false;
    this.victim = v;
    return this.canAttack(v, { range: 0, combat: true, lineOfSight: false, testInvisible: false });
  }
  override start(): void {
    this.pet.setTarget(this.victim);
    this.timestamp = (ownerOf(this.pet)?.['lastHurtMobTick'] as number | undefined) ?? 0;
    this.targetMob = this.victim;
  }
}

/** Untamed pets hunt prey now and then (wolves: sheep, rabbits, foxes; cats: rabbits). */
export class NonTameRandomTargetGoal extends NearestAttackableTargetGoal {
  constructor(private readonly pet: Mob, filter: (e: Entity) => boolean, mustSee = false) {
    super(pet, filter, 10, mustSee);
  }
  override canUse(): boolean {
    return !isTame(this.pet) && super.canUse();
  }
  override canContinueToUse(): boolean {
    return !isTame(this.pet) && super.canContinueToUse();
  }
}

/** Remember who a player last hurt (for their pets' OwnerHurtTargetGoal). */
export function recordPlayerAttack(level: { getGameTime(): number }, attacker: Entity, victim: Entity): void {
  if (!attacker.player) return;
  attacker['lastHurtMob'] = victim.id;
  attacker['lastHurtMobTick'] = level.getGameTime();
}

/** Death message sent to a tamed pet's owner. */
export function petDeathMessage(m: Mob, type: string, attacker: Entity | null): TextComponent | null {
  if (!ownerPlayer(m)) return null;
  const name = m.e['customName'] as string | undefined;
  return deathMessageFor(name ? { text: name } : { key: `entity.${m.def.id}` }, type, attacker, m.e.physics.fallDistance);
}
