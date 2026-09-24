/**
 * Aquatic mobs: schooling fish (cod, salmon in three sizes, tropical fish patterns), pufferfish
 * that puff up and sting, squid and glow squid (pulse swimming, ink), dolphins (air, moisture,
 * playing with items, treasure hunting, Dolphin's Grace), axolotls (playing dead, hunting,
 * regeneration for helpers) and guardians / elder guardians (laser beams, thorns, mining
 * fatigue). Includes catching these mobs in water buckets.
 */
import type { Entity } from '../../../common/entity/ecs';
import { ItemStack } from '../../../common/item/stack';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, stateFlags, F } from '../../../common/block/registry';
import { hurt, addEffect } from '../../survival/living';
import { AABB } from '../../../common/math/geom';
import type { ServerPlayer } from '../../player';
import { registerMob, Mob, MobDef, mobOf, yawTo, pitchTo, rotlerp } from '../mob';
import { Goal, Flag, reducedTickDelay } from '../goals';
import {
  PanicGoal, BreedGoal, TemptGoal, AvoidEntityGoal, RandomSwimmingGoal, RandomLookAroundGoal, LookAtPlayerGoal, MeleeAttackGoal,
  HurtByTargetGoal, NearestAttackableTargetGoal, TryFindWaterGoal, RandomStrollGoal, FollowParentGoal, FloatGoal,
} from '../goallib';
import { PathType } from '../pathfinding';
import { swimmablePos } from '../randompos';
import { handStack, useItem, exchangeItem } from '../actions';
import { attackablePlayer } from '../targeting';
import { items, sounds } from './common';

// =============================================================================================
// Buckets
// =============================================================================================

const BUCKETABLE = new Set(['cod', 'salmon', 'pufferfish', 'tropical_fish', 'axolotl', 'tadpole']);

/** Scoop a bucketable mob into a water bucket (reference Bucketable.bucketMobPickup). */
export function bucketMob(m: Mob, p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const s = handStack(p, hand);
  if (s.id !== 'water_bucket' || !BUCKETABLE.has(m.def.id) || !m.alive) return false;
  const data: Record<string, unknown> = { ...m.data, health: m.health };
  delete data['persistent'];
  if (m.e['customName']) data['name'] = m.e['customName'];
  const bucket = new ItemStack(`${m.def.id}_bucket`, 1, { entity: data });
  m.playSound(m.def.id === 'axolotl' ? 'item.bucket.fill_axolotl' : m.def.id === 'tadpole' ? 'item.bucket.fill_tadpole' : 'item.bucket.fill_fish');
  exchangeItem(p, hand, s, bucket);
  m.level.entities.remove(m.e);
  return true;
}

/** Restore a mob released from a bucket (always persistent). */
export function fromBucket(m: Mob, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (k === 'health') m.e.living.health = Math.min(m.maxHealth, Number(v));
    else if (k === 'name') m.e['customName'] = v;
    else m.data[k] = v;
  }
  m.data['fromBucket'] = true;
  m.setPersistent();
  m.def.syncMeta?.(m);
}

// =============================================================================================
// Fish
// =============================================================================================

/** Stranded fish flop around (reference AbstractFish.aiStep). */
function flop(m: Mob): void {
  const p = m.e.physics;
  if (!m.inWater && m.onGround && p.verticalCollision) {
    p.vx += (m.random.nextFloat() * 2 - 1) * 0.05;
    p.vy += 0.4;
    p.vz += (m.random.nextFloat() * 2 - 1) * 0.05;
    p.onGround = false;
    m.playSound(`entity.${m.def.id}.flop`);
  }
}

/** Schools follow a leader of their kind (reference FollowFlockLeaderGoal). */
class FollowFlockLeaderGoal extends Goal {
  private next = 0;
  private recalc = 0;
  constructor(private readonly f: Mob, private readonly maxSchool: number) {
    super();
    this.next = this.nextStart();
  }
  private nextStart(): number {
    return reducedTickDelay(200 + this.f.random.nextInt(200) % 20);
  }
  private leader(): Mob | null {
    const id = this.f.tmp['leader'] as number | undefined;
    const l = id ? mobOf(this.f.level.entities.get(id)) : null;
    return l && l.alive ? l : null;
  }
  canUse(): boolean {
    const f = this.f;
    if ((f.tmp['schoolSize'] as number | undefined ?? 1) > 1) return false;
    if (this.leader()) return true;
    if (this.next > 0) {
      this.next--;
      return false;
    }
    this.next = this.nextStart();
    const others = f.level.getEntities(f.box().inflate(8), (e) => e.type === f.def.id && e !== f.e).map((e) => mobOf(e)!).filter(Boolean);
    const leader = others.find((o) => ((o.tmp['schoolSize'] as number | undefined) ?? 1) > 1 && ((o.tmp['schoolSize'] as number) < this.maxSchool)) ?? others.find((o) => !o.tmp['leader']) ?? null;
    if (!leader || leader.tmp['leader']) return false;
    // Recruit this fish and any free fish around into the leader's school
    for (const o of [f, ...others]) {
      if (o === leader || o.tmp['leader'] || ((leader.tmp['schoolSize'] as number | undefined) ?? 1) >= this.maxSchool) continue;
      o.tmp['leader'] = leader.e.id;
      leader.tmp['schoolSize'] = ((leader.tmp['schoolSize'] as number | undefined) ?? 1) + 1;
    }
    return !!this.leader();
  }
  override canContinueToUse(): boolean {
    const l = this.leader();
    return !!l && this.f.distanceToSqr(l.e) <= 121;
  }
  override start(): void {
    this.recalc = 0;
  }
  override stop(): void {
    const l = this.leader();
    if (l) l.tmp['schoolSize'] = Math.max(1, ((l.tmp['schoolSize'] as number | undefined) ?? 2) - 1);
    this.f.tmp['leader'] = 0;
  }
  override tick(): void {
    if (--this.recalc > 0) return;
    this.recalc = this.adjustedTickDelay(10);
    const l = this.leader();
    if (!l) return;
    // Keep a loose formation behind the leader
    const off = (this.f.e.id % 5) - 2;
    this.f.nav.moveTo(l.x + off * 0.5, l.y, l.z + (this.f.e.id % 3) - 1, 1);
  }
}

