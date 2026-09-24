/**
 * The deep dark: shriekers raise a player's warning level when disturbed by vibrations, casting
 * darkness and, at the fourth warning, summoning an echo warden. The warden is blind: it
 * perceives vibrations and sniffs out creatures, grows angry at suspects, roars, fights in
 * melee, fires a sonic boom at far or unreachable targets, pulses darkness and digs back into
 * the ground when nothing happens for a minute.
 */
import type { Entity } from '../../../common/entity/ecs';
import { AABB } from '../../../common/math/geom';
import { BIOMES } from '../../../common/worldgen/biomes';
import { blockOf, getCollisionShape, stateFlags, F, tryGetValue, setValue } from '../../../common/block/registry';
import { P } from '../../../common/block/properties';
import { hurt, knockback } from '../../survival/living';
import type { ServerLevel } from '../../level';
import type { ServerPlayer } from '../../player';
import { registerMob, Mob, mobOf } from '../mob';
import { Goal, Flag } from '../goals';
import { LookAtPlayerGoal, RandomStrollGoal } from '../goallib';
import { attackablePlayer, withinMeleeRange } from '../targeting';
import { addVibrationListener, Vibration } from '../vibrations';
import { sounds } from './common';
import { ownerOf, type ProjectileState } from '../../combat/projectiles';

type V3 = [number, number, number];

// =============================================================================================
// Echo warden
// =============================================================================================

const ANGRY = 80;
const AGITATED = 40;

function suspects(m: Mob): Map<number, number> {
  let s = m.tmp['suspects'] as Map<number, number> | undefined;
  if (!s) {
    s = new Map();
    m.tmp['suspects'] = s;
  }
  return s;
}

function canTargetWarden(m: Mob, e: Entity | null): e is Entity {
  if (!e || e === m.e || e.removed || !e.living || e.living.dead) return false;
  if (e.type === 'echo_warden' || e.type === 'armor_stand') return false;
  if (e.player && !attackablePlayer(e)) return false;
  return m.level.getDifficulty() !== 0 || !e.player;
}

export function increaseAngerAt(m: Mob, e: Entity, amount: number, listening = true): void {
  if (m.tmp['emerging'] || m.tmp['digging'] || !canTargetWarden(m, e)) return;
  const s = suspects(m);
  const before = s.get(e.id) ?? 0;
  const after = Math.min(150, before + amount);
  s.set(e.id, after);
  m.tmp['calmTicks'] = 0;
  if (before < ANGRY && after >= ANGRY && !m.tmp['roar']) {
    m.tmp['roar'] = 84;
    m.tmp['roarTarget'] = e.id;
    m.nav.stop();
    m.playSound('entity.echo_warden.roar', 3);
    m.broadcastEvent('roar');
  } else if (listening && after >= AGITATED) m.playSound('entity.echo_warden.listening_angry', 2);
  else if (listening) m.playSound('entity.echo_warden.listening', 2);
}

function angriest(m: Mob): { e: Entity; anger: number } | null {
  let best: { e: Entity; anger: number } | null = null;
  for (const [id, a] of suspects(m)) {
    const e = m.level.entities.get(id) ?? null;
    if (!canTargetWarden(m, e)) continue;
    if (!best || a > best.anger) best = { e, anger: a };
  }
  return best;
}

function wardenAnger(m: Mob): number {
  return angriest(m)?.anger ?? 0;
}

/** Vibrations within 16 blocks make the warden listen: sources grow suspect, places get checked. */
addVibrationListener((level, v: Vibration) => {
  const box = new AABB(v.x - 16, v.y - 16, v.z - 16, v.x + 16, v.y + 16, v.z + 16);
  for (const e of level.getEntities(box, (e) => e.type === 'echo_warden')) {
    const m = mobOf(e);
    if (!m || !m.alive || m.tmp['emerging'] || m.tmp['digging']) continue;
    if (v.source === m.e) continue;
    if ((m.x - v.x) ** 2 + (m.y - v.y) ** 2 + (m.z - v.z) ** 2 > 256) continue;
    m.broadcastEvent('tendrils');
    m.tmp['calmTicks'] = 0;
    const pr = v.source?.['proj'] as ProjectileState | undefined;
    const src = pr ? ownerOf(level, pr) : v.source;
    if (src && canTargetWarden(m, src)) {
      increaseAngerAt(m, src, pr ? 10 : 35);
      m.tmp['disturbance'] = [v.x, v.y, v.z] satisfies V3;
    } else m.tmp['disturbance'] = [v.x, v.y, v.z] satisfies V3;
  }
});

