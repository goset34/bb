/**
 * Gustlings (trial chamber wind spirits: they inhale and fire gust charges, leap around their
 * target and deflect projectiles) and groaners (pale garden stalkers that only move while no
 * player looks at them, bound to a groaner heart that shields them and grows resin when they
 * are struck; they crumble at dawn or when their heart is broken).
 */
import type { Entity } from '../../../common/entity/ecs';
import { blockOf, getBlock, getCollisionShape, stateFlags, F, tryGetValue, setValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { DX, DY, DZ } from '../../../common/world/direction';
import type { ServerLevel } from '../../level';
import { registerMob, Mob, mobOf, yawTo } from '../mob';
import { Goal, Flag } from '../goals';
import { MeleeAttackGoal, NearestAttackableTargetGoal, RandomStrollGoal, LookAtPlayerGoal, HurtByTargetGoal, RandomLookAroundGoal } from '../goallib';
import { attackablePlayer } from '../targeting';
import { createProjectile, shoot } from '../../combat/projectiles';
import { sounds } from './common';

type V3 = [number, number, number];

// =============================================================================================
// Gustling
// =============================================================================================

/** Inhale, then fire a gust charge at the target (reference Breeze Shoot behaviour). */
class GustShootGoal extends Goal {
  private phase: 'inhale' | 'shoot' | 'cooldown' | null = null;
  private timer = 0;
  constructor(private readonly g: Mob) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.g.getTarget();
    if (!t || !this.g.onGround) return false;
    const d = this.g.distanceToSqr(t);
    return d > 4 && d < 256 && this.g.hasLineOfSight(t) && ((this.g.tmp['shootCooldown'] as number | undefined) ?? 0) <= 0;
  }
  override canContinueToUse(): boolean {
    return this.phase !== null && !!this.g.getTarget();
  }
  override start(): void {
    this.phase = 'inhale';
    this.timer = 20;
    this.g.setMeta('pose', 'inhaling');
    this.g.playSound('entity.gustling.inhale', 1);
    this.g.nav.stop();
  }
  override stop(): void {
    this.phase = null;
    this.g.setMeta('pose', 'idle');
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const g = this.g, t = g.getTarget();
    if (!t) return;
    g.look.setLookAtEntity(t, 360, 360);
    if (--this.timer > 0) return;
    if (this.phase === 'inhale') {
      this.phase = 'shoot';
      this.timer = 5;
      g.setMeta('pose', 'shooting');
      const tt = t.transform!;
      const p = createProjectile(g.level, 'gust_charge', g.x, g.y + g.height * 0.6, g.z, { owner: g.e });
      const dy = tt.y + (t.physics?.height ?? 1.8) * 0.3 - p.transform!.y;
      shoot(g.level, p, tt.x - g.x, dy, tt.z - g.z, 0.7, 5 - g.level.getDifficulty());
      g.level.addFreshEntity(p);
      g.playSound('entity.gustling.shoot', 1.5);
    } else if (this.phase === 'shoot') {
      this.phase = 'cooldown';
      this.timer = 10;
      g.setMeta('pose', 'idle');
      g.tmp['shootCooldown'] = 40 + g.random.nextInt(20);
    } else this.phase = null;
  }
}