/** Leaders roam; followers only swim when they have no leader. */
class FishSwimGoal extends RandomSwimmingGoal {
  override canUse(): boolean {
    return !this.m.tmp['leader'] && super.canUse();
  }
}

function fishDef(id: string, extra: Partial<MobDef> & { school?: number }): MobDef {
  const school = extra.school ?? 0;
  return registerMob({
    id, attrs: { max_health: 3 }, nav: 'swim', move: 'swim', swimStyle: 'fish', aquatic: true, xp: (m) => 1 + m.random.nextInt(3),
    hurtSound: `entity.${id}.hurt`, deathSound: `entity.${id}.death`,
    setup(m) {
      m.goals.add(0, new PanicGoal(m, 1.25));
      m.goals.add(2, new AvoidEntityGoal(m, (e) => !!e.player && e.player.gameMode !== 'spectator', 8, 1.6, 1.4));
      if (school) m.goals.add(5, new FollowFlockLeaderGoal(m, school));
      m.goals.add(4, new FishSwimGoal(m, 1, 40));
    },
    tick: flop,
    interact: (m, p, hand) => bucketMob(m, p, hand),
    canSpawn(level, x, y, z) {
      return !!(stateFlags[level.getBlockState(x, y, z)]! & F.WATER) && !!(stateFlags[level.getBlockState(x, y + 1, z)]! & F.WATER) && y >= 50 && y <= 64;
    },
    ...extra,
  });
}

fishDef('cod', { school: 8 });

const SALMON_SIZES = ['small', 'medium', 'large'];
fishDef('salmon', {
  school: 5,
  init(m, ctx) {
    const r = m.random.nextInt(100);
    m.data['size'] = (ctx.opts['size'] as string | undefined) ?? (r < 30 ? 'small' : r < 80 ? 'medium' : 'large');
  },
  size(m) {
    const s = SALMON_SIZES.indexOf((m.data['size'] as string | undefined) ?? 'medium');
    const k = [0.5, 1, 1.5][s < 0 ? 1 : s]!;
    return [0.7 * k, 0.4 * k, 0.26 * k];
  },
  syncMeta(m) {
    m.setMeta('size', (m.data['size'] as string | undefined) ?? 'medium');
  },
  lootFlags(m) {
    return { size: m.data['size'] };
  },
});

/** Tropical fish: shape (small/large), pattern and two colours packed into one variant number. */
export const TROPICAL_PATTERNS = [['kob', 'sunstreak', 'snooper', 'dasher', 'brinely', 'spotty'], ['flopper', 'stripey', 'glitter', 'blockfish', 'betty', 'clayfish']];
const COMMON_TROPICAL: number[] = [
  0x00010000 | 0x01 << 8 | 0x0e << 24, 0x00000000 | 0x07 << 24 | 0x01 << 8, 0x00000100 | 0x07 << 24, 0x00010500 | 0x0e << 24,
  0x00010000 | 0x04 << 24 | 0x01 << 8, 0x00000300 | 0x00 << 24, 0x00010100 | 0x06 << 24 | 0x03 << 16, 0x00000400 | 0x0a << 24 | 0x04 << 16,
  0x00010200 | 0x0b << 24, 0x00000200 | 0x05 << 24 | 0x03 << 16, 0x00000500 | 0x01 << 24 | 0x0e << 16, 0x00010300 | 0x09 << 24 | 0x06 << 16,
];

export function tropicalVariant(v: number): { shape: number; pattern: number; base: number; patternColor: number } {
  return { shape: v & 0xff, pattern: (v >> 8) & 0xff, base: (v >> 16) & 0xff, patternColor: (v >> 24) & 0xff };
}

fishDef('tropical_fish', {
  school: 7,
  init(m, ctx) {
    let v = ctx.opts['variant'] as number | undefined;
    if (v === undefined) {
      if (m.random.nextFloat() < 0.9) v = COMMON_TROPICAL[m.random.nextInt(COMMON_TROPICAL.length)]!;
      else v = m.random.nextInt(2) | m.random.nextInt(6) << 8 | m.random.nextInt(16) << 16 | m.random.nextInt(16) << 24;
    }
    m.data['variant'] = v;
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as number | undefined) ?? 0);
  },
  canSpawn(level, x, y, z) {
    const water = !!(stateFlags[level.getBlockState(x, y, z)]! & F.WATER);
    const b = BIOMES[level.getBiome(x, y, z)];
    if (b?.name === 'lush_caves') return water;
    return water && y >= 50 && y <= 64;
  },
});

