/**
 * Classic monsters: spiders and cave spiders (wall climbing, daylight neutrality, jockeys),
 * voidwalkers (stare aggression, teleporting, carrying blocks, water sensitivity), voidmites,
 * slimes (sizes, bouncing, splitting), silverfish (infested blocks, waking friends), drowned
 * (swimming, tridents, nautilus shells) and phantoms (insomnia spawns, circling and swooping).
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, blockHasTag, getBlock, stateFlags, F, getCollisionShape, tryGetValue, setValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { addEffect } from '../../survival/living';
import { AABB } from '../../../common/math/geom';
import { registerMob, Mob, mobOf, yawTo, rotlerp, wrapDegrees } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import { MoveControl, SlimeMoveControl } from '../controls';
import {
  FloatGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, LeapAtTargetGoal, MeleeAttackGoal, HurtByTargetGoal,
  NearestAttackableTargetGoal, AvoidEntityGoal, MoveToBlockGoal,
} from '../goallib';
import { PathType } from '../pathfinding';
import { attackablePlayer, canTarget, hitbox } from '../targeting';
import { createMob, updateSize } from '../factory';
import { mobThrow, RangedAttackGoal } from '../../combat/ranged';
import { startRiding } from '../../entity/riding';
import { zombieDef, zombieInit, RemoveTurtleEggGoal } from './undead';
import { sounds, equip } from './common';

type V3 = [number, number, number];

/** Reference light-dependent value: brightness scaled 0..1. */
function brightnessAt(m: Mob): number {
  return m.level.getMaxLocalRawBrightness(Math.floor(m.x), Math.floor(m.eyeY), Math.floor(m.z)) / 15;
}

// =============================================================================================
// Spiders
// =============================================================================================

class SpiderAttackGoal extends MeleeAttackGoal {
  override canContinueToUse(): boolean {
    if (brightnessAt(this.m) >= 0.5 && this.m.random.nextInt(100) === 0) {
      this.m.setTarget(null);
      return false;
    }
    return super.canContinueToUse();
  }
}

/** Spiders only pick targets in the dark (reference SpiderTargetGoal). */
class SpiderTargetGoal extends NearestAttackableTargetGoal {
  override canUse(): boolean {
    return brightnessAt(this.m) < 0.5 && super.canUse();
  }
}

const SPIDER_EFFECTS = ['speed', 'strength', 'regeneration', 'invisibility'];

function spiderDef(id: 'spider' | 'cave_spider'): void {
  registerMob({
    id, attrs: id === 'spider' ? { max_health: 16, movement_speed: 0.3, attack_damage: 2 } : { max_health: 12, movement_speed: 0.3, attack_damage: 2 },
    nav: 'climber', arthropod: true, hostile: true, xp: 5, ...sounds('spider'), headItem: undefined,
    setup(m) {
      m.goals.add(1, new FloatGoal(m));
      m.goals.add(2, new AvoidEntityGoal(m, (e) => e.type === 'armadillo' && mobOf(e)?.e.meta['state'] !== 'idle' ? false : e.type === 'armadillo', 6, 1, 1.2));
      m.goals.add(3, new LeapAtTargetGoal(m, 0.4));
      m.goals.add(4, new SpiderAttackGoal(m, 1, true));
      m.goals.add(5, new RandomStrollGoal(m, 0.8, 120, true, true));
      m.goals.add(6, new LookAtPlayerGoal(m, 8));
      m.goals.add(6, new RandomLookAroundGoal(m));
      m.targets.add(1, new HurtByTargetGoal(m));
      m.targets.add(2, new SpiderTargetGoal(m, 'player', 10, true));
      m.targets.add(3, new SpiderTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
    },
    init(m, ctx) {
      const r = m.random;
      // One spider in a hundred carries a skeleton rider
      if (id === 'spider' && ctx.reason !== 'spawner' && r.nextInt(100) === 0 && ctx.reason !== 'breeding') {
        const sk = createMob(m.level, 'skeleton', m.x, m.y, m.z, { reason: 'jockey', yaw: m.e.transform.yaw });
        if (sk) {
          m.level.addFreshEntity(sk);
          startRiding(m.level, sk, m.e);
        }
      }
      if (m.level.getDifficulty() === 3 && r.nextFloat() < 0.1 * Math.max(0, Math.min(1, (ctx.difficulty - 2) / 2))) {
        const fx = SPIDER_EFFECTS[r.nextInt(SPIDER_EFFECTS.length)]!;
        addEffect(m.level, m.e, { id: fx, amp: 0, dur: -1, ambient: false, particles: true, icon: true });
      }
    },
    tick(m) {
      // Climb whatever the spider bumps into
      const climbing = m.e.physics.horizontalCollision;
      m.e['climbing'] = climbing;
      m.setMeta('climbing', climbing);
    },
    hurtFilter(_m, type, amount) {
      return type === 'poison' ? 0 : amount;
    },
    doHurtTarget: id === 'cave_spider' ? (m, target) => {
      const ok = m.level.hurtEntity(target, 'mob_attack', m.attr('attack_damage'), m.e);
      if (ok && target.living) {
        const d = m.level.getDifficulty();
        const secs = d === 2 ? 7 : d === 3 ? 15 : 0;
        if (secs > 0) m.level.addEntityEffect(target, 'poison', secs * 20, 0);
      }
      return ok;
    } : undefined,
    canSpawn: id === 'cave_spider' ? (_l, _x, _y, _z, reason) => reason !== 'natural' : undefined,
  });
}
spiderDef('spider');
spiderDef('cave_spider');

// =============================================================================================
// Voidwalker
// =============================================================================================

const HOLDABLE = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'sand', 'red_sand', 'gravel', 'clay', 'pumpkin', 'carved_pumpkin',
  'melon', 'tnt', 'cactus', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_nylium', 'warped_nylium', 'crimson_roots',
  'warped_roots', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots',
]);