/** Emerge from the ground (7 seconds of invulnerability), or dig back into it. */
class EmergeOrDigGoal extends Goal {
  constructor(private readonly w: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP | Flag.TARGET;
  }
  canUse(): boolean {
    return !!this.w.tmp['emerging'] || !!this.w.tmp['digging'];
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override isInterruptable(): boolean {
    return false;
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const w = this.w;
    w.nav.stop();
    if (w.tmp['emerging']) {
      const t = (w.tmp['emerging'] as number) - 1;
      w.tmp['emerging'] = t;
      if (t % 10 === 0) w.broadcastEvent('emergeParticles');
      if (t <= 0) {
        w.tmp['emerging'] = 0;
        w.setMeta('pose', 'idle');
      }
    } else if (w.tmp['digging']) {
      const t = (w.tmp['digging'] as number) - 1;
      w.tmp['digging'] = t;
      if (t % 10 === 0) w.broadcastEvent('digParticles');
      if (t <= 0) w.level.entities.remove(w.e);
    }
  }
}

class WardenFightGoal extends Goal {
  private attackCooldown = 0;
  private boomCooldown = 0;
  private boomCharge = 0;
  private recalc = 0;
  constructor(private readonly w: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  private target(): Entity | null {
    const a = angriest(this.w);
    return a && a.anger >= ANGRY ? a.e : null;
  }
  canUse(): boolean {
    return !this.w.tmp['roar'] && !!this.target();
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override start(): void {
    this.w.setTarget(this.target());
    this.w.setMeta('pose', 'fighting');
  }
  override stop(): void {
    this.w.setTarget(null);
    this.boomCharge = 0;
    this.w.setMeta('pose', 'idle');
  }
  override requiresUpdateEveryTick(): boolean {
    return true;
  }
  override tick(): void {
    const w = this.w, t = this.target();
    if (!t) return;
    w.setTarget(t);
    const tt = t.transform!;
    w.look.setLookAtEntity(t, 30, 30);
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.boomCooldown > 0) this.boomCooldown--;
    // Sonic boom charging
    if (this.boomCharge > 0) {
      this.boomCharge++;
      w.nav.stop();
      if (this.boomCharge === 34) {
        const eyeX = w.x, eyeY = w.y + 1.6, eyeZ = w.z;
        const dx = tt.x - eyeX, dy = tt.y + (t.physics?.height ?? 1.8) / 2 - eyeY, dz = tt.z - eyeZ;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        for (let i = 1; i < Math.floor(len) + 7; i++) {
          w.level.addParticle('sonic_boom', eyeX + (dx / len) * i, eyeY + (dy / len) * i, eyeZ + (dz / len) * i, 0, 0, 0, 1);
        }
        w.playSound('entity.echo_warden.sonic_boom', 3);
        if (hurt(w.level, t, 'sonic_boom', 10, w.e)) {
          const kbr = t.living?.attrs.value('knockback_resistance') ?? 0;
          if (t.physics) t.physics.vy += 0.5 * (1 - kbr);
          knockback(t, 2.5 * (1 - kbr), -dx, -dz);
        }
      }
      if (this.boomCharge >= 60) {
        this.boomCharge = 0;
        this.boomCooldown = 40;
      }
      return;
    }
    const d = w.distanceToSqr(t);
    const reachable = !!w.nav.path?.reached || d < 9;
    if (this.boomCooldown <= 0 && d < 400 && (d > 225 || !reachable) && w.hasLineOfSight(t)) {
      this.boomCharge = 1;
      w.playSound('entity.echo_warden.sonic_charge', 3);
      w.broadcastEvent('sonicCharge');
      return;
    }
    if (--this.recalc <= 0) {
      this.recalc = 10;
      w.nav.moveToEntity(t, 1.2);
    }
    if (this.attackCooldown <= 0 && withinMeleeRange(w, t)) {
      this.attackCooldown = 18;
      w.swing();
      const dmg = w.level.getDifficulty() === 3 ? 45 : w.attr('attack_damage');
      w.level.hurtEntity(t, 'mob_attack', dmg, w.e);
      w.playSound('entity.echo_warden.attack_impact');
    }
  }
}

/** Walk towards the last disturbance (reference GoToTargetLocation on the disturbance memory). */
class InvestigateGoal extends Goal {
  constructor(private readonly w: Mob) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return !!this.w.tmp['disturbance'] && !this.w.getTarget();
  }
  override canContinueToUse(): boolean {
    return this.canUse() && !this.w.nav.isDone();
  }
  override start(): void {
    const [x, y, z] = this.w.tmp['disturbance'] as V3;
    const agitated = wardenAnger(this.w) >= AGITATED;
    this.w.nav.moveTo(x, y, z, agitated ? 1.2 : 0.7);
  }
  override stop(): void {
    this.w.tmp['disturbance'] = null;
  }
}

/** Sniff the air every few seconds; nearby creatures become suspects (reference Sniffing). */
class SniffGoal extends Goal {
  private cooldown = 0;
  private sniffTime = 0;
  constructor(private readonly w: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
    this.cooldown = 100 + w.random.nextInt(100);
  }
  canUse(): boolean {
    if (this.w.getTarget() || this.w.tmp['roar']) return false;
    if (--this.cooldown > 0) return false;
    this.cooldown = 100 + this.w.random.nextInt(100);
    return true;
  }
  override canContinueToUse(): boolean {
    return this.sniffTime > 0;
  }
  override start(): void {
    this.sniffTime = 84;
    this.w.nav.stop();
    this.w.setMeta('pose', 'sniffing');
    this.w.playSound('entity.echo_warden.sniff', 5);
    this.w.broadcastEvent('sniff');
  }
  override stop(): void {
    this.w.setMeta('pose', 'idle');
    const w = this.w;
    const near = w.level.getEntities(w.box().inflate(24, 20, 24), (e) => canTargetWarden(w, e))
      .sort((a, b) => w.distanceToSqr(a) - w.distanceToSqr(b))[0];
    if (!near) return;
    const t = near.transform!;
    const close = (w.x - t.x) ** 2 + (w.z - t.z) ** 2 <= 36 && Math.abs(w.y - t.y) <= 20;
    if (close) increaseAngerAt(w, near, 35, false);
    else w.tmp['disturbance'] = [t.x, t.y, t.z] satisfies V3;
  }
  override tick(): void {
    this.sniffTime--;
  }
}

function wardenTick(m: Mob): void {
  // Anger slowly fades
  const s = suspects(m);
  for (const [id, a] of s) {
    const e = m.level.entities.get(id) ?? null;
    if (!canTargetWarden(m, e) || a <= 1) s.delete(id);
    else s.set(id, a - 1);
  }
  const anger = wardenAnger(m);
  m.setMeta('anger', anger);
  // Roaring before a fight
  const roar = (m.tmp['roar'] as number | undefined) ?? 0;
  if (roar > 0) {
    m.tmp['roar'] = roar - 1;
    m.nav.stop();
    m.setMeta('pose', 'roaring');
    if (roar === 1) m.setMeta('pose', 'fighting');
  }
  // Touching a creature makes it a suspect
  if (m.tickCount % 5 === 0) {
    for (const e of m.level.getEntities(m.box().inflate(0.2), (e) => canTargetWarden(m, e))) increaseAngerAt(m, e, 35, false);
  }
  // Darkness pulses every six seconds
  if (m.tickCount % 120 === 0) {
    for (const p of m.level.players) {
      if (!attackablePlayer(p.entity) || m.distanceToSqr(p.entity) > 400) continue;
      m.level.addEntityEffect(p.entity, 'darkness', 260, 0);
    }
  }
  // Heartbeat faster with anger
  const beat = Math.max(8, 40 - Math.floor(anger / 4));
  if (m.tickCount % beat === 0) m.playSound('entity.echo_warden.heartbeat', 5);
  // Dig down after a minute of calm
  const calm = ((m.tmp['calmTicks'] as number | undefined) ?? 0) + 1;
  m.tmp['calmTicks'] = calm;
  if (calm > 1200 && anger < AGITATED && !m.tmp['emerging'] && !m.tmp['digging'] && m.onGround && !m.persistent) {
    m.tmp['digging'] = 100;
    m.setMeta('pose', 'digging');
    m.playSound('entity.echo_warden.dig', 5);
    m.broadcastEvent('dig');
  }
}

registerMob({
  id: 'echo_warden', attrs: { max_health: 500, movement_speed: 0.3, knockback_resistance: 1, attack_knockback: 1.5, attack_damage: 30, follow_range: 24 },
  hostile: true, fireImmune: true, xp: 5, ...sounds('echo_warden'), stepHeight: 1, disablesShield: true,
  ambientFor(m) {
    const a = wardenAnger(m);
    return a >= ANGRY ? 'entity.echo_warden.angry' : a >= AGITATED ? 'entity.echo_warden.agitated' : 'entity.echo_warden.ambient';
  },
  setup(m) {
    m.goals.add(0, new EmergeOrDigGoal(m));
    m.goals.add(1, new WardenFightGoal(m));
    m.goals.add(2, new InvestigateGoal(m));
    m.goals.add(3, new SniffGoal(m));
    m.goals.add(5, new RandomStrollGoal(m, 0.5, 120, false, false));
    m.goals.add(6, new LookAtPlayerGoal(m, 8));
  },
  init(m, ctx) {
    if (ctx.reason === 'triggered' || ctx.opts['emerge']) {
      m.tmp['emerging'] = 134;
      m.setMeta('pose', 'emerging');
      m.playSound('entity.echo_warden.emerge', 5);
      m.broadcastEvent('emerge');
    }
    if (ctx.reason === 'command' || ctx.reason === 'spawn_egg') m.setPersistent();
  },
  tick: wardenTick,
  hurtFilter(m, _type, amount, attacker) {
    if (m.tmp['emerging'] || m.tmp['digging']) return 0;
    if (attacker) increaseAngerAt(m, attacker, 100, false);
    return amount;
  },
  canSpawn: () => false,
});

// =============================================================================================
// Shriekers
// =============================================================================================

interface Warning {
  level: number;
  cooldown: number;
  since: number;
}

function warningOf(p: ServerPlayer): Warning {
  let w = p.ext['wardenWarning'] as Warning | undefined;
  if (!w) {
    w = { level: 0, cooldown: 0, since: 0 };
    p.ext['wardenWarning'] = w;
  }
  return w;
}

/** Per-player warning bookkeeping: cooldown between shrieks and decay after ten quiet minutes. */
export function tickWarning(p: ServerPlayer): void {
  const w = p.ext['wardenWarning'] as Warning | undefined;
  if (!w) return;
  if (w.cooldown > 0) w.cooldown--;
  w.since++;
  if (w.since >= 12000 && w.level > 0) {
    w.level--;
    w.since = 0;
  }
}

function shriekersNear(level: ServerLevel, x: number, y: number, z: number): V3[] {
  const out: V3[] = [];
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
    if (blockOf(level.getBlockState(bx + dx, by + dy, bz + dz)).name === 'echo_shrieker') out.push([bx + dx, by + dy, bz + dz]);
  }
  return out;
}