/** Leap to a spot near (or away from) the target (reference Breeze LongJump). */
class GustJumpGoal extends Goal {
  private cooldown = 0;
  private charging = 0;
  private dest: V3 | null = null;
  constructor(private readonly g: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP;
  }
  canUse(): boolean {
    const g = this.g, t = g.getTarget();
    if (!t || !g.onGround || g.inWater) return false;
    if (--this.cooldown > 0) return false;
    this.cooldown = 10 + g.random.nextInt(30);
    const d = g.distanceToSqr(t);
    if (d < 16 && g.random.nextInt(3) !== 0) return false;
    this.dest = this.pick(t);
    return !!this.dest;
  }
  private pick(t: Entity): V3 | null {
    const g = this.g, level = g.level, tt = t.transform!;
    for (let i = 0; i < 20; i++) {
      const a = g.random.nextFloat() * Math.PI * 2, r = 4 + g.random.nextFloat() * 6;
      const x = Math.floor(tt.x + Math.cos(a) * r), z = Math.floor(tt.z + Math.sin(a) * r);
      for (let dy = 4; dy >= -4; dy--) {
        const y = Math.floor(tt.y) + dy;
        if (!(stateFlags[level.getBlockState(x, y - 1, z)]! & F.SOLID)) continue;
        if (getCollisionShape(level.getBlockState(x, y, z)).length || getCollisionShape(level.getBlockState(x, y + 1, z)).length) continue;
        if ((x - g.x) ** 2 + (z - g.z) ** 2 > 24 * 24) continue;
        return [x, y, z];
      }
    }
    return null;
  }
  override canContinueToUse(): boolean {
    return this.charging > 0 || !this.g.onGround;
  }
  override start(): void {
    this.charging = 10;
    this.g.setMeta('pose', 'inhaling');
    this.g.playSound('entity.gustling.charge', 1);
  }
  override stop(): void {
    this.g.setMeta('pose', 'idle');
  }
  override tick(): void {
    const g = this.g;
    if (this.charging > 0) {
      g.nav.stop();
      if (--this.charging === 0 && this.dest) {
        const [x, y, z] = this.dest;
        const ticks = 14;
        const p = g.e.physics;
        p.vx = (x + 0.5 - g.x) / ticks;
        p.vz = (z + 0.5 - g.z) / ticks;
        p.vy = (y - g.y + 0.5 * 0.08 * ticks * ticks) / ticks;
        g.e.transform.yaw = g.e.transform.bodyYaw = yawTo(p.vx, p.vz);
        g.setMeta('pose', 'jumping');
        g.playSound('entity.gustling.jump', 1);
      }
    } else if (g.onGround) g.playSound('entity.gustling.land', 1);
  }
}

registerMob({
  id: 'gustling', attrs: { max_health: 30, movement_speed: 0.63, attack_damage: 3, follow_range: 24 }, hostile: true, noFallDamage: true,
  xp: 10, ...sounds('gustling'),
  ambientFor(m) {
    return m.onGround ? 'entity.gustling.idle_ground' : 'entity.gustling.idle_air';
  },
  setup(m) {
    m.goals.add(1, new GustJumpGoal(m));
    m.goals.add(2, new GustShootGoal(m));
    m.goals.add(5, new RandomStrollGoal(m, 0.6, 60, false, true));
    m.goals.add(6, new LookAtPlayerGoal(m, 16));
    m.targets.add(1, new HurtByTargetGoal(m));
    m.targets.add(2, new NearestAttackableTargetGoal(m, 'player', 10, true));
    m.targets.add(3, new NearestAttackableTargetGoal(m, (e) => e.type === 'iron_golem', 10, true));
  },
  tick(m) {
    const c = (m.tmp['shootCooldown'] as number | undefined) ?? 0;
    if (c > 0) m.tmp['shootCooldown'] = c - 1;
    if (!m.onGround && m.tickCount % 3 === 0) m.broadcastEvent('whirl');
  },
  hurtFilter(m, type, amount) {
    // Arrows, tridents and thrown things bounce off (wind charges still land)
    if (['arrow', 'trident', 'thrown', 'mob_projectile'].includes(type)) {
      m.playSound('entity.gustling.deflect');
      return 0;
    }
    return amount;
  },
  canSpawn: (_l, _x, _y, _z, reason) => reason !== 'natural',
});

// =============================================================================================
// Groaner and its heart
// =============================================================================================

/** A non-spectator player within 24 blocks whose view cone holds the groaner freezes it. */
function watched(m: Mob): boolean {
  for (const p of m.level.players) {
    const e = p.entity;
    if (!attackablePlayer(e) && p.data.gameMode !== 'creative') continue;
    if (p.data.gameMode === 'spectator' || m.distanceToSqr(e) > 24 * 24) continue;
    const t = e.transform;
    const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
    const lx = -Math.sin(yaw) * Math.cos(pitch), ly = -Math.sin(pitch), lz = Math.cos(yaw) * Math.cos(pitch);
    const ey = t.y + e.physics.eyeHeight;
    // Any of the groaner's eye, middle or feet within the view cone counts
    for (const hy of [m.eyeY, m.y + m.height / 2, m.y]) {
      let dx = m.x - t.x, dy = hy - ey, dz = m.z - t.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= d; dy /= d; dz /= d;
      if (lx * dx + ly * dy + lz * dz > 1 - 0.5 / d && m.hasLineOfSight(e)) return true;
    }
  }
  return false;
}

function heartPos(m: Mob): V3 | null {
  return (m.data['heart'] as V3 | undefined) ?? null;
}

function heartValid(level: ServerLevel, pos: V3): boolean {
  return blockOf(level.getBlockState(pos[0], pos[1], pos[2])).name === 'groaner_heart';
}