function holdable(state: number): boolean {
  const b = blockOf(state);
  return HOLDABLE.has(b.name) || blockHasTag(b, 'small_flowers');
}

/** Teleport to a random or given spot with solid ground and room (reference randomTeleport). */
export function randomTeleport(m: Mob, x: number, y: number, z: number): boolean {
  const level = m.level;
  let by = Math.floor(y);
  const bx = Math.floor(x), bz = Math.floor(z);
  if (!level.isLoaded(bx, bz)) return false;
  let found = false;
  while (!found && by > level.minY) {
    const below = level.getBlockState(bx, by - 1, bz);
    if (stateFlags[below]! & F.SOLID) found = true;
    else by--;
  }
  if (!found) return false;
  for (let h = 0; h < Math.ceil(m.height); h++) {
    const s = level.getBlockState(bx, by + h, bz);
    if (getCollisionShape(s).length || stateFlags[s]! & (F.WATER | F.LAVA)) return false;
  }
  const t = m.e.transform;
  const ox = t.x, oy = t.y, oz = t.z;
  t.x = t.px = x; t.y = t.py = by; t.z = t.pz = z;
  m.e.physics.vx = m.e.physics.vy = m.e.physics.vz = 0;
  if (m.e.net) m.e.net.forceSync = true;
  m.nav.stop();
  m.level.gameEvent('teleport', ox, oy, oz, m.e);
  m.level.addParticle('portal', ox, oy + m.height / 2, oz, 0, 0, 0, 32);
  m.level.playSound(ox, oy, oz, 'entity.voidwalker.teleport', 1, 1);
  m.playSound('entity.voidwalker.teleport');
  return true;
}

function teleportRandomly(m: Mob): boolean {
  if (m.inWater || !m.alive) return false;
  const r = m.random;
  return randomTeleport(m, m.x + (r.nextDouble() - 0.5) * 64, m.y + (r.nextInt(64) - 32), m.z + (r.nextDouble() - 0.5) * 64);
}

function teleportTowards(m: Mob, e: Entity): boolean {
  const t = e.transform!;
  let vx = m.x - t.x, vy = m.y + m.height / 2 - (t.y + (e.physics?.eyeHeight ?? 1.6)), vz = m.z - t.z;
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  vx /= len; vy /= len; vz /= len;
  const r = m.random;
  return randomTeleport(m, m.x + (r.nextDouble() - 0.5) * 8 - vx * 16, m.y + (r.nextInt(16) - 8) - vy * 16, m.z + (r.nextDouble() - 0.5) * 8 - vz * 16);
}

/** A player staring at the voidwalker's head (without a carved pumpkin on). */
export function isLookingAtMe(m: Mob, e: Entity): boolean {
  const inv = e.player?.inventory;
  if (!inv || inv.get(39).id === 'carved_pumpkin') return false;
  const t = e.transform!;
  const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
  const lx = -Math.sin(yaw) * Math.cos(pitch), ly = -Math.sin(pitch), lz = Math.cos(yaw) * Math.cos(pitch);
  let dx = m.x - t.x, dy = m.eyeY - (t.y + (e.physics?.eyeHeight ?? 1.62)), dz = m.z - t.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= d; dy /= d; dz /= d;
  const dot = lx * dx + ly * dy + lz * dz;
  return dot > 1 - 0.025 / d && m.hasLineOfSight(e);
}

function setVoidTarget(m: Mob, e: Entity | null): void {
  const speed = m.e.living.attrs.get('movement_speed');
  speed.remove('attacking_boost');
  if (e) {
    m.tmp['targetChange'] = m.tickCount;
    m.setMeta('creepy', true);
    speed.add({ id: 'attacking_boost', amount: 0.15, op: 'add' });
  } else {
    m.setMeta('creepy', false);
    m.tmp['stared'] = false;
  }
  m.e.input.speed = m.speed;
}

class VoidwalkerFreezeGoal extends Goal {
  private target: Entity | null = null;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    this.target = this.m.getTarget();
    const t = this.target;
    if (!t?.player || this.m.distanceToSqr(t) > 256) return false;
    return isLookingAtMe(this.m, t);
  }
  override start(): void {
    this.m.nav.stop();
  }
  override tick(): void {
    const t = this.target!.transform!;
    this.m.look.setLookAt(t.x, t.y + 1.62, t.z);
  }
}

/** Notice a staring player, scream, then hunt them (reference EndermanLookForPlayerGoal). */
class VoidwalkerLookForPlayerGoal extends NearestAttackableTargetGoal {
  private pending: Entity | null = null;
  private aggroTime = 0;
  private teleportTime = 0;
  constructor(private readonly v: Mob) {
    super(v, 'player', 10, false, false, (e) => isLookingAtMe(v, e) || isAngryAtVoid(v, e));
  }
  override canUse(): boolean {
    const ok = super.canUse();
    if (ok) this.pending = this.v.getTarget() ?? null;
    return ok;
  }
  override start(): void {
    this.aggroTime = this.adjustedTickDelay(5);
    this.teleportTime = 0;
    this.v.tmp['stared'] = true;
    this.v.playSound('entity.voidwalker.stare', 2.5);
    super.start();
    this.pending = this.v.getTarget();
    setVoidTarget(this.v, this.pending);
  }
  override stop(): void {
    this.pending = null;
    setVoidTarget(this.v, null);
    super.stop();
  }
  override tick(): void {
    const v = this.v, t = v.getTarget();
    if (!t) return;
    if (this.aggroTime > 0) {
      this.aggroTime--;
      v.look.setLookAtEntity(t, 10, 10);
      return;
    }
    if (isLookingAtMe(v, t)) {
      if (v.distanceToSqr(t) < 16) teleportRandomly(v);
      this.teleportTime = 0;
    } else if (v.distanceToSqr(t) > 256 && this.teleportTime++ >= this.adjustedTickDelay(30) && teleportTowards(v, t)) {
      this.teleportTime = 0;
    }
  }
}