function inDeepDark(level: ServerLevel, x: number, y: number, z: number): boolean {
  return BIOMES[level.getBiome(Math.floor(x), Math.floor(y), Math.floor(z))]?.name === 'deep_dark';
}

/** A disturbed shrieker screams; a summoning shrieker warns the player and may call a warden. */
function shriek(level: ServerLevel, pos: V3, p: ServerPlayer | null): void {
  const [x, y, z] = pos;
  const s = level.getBlockState(x, y, z);
  if (tryGetValue(s, P.shrieking) === true) return;
  const canSummon = tryGetValue(s, P.canSummon) === true;
  let warn = 0;
  if (p && canSummon) {
    // Every player near the shriek shares the warning level (reference WardenSpawnTracker)
    const w = warningOf(p);
    if (w.cooldown > 0) return;
    const nearby = level.players.filter((o) => o !== p && (o.entity.transform.x - x) ** 2 + (o.entity.transform.z - z) ** 2 < 256 && Math.abs(o.entity.transform.y - y) < 16);
    const maxLevel = Math.max(w.level, ...nearby.map((o) => warningOf(o).level));
    warn = Math.min(4, maxLevel + 1);
    for (const o of [p, ...nearby]) {
      const ow = warningOf(o);
      ow.level = warn;
      ow.cooldown = 200;
      ow.since = 0;
    }
  }
  level.setBlock(x, y, z, setValue(s, P.shrieking, true), 3);
  level.scheduleTick(x, y, z, blockOf(s), 90);
  level.playSound(x + 0.5, y + 0.5, z + 0.5, 'block.echo_shrieker.shriek', 2, 0.6 + level.random.nextFloat() * 0.4);
  level.levelEvent(3007, x, y, z, 0);
  if (!canSummon || !p) return;
  // Darkness for everyone close by
  for (const o of level.players) {
    if ((o.entity.transform.x - x) ** 2 + (o.entity.transform.y - y) ** 2 + (o.entity.transform.z - z) ** 2 <= 1600) level.addEntityEffect(o.entity, 'darkness', 260, 0);
  }
  if (warn >= 4) summonWarden(level, pos);
  else if (warn > 1) level.playSound(x + 0.5, y + 0.5, z + 0.5, `entity.echo_warden.nearby_close${warn === 3 ? 'st' : 'r'}`, 1, 1);
}

