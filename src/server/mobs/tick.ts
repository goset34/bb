/**
 * Per-tick mob update (reference Mob.tick → baseTick → aiStep → travel → pushEntities →
 * body rotation → despawn check): environment damage, AI selectors and controls, movement,
 * entity pushing, ambient sounds and despawning.
 */
import { stateFlags, F, getCollisionShape, blockOf } from '../../common/block/registry';
import { tickLivingMovement, updateFluidState, moveRelative, move, DEFAULT_TRAVEL, TravelOptions } from '../../common/entity/physics';
import { MOBS } from '../../common/entity/mobs';
import { hurt, tickLiving, hasEffect, effectAmp } from '../survival/living';
import type { Mob, RiderInput } from './mob';
import { Flag } from './goals';
import { controllingPassenger, vehicleOf, passengersOf, positionPassengers } from '../entity/riding';
import { getItem } from '../../common/item/items';
import { ItemStack } from '../../common/item/stack';
import { tickAgeing } from './actions';
import { tickLeash } from './leash';
import { tickPickup } from './pickup';

/** Despawn distances per category: [instant despawn, random despawn]. */
const DESPAWN: Record<string, [number, number] | null> = {
  monster: [128, 32], creature: null, ambient: [128, 32], water_creature: [128, 32], water_ambient: [64, 32],
  underground_water_creature: [128, 32], axolotls: [128, 32], misc: null,
};

function eyeInsideSolid(m: Mob): boolean {
  const t = m.e.transform, ph = m.e.physics;
  const ey = t.y + ph.eyeHeight;
  const w = ph.width * 0.8 / 2;
  for (const [dx, dz] of [[-w, -w], [w, -w], [-w, w], [w, w]] as const) {
    const bx = Math.floor(t.x + dx), by = Math.floor(ey), bz = Math.floor(t.z + dz);
    const s = m.level.getBlockState(bx, by, bz);
    if (!(stateFlags[s]! & F.SOLID) || !(stateFlags[s]! & F.OPAQUE_CUBE)) continue;
    const shape = getCollisionShape(s);
    for (let i = 0; i < shape.length; i += 6) {
      if (ey > by + shape[i + 1]! && ey < by + shape[i + 4]!) return true;
    }
  }
  return false;
}

/** Sunlight that sets undead on fire (reference isSunBurnTick). */
export function isSunBurnTick(m: Mob): boolean {
  const level = m.level;
  if (!level.isDay()) return false;
  const p = m.e.physics;
  const bx = Math.floor(m.x), ey = Math.floor(m.eyeY), bz = Math.floor(m.z);
  const f = m.brightness(bx, ey, bz);
  const wet = p.inWater || level.isRainingAt(bx, ey, bz) || p.inPowderSnow || p.wasInPowderSnow;
  return f > 0.5 && m.random.nextFloat() * 30 < (f - 0.4) * 2 && !wet && level.canSeeSky(bx, ey, bz);
}