function isAngryAtVoid(m: Mob, e: Entity): boolean {
  return ((m.data['anger'] as number | undefined) ?? 0) > 0 && m.tmp['angerTarget'] === e.id;
}

class VoidwalkerTakeBlockGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    const m = this.m;
    if (m.data['carried'] || m.level.getGameRule('mobGriefing') === false) return false;
    return m.random.nextInt(reducedTickDelay(20)) === 0;
  }
  override tick(): void {
    const m = this.m, r = m.random;
    const x = Math.floor(m.x - 2 + r.nextDouble() * 4), y = Math.floor(m.y + r.nextDouble() * 3), z = Math.floor(m.z - 2 + r.nextDouble() * 4);
    const s = m.level.getBlockState(x, y, z);
    if (!holdable(s)) return;
    // Must see the block
    const hit = m.level.getBlockState(Math.floor((m.x + x + 0.5) / 2), Math.floor((m.eyeY + y + 0.5) / 2), Math.floor((m.z + z + 0.5) / 2));
    if (getCollisionShape(hit).length && hit !== s) return;
    m.level.removeBlock(x, y, z);
    m.level.gameEvent('block_destroy', x, y, z, m.e, s);
    m.data['carried'] = s;
    m.setMeta('carried', s);
  }
}

class VoidwalkerLeaveBlockGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    const m = this.m;
    if (m.data['carried'] === undefined || m.level.getGameRule('mobGriefing') === false) return false;
    return m.random.nextInt(reducedTickDelay(2000)) === 0;
  }
  override tick(): void {
    const m = this.m, r = m.random, level = m.level;
    const x = Math.floor(m.x - 1 + r.nextDouble() * 2), y = Math.floor(m.y + r.nextDouble() * 2), z = Math.floor(m.z - 1 + r.nextDouble() * 2);
    const carried = m.data['carried'] as number;
    const here = level.getBlockState(x, y, z), below = level.getBlockState(x, y - 1, z);
    if (!(stateFlags[here]! & F.AIR) || !(stateFlags[below]! & F.FULL_COLLISION) || blockOf(below).name === 'bedrock') return;
    if (!blockOf(carried).behavior.canSurvive(carried, level, x, y, z)) return;
    if (level.getEntities(new AABB(x, y, z, x + 1, y + 1, z + 1)).length) return;
    level.setBlock(x, y, z, carried, 3);
    level.gameEvent('block_place', x, y, z, m.e, carried);
    delete m.data['carried'];
    m.setMeta('carried', 0);
  }
}

registerMob({
  id: 'voidwalker', attrs: { max_health: 40, movement_speed: 0.3, attack_damage: 7, follow_range: 64 }, stepHeight: 1, hostile: true,
  hurtByWater: true, xp: 5, ...sounds('voidwalker'), malus: { [PathType.WATER]: -1 },
  ambientFor(m) {
    return m.e.meta['creepy'] ? 'entity.voidwalker.scream' : 'entity.voidwalker.ambient';
  },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new VoidwalkerFreezeGoal(m));
    m.goals.add(2, new MeleeAttackGoal(m, 1, false));
    m.goals.add(7, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(8, new LookAtPlayerGoal(m, 8));
    m.goals.add(8, new RandomLookAroundGoal(m));
    m.goals.add(10, new VoidwalkerLeaveBlockGoal(m));
    m.goals.add(11, new VoidwalkerTakeBlockGoal(m));
    m.targets.add(1, new VoidwalkerLookForPlayerGoal(m));
    m.targets.add(2, new HurtByTargetGoal(m));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'voidmite' && !!mobOf(e)?.data['playerSpawned'], 10, true, false));
  },
  tick(m) {
    const a = (m.data['anger'] as number | undefined) ?? 0;
    if (a > 0) m.data['anger'] = a - 1;
    // In daylight under open sky, voidwalkers lose interest and blink away
    if (m.level.isDay() && m.tickCount >= ((m.tmp['targetChange'] as number | undefined) ?? 0) + 600) {
      const f = brightnessAt(m);
      if (f > 0.5 && m.level.canSeeSky(Math.floor(m.x), Math.floor(m.eyeY), Math.floor(m.z)) && m.random.nextFloat() * 30 < (f - 0.4) * 2) {
        m.setTarget(null);
        setVoidTarget(m, null);
        teleportRandomly(m);
      }
    }
    if (m.random.nextInt(4) === 0) m.broadcastEvent('portalParticles');
  },
  hurtFilter(m, type, amount) {
    // Projectiles never hit: the voidwalker teleports away instead
    if (['arrow', 'trident', 'thrown', 'mob_projectile', 'fireball'].includes(type)) {
      for (let i = 0; i < 64; i++) if (teleportRandomly(m)) break;
      return 0;
    }
    return amount;
  },
  onHurt(m, _type, _amount, attacker) {
    if (attacker?.player) {
      m.data['anger'] = 600 + m.random.nextInt(400);
      m.tmp['angerTarget'] = attacker.id;
      setVoidTarget(m, attacker);
    }
    // Hurt by something non-living (water, rain, fire…): usually teleport
    if (!attacker?.living && m.random.nextInt(10) !== 0) teleportRandomly(m);
  },
  onDeath(m) {
    const c = m.data['carried'] as number | undefined;
    if (c !== undefined && c > 0) m.level.spawnItem(m.x, m.y + 0.5, m.z, new ItemStack(blockOf(c).item ?? blockOf(c).name, 1));
  },
  syncMeta(m) {
    m.setMeta('carried', (m.data['carried'] as number | undefined) ?? 0);
  },
});

// ---- Voidmite --------------------------------------------------------------------------------