/** Crumble away (dawn, a broken heart, straying too far). */
function tearDown(m: Mob): void {
  if (m.tmp['tearing']) return;
  m.tmp['tearing'] = 45;
  m.setMeta('tearing', true);
  m.playSound('entity.groaner.twitch');
  m.broadcastEvent('tearDown');
}

class GroanerAttackGoal extends MeleeAttackGoal {
  override canUse(): boolean {
    return !this.m.tmp['frozen'] && super.canUse();
  }
  override canContinueToUse(): boolean {
    return !this.m.tmp['frozen'] && super.canContinueToUse();
  }
}

registerMob({
  id: 'groaner', attrs: { max_health: 1, movement_speed: 0.4, attack_damage: 3, follow_range: 32 }, hostile: true, stepHeight: 1,
  xp: 0, loot: null, ...sounds('groaner'),
  ambientFor(m) {
    return m.tmp['frozen'] ? null : 'entity.groaner.ambient';
  },
  setup(m) {
    m.goals.add(2, new GroanerAttackGoal(m, 1, true));
    m.goals.add(7, new (class extends RandomStrollGoal {
      override canUse(): boolean {
        return !m.tmp['frozen'] && super.canUse();
      }
    })(m, 0.8));
    m.goals.add(8, new (class extends LookAtPlayerGoal {
      override canUse(): boolean {
        return !m.tmp['frozen'] && super.canUse();
      }
    })(m, 8));
    m.goals.add(8, new (class extends RandomLookAroundGoal {
      override canUse(): boolean {
        return !m.tmp['frozen'] && super.canUse();
      }
    })(m));
    m.targets.add(1, new NearestAttackableTargetGoal(m, 'player', 10, true));
  },
  tick(m) {
    // Crumbling
    const tear = (m.tmp['tearing'] as number | undefined) ?? 0;
    if (tear > 0) {
      m.nav.stop();
      m.tmp['tearing'] = tear - 1;
      if (tear === 1) {
        m.broadcastEvent('poof');
        m.level.entities.remove(m.e);
      }
      return;
    }
    // Freeze while watched
    const frozen = watched(m);
    if (frozen !== !!m.tmp['frozen']) {
      m.tmp['frozen'] = frozen;
      m.setMeta('frozen', frozen);
      m.playSound(frozen ? 'entity.groaner.freeze' : 'entity.groaner.unfreeze');
    }
    if (frozen) {
      m.nav.stop();
      m.e.input.forward = m.e.input.strafe = 0;
      m.e.input.jumping = false;
      const p = m.e.physics;
      p.vx = 0;
      p.vz = 0;
    }
    // Bound groaners follow the heart's schedule
    const h = heartPos(m);
    if (h) {
      // Re-bind after reloads (entity ids change); a second groaner for one heart crumbles
      const be = m.level.getBlockEntity(h[0], h[1], h[2]);
      if (be) {
        const cur = be.data['groaner'] as number | undefined;
        const other = cur ? m.level.entities.get(cur) : undefined;
        if (!other || other.removed) be.data['groaner'] = m.e.id;
        else if (other !== m.e) tearDown(m);
      }
      if (!heartValid(m.level, h)) tearDown(m);
      else if ((m.x - h[0]) ** 2 + (m.z - h[2]) ** 2 > 34 * 34) tearDown(m);
      else if (tryGetValue(m.level.getBlockState(h[0], h[1], h[2]), P.groanerState) !== 'awake') tearDown(m);
    }
  },
  hurtFilter(m, type, amount, attacker) {
    const h = heartPos(m);
    if (!h || !heartValid(m.level, h) || type === 'out_of_world' || type === 'generic_kill') return amount;
    // Bound groaners cannot be hurt; their heart answers with resin
    m.broadcastEvent('twitch');
    m.playSound('entity.groaner.twitch');
    if (attacker?.player) growResin(m.level, h);
    return 0;
  },
  canSpawn: () => false,
});

// ---- Heart -------------------------------------------------------------------------------------

const AXIS_DIRS: Record<string, [number, number]> = { x: [4, 5], y: [0, 1], z: [2, 3] };

/** Uprooted without pale oak logs on both sides of its axis; awake at night, dormant by day. */
function desiredHeartState(level: ServerLevel, x: number, y: number, z: number, s: number): 'uprooted' | 'dormant' | 'awake' {
  const axis = (tryGetValue(s, P.axis) as string | undefined) ?? 'y';
  const [a, b] = AXIS_DIRS[axis]!;
  const log = (d: number) => {
    const n = blockOf(level.getBlockState(x + DX[d]!, y + DY[d]!, z + DZ[d]!)).name;
    return n === 'pale_oak_log' || n === 'pale_oak_wood' || n === 'stripped_pale_oak_log' || n === 'stripped_pale_oak_wood';
  };
  if (!log(a) || !log(b)) return 'uprooted';
  const t = level.getDayTime() % 24000;
  return t >= 13000 && t <= 23000 ? 'awake' : 'dormant';
}