function summonWarden(level: ServerLevel, [x, y, z]: V3): void {
  const near = level.getEntities(new AABB(x - 48, y - 48, z - 48, x + 48, y + 48, z + 48), (e) => e.type === 'echo_warden');
  if (near.length) return;
  for (let i = 0; i < 20; i++) {
    const tx = x + level.random.nextInt(11) - 5, tz = z + level.random.nextInt(11) - 5;
    for (let dy = 6; dy >= -6; dy--) {
      const ty = y + dy;
      const below = level.getBlockState(tx, ty - 1, tz);
      if (!(stateFlags[below]! & F.SOLID)) continue;
      let free = true;
      for (let h = 0; h < 3; h++) if (getCollisionShape(level.getBlockState(tx, ty + h, tz)).length || stateFlags[level.getBlockState(tx, ty + h, tz)]! & F.LAVA) free = false;
      if (!free) continue;
      const e = level.createEntity('echo_warden', tx + 0.5, ty, tz + 0.5, { reason: 'triggered', emerge: true });
      if (e) {
        for (const p of level.players) warningOf(p).level = Math.min(warningOf(p).level, 3);
        return;
      }
    }
  }
}

addVibrationListener((level, v) => {
  // Only player-caused vibrations (or their projectiles) inside the deep dark disturb shriekers
  const pr = v.source?.['proj'] as ProjectileState | undefined;
  const src = pr ? ownerOf(level, pr) : v.source;
  if (!src?.player || !inDeepDark(level, v.x, v.y, v.z)) return;
  const p = level.players.find((pl) => pl.entity === src) ?? null;
  if (!p) return;
  // Throttle the block scan per player
  const last = (p.ext['shriekScan'] as number | undefined) ?? -100;
  if (level.getGameTime() - last < 10) return;
  p.ext['shriekScan'] = level.getGameTime();
  const list = shriekersNear(level, v.x, v.y, v.z);
  if (list.length) shriek(level, list[0]!, p);
});