registerMob({
  id: 'voidmite', attrs: { max_health: 8, movement_speed: 0.25, attack_damage: 2 }, arthropod: true, hostile: true, xp: 3, loot: null,
  ...sounds('voidmite'),
  setup(m) {
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(2, new MeleeAttackGoal(m, 1, false));
    m.goals.add(3, new RandomStrollGoal(m, 1, 120, true, true));
    m.goals.add(7, new LookAtPlayerGoal(m, 8));
    m.goals.add(8, new RandomLookAroundGoal(m));
    m.targets.add(1, new HurtByTargetGoal(m).setAlertOthers());
    m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true));
  },
  tick(m) {
    // Voidmites fade away after two minutes
    if (!m.persistent) {
      const life = ((m.data['life'] as number | undefined) ?? 0) + 1;
      m.data['life'] = life;
      if (life >= 2400) m.level.entities.remove(m.e);
    }
    if (m.random.nextInt(3) === 0) m.broadcastEvent('portalParticles');
  },
});

// =============================================================================================
// Slime
// =============================================================================================

const slimeSize = (m: Mob) => (m.data['size'] as number | undefined) ?? 1;

export function setSlimeSize(m: Mob, size: number, heal: boolean): void {
  const s = Math.max(1, Math.min(127, size));
  m.data['size'] = s;
  const a = m.e.living.attrs;
  a.get('max_health').setBase(s * s);
  a.get('movement_speed').setBase(0.2 + 0.1 * s);
  a.get('attack_damage').setBase(s);
  if (heal) m.e.living.health = m.maxHealth;
  m.e.input.speed = m.speed;
  m.setMeta('size', s);
  updateSize(m);
}

function slimeMove(m: Mob): SlimeMoveControl {
  return m.move as SlimeMoveControl;
}

class SlimeAttackGoal extends Goal {
  private growTiredTimer = 0;
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.s.getTarget();
    return !!t && !t.living?.dead && canTarget(this.s, t, { range: 0, combat: true, lineOfSight: false, testInvisible: false });
  }
  override start(): void {
    this.growTiredTimer = reducedTickDelay(300);
  }
  override canContinueToUse(): boolean {
    return this.canUse() && --this.growTiredTimer > 0;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const t = this.s.getTarget();
    if (!t) return;
    this.s.look.setLookAtEntity(t, 10, 10);
    const tt = t.transform!;
    slimeMove(this.s).setDirection(yawTo(tt.x - this.s.x, tt.z - this.s.z), true);
  }
}

class SlimeRandomDirectionGoal extends Goal {
  private chosen = 0;
  private time = 0;
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    const s = this.s;
    return !s.getTarget() && (s.onGround || s.inWater || s.inLava || s.e.living.effects.has('levitation'));
  }
  override tick(): void {
    if (--this.time <= 0) {
      this.time = this.adjustedTickDelay(40 + this.s.random.nextInt(60));
      this.chosen = this.s.random.nextInt(360);
    }
    slimeMove(this.s).setDirection(this.chosen, false);
  }
}

class SlimeKeepOnJumpingGoal extends Goal {
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    return !this.s.e['vehicle'];
  }
  override tick(): void {
    slimeMove(this.s).setWantedMovement(1);
  }
}

class SlimeFloatGoal extends Goal {
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
    s.nav.canFloat = true;
  }
  canUse(): boolean {
    return (this.s.inWater || this.s.inLava);
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    if (this.s.random.nextFloat() < 0.8) this.s.jump.jump();
    slimeMove(this.s).setWantedMovement(1.2);
  }
}

/** Slime chunks: one chunk in ten, decided by the world seed and chunk position. */
export function isSlimeChunk(seed: number, cx: number, cz: number): boolean {
  let h = (seed ^ Math.imul(cx, 0x4c1906) ^ Math.imul(cx * cx, 0x5ac0db) ^ Math.imul(cz, 0x4307a7) ^ Math.imul(cz * cz, 0x5f24f) ^ 0x3ad8025f) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) % 10 === 0;
}

registerMob({
  id: 'slime', attrs: { max_health: 1, movement_speed: 0.3, attack_damage: 1 }, move: 'slime', hostile: true, spawnDarkness: false,
  xp: (m) => slimeSize(m), hurtSound: 'entity.slime.hurt', deathSound: 'entity.slime.death',
  setup(m) {
    m.goals.add(1, new SlimeFloatGoal(m));
    m.goals.add(2, new SlimeAttackGoal(m));
    m.goals.add(3, new SlimeRandomDirectionGoal(m));
    m.goals.add(5, new SlimeKeepOnJumpingGoal(m));
    m.targets.add(1, new NearestAttackableTargetGoal(m, 'player', 10, true, false, (e) => Math.abs(e.transform!.y - m.y) <= 4));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
  },
  init(m, ctx) {
    let size = ctx.opts['size'] as number | undefined;
    if (size === undefined) {
      let i = m.random.nextInt(3);
      if (i < 2 && m.random.nextFloat() < 0.5 * Math.max(0, Math.min(1, (ctx.difficulty - 2) / 2))) i++;
      size = 1 << i;
    }
    setSlimeSize(m, size, true);
  },
  loaded(m) {
    setSlimeSize(m, slimeSize(m), false);
  },
  size(m) {
    const s = slimeSize(m);
    return [0.52 * s, 0.52 * s, 0.325 * s];
  },
  tick(m) {
    // Big slimes hurt what they touch
    const s = slimeSize(m);
    if (s > 1) {
      const r = 0.6 * s;
      for (const e of m.level.getEntities(m.box().inflate(0.2), (e) => (e.player ? attackablePlayer(e) : e.type === 'iron_golem') && e !== m.e)) {
        if (m.distanceToSqr(e) < r * r && m.hasLineOfSight(e) && m.level.hurtEntity(e, 'mob_attack', m.attr('attack_damage'), m.e)) {
          m.playSound('entity.slime.attack', 1, (m.random.nextFloat() - m.random.nextFloat()) * 0.2 + 1);
        }
      }
    }
    // Landing squish
    const was = m.tmp['wasOnGround'] as boolean | undefined;
    if (m.onGround && was === false) {
      m.broadcastEvent('squish');
      m.playSound(s > 1 ? 'entity.slime.squish' : 'entity.slime.squish_small', 0.4 * s);
    }
    m.tmp['wasOnGround'] = m.onGround;
  },
  onDeath(m) {
    // Split into two to four smaller slimes
    const s = slimeSize(m);
    if (s <= 1) return;
    const n = 2 + m.random.nextInt(3);
    for (let i = 0; i < n; i++) {
      const ox = ((i % 2) - 0.5) * s / 4, oz = (Math.floor(i / 2) - 0.5) * s / 4;
      const c = m.level.createEntity('slime', m.x + ox, m.y + 0.5, m.z + oz, { reason: 'triggered', size: Math.floor(s / 2) });
      const cm = mobOf(c);
      if (cm) {
        if (m.persistent) cm.setPersistent();
        if (m.e['customName']) c!['customName'] = m.e['customName'];
        cm.e.transform.yaw = m.random.nextFloat() * 360;
      }
    }
  },
  lootFlags(m) {
    return { size: slimeSize(m) };
  },
  canSpawn(level, x, y, z, reason, r) {
    if (reason !== 'natural') return true;
    if (level.getDifficulty() === 0) return false;
    const b = BIOMES[level.getBiome(x, y, z)];
    // Swamps at night by moon phase, or anywhere deep in a slime chunk
    if (b?.category === 'swamp' && y > 50 && y < 70) {
      const moon = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75][Math.floor(level.getDayTime() / 24000) % 8]!;
      if (r.nextFloat() < 0.5 && r.nextFloat() < moon && level.getMaxLocalRawBrightness(x, y, z) <= r.nextInt(8)) return true;
    }
    if (r.nextInt(10) === 0 && y < 40 && isSlimeChunk(level.seed.lo, x >> 4, z >> 4)) return true;
    return false;
  },
});