/** Place a few resin clumps on pale oak logs around the heart. */
function growResin(level: ServerLevel, [x, y, z]: V3): void {
  const clump = getBlock('resin_clump');
  const n = 2 + level.random.nextInt(2);
  let placed = 0;
  for (let tries = 0; tries < 24 && placed < n; tries++) {
    const lx = x + level.random.nextInt(5) - 2, ly = y + level.random.nextInt(5) - 2, lz = z + level.random.nextInt(5) - 2;
    const ls = blockOf(level.getBlockState(lx, ly, lz)).name;
    if (!ls.includes('pale_oak_log') && !ls.includes('pale_oak_wood')) continue;
    const d = level.random.nextInt(6);
    const px = lx + DX[d]!, py = ly + DY[d]!, pz = lz + DZ[d]!;
    const at = level.getBlockState(px, py, pz);
    if (!(stateFlags[at]! & F.AIR) && blockOf(at) !== clump) continue;
    // The clump attaches to the face touching the log
    const face = [P.up, P.down, P.south, P.north, P.east, P.west][d]!;
    const base = blockOf(at) === clump ? at : clump.defaultState;
    level.setBlock(px, py, pz, setValue(base, face, true), 3);
    placed++;
  }
  level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.groaner_heart.hurt', 1, 1);
}

/** Heart ticking: state changes, spawning a bound groaner at night, tearing it down by day. */
export function groanerHeartSystem(level: ServerLevel): { name: string; tick(level: ServerLevel): void } {
  return {
    name: 'groaner_hearts',
    tick() {
      if (level.getGameTime() % 20 !== 0) return;
      for (const h of level.chunks.holders.values()) {
        const c = h.chunk;
        if (!c || !c.blockEntities.size) continue;
        for (const be of c.blockEntities.values()) {
          if (be.type !== 'groaner_heart') continue;
          const s = level.getBlockState(be.x, be.y, be.z);
          if (blockOf(s).name !== 'groaner_heart') continue;
          const want = desiredHeartState(level, be.x, be.y, be.z, s);
          if (tryGetValue(s, P.groanerState) !== want) level.setBlock(be.x, be.y, be.z, setValue(s, P.groanerState, want), 3);
          if (want !== 'awake' || level.getDifficulty() === 0) continue;
          const linked = be.data['groaner'] as number | undefined;
          const e = linked ? level.entities.get(linked) : undefined;
          if (e && !e.removed) continue;
          if (level.random.nextInt(5) !== 0) continue;
          spawnBoundGroaner(level, [be.x, be.y, be.z], be.data);
        }
      }
    },
  };
}

function spawnBoundGroaner(level: ServerLevel, pos: V3, beData: Record<string, unknown>): void {
  const [x, y, z] = pos;
  // Only when a player is near enough to be stalked
  if (!level.players.some((p) => (p.entity.transform.x - x) ** 2 + (p.entity.transform.z - z) ** 2 < 32 * 32)) return;
  for (let i = 0; i < 12; i++) {
    const tx = x + level.random.nextInt(33) - 16, tz = z + level.random.nextInt(33) - 16;
    for (let dy = 8; dy >= -8; dy--) {
      const ty = y + dy;
      if (!(stateFlags[level.getBlockState(tx, ty - 1, tz)]! & F.SOLID)) continue;
      let free = true;
      for (let hh = 0; hh < 3; hh++) if (getCollisionShape(level.getBlockState(tx, ty + hh, tz)).length || stateFlags[level.getBlockState(tx, ty + hh, tz)]! & F.WATER) free = false;
      if (!free) continue;
      if (level.getMaxLocalRawBrightness(tx, ty, tz) > 11) continue;
      const e = level.createEntity('groaner', tx + 0.5, ty, tz + 0.5, { reason: 'triggered' });
      const m = mobOf(e);
      if (!m) return;
      m.data['heart'] = pos;
      beData['groaner'] = m.e.id;
      m.playSound('entity.groaner.spawn');
      return;
    }
  }
}

/** Breaking a heart releases its groaner. */
export function heartBroken(level: ServerLevel, beData: Record<string, unknown>): void {
  const id = beData['groaner'] as number | undefined;
  const m = mobOf(id ? level.entities.get(id) : undefined);
  if (m) tearDown(m);
}
