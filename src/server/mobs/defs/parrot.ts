/**
 * Parrots: flying pets tamed with seeds, poisoned by cookies, imitating nearby monsters, dancing
 * next to a playing jukebox and riding on their owner's shoulders (stored with the player and
 * released when the player falls, swims, flies, sleeps or gets hurt).
 */
import type { Entity } from '../../../common/entity/ecs';
import { blockOf, blockHasTag, stateFlags, F, tryGetValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import type { ServerPlayer } from '../../player';
import { saveEntity, loadEntity, SavedEntity } from '../../entity/persistence';
import { vehicleOf } from '../../entity/riding';
import { registerMob, Mob, mobOf, MOB_DEFS } from '../mob';
import { Goal, Flag } from '../goals';
import { FloatGoal, LookAtPlayerGoal, RandomFlyingGoal } from '../goallib';
import { PathType } from '../pathfinding';
import type { Vec3 } from '../randompos';
import { handStack, useItem } from '../actions';
import { hitbox } from '../targeting';
import {
  isTame, isOwnedBy, ownerOf, tameAttempt, toggleSit, isOrderedToSit, isInSittingPose, setInSittingPose,
  SitWhenOrderedToGoal, TamablePanicGoal, FollowOwnerGoal,
} from '../tamable';
import { items, sounds } from './common';

export const PARROT_VARIANTS = ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'];
const SEEDS = items('wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod');

/** Imitation sound for a hostile mob type (every hostile mob can be imitated). */
function imitationOf(type: string): string | null {
  const def = MOB_DEFS.get(type);
  return def?.hostile && type !== 'parrot' ? `entity.parrot.imitate.${type}` : null;
}

function imitationPitch(m: { random: Mob['random'] }): number {
  return (m.random.nextFloat() - m.random.nextFloat()) * 0.2 + 1;
}

/** Imitate a random monster within 20 blocks (reference Parrot.imitateNearbyMobs). */
function imitateNearbyMobs(m: Mob): boolean {
  if (m.random.nextInt(2) !== 0) return false;
  const box = m.box().inflate(20);
  const list = m.level.getEntities(box, (e) => !!mobOf(e) && !!imitationOf(e.type) && !e.living?.dead);
  if (!list.length) return false;
  const pick = list[m.random.nextInt(list.length)]!;
  m.level.playSound(m.x, m.y, m.z, imitationOf(pick.type)!, 0.7, imitationPitch(m));
  return true;
}

/** Wandering prefers treetops (reference ParrotWanderGoal). */
class ParrotWanderGoal extends RandomFlyingGoal {
  protected override position(): Vec3 | null {
    if (this.m.inWater) return super.position();
    if (this.m.random.nextFloat() >= 0.01) {
      const tree = this.treePos();
      if (tree) return tree;
    }
    return super.position();
  }
  private treePos(): Vec3 | null {
    const level = this.m.level;
    const bx = Math.floor(this.m.x), by = Math.floor(this.m.y), bz = Math.floor(this.m.z);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -6; dy <= 8; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx === 0 && dz === 0 && dy === 0) continue;
          const x = bx + dx, y = by + dy, z = bz + dz;
          const b = blockOf(level.getBlockState(x, y - 1, z));
          if (!(blockHasTag(b, 'leaves') || blockHasTag(b, 'logs'))) continue;
          if (!(stateFlags[level.getBlockState(x, y, z)]! & F.AIR) || !(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR)) continue;
          return [x + 0.5, y, z + 0.5];
        }
      }
    }
    return null;
  }
}

/** Follow other nearby mobs around (reference FollowMobGoal). */
class FollowMobGoal extends Goal {
  private followed: Entity | null = null;
  private recalc = 0;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly stopDist: number, private readonly area: number) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const list = this.m.level.getEntities(this.m.box().inflate(this.area), (e) => !!mobOf(e) && e.type !== this.m.def.id && !e.living?.dead && !e['invisible']);
    if (!list.length) return false;
    this.followed = list[0]!;
    return true;
  }
  override canContinueToUse(): boolean {
    const f = this.followed;
    return !!f && !f.removed && !this.m.nav.isDone() && this.m.distanceToSqr(f) > this.stopDist * this.stopDist;
  }
  override start(): void {
    this.recalc = 0;
    this.m.nav.setMalus(PathType.WATER, 0);
  }
  override stop(): void {
    this.followed = null;
    this.m.nav.stop();
  }
  override tick(): void {
    const f = this.followed;
    if (!f || isOrderedToSit(this.m)) return;
    this.m.look.setLookAtEntity(f, 10, 40);
    if (--this.recalc > 0) return;
    this.recalc = this.adjustedTickDelay(10);
    const d = this.m.distanceToSqr(f);
    if (d > this.stopDist * this.stopDist) this.m.nav.moveToEntity(f, this.speed);
    else {
      this.m.nav.stop();
      const t = f.transform!;
      if (d <= this.stopDist * this.stopDist) this.m.move.setWantedPosition(this.m.x - (t.x - this.m.x), this.m.y, this.m.z - (t.z - this.m.z), this.speed);
    }
  }
}