// ---- Pufferfish ------------------------------------------------------------------------------

const puffState = (m: Mob) => (m.data['puff'] as number | undefined) ?? 0;
const NOT_SCARY = new Set(['axolotl', 'turtle', 'dolphin', 'guardian', 'elder_guardian', 'pufferfish', 'cod', 'salmon', 'tropical_fish', 'squid', 'glow_squid', 'tadpole']);

function scaresPufferfish(e: Entity): boolean {
  if (!e.living || e.living.dead) return false;
  if (e.player) return e.player.gameMode !== 'spectator' && e.player.gameMode !== 'creative';
  return !NOT_SCARY.has(e.type);
}

function setPuff(m: Mob, v: number): void {
  m.data['puff'] = v;
  m.setMeta('puff', v);
  // Puffing up grows the hitbox
  const info = [0.5, 0.7, 1][v]!;
  m.e.physics.width = 0.7 * info;
  m.e.physics.height = 0.7 * info;
}

fishDef('pufferfish', {
  setup(m) {
    m.goals.add(0, new PanicGoal(m, 1.25));
    m.goals.add(2, new AvoidEntityGoal(m, (e) => !!e.player && e.player.gameMode !== 'spectator', 8, 1.6, 1.4));
    m.goals.add(4, new RandomSwimmingGoal(m, 1, 40));
    // Puff up when something scary swims close
    m.goals.add(1, new (class extends Goal {
      canUse(): boolean {
        return m.level.getEntities(m.box().inflate(2), scaresPufferfish).length > 0;
      }
      override start(): void {
        m.tmp['inflateCounter'] = 1;
        m.tmp['deflateTimer'] = 0;
      }
      override stop(): void {
        m.tmp['inflateCounter'] = 0;
      }
    })());
  },
  size(m) {
    const k = [0.5, 0.7, 1][puffState(m)]!;
    return [0.7 * k, 0.7 * k, 0.455 * k];
  },
  tick(m) {
    flop(m);
    const inflate = (m.tmp['inflateCounter'] as number | undefined) ?? 0;
    const p = puffState(m);
    if (inflate > 0) {
      if (p === 0) {
        m.playSound('entity.puffer_fish.blow_up');
        setPuff(m, 1);
      } else if (inflate > 40 && p === 1) {
        m.playSound('entity.puffer_fish.blow_up');
        setPuff(m, 2);
      }
      m.tmp['inflateCounter'] = inflate + 1;
    } else if (p !== 0) {
      const d = ((m.tmp['deflateTimer'] as number | undefined) ?? 0) + 1;
      m.tmp['deflateTimer'] = d;
      if (d > 60 && p === 2) {
        m.playSound('entity.puffer_fish.blow_out');
        setPuff(m, 1);
      } else if (d > 100 && p === 1) {
        m.playSound('entity.puffer_fish.blow_out');
        setPuff(m, 0);
        m.tmp['deflateTimer'] = 0;
      }
    }
    // Spikes sting everything touching them
    if (p > 0) {
      for (const e of m.level.getEntities(m.box().inflate(0.3), (e) => !!e.living && e !== m.e && scaresPufferfish(e))) {
        if (hurt(m.level, e, 'mob_attack', 1 + p, m.e)) {
          m.level.addEntityEffect(e, 'poison', 60 * p, 0);
          if (e.player) m.level.playSound(e.transform!.x, e.transform!.y, e.transform!.z, 'entity.puffer_fish.sting', 1, 1);
        }
      }
    }
  },
  syncMeta(m) {
    m.setMeta('puff', puffState(m));
  },
});

// =============================================================================================
// Squid and glow squid
// =============================================================================================

function squidTick(m: Mob): void {
  const e = m.e, p = e.physics, t = e.transform;
  if (m.inWater) {
    const tv = m.tmp['tv'] as [number, number, number] | undefined ?? [0, 0, 0];
    let phase = ((m.tmp['tentacle'] as number | undefined) ?? 0) + (m.tmp['tentacleSpeed'] as number | undefined ?? 0.1);
    if (phase > Math.PI * 2) {
      phase -= Math.PI * 2;
      if (m.random.nextInt(10) === 0) m.tmp['tentacleSpeed'] = (1 / (m.random.nextFloat() + 1)) * 0.2;
    }
    m.tmp['tentacle'] = phase;
    let speed = 0;
    if (phase < Math.PI) {
      const f = phase / Math.PI;
      if (f > 0.75) speed = 1;
    }
    p.vx = tv[0] * speed;
    p.vy = tv[1] * speed;
    p.vz = tv[2] * speed;
    const h = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (h > 1e-3) t.bodyYaw = t.yaw = rotlerp(t.yaw, yawTo(p.vx, p.vz), 20);
    t.pitch = rotlerp(t.pitch, pitchTo(p.vx, p.vy, p.vz), 10);
    e.input.forward = 0;
    p.noGravity = true;
  } else {
    p.noGravity = false;
    if (!m.onGround) p.vy *= 0.98;
  }
  // Glow squid dim for a while after being hurt
  const dark = (m.data['darkTicks'] as number | undefined) ?? 0;
  if (dark > 0) {
    m.data['darkTicks'] = dark - 1;
    if (dark === 1 || dark % 20 === 0) m.setMeta('dark', dark - 1);
  }
}