// =============================================================================================
// Silverfish
// =============================================================================================

const INFESTABLE: Record<string, string> = {
  stone: 'infested_stone', cobblestone: 'infested_cobblestone', stone_bricks: 'infested_stone_bricks', mossy_stone_bricks: 'infested_mossy_stone_bricks',
  cracked_stone_bricks: 'infested_cracked_stone_bricks', chiseled_stone_bricks: 'infested_chiseled_stone_bricks', deepslate: 'infested_deepslate',
};
const HOST_OF: Record<string, string> = Object.fromEntries(Object.entries(INFESTABLE).map(([k, v]) => [v, k]));

/** Turn an infested block back into its host and release a silverfish. */
export function releaseSilverfish(level: Mob['level'], x: number, y: number, z: number, state: number, destroy: boolean): void {
  const b = blockOf(state);
  const host = HOST_OF[b.name];
  if (!host) return;
  if (destroy) level.destroyBlock(x, y, z, false);
  else {
    let s = getBlock(host).defaultState;
    if (host === 'deepslate') s = setValue(s, P.axis, tryGetValue(state, P.axis) ?? 'y');
    level.setBlock(x, y, z, s, 3);
  }
  const sf = level.createEntity('silverfish', x + 0.5, y, z + 0.5, { reason: 'triggered' });
  if (sf) mobOf(sf)?.broadcastEvent('poof');
}

class WakeUpFriendsGoal extends Goal {
  private lookForFriends = 0;
  constructor(private readonly s: Mob) {
    super();
  }
  notifyHurt(): void {
    if (this.lookForFriends === 0) this.lookForFriends = this.adjustedTickDelay(20);
  }
  canUse(): boolean {
    return this.lookForFriends > 0;
  }
  override tick(): void {
    if (--this.lookForFriends > 0) return;
    const s = this.s, level = s.level, r = s.random;
    const bx = Math.floor(s.x), by = Math.floor(s.y), bz = Math.floor(s.z);
    const grief = level.getGameRule('mobGriefing') !== false;
    for (let dy = 0; dy <= 5 && dy >= -5; dy = (dy <= 0 ? 1 : 0) - dy) {
      for (let dx = 0; dx <= 10 && dx >= -10; dx = (dx <= 0 ? 1 : 0) - dx) {
        for (let dz = 0; dz <= 10 && dz >= -10; dz = (dz <= 0 ? 1 : 0) - dz) {
          const x = bx + dx, y = by + dy, z = bz + dz;
          const st = level.getBlockState(x, y, z);
          if (!HOST_OF[blockOf(st).name]) continue;
          releaseSilverfish(level, x, y, z, st, grief);
          if (r.nextBool()) return;
        }
      }
    }
  }
}

class MergeWithStoneGoal extends Goal {
  private dir = 0;
  private doMerge = false;
  constructor(private readonly s: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const s = this.s;
    if (s.getTarget() || !s.nav.isDone()) return false;
    if (s.level.getGameRule('mobGriefing') === false || s.random.nextInt(reducedTickDelay(10)) !== 0) return false;
    this.dir = s.random.nextInt(6);
    const [x, y, z] = this.target();
    this.doMerge = !!INFESTABLE[blockOf(s.level.getBlockState(x, y, z)).name];
    return this.doMerge;
  }
  private target(): V3 {
    const s = this.s;
    const d = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][this.dir]!;
    return [Math.floor(s.x) + d[0]!, Math.floor(s.y + 0.5) + d[1]!, Math.floor(s.z) + d[2]!];
  }
  override canContinueToUse(): boolean {
    return false;
  }
  override start(): void {
    if (!this.doMerge) return;
    const s = this.s, [x, y, z] = this.target();
    const st = s.level.getBlockState(x, y, z);
    const inf = INFESTABLE[blockOf(st).name];
    if (!inf) return;
    let ns = getBlock(inf).defaultState;
    if (inf === 'infested_deepslate') ns = setValue(ns, P.axis, tryGetValue(st, P.axis) ?? 'y');
    s.level.setBlock(x, y, z, ns, 3);
    s.broadcastEvent('poof');
    s.level.entities.remove(s.e);
  }
}