/** Hop onto the owner's shoulder when touching them (reference LandOnOwnersShoulderGoal). */
class LandOnOwnersShoulderGoal extends Goal {
  private riding = false;
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    const o = ownerOf(this.m);
    const p = o?.player;
    if (!o || !p || p.gameMode === 'spectator' || p.abilities.flying || o.physics?.inWater || o.physics?.inPowderSnow) return false;
    return !isOrderedToSit(this.m) && ((this.m.tmp['rideCooldown'] as number | undefined) ?? 0) > 100;
  }
  override isInterruptable(): boolean {
    return !this.riding;
  }
  override start(): void {
    this.riding = false;
  }
  override tick(): void {
    if (this.riding || isInSittingPose(this.m) || this.m.leashHolder) return;
    const o = ownerOf(this.m);
    if (!o) return;
    const player = this.m.level.players.find((pl) => pl.entity === o);
    if (player && this.m.box().intersects(hitbox(player.entity))) this.riding = setEntityOnShoulder(player, this.m);
  }
}

// ---- Jukebox dancing -------------------------------------------------------------------------

function nearPlayingJukebox(m: Mob): boolean {
  const level = m.level;
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dy * dy + dz * dz > 12) continue;
        const s = level.getBlockState(bx + dx, by + dy, bz + dz);
        if (blockOf(s).name === 'jukebox' && tryGetValue(s, P.hasRecord) === true) return true;
      }
    }
  }
  return false;
}

registerMob({
  id: 'parrot', attrs: { max_health: 6, flying_speed: 0.4, movement_speed: 0.2, attack_damage: 3 }, nav: 'fly', move: 'hover',
  malus: { [PathType.DANGER_FIRE]: -1, [PathType.DAMAGE_FIRE]: -1, [PathType.COCOA]: -1 }, noFallDamage: true,
  loot: 'entities/parrot', xp: (m) => 1 + m.random.nextInt(3), ...sounds('parrot'),
  ambientFor(m) {
    // One time in a thousand a parrot imitates a random monster even with none nearby
    if (m.level.getDifficulty() !== 0 && m.random.nextInt(1000) === 0) {
      const hostile = [...MOB_DEFS.values()].filter((d) => d.hostile);
      if (hostile.length) return imitationOf(hostile[m.random.nextInt(hostile.length)]!.id);
    }
    return 'entity.parrot.ambient';
  },
  setup(m) {
    m.goals.add(0, new TamablePanicGoal(m, 1.25));
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new LookAtPlayerGoal(m, 8));
    m.goals.add(2, new SitWhenOrderedToGoal(m));
    m.goals.add(2, new FollowOwnerGoal(m, 1, 5, 1, true));
    m.goals.add(2, new ParrotWanderGoal(m, 1));
    m.goals.add(3, new LandOnOwnersShoulderGoal(m));
    m.goals.add(3, new FollowMobGoal(m, 1, 3, 7));
  },
  init(m, ctx) {
    m.data['variant'] = (ctx.opts['variant'] as string | undefined) ?? PARROT_VARIANTS[m.random.nextInt(PARROT_VARIANTS.length)];
  },
  loaded(m) {
    if (isOrderedToSit(m)) setInSittingPose(m, true);
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'red_blue');
    m.setMeta('tamed', isTame(m));
    m.setMeta('sitting', isInSittingPose(m));
  },
  tick(m) {
    m.tmp['rideCooldown'] = ((m.tmp['rideCooldown'] as number | undefined) ?? 0) + 1;
    if (m.tickCount % 20 === 0) m.setMeta('dancing', nearPlayingJukebox(m));
    if (m.random.nextInt(400) === 0) imitateNearbyMobs(m);
    // Parrots glide down slowly when not flapping
    const p = m.e.physics;
    if (!m.onGround && p.vy < 0) p.vy *= 0.6;
    m.setMeta('flying', !m.onGround);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (!isTame(m) && SEEDS(s)) {
      useItem(p, hand, s);
      m.playSound('entity.parrot.eat');
      tameAttempt(m, p, 10);
      return true;
    }
    if (s.id === 'cookie') {
      useItem(p, hand, s);
      m.level.addEntityEffect(m.e, 'poison', 900, 0);
      m.level.hurtEntity(m.e, 'player_attack', Number.MAX_VALUE, p.entity);
      return true;
    }
    if (m.onGround && isTame(m) && isOwnedBy(m, p.entity)) return toggleSit(m, p);
    return false;
  },
  canMate: () => false,
  canSpawn(level, x, y, z) {
    const b = blockOf(level.getBlockState(x, y - 1, z));
    return (blockHasTag(b, 'leaves') || b.name === 'grass_block' || blockHasTag(b, 'logs')) && level.getMaxLocalRawBrightness(x, y, z) > 8;
  },
});