/** Pick a new swim direction now and then (reference SquidRandomMovementGoal). */
class SquidRandomMovementGoal extends Goal {
  constructor(private readonly s: Mob) {
    super();
  }
  canUse(): boolean {
    return true;
  }
  override tick(): void {
    const s = this.s;
    if (s.noActionTime > 100) s.tmp['tv'] = [0, 0, 0];
    else if (s.random.nextInt(reducedTickDelay(50)) === 0 || !s.inWater || !s.tmp['tv']) {
      const f = s.random.nextFloat() * Math.PI * 2;
      s.tmp['tv'] = [Math.cos(f) * 0.2, -0.1 + s.random.nextFloat() * 0.2, Math.sin(f) * 0.2];
    }
  }
}

/** Flee from what hurt us in a burst (reference SquidFleeGoal). */
class SquidFleeGoal extends Goal {
  private time = 0;
  constructor(private readonly s: Mob) {
    super();
  }
  canUse(): boolean {
    const a = this.s.getLastHurtBy();
    return !!a && this.s.inWater && this.s.distanceToSqr(a) < 100;
  }
  override start(): void {
    this.time = 0;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    this.time++;
    const s = this.s, a = s.getLastHurtBy();
    if (!a) return;
    const at = a.transform!;
    let dx = s.x - at.x, dy = s.y - at.y, dz = s.z - at.z;
    const above = s.level.getBlockState(Math.floor(s.x + dx), Math.floor(s.y + dy), Math.floor(s.z + dz));
    if (stateFlags[above]! & F.WATER || stateFlags[above]! & F.AIR) {
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= len; dy /= len; dz /= len;
      let k = 3;
      if (len > 5) k -= (len - 5) / 5;
      if (k > 0) s.tmp['tv'] = [dx * k / 20, dy * k / 20, dz * k / 20];
    }
    if (this.time % 10 === 5) s.broadcastEvent('bubbles');
  }
  override canContinueToUse(): boolean {
    return this.time < 20 && this.canUse();
  }
}

function squidDef(id: 'squid' | 'glow_squid'): void {
  registerMob({
    id, attrs: { max_health: 10 }, move: 'none', nav: 'swim', aquatic: true, xp: (m) => 1 + m.random.nextInt(3),
    ...sounds(id === 'squid' ? 'squid' : 'glow_squid'),
    setup(m) {
      m.goals.add(0, new SquidRandomMovementGoal(m));
      m.goals.add(1, new SquidFleeGoal(m));
    },
    tick: squidTick,
    onHurt(m) {
      // A cloud of ink covers the escape
      m.playSound(id === 'squid' ? 'entity.squid.squirt' : 'entity.glow_squid.squirt');
      m.broadcastEvent(id === 'squid' ? 'ink' : 'glowInk');
      if (id === 'glow_squid') {
        m.data['darkTicks'] = 100;
        m.setMeta('dark', 100);
      }
    },
    canSpawn(level, x, y, z) {
      const water = !!(stateFlags[level.getBlockState(x, y, z)]! & F.WATER);
      if (id === 'glow_squid') return water && y <= 30 && level.getMaxLocalRawBrightness(x, y, z) === 0 && blockOf(level.getBlockState(x, y - 1, z)).name !== 'bedrock';
      return water && y > 45 && y < 63;
    },
  });
}
squidDef('squid');
squidDef('glow_squid');

// =============================================================================================
// Dolphin
// =============================================================================================

const DOLPHIN_MAX_AIR = 4800;
const DOLPHIN_MOISTURE = 2400;

class BreathAirGoal extends Goal {
  constructor(private readonly d: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return this.d.e.physics.air < 140;
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override isInterruptable(): boolean {
    return false;
  }
  override start(): void {
    this.findAir();
  }
  private findAir(): void {
    const d = this.d, level = d.level;
    const bx = Math.floor(d.x), by = Math.floor(d.y), bz = Math.floor(d.z);
    let target: [number, number, number] | null = null;
    outer: for (let dy = 0; dy < 16; dy++) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (stateFlags[level.getBlockState(bx + dx, by + dy, bz + dz)]! & F.AIR) {
          target = [bx + dx, by + dy, bz + dz];
          break outer;
        }
      }
    }
    if (!target) target = [bx, by + 8, bz];
    d.nav.moveTo(target[0] + 0.5, target[1] + 1, target[2] + 0.5, 1);
  }
  override tick(): void {
    this.findAir();
    const p = this.d.e.physics;
    p.vx *= 0.9; p.vz *= 0.9;
    p.vy += 0.02;
  }
}