registerMob({
  id: 'silverfish', attrs: { max_health: 8, movement_speed: 0.25, attack_damage: 1 }, arthropod: true, hostile: true, xp: 5, loot: null, spawnDarkness: false,
  ...sounds('silverfish'),
  setup(m) {
    const wake = new WakeUpFriendsGoal(m);
    m.tmp['wakeGoal'] = wake;
    m.goals.add(1, new FloatGoal(m));
    m.goals.add(3, wake);
    m.goals.add(4, new MeleeAttackGoal(m, 1, false));
    m.goals.add(5, new MergeWithStoneGoal(m));
    m.targets.add(1, new HurtByTargetGoal(m).setAlertOthers());
    m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true));
  },
  onHurt(m, type, _a, attacker) {
    if (attacker?.player || type === 'magic' || type === 'indirect_magic') (m.tmp['wakeGoal'] as WakeUpFriendsGoal).notifyHurt();
  },
  canSpawn(level, x, y, z, reason) {
    if (reason === 'natural') return level.getMaxLocalRawBrightness(x, y, z) <= 5 && !level.getPlayers().some((p) => (p.transform!.x - x) ** 2 + (p.transform!.y - y) ** 2 + (p.transform!.z - z) ** 2 < 25);
    return true;
  },
});

// =============================================================================================
// Drowned
// =============================================================================================

/** Drowned hunt swimmers, and anyone at night or in the rain (reference Drowned.okTarget). */
function drownedOkTarget(m: Mob, e: Entity | null): boolean {
  if (!e) return false;
  return !m.level.isDay() || !!e.physics?.inWater;
}

class DrownedAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    return super.canUse() && drownedOkTarget(this.m, this.m.getTarget()) && this.m.equipment[0]!.id !== 'trident';
  }
  override canContinueToUse(): boolean {
    return super.canContinueToUse() && drownedOkTarget(this.m, this.m.getTarget());
  }
}

class DrownedGoToWaterGoal extends MoveToBlockGoal {
  constructor(private readonly d: Mob) {
    super(d, 1, 10, 2);
  }
  override canUse(): boolean {
    return this.d.level.isDay() && !this.d.inWater && super.canUse();
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    return !!(stateFlags[this.d.level.getBlockState(x, y, z)]! & F.WATER);
  }
  protected override moveTarget(): V3 {
    return [this.blockPos[0], this.blockPos[1], this.blockPos[2]];
  }
}

class DrownedGoToBeachGoal extends MoveToBlockGoal {
  constructor(private readonly d: Mob) {
    super(d, 1, 8, 2);
  }
  override canUse(): boolean {
    return super.canUse() && !this.d.level.isDay() && this.d.inWater && this.d.y >= 60;
  }
  protected isValidTarget(x: number, y: number, z: number): boolean {
    const level = this.d.level;
    return !!(stateFlags[level.getBlockState(x, y, z)]! & F.AIR) && !!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.AIR)
      && !!(stateFlags[level.getBlockState(x, y - 1, z)]! & F.SOLID);
  }
  override start(): void {
    this.d.tmp['searchingForLand'] = false;
    super.start();
  }
}

class DrownedSwimUpGoal extends Goal {
  private stuck = false;
  constructor(private readonly d: Mob, private readonly speed: number, private readonly seaLevel: number) {
    super();
  }
  canUse(): boolean {
    return !this.d.level.isDay() && this.d.inWater && this.d.y < this.seaLevel - 2;
  }
  override canContinueToUse(): boolean {
    return this.canUse() && !this.stuck;
  }
  override start(): void {
    this.stuck = false;
  }
  override tick(): void {
    const d = this.d;
    if (d.y < this.seaLevel - 1 && (d.nav.isDone() || (d.tmp['closeToTarget'] as boolean | undefined))) {
      const ok = d.nav.moveTo(d.x + d.random.nextInt(8) - 4, this.seaLevel - 1, d.z + d.random.nextInt(8) - 4, this.speed);
      if (!ok) this.stuck = true;
    }
  }
}

registerMob({
  ...zombieDef('drowned', {}),
  nav: 'amphibious', move: 'swim', swimStyle: 'smooth', stepHeight: 1, waterBreather: true,
  malus: { [PathType.WATER]: 0 },
  ambientFor(m) {
    return m.inWater ? 'entity.drowned.ambient_water' : 'entity.drowned.ambient';
  },
  setup(m) {
    m.goals.add(1, new DrownedGoToWaterGoal(m));
    m.goals.add(4, new RemoveTurtleEggGoal(m, 1, 3));
    m.goals.add(2, new RangedAttackGoal(m, 1, 40, 40, 10, (mm, t) => {
      mobThrow(mm, t, 'trident', 1.6, 14 - mm.level.getDifficulty() * 4, mm.equipment[0]!.copy());
      mm.playSound('entity.drowned.shoot');
    }));
    m.goals.add(2, new DrownedAttackGoal(m, 1, false));
    m.goals.add(5, new DrownedGoToBeachGoal(m));
    m.goals.add(6, new DrownedSwimUpGoal(m, 1, 63));
    m.goals.add(7, new RandomStrollGoal(m, 1, 120, true, false));
    m.goals.add(8, new LookAtPlayerGoal(m, 8));
    m.goals.add(8, new RandomLookAroundGoal(m));
    m.targets.add(1, new HurtByTargetGoal(m, 'zombie_swinekin').setAlertOthers());
    m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true, false, (e) => drownedOkTarget(m, e)));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'villager' || e.type === 'wandering_trader', 10, false));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'axolotl' && !mobOf(e)?.isBaby, 10, true));
    m.targets.add(5, new NearestAttackableTargetGoal(m, (e) => e.type === 'turtle' && !!mobOf(e)?.isBaby && !e.physics?.inWater, 10, true));
  },
  init(m, ctx) {
    zombieInit(m, ctx);
    if (ctx.reason === 'conversion') return;
    // Tridents, fishing rods and nautilus shells
    const r = m.random;
    if (m.equipment[1]!.isEmpty() && r.nextFloat() < 0.03) {
      equip(m, 1, 'nautilus_shell');
      m.guaranteedDrops[1] = true;
    }
    if (r.nextFloat() > 0.9) {
      const i = r.nextInt(16);
      if (i < 10) equip(m, 0, 'trident');
      else if (i < 12) equip(m, 0, 'fishing_rod');
    }
  },
  canSpawn(level, x, y, z, reason, r) {
    if (reason !== 'natural') return true;
    const b = BIOMES[level.getBiome(x, y, z)];
    if (!(stateFlags[level.getBlockState(x, y - 1, z)]! & F.WATER) && !(stateFlags[level.getBlockState(x, y, z)]! & F.WATER)) return false;
    if (b?.category === 'river') return r.nextInt(15) === 0 && y < 60;
    return r.nextInt(40) === 0 && y < 58;
  },
  burnsInDay: true,
});