function tickEnvironment(m: Mob): void {
  const level = m.level, e = m.e, p = e.physics, t = e.transform, d = m.def;
  if (p.inLava && !p.fireImmune) {
    level.igniteEntity(e, 15);
    hurt(level, e, 'lava', 4);
  }
  // Breathing
  if (d.aquatic) {
    if (!p.inWater) {
      p.air--;
      if (p.air <= -20) {
        p.air = 0;
        hurt(level, e, 'drown', 2);
      }
    } else p.air = p.maxAir;
  } else if (!d.waterBreather && !d.undead) {
    const eyeWater = p.underWater && blockOf(level.getBlockState(Math.floor(t.x), Math.floor(t.y + p.eyeHeight), Math.floor(t.z))).name !== 'bubble_column';
    if (eyeWater && !hasEffect(e, 'water_breathing')) {
      p.air--;
      if (p.air <= -20) {
        p.air = 0;
        hurt(level, e, 'drown', 2);
      }
    } else if (p.air < p.maxAir) p.air = Math.min(p.maxAir, p.air + 4);
  }
  if (d.hurtByWater && (p.inWater || level.isRainingAt(Math.floor(t.x), Math.floor(t.y + p.height), Math.floor(t.z)))) hurt(level, e, 'drown', 1);
  // Freezing in powder snow
  if (p.inPowderSnow) p.frozenTicks = Math.min(142, p.frozenTicks + 1);
  else p.frozenTicks = Math.max(0, p.frozenTicks - 2);
  if (p.frozenTicks >= 140 && level.getGameTime() % 40 === 0) hurt(level, e, 'freeze', m.tmp['freezeDamage'] as number | undefined ?? 1);
  // Suffocation and the void
  if (!p.noPhysics && eyeInsideSolid(m)) hurt(level, e, 'in_wall', 1);
  if (t.y < level.minY - 64) hurt(level, e, 'out_of_world', 4);
  // Sunlight
  if (d.burnsInDay && isSunBurnTick(m)) {
    const head = m.equipment[5]!;
    if (!head.isEmpty()) {
      const max = getItem(head.id)?.maxDamage ?? 0;
      if (max > 0) {
        head.damage = head.damage + m.random.nextInt(2);
        if (head.damage >= max) {
          m.equipment[5] = ItemStack.empty();
          m.broadcastEvent('itemBreak', 5);
        }
      }
    } else level.igniteEntity(e, 8);
  }
}

function travelOptions(m: Mob): TravelOptions {
  const e = m.e;
  const lev = effectAmp(e, 'levitation');
  const jump = effectAmp(e, 'jump_boost');
  return {
    ...DEFAULT_TRAVEL,
    lavaPush: m.level.dim.ultrawarm ? 0.007 : 0.0023333333333333335,
    slowFalling: hasEffect(e, 'slow_falling'),
    levitation: lev >= 0 ? lev + 1 : 0,
    jumpBoost: jump >= 0 ? jump + 1 : 0,
    dolphinsGrace: hasEffect(e, 'dolphins_grace'),
  };
}

/** Swimmers move with their own drag in water (reference AbstractFish/Dolphin.travel). */
function travel(m: Mob): void {
  const e = m.e, p = e.physics, inp = e.input;
  const opts = travelOptions(m);
  if (m.def.move === 'swim' && p.inWater) {
    if (p.noJumpDelay > 0) p.noJumpDelay--;
    updateFluidState(m.level, e, opts.lavaPush);
    const accel = m.def.swimStyle === 'smooth' ? inp.speed : 0.01;
    moveRelative(e, accel, inp.strafe * 0.98, inp.up * 0.98, inp.forward * 0.98);
    move(m.level, e, p.vx, p.vy, p.vz);
    p.vx *= 0.9;
    p.vy *= 0.9;
    p.vz *= 0.9;
    if (!m.getTarget()) p.vy -= 0.005;
    return;
  }
  tickLivingMovement(m.level, e, opts);
}

/** Push overlapping entities apart (reference pushEntities / push). */
function pushEntities(m: Mob): void {
  const e = m.e, level = m.level;
  if (e.physics.noPhysics || !e.physics.pushable) return;
  const list = level.getEntities(m.box(), (o) => !!o.physics && o.physics.pushable && !o.physics.noPhysics && !o.player && !o.item && !o.xpOrb, e);
  if (!list.length) return;
  const cram = Number(level.getGameRule('maxEntityCramming'));
  if (cram > 0 && list.length > cram - 1 && m.random.nextInt(4) === 0) hurt(level, e, 'cramming', 6);
  for (const o of list) {
    const ot = o.transform!;
    let dx = ot.x - m.x, dz = ot.z - m.z;
    let d = Math.max(Math.abs(dx), Math.abs(dz));
    if (d < 0.01) continue;
    d = Math.sqrt(d);
    dx /= d;
    dz /= d;
    const f = Math.min(1, 1 / d);
    dx *= f * 0.05;
    dz *= f * 0.05;
    e.physics.vx -= dx;
    e.physics.vz -= dz;
    o.physics!.vx += dx;
    o.physics!.vz += dz;
  }
}