/** Jump out of the water now and then (reference DolphinJumpGoal). */
class DolphinJumpGoal extends Goal {
  private breached = false;
  private next = 0;
  constructor(private readonly d: Mob, private readonly interval: number) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP;
  }
  canUse(): boolean {
    const d = this.d;
    if (this.next > 0) {
      this.next--;
      return false;
    }
    this.next = reducedTickDelay(this.interval);
    const t = d.e.transform, yaw = (t.yaw * Math.PI) / 180;
    const fx = Math.floor(d.x - Math.sin(yaw) * 2), fz = Math.floor(d.z + Math.cos(yaw) * 2), y = Math.floor(d.y);
    const water = (yy: number) => !!(stateFlags[d.level.getBlockState(fx, yy, fz)]! & F.WATER);
    const air = (yy: number) => !!(stateFlags[d.level.getBlockState(fx, yy, fz)]! & F.AIR);
    return d.inWater && water(y) && air(y + 1) && air(y + 2);
  }
  override canContinueToUse(): boolean {
    const vy = this.d.e.physics.vy;
    return (vy * vy >= 0.03 || this.d.e.transform.pitch === 0 || Math.abs(this.d.e.transform.pitch) >= 10 || !this.d.inWater) && !this.d.onGround;
  }
  override isInterruptable(): boolean {
    return false;
  }
  override start(): void {
    const d = this.d, p = d.e.physics, t = d.e.transform, yaw = (t.yaw * Math.PI) / 180;
    p.vx += -Math.sin(yaw) * 0.6;
    p.vy += 0.7;
    p.vz += Math.cos(yaw) * 0.6;
    d.nav.stop();
    this.breached = false;
  }
  override stop(): void {
    this.d.e.transform.pitch = 0;
  }
  override tick(): void {
    const d = this.d;
    const was = this.breached;
    if (!was) this.breached = d.inWater;
    if (this.breached && !was) d.playSound('entity.dolphin.jump');
    const p = d.e.physics;
    const h = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (p.vy * p.vy < 0.03 && d.e.transform.pitch !== 0) d.e.transform.pitch = rotlerp(d.e.transform.pitch, 0, 0.2);
    else if (h > 0) d.e.transform.pitch = pitchTo(p.vx, p.vy, p.vz);
  }
}

/** Swim next to swimming players and give them Dolphin's Grace. */
class SwimWithPlayerGoal extends Goal {
  private player: Entity | null = null;
  constructor(private readonly d: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const d = this.d;
    const list = d.level.getEntities(d.box().inflate(10), (e) => !!e.player && !!e.input?.swimming && attackablePlayer(e));
    this.player = list[0] ?? null;
    return !!this.player;
  }
  override canContinueToUse(): boolean {
    const p = this.player;
    return !!p && !!p.input?.swimming && this.d.distanceToSqr(p) < 256;
  }
  override start(): void {
    if (this.player) this.d.level.addEntityEffect(this.player, 'dolphins_grace', 100, 0);
  }
  override stop(): void {
    this.player = null;
    this.d.nav.stop();
  }
  override tick(): void {
    const p = this.player!;
    this.d.look.setLookAtEntity(p, 10, 40);
    if (this.d.distanceToSqr(p) < 6.25) this.d.nav.stop();
    else this.d.nav.moveToEntity(p, this.speed);
    if (p.input?.swimming && this.d.random.nextInt(6) === 0) this.d.level.addEntityEffect(p, 'dolphins_grace', 100, 0);
  }
}

/** After being fed fish, lead the player to the nearest shipwreck or ruin (reference). */
class SwimToTreasureGoal extends Goal {
  private target: [number, number, number] | null = null;
  private stuck = false;
  constructor(private readonly d: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return !!this.d.data['gotFish'] && this.d.e.physics.air >= 100;
  }
  override canContinueToUse(): boolean {
    if (!this.target || this.stuck) return false;
    const [x, , z] = this.target;
    return !!this.d.data['gotFish'] && (this.d.x - x) ** 2 + (this.d.z - z) ** 2 > 4 && this.d.e.physics.air >= 100;
  }
  override start(): void {
    const d = this.d;
    const gen = d.level.generator;
    let best: { x: number; y: number; z: number } | null = null;
    for (const kind of ['shipwreck', 'ocean_ruin', 'buried_treasure']) {
      const r = gen.locateStructure?.(kind, Math.floor(d.x), Math.floor(d.z), 50) ?? null;
      if (r && (!best || (r.x - d.x) ** 2 + (r.z - d.z) ** 2 < (best.x - d.x) ** 2 + (best.z - d.z) ** 2)) best = r;
    }
    if (!best) {
      this.stuck = true;
      d.data['gotFish'] = false;
      return;
    }
    this.target = [best.x, best.y, best.z];
    this.stuck = false;
    d.broadcastEvent('happyVillager');
  }
  override stop(): void {
    const d = this.d;
    if (this.target && (d.x - this.target[0]) ** 2 + (d.z - this.target[2]) ** 2 <= 16 || this.stuck) d.data['gotFish'] = false;
    d.nav.stop();
  }
  override tick(): void {
    const d = this.d, [x, y, z] = this.target!;
    if (d.nav.isDone()) {
      const dx = x - d.x, dz = z - d.z;
      const len = Math.hypot(dx, dz) || 1;
      const step = Math.min(len, 16);
      const tx = d.x + (dx / len) * step, tz = d.z + (dz / len) * step;
      const ty = Math.max(Math.min(y, 60), d.level.minY + 2);
      if (!d.nav.moveTo(tx, ty, tz, 1.3)) this.stuck = d.random.nextInt(40) === 0;
    }
    d.look.setLookAt(x, y, z, 10, 40);
  }
}