// =============================================================================================
// Phantom
// =============================================================================================

const phantomSize = (m: Mob) => (m.data['size'] as number | undefined) ?? 0;

function setPhantomSize(m: Mob, size: number): void {
  const s = Math.max(0, Math.min(64, size));
  m.data['size'] = s;
  m.e.living.attrs.get('attack_damage').setBase(6 + s);
  m.setMeta('size', s);
  updateSize(m);
}

/** Phantoms glide towards a point with fixed speed and banking (reference PhantomMoveControl). */
class PhantomMoveControl extends MoveControl {
  private speed = 0.1;
  override tick(): void {
    const m = this.mob, e = m.e, t = e.transform, p = e.physics;
    if (e.physics.horizontalCollision) {
      t.yaw += 180;
      this.speed = 0.1;
    }
    const mt = (m.tmp['moveTarget'] as V3 | undefined) ?? [m.x, m.y, m.z];
    const dx = mt[0] - m.x, dy = mt[1] - m.y, dz = mt[2] - m.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (Math.abs(h) > 1e-5) {
      const d3 = 1 - Math.abs(dy * 0.7) / h;
      const ndx = dx * d3, ndz = dz * d3;
      const h2 = Math.sqrt(ndx * ndx + ndz * ndz);
      const d6 = Math.sqrt(ndx * ndx + ndz * ndz + dy * dy);
      const f = t.yaw;
      const f1 = yawTo(ndx, ndz);
      t.yaw = rotlerp(wrapDegrees(f), f1, 4);
      t.bodyYaw = t.yaw;
      if (Math.abs(wrapDegrees(f - f1)) < 3) this.speed = Math.min(1.8, this.speed + 0.005 * (1.8 / this.speed));
      else this.speed = Math.max(0.2, this.speed - 0.025);
      const f4 = -(Math.atan2(-dy, h2) * 180) / Math.PI;
      t.pitch = f4;
      const f5 = t.yaw + 90;
      const d7 = this.speed * Math.cos((f5 * Math.PI) / 180) * Math.abs(ndx / d6);
      const d8 = this.speed * Math.sin((f5 * Math.PI) / 180) * Math.abs(ndz / d6);
      const d9 = this.speed * Math.sin((f4 * Math.PI) / 180) * Math.abs(dy / d6);
      p.vx += (d7 - p.vx) * 0.2;
      p.vy += (d9 - p.vy) * 0.2;
      p.vz += (d8 - p.vz) * 0.2;
    }
    e.input.forward = 0;
  }
}

class PhantomAttackStrategyGoal extends Goal {
  private nextSweep = 0;
  constructor(private readonly ph: Mob) {
    super();
  }
  canUse(): boolean {
    const t = this.ph.getTarget();
    return !!t && canTarget(this.ph, t, { range: 0, combat: true, lineOfSight: false, testInvisible: false });
  }
  override start(): void {
    this.nextSweep = this.adjustedTickDelay(10);
    this.ph.tmp['attackPhase'] = 'circle';
    this.setAnchor();
  }
  override stop(): void {
    const ph = this.ph;
    ph.tmp['anchor'] = [Math.floor(ph.x), ph.level.getHeight('motion', Math.floor(ph.x), Math.floor(ph.z)) + 10 + ph.random.nextInt(20), Math.floor(ph.z)];
  }
  override tick(): void {
    const ph = this.ph;
    if (ph.tmp['attackPhase'] === 'circle' && --this.nextSweep <= 0) {
      ph.tmp['attackPhase'] = 'swoop';
      this.setAnchor();
      this.nextSweep = this.adjustedTickDelay((8 + ph.random.nextInt(4)) * 20);
      ph.playSound('entity.phantom.swoop', 10, 0.95 + ph.random.nextFloat() * 0.1);
    }
  }
  private setAnchor(): void {
    const ph = this.ph, t = ph.getTarget()?.transform;
    if (!t) return;
    const y = Math.floor(t.y) + 20 + ph.random.nextInt(20);
    ph.tmp['anchor'] = [Math.floor(t.x), Math.min(y, ph.level.maxY - 1), Math.floor(t.z)];
  }
}