/** Remove mobs far from every player (reference checkDespawn). */
function checkDespawn(m: Mob): boolean {
  const level = m.level;
  if (level.getDifficulty() === 0 && m.def.hostile && !m.persistent) {
    level.entities.remove(m.e);
    return true;
  }
  const cat = MOBS.get(m.def.id)?.category ?? 'misc';
  const dist = DESPAWN[cat];
  if (!dist || m.persistent || m.tmp['fromBucket']) {
    m.noActionTime = 0;
    return false;
  }
  let best = Infinity;
  for (const p of level.players) {
    if (p.data.gameMode === 'spectator') continue;
    best = Math.min(best, m.distanceToSqr(p.entity));
  }
  if (best === Infinity) return false;
  const [far, near] = dist;
  if (best > far * far) {
    level.entities.remove(m.e);
    return true;
  }
  if (m.noActionTime > 600 && m.random.nextInt(800) === 0 && best > near * near) {
    level.entities.remove(m.e);
    return true;
  }
  if (best < near * near) m.noActionTime = 0;
  return false;
}

function ambientSound(m: Mob): void {
  if (!m.def.ambient && !m.def.ambientFor) return;
  if (m.random.nextInt(1000) < m.ambientSoundTime++) {
    m.ambientSoundTime = -(m.tmp['ambientInterval'] as number | undefined ?? 80);
    const s = m.def.ambientFor ? m.def.ambientFor(m) : m.def.ambient;
    if (s) m.playSound(s);
  }
}

export function tickMob(m: Mob): void {
  const e = m.e, level = m.level, t = e.transform, l = e.living;
  t.px = t.x; t.py = t.y; t.pz = t.z; t.pyaw = t.yaw; t.ppitch = t.pitch; t.pHeadYaw = t.headYaw; t.pBodyYaw = t.bodyYaw;
  m.tickCount++;
  tickLiving(level, e);
  if (l.dead) {
    const inp = e.input;
    inp.forward = inp.strafe = inp.up = 0;
    inp.jumping = false;
    tickLivingMovement(level, e, DEFAULT_TRAVEL);
    if (l.deathTime >= 20 && !e.removed) {
      m.broadcastEvent('poof');
      level.entities.remove(e);
    }
    return;
  }
  tickEnvironment(m);
  if (e.removed || l.dead) return;
  ambientSound(m);
  // A controlling rider steers the mob; its own movement goals pause
  const rider = controllingPassenger(e);
  const riderInput = rider ? (m.tmp['riderInput'] as RiderInput | undefined) : undefined;
  m.goals.setControlFlag(Flag.MOVE, !rider);
  m.goals.setControlFlag(Flag.JUMP, !rider && !vehicleOf(e));
  m.goals.setControlFlag(Flag.LOOK, !rider);
  tickLeash(m);
  if (e.removed || l.dead) return;
  if (!m.noAi) {
    m.noActionTime++;
    m.sensing.tick();
    if ((m.tickCount + e.id) % 2 !== 0 && m.tickCount > 1) {
      m.targets.tickRunning(false);
      m.goals.tickRunning(false);
    } else {
      m.targets.tick();
      m.goals.tick();
    }
    m.nav.tick();
    m.def.tick?.(m);
    if (e.removed) return;
    if (rider && riderInput && m.def.ridden) {
      m.nav.stop();
      m.def.ridden(m, rider, riderInput);
    } else {
      m.move.tick();
      m.look.tick();
      m.jump.tick();
    }
  } else {
    e.input.forward = e.input.strafe = e.input.up = 0;
    e.input.jumping = false;
    m.def.tick?.(m);
  }
  tickAgeing(m);
  if (!m.noAi) tickPickup(m);
  // Passengers are carried by their vehicle
  if (!vehicleOf(e)) {
    travel(m);
    pushEntities(m);
  }
  m.body.tick();
  if (passengersOf(e).length) positionPassengers(e);
  checkDespawn(m);
}