/** Toss around items dropped nearby (reference PlayWithItemsGoal). */
class PlayWithItemsGoal extends Goal {
  private cooldown = 0;
  constructor(private readonly d: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const d = this.d;
    if (this.cooldown > d.tickCount) return false;
    return d.equipment[0]!.isEmpty() && d.level.getEntities(d.box().inflate(8), (e) => !!e.item && e.item.pickupDelay <= 0).length > 0;
  }
  override start(): void {
    const items = this.d.level.getEntities(this.d.box().inflate(8), (e) => !!e.item && e.item.pickupDelay <= 0);
    if (items.length) this.d.nav.moveToEntity(items[0]!, 1.2);
    this.cooldown = 0;
  }
  override stop(): void {
    const d = this.d, held = d.equipment[0]!;
    if (!held.isEmpty()) {
      const t = d.e.transform, yaw = (t.yaw * Math.PI) / 180;
      const drop = d.level.spawnItem(d.x, d.eyeY - 0.3, d.z, held, -Math.sin(yaw) * 0.3, 0.3, Math.cos(yaw) * 0.3);
      if (drop?.item) drop.item.thrower = d.e.id;
      d.equipment[0] = ItemStack.empty();
      this.cooldown = d.tickCount + d.random.nextInt(100);
    }
  }
  override tick(): void {
    const d = this.d;
    const items = d.level.getEntities(d.box().inflate(8), (e) => !!e.item && e.item.pickupDelay <= 0);
    if (!d.equipment[0]!.isEmpty()) {
      this.stop();
      return;
    }
    if (items.length) d.nav.moveToEntity(items[0]!, 1.2);
  }
}

registerMob({
  id: 'dolphin', attrs: { max_health: 10, movement_speed: 1.2, attack_damage: 3 }, nav: 'swim', move: 'swim', swimStyle: 'smooth', canBreach: true,
  ageable: true, xp: (m) => 1 + m.random.nextInt(3), food: () => false, ...sounds('dolphin'), waterBreather: false,
  ambientFor(m) {
    return m.inWater ? 'entity.dolphin.ambient_water' : 'entity.dolphin.ambient';
  },
  setup(m) {
    m.canPickUpLoot = true;
    m.e.physics.maxAir = DOLPHIN_MAX_AIR;
    m.e.physics.air = DOLPHIN_MAX_AIR;
    m.goals.add(0, new BreathAirGoal(m));
    m.goals.add(0, new TryFindWaterGoal(m));
    m.goals.add(1, new SwimToTreasureGoal(m));
    m.goals.add(2, new SwimWithPlayerGoal(m, 4));
    m.goals.add(4, new RandomSwimmingGoal(m, 1, 10));
    m.goals.add(4, new RandomLookAroundGoal(m));
    m.goals.add(5, new LookAtPlayerGoal(m, 6));
    m.goals.add(5, new DolphinJumpGoal(m, 10));
    m.goals.add(6, new MeleeAttackGoal(m, 1.2, true));
    m.goals.add(8, new PlayWithItemsGoal(m));
    m.goals.add(9, new AvoidEntityGoal(m, (e) => e.type === 'guardian', 8, 1, 1));
    m.targets.add(1, new HurtByTargetGoal(m, 'guardian').setAlertOthers());
  },
  init(m) {
    m.data['moisture'] = DOLPHIN_MOISTURE;
  },
  tick(m) {
    const p = m.e.physics;
    // Moisture: dolphins dry out on land
    let moist = (m.data['moisture'] as number | undefined) ?? DOLPHIN_MOISTURE;
    if (m.inWater || m.level.isRainingAt(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z))) moist = DOLPHIN_MOISTURE;
    else {
      moist--;
      if (moist <= 0) m.level.hurtEntity(m.e, 'dry_out', 1);
      if (m.onGround) {
        p.vx += (m.random.nextFloat() * 2 - 1) * 0.2;
        p.vy = 0.5;
        p.vz += (m.random.nextFloat() * 2 - 1) * 0.2;
        m.e.transform.yaw = m.random.nextFloat() * 360;
        p.onGround = false;
      }
    }
    m.data['moisture'] = moist;
    m.setMeta('moist', moist > 0 ? 1 : 0);
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (s.id === 'cod' || s.id === 'salmon') {
      useItem(p, hand, s);
      m.playSound('entity.dolphin.eat');
      m.data['gotFish'] = true;
      m.broadcastEvent('villagerHappy');
      return true;
    }
    return false;
  },
  wantsToPickUp(m, s) {
    return m.equipment[0]!.isEmpty() && !s.isEmpty();
  },
  pickUp(m, e) {
    m.equipment[0] = e.item!.stack.split(1);
    m.playSound('entity.dolphin.play');
  },
  canSpawn(level, x, y, z) {
    return !!(stateFlags[level.getBlockState(x, y, z)]! & F.WATER) && y > 45 && y < 63;
  },
});

// =============================================================================================
// Axolotl
// =============================================================================================

export const AXOLOTL_VARIANTS = ['lucy', 'wild', 'gold', 'cyan', 'blue'];
const AXOLOTL_PREY = new Set(['tropical_fish', 'pufferfish', 'salmon', 'cod', 'squid', 'glow_squid', 'drowned', 'guardian', 'elder_guardian']);
const AXOLOTL_MOISTURE = 6000;

function playingDead(m: Mob): boolean {
  return ((m.tmp['playDead'] as number | undefined) ?? 0) > 0;
}

class AxolotlAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    return !playingDead(this.m) && super.canUse();
  }
  override canContinueToUse(): boolean {
    return !playingDead(this.m) && super.canContinueToUse();
  }
}

registerMob({
  id: 'axolotl', attrs: { max_health: 14, movement_speed: 1, attack_damage: 2 }, nav: 'amphibious', move: 'swim', swimStyle: 'smooth',
  ageable: true, waterBreather: true, xp: (m) => 1 + m.random.nextInt(3), food: items('tropical_fish_bucket'), loot: null,
  ...sounds('axolotl', false), malus: { [PathType.WATER]: 0 },
  ambientFor(m) {
    return m.inWater ? 'entity.axolotl.idle_water' : 'entity.axolotl.idle_air';
  },
  setup(m) {
    m.goals.add(0, new FloatGoal(m));
    m.goals.add(1, new BreedGoal(m, 0.2));
    m.goals.add(2, new AxolotlAttackGoal(m, 1, true));
    m.goals.add(3, new TemptGoal(m, 1.1, items('tropical_fish_bucket'), false));
    m.goals.add(4, new FollowParentGoal(m, 1.1));
    m.goals.add(5, new (class extends RandomSwimmingGoal {
      override canUse(): boolean {
        return !playingDead(m) && m.inWater && super.canUse();
      }
    })(m, 0.5, 40));
    m.goals.add(6, new (class extends RandomStrollGoal {
      override canUse(): boolean {
        return !playingDead(m) && !m.inWater && super.canUse();
      }
    })(m, 0.15));
    m.goals.add(7, new LookAtPlayerGoal(m, 6));
    m.targets.add(1, new NearestAttackableTargetGoal(m, (e) => AXOLOTL_PREY.has(e.type) && !playingDead(m) && !m.tmp['huntCooldown'], 10, true));
  },
  init(m, ctx) {
    let v = ctx.opts['variant'] as string | undefined;
    if (!v) v = AXOLOTL_VARIANTS[m.random.nextInt(4)];
    m.data['variant'] = v;
    m.data['moisture'] = AXOLOTL_MOISTURE;
  },
  syncMeta(m) {
    m.setMeta('variant', (m.data['variant'] as string | undefined) ?? 'lucy');
  },
  tick(m) {
    // Moisture on land
    let moist = (m.data['moisture'] as number | undefined) ?? AXOLOTL_MOISTURE;
    if (m.inWater || m.level.isRainingAt(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z))) moist = AXOLOTL_MOISTURE;
    else if (--moist <= 0) m.level.hurtEntity(m.e, 'dry_out', 1);
    m.data['moisture'] = moist;
    // Playing dead: lie still and regenerate
    const pd = (m.tmp['playDead'] as number | undefined) ?? 0;
    if (pd > 0) {
      m.tmp['playDead'] = pd - 1;
      m.nav.stop();
      m.e.input.forward = 0;
      if (pd === 1) m.setMeta('playDead', false);
    }
    const cd = (m.tmp['huntCooldown'] as number | undefined) ?? 0;
    if (cd > 0) m.tmp['huntCooldown'] = cd - 1;
  },
  onHurt(m, _type, amount) {
    // In water, a hurt axolotl may play dead (reference 1/3 chance under half health)
    if (m.inWater && !playingDead(m) && m.health > 0 && m.health < m.maxHealth / 2 && m.random.nextInt(3) < Math.max(1, Math.floor(amount))) {
      m.tmp['playDead'] = 200;
      m.setMeta('playDead', true);
      m.setTarget(null);
      addEffect(m.level, m.e, { id: 'regeneration', amp: 0, dur: 200, ambient: false, particles: true, icon: true });
    }
  },
  onKill(m) {
    m.tmp['huntCooldown'] = 2400;
  },
  interact(m, p, hand) {
    const s = handStack(p, hand);
    if (bucketMob(m, p, hand)) return true;
    // Breeding with a bucket of tropical fish leaves a water bucket behind
    if (s.id === 'tropical_fish_bucket' && !m.isBaby && !(m.tmp['inLove'] as number | undefined)) {
      m.tmp['inLove'] = 600;
      m.tmp['loveCause'] = p.entity.id;
      m.broadcastEvent('love');
      exchangeItem(p, hand, s, new ItemStack('water_bucket', 1));
      return true;
    }
    return false;
  },
  offspring(m, partner) {
    // Blue axolotls are the rare mutation (1 in 1200)
    const v = m.random.nextInt(1200) === 0 ? 'blue' : (m.random.nextBool() ? m : partner).data['variant'];
    return { type: 'axolotl', data: { variant: v } };
  },
  canSpawn(level, x, y, z) {
    return blockOf(level.getBlockState(x, y - 1, z)).name === 'clay' && !!(stateFlags[level.getBlockState(x, y, z)]! & F.WATER);
  },
});