class PhantomSweepAttackGoal extends Goal {
  constructor(private readonly ph: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return !!this.ph.getTarget() && this.ph.tmp['attackPhase'] === 'swoop';
  }
  override canContinueToUse(): boolean {
    const t = this.ph.getTarget();
    if (!t || t.living?.dead || !attackablePlayer(t)) return false;
    // Cats scare phantoms off
    if (this.ph.tickCount % 20 === 0 && this.ph.level.getEntities(this.ph.box().inflate(16), (e) => e.type === 'cat' || e.type === 'ocelot').length) {
      this.ph.tmp['attackPhase'] = 'circle';
      this.ph.playSound('entity.cat.hiss');
      return false;
    }
    return this.canUse();
  }
  override stop(): void {
    this.ph.setTarget(null);
    this.ph.tmp['attackPhase'] = 'circle';
  }
  override tick(): void {
    const ph = this.ph, t = ph.getTarget()!;
    const tt = t.transform!;
    ph.tmp['moveTarget'] = [tt.x, tt.y + (t.physics?.height ?? 1.8) * 0.5, tt.z];
    if (ph.box().inflate(0.2).intersects(hitbox(t))) {
      ph.swing();
      ph.level.hurtEntity(t, 'mob_attack', ph.attr('attack_damage'), ph.e);
      ph.tmp['attackPhase'] = 'circle';
      ph.playSound('entity.phantom.bite');
    } else if (ph.e.physics.horizontalCollision || ph.e.living.hurtTime > 0) ph.tmp['attackPhase'] = 'circle';
  }
}

class PhantomCircleAroundAnchorGoal extends Goal {
  private angle = 0;
  private distance = 0;
  private height = 0;
  private clockwise = 1;
  constructor(private readonly ph: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return !this.ph.getTarget() || this.ph.tmp['attackPhase'] === 'circle';
  }
  override start(): void {
    const r = this.ph.random;
    this.distance = 5 + r.nextFloat() * 10;
    this.height = -4 + r.nextFloat() * 9;
    this.clockwise = r.nextBool() ? 1 : -1;
    this.selectNext();
  }
  override tick(): void {
    const ph = this.ph, r = ph.random;
    if (r.nextInt(this.adjustedTickDelay(350)) === 0) this.height = -4 + r.nextFloat() * 9;
    if (r.nextInt(this.adjustedTickDelay(250)) === 0) {
      this.distance++;
      if (this.distance > 15) {
        this.distance = 5;
        this.clockwise = -this.clockwise;
      }
    }
    if (r.nextInt(this.adjustedTickDelay(450)) === 0) {
      this.angle = r.nextFloat() * 2 * Math.PI;
      this.selectNext();
    }
    const mt = (ph.tmp['moveTarget'] as V3 | undefined) ?? [ph.x, ph.y, ph.z];
    if ((mt[0] - ph.x) ** 2 + (mt[1] - ph.y) ** 2 + (mt[2] - ph.z) ** 2 < 4) this.selectNext();
    if (mt[1] < ph.y && !(stateFlags[ph.level.getBlockState(Math.floor(ph.x), Math.floor(ph.y) - 1, Math.floor(ph.z))]! & F.AIR)) {
      this.height = Math.max(1, this.height);
      this.selectNext();
    }
    if (mt[1] > ph.y && !(stateFlags[ph.level.getBlockState(Math.floor(ph.x), Math.floor(ph.y) + 1, Math.floor(ph.z))]! & F.AIR)) {
      this.height = Math.min(-1, this.height);
      this.selectNext();
    }
  }
  private selectNext(): void {
    const ph = this.ph;
    let anchor = ph.tmp['anchor'] as V3 | undefined;
    if (!anchor) {
      anchor = [Math.floor(ph.x), Math.floor(ph.y), Math.floor(ph.z)];
      ph.tmp['anchor'] = anchor;
    }
    this.angle += this.clockwise * 15 * (Math.PI / 180);
    ph.tmp['moveTarget'] = [anchor[0] + this.distance * Math.cos(this.angle), anchor[1] - 4 + this.height, anchor[2] + this.distance * Math.sin(this.angle)];
  }
}

/** Target a nearby player every so often (reference PhantomAttackPlayerTargetGoal). */
class PhantomAttackPlayerTargetGoal extends Goal {
  private next = reducedTickDelay(20);
  constructor(private readonly ph: Mob) {
    super();
  }
  canUse(): boolean {
    if (this.next > 0) {
      this.next--;
      return false;
    }
    this.next = reducedTickDelay(60);
    const ph = this.ph;
    const list = ph.level.getEntities(ph.box().inflate(16, 64, 16), (e) => !!e.player && attackablePlayer(e))
      .sort((a, b) => b.transform!.y - a.transform!.y);
    for (const p of list) {
      if (canTarget(ph, p, { range: 64, combat: true, lineOfSight: false, testInvisible: true })) {
        ph.setTarget(p);
        return true;
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    const t = this.ph.getTarget();
    return !!t && canTarget(this.ph, t, { range: 64, combat: true, lineOfSight: false, testInvisible: true });
  }
}

registerMob({
  id: 'phantom', attrs: { max_health: 20, attack_damage: 6, follow_range: 64 }, move: 'none', nav: 'fly', noGravity: true, undead: true, hostile: true,
  burnsInDay: true, noFallDamage: true, xp: 5, ...sounds('phantom'),
  setup(m) {
    m.move = new PhantomMoveControl(m);
    m.goals.add(1, new PhantomAttackStrategyGoal(m));
    m.goals.add(2, new PhantomSweepAttackGoal(m));
    m.goals.add(3, new PhantomCircleAroundAnchorGoal(m));
    m.targets.add(1, new PhantomAttackPlayerTargetGoal(m));
    m.tmp['attackPhase'] = 'circle';
  },
  init(m, ctx) {
    setPhantomSize(m, (ctx.opts['size'] as number | undefined) ?? 0);
    m.tmp['anchor'] = [Math.floor(m.x), Math.floor(m.y) + 5, Math.floor(m.z)];
  },
  loaded(m) {
    setPhantomSize(m, phantomSize(m));
  },
  size(m) {
    const s = phantomSize(m);
    const k = 1 + 0.15 * s;
    return [0.9 * k, 0.5 * k, 0.175 * k];
  },
  tick(m) {
    m.e.physics.noGravity = true;
    if (m.tickCount % 8 === 0) m.playSound('entity.phantom.flap', 0.95 + m.random.nextFloat() * 0.05);
  },
});