// ---- Shoulders --------------------------------------------------------------------------------

interface Shoulders {
  left?: SavedEntity;
  right?: SavedEntity;
  since: number;
}

function shouldersOf(p: ServerPlayer): Shoulders {
  let s = p.entity['shoulders'] as Shoulders | undefined;
  if (!s) {
    s = { since: 0 };
    p.entity['shoulders'] = s;
  }
  return s;
}

function variantOf(s: SavedEntity | undefined): string {
  return s ? (((s.data['data'] as Record<string, unknown> | undefined)?.['variant'] as string | undefined) ?? 'red_blue') : '';
}

/** Tell everyone (including the player) which parrots ride on the player's shoulders. */
function syncShoulders(p: ServerPlayer): void {
  const sh = shouldersOf(p);
  const e = p.entity;
  e.meta ??= {};
  e.meta['shoulderLeft'] = variantOf(sh.left);
  e.meta['shoulderRight'] = variantOf(sh.right);
  if (e.net) e.net.metaDirty = true;
  p.send({ type: 'entityMeta', id: e.id, meta: { shoulderLeft: e.meta['shoulderLeft'], shoulderRight: e.meta['shoulderRight'] } });
}

export function setEntityOnShoulder(p: ServerPlayer, m: Mob): boolean {
  const e = p.entity, ph = e.physics;
  if (vehicleOf(e) || !ph.onGround || ph.inWater || ph.inPowderSnow) return false;
  const sh = shouldersOf(p);
  if (sh.left && sh.right) return false;
  const saved = saveEntity(m.e);
  if (!saved) return false;
  if (!sh.left) sh.left = saved;
  else sh.right = saved;
  sh.since = p.level.getGameTime();
  m.level.entities.remove(m.e);
  syncShoulders(p);
  return true;
}

/** Let the shoulder parrots fly off (reference Player.removeEntitiesOnShoulder). */
export function releaseShoulders(p: ServerPlayer, force = false): void {
  const sh = shouldersOf(p);
  if (!sh.left && !sh.right) return;
  if (!force && sh.since + 20 >= p.level.getGameTime()) return;
  const t = p.entity.transform;
  for (const [side, saved] of [[-1, sh.left], [1, sh.right]] as const) {
    if (!saved) continue;
    const yaw = (t.bodyYaw * Math.PI) / 180;
    saved.pos = [t.x + Math.cos(yaw) * 0.4 * side, t.y + 0.7, t.z + Math.sin(yaw) * 0.4 * side];
    saved.vel = [0, 0, 0];
    const e = loadEntity(p.level, saved);
    if (!e) continue;
    p.level.addFreshEntity(e);
    const m = mobOf(e);
    if (m) {
      m.tmp['rideCooldown'] = 0;
      m.def.syncMeta?.(m);
    }
  }
  sh.left = sh.right = undefined;
  syncShoulders(p);
}

/** Per-tick shoulder rules: fall, water, flight, sleep and powder snow release; ambient chatter. */
export function tickShoulders(p: ServerPlayer, sleeping: boolean): void {
  const sh = p.entity['shoulders'] as Shoulders | undefined;
  if (!sh || (!sh.left && !sh.right)) return;
  const ph = p.entity.physics;
  if (ph.fallDistance > 0.5 || ph.inWater || p.data.abilities.flying || sleeping || ph.inPowderSnow) {
    releaseShoulders(p);
    return;
  }
  const level = p.level;
  if (level.random.nextInt(200) === 0) {
    const t = p.entity.transform;
    // Shoulder parrots imitate monsters nearby or chatter
    const box = { minX: t.x - 20, minY: t.y - 20, minZ: t.z - 20, maxX: t.x + 20, maxY: t.y + 20, maxZ: t.z + 20 };
    const hostile = [...level.entities.all()].filter((e) => {
      const et = e.transform;
      return !!et && !!imitationOf(e.type) && et.x >= box.minX && et.x <= box.maxX && et.y >= box.minY && et.y <= box.maxY && et.z >= box.minZ && et.z <= box.maxZ;
    });
    const sound = hostile.length && level.random.nextInt(2) === 0 ? imitationOf(hostile[level.random.nextInt(hostile.length)]!.type)! : 'entity.parrot.ambient';
    level.playSound(t.x, t.y, t.z, sound, 1, (level.random.nextFloat() - level.random.nextFloat()) * 0.2 + 1);
  }
}

export function saveShoulders(p: ServerPlayer): Shoulders | undefined {
  const sh = p.entity['shoulders'] as Shoulders | undefined;
  return sh && (sh.left || sh.right) ? sh : undefined;
}

export function loadShoulders(p: ServerPlayer, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const d = data as Shoulders;
  p.entity['shoulders'] = { left: d.left, right: d.right, since: 0 } satisfies Shoulders;
  syncShoulders(p);
}