/** A player who kills a mob an axolotl is fighting gets regeneration (reference). */
export function axolotlAssist(level: Mob['level'], victim: Entity, killer: Entity | null): void {
  if (!killer?.player) return;
  const t = victim.transform;
  if (!t) return;
  for (const e of level.getEntities(new AABB(t.x - 20, t.y - 20, t.z - 20, t.x + 20, t.y + 20, t.z + 20), (o) => o.type === 'axolotl')) {
    const a = mobOf(e);
    if (!a || a.getTarget() !== victim) continue;
    const cur = killer.living?.effects.get('regeneration');
    const dur = Math.min(2400, 100 + (cur?.dur ?? 0));
    addEffect(level, killer, { id: 'regeneration', amp: 0, dur, ambient: false, particles: true, icon: true });
    killer.living?.effects.delete('mining_fatigue');
    break;
  }
}

// =============================================================================================
// Guardians
// =============================================================================================

/** Charge a laser for 80 ticks, then hit for attack damage + 1 magic (+2 on hard). */
class GuardianAttackGoal extends Goal {
  private time = 0;
  constructor(private readonly g: Mob, private readonly elder: boolean) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.g.getTarget();
    return !!t && !t.living?.dead;
  }
  override canContinueToUse(): boolean {
    const t = this.g.getTarget();
    return super.canContinueToUse() && !!t && (this.elder || this.g.distanceToSqr(t) > 9);
  }
  override start(): void {
    this.time = -10;
    this.g.nav.stop();
    const t = this.g.getTarget();
    if (t) this.g.look.setLookAtEntity(t, 90, 90);
  }
  override stop(): void {
    this.g.setMeta('beam', 0);
    this.g.setTarget(null);
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const g = this.g, t = g.getTarget();
    if (!t) return;
    g.nav.stop();
    g.look.setLookAtEntity(t, 90, 90);
    if (!g.hasLineOfSight(t)) {
      g.setTarget(null);
      return;
    }
    this.time++;
    if (this.time === 0) {
      g.setMeta('beam', t.id);
      g.broadcastEvent('beam');
    } else if (this.time >= 80) {
      let dmg = 1;
      if (g.level.getDifficulty() === 3) dmg += 2;
      if (this.elder) dmg += 2;
      g.level.hurtEntity(t, 'indirect_magic', dmg, g.e);
      g.level.hurtEntity(t, 'mob_attack', g.attr('attack_damage'), g.e);
      g.setTarget(null);
    }
  }
}

function guardianTarget(g: Mob) {
  return (e: Entity) => (!!e.player || e.type === 'squid' || e.type === 'glow_squid' || e.type === 'axolotl') && g.distanceToSqr(e) > 9;
}

function guardianDef(id: 'guardian' | 'elder_guardian'): void {
  const elder = id === 'elder_guardian';
  registerMob({
    id, attrs: elder ? { max_health: 80, attack_damage: 8, movement_speed: 0.3 } : { max_health: 30, attack_damage: 6, movement_speed: 0.5 },
    nav: 'swim', move: 'swim', swimStyle: 'fish', waterBreather: true, hostile: true, xp: 10, persistent: elder, spawnDarkness: false,
    ...sounds(id), malus: { [PathType.WATER]: 0 },
    ambientFor(m) {
      return m.inWater ? `entity.${id}.ambient` : `entity.${id}.ambient_land`;
    },
    setup(m) {
      m.goals.add(4, new GuardianAttackGoal(m, elder));
      m.goals.add(7, new (class extends RandomSwimmingGoal {
        protected override position() {
          return swimmablePos(m, 10, 7);
        }
      })(m, 1, 80));
      m.goals.add(8, new LookAtPlayerGoal(m, 8));
      m.goals.add(8, new LookAtPlayerGoal(m, 12, 0.01, false, (e) => e.type === 'guardian'));
      m.goals.add(9, new RandomLookAroundGoal(m));
      m.targets.add(1, new NearestAttackableTargetGoal(m, guardianTarget(m), 10, true));
    },
    tick(m) {
      const p = m.e.physics;
      // Stranded guardians flop and hurt
      if (!m.inWater && m.onGround) {
        p.vy += 0.5;
        p.vx += (m.random.nextFloat() * 2 - 1) * 0.4;
        p.vz += (m.random.nextFloat() * 2 - 1) * 0.4;
        m.e.transform.yaw = m.random.nextFloat() * 360;
        p.onGround = false;
        m.playSound(`entity.${id}.flop`);
      }
      m.setMeta('moving', p.vx * p.vx + p.vz * p.vz > 1e-4);
      // Elder guardians curse nearby players with mining fatigue
      if (elder && (m.tickCount + m.e.id) % 1200 === 0) {
        for (const pl of m.level.players) {
          const e = pl.entity;
          if (!attackablePlayer(e) || m.distanceToSqr(e) > 2500) continue;
          const cur = e.living?.effects.get('mining_fatigue');
          if (cur && cur.amp >= 2 && cur.dur >= 1200) continue;
          pl.send({ type: 'gameEvent', event: 'elder_guardian_curse' });
          m.level.addEntityEffect(e, 'mining_fatigue', 6000, 2);
        }
      }
    },
    hurtFilter(m, type, amount, attacker) {
      // Spikes hurt melee attackers while the guardian is not moving
      if (!m.e.meta['moving'] && attacker && attacker.living && (type === 'player_attack' || type === 'mob_attack') && attacker.transform) {
        hurt(m.level, attacker, 'thorns', 2, m.e);
      }
      return amount;
    },
    canSpawn(_level, _x, _y, _z, reason) {
      return reason !== 'natural';
    },
  });
}
guardianDef('guardian');
guardianDef('elder_guardian');
