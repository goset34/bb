/**
 * Projectile entities (reference AbstractArrow, ThrowableProjectile, AbstractHurtingProjectile):
 * arrows (crits, piercing, punch, flame, sticking into blocks, pickup), tridents (loyalty),
 * snowballs, eggs, void pearls, experience bottles, fireballs, wind charges and llama spit.
 */
import type { Entity } from '../../common/entity/ecs';
import { makePhysics, makeTransform } from '../../common/entity/components';
import { AABB } from '../../common/math/geom';
import { raycastBlocks } from '../../common/world/raycast';
import { stateFlags, F, getBlock, getCollisionShape } from '../../common/block/registry';
import { DX, DY, DZ } from '../../common/world/direction';
import { ItemStack, SerializedStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import type { ServerLevel } from '../level';
import { hurt, addEffect, knockback } from '../survival/living';
import { effect } from '../../common/entity/living';
import { ENTITY_CODECS } from '../entity/persistence';
import { explode } from './explosion';
import { mobOf } from '../mobs/mob';

export type ProjectileKind =
  | 'arrow' | 'spectral_arrow' | 'trident' | 'snowball' | 'egg' | 'void_pearl' | 'experience_bottle'
  | 'small_fireball' | 'fireball' | 'wind_charge' | 'gust_charge' | 'llama_spit';

export interface ProjectileState {
  kind: ProjectileKind;
  owner: number;
  /** Player name of the owner (survives reloads). */
  ownerName?: string;
  leftOwner: boolean;
  gravity: number;
  inertia: number;
  waterInertia: number;
  /** Accelerating projectiles (fireballs) add this each tick along their heading. */
  accel: number;
  life: number;
  // Arrows and tridents
  damage: number;
  crit: boolean;
  pierce: number;
  pierced: number[];
  punch: number;
  inGround: boolean;
  stuck: [number, number, number, number] | null;
  shake: number;
  /** 0 = no pickup, 1 = pickup, 2 = creative only. */
  pickup: number;
  stack: SerializedStack | null;
  effects: Array<{ id: string; dur: number; amp: number }>;
  dealtDamage: boolean;
  loyalty: number;
  returning: boolean;
  /** Explosion power (large fireballs) / burst radius (wind charges). */
  power: number;
}

type ProjEntity = Entity & { proj: ProjectileState };

const SIZES: Record<ProjectileKind, number> = {
  arrow: 0.5, spectral_arrow: 0.5, trident: 0.5, snowball: 0.25, egg: 0.25, void_pearl: 0.25, experience_bottle: 0.25,
  small_fireball: 0.3125, fireball: 1, wind_charge: 0.3125, gust_charge: 0.3125, llama_spit: 0.25,
};

export function projOf(e: Entity | null | undefined): ProjectileState | undefined {
  return e ? (e['proj'] as ProjectileState | undefined) : undefined;
}

export interface ProjectileOptions {
  owner?: Entity | null;
  damage?: number;
  stack?: ItemStack | null;
  pickup?: number;
  crit?: boolean;
  pierce?: number;
  punch?: number;
  onFire?: boolean;
  loyalty?: number;
  power?: number;
  effects?: Array<{ id: string; dur: number; amp: number }>;
}

/** Create a projectile at a position (not yet moving; call shoot or set velocity). */
export function createProjectile(level: ServerLevel, kind: ProjectileKind, x: number, y: number, z: number, o: ProjectileOptions = {}): ProjEntity {
  const size = SIZES[kind];
  const physics = makePhysics(size, size, size / 2);
  physics.stepHeight = 0;
  physics.pushable = false;
  const arrowLike = kind === 'arrow' || kind === 'spectral_arrow' || kind === 'trident';
  const hurting = kind === 'small_fireball' || kind === 'fireball' || kind === 'wind_charge' || kind === 'gust_charge';
  physics.noGravity = hurting;
  physics.fireImmune = hurting;
  if (o.onFire) physics.fireTicks = 2000;
  const proj: ProjectileState = {
    kind, owner: o.owner?.id ?? 0, ownerName: o.owner?.player?.name, leftOwner: false,
    gravity: arrowLike ? 0.05 : hurting ? 0 : kind === 'llama_spit' ? 0.06 : 0.03,
    inertia: hurting ? (kind === 'wind_charge' || kind === 'gust_charge' ? 1 : 0.95) : 0.99,
    waterInertia: kind === 'trident' ? 0.99 : arrowLike ? 0.6 : 0.8,
    accel: kind === 'small_fireball' || kind === 'fireball' ? 0.1 : 0,
    life: 0, damage: o.damage ?? (kind === 'trident' ? 8 : 2), crit: !!o.crit, pierce: o.pierce ?? 0, pierced: [], punch: o.punch ?? 0,
    inGround: false, stuck: null, shake: 0, pickup: o.pickup ?? (arrowLike ? 1 : 0), stack: o.stack ? o.stack.toJSON() : null,
    effects: o.effects ?? [], dealtDamage: false, loyalty: o.loyalty ?? 0, returning: false, power: o.power ?? 1,
  };
  const e: ProjEntity = {
    id: 0, type: kind, removed: false, transform: makeTransform(x, y, z), physics, proj,
    meta: { crit: proj.crit, onFire: !!o.onFire, ...(o.effects?.length ? { color: effectColor(o.effects) } : {}) },
    noSave: false,
  };
  return e;
}

function effectColor(effects: Array<{ id: string }>): number {
  let h = 0;
  for (const fx of effects) for (let i = 0; i < fx.id.length; i++) h = (h * 31 + fx.id.charCodeAt(i)) >>> 0;
  return 0x404040 | (h & 0xbfbfbf);
}

/** Reference Projectile.shoot: normalised direction plus triangular spread, scaled by velocity. */
export function shoot(level: ServerLevel, e: Entity, dx: number, dy: number, dz: number, velocity: number, inaccuracy: number): void {
  const r = level.random;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  let vx = dx / len + r.triangle(0, 0.0172275 * inaccuracy);
  let vy = dy / len + r.triangle(0, 0.0172275 * inaccuracy);
  let vz = dz / len + r.triangle(0, 0.0172275 * inaccuracy);
  vx *= velocity; vy *= velocity; vz *= velocity;
  const p = e.physics!, t = e.transform!;
  p.vx = vx; p.vy = vy; p.vz = vz;
  const h = Math.sqrt(vx * vx + vz * vz);
  t.yaw = t.pyaw = (Math.atan2(vx, vz) * 180) / Math.PI;
  t.pitch = t.ppitch = (Math.atan2(vy, h) * 180) / Math.PI;
}

/** Reference shootFromRotation: aim along the shooter's view, inheriting its motion. */
export function shootFromRotation(level: ServerLevel, e: Entity, shooter: Entity, pitch: number, yaw: number, roll: number, velocity: number, inaccuracy: number): void {
  const D = Math.PI / 180;
  const x = -Math.sin(yaw * D) * Math.cos(pitch * D);
  const y = -Math.sin((pitch + roll) * D);
  const z = Math.cos(yaw * D) * Math.cos(pitch * D);
  shoot(level, e, x, y, z, velocity, inaccuracy);
  const sp = shooter.physics;
  if (sp) {
    e.physics!.vx += sp.vx;
    e.physics!.vz += sp.vz;
    if (!sp.onGround) e.physics!.vy += sp.vy;
  }
}

export function ownerOf(level: ServerLevel, pr: ProjectileState): Entity | null {
  if (pr.owner) {
    const e = level.entities.get(pr.owner);
    if (e && !e.removed) return e;
  }
  if (pr.ownerName) {
    const p = level.players.find((pl) => pl.name === pr.ownerName);
    if (p) {
      pr.owner = p.entity.id;
      return p.entity;
    }
  }
  return null;
}

function hitbox(e: Entity): AABB {
  const t = e.transform!, p = e.physics;
  const hw = (p?.width ?? 0.5) / 2;
  return new AABB(t.x - hw, t.y, t.z - hw, t.x + hw, t.y + (p?.height ?? 0.5), t.z + hw);
}

function canHit(level: ServerLevel, e: ProjEntity, o: Entity): boolean {
  if (o.removed || !o.living || o.living.dead) return false;
  if (o.player?.gameMode === 'spectator') return false;
  const pr = e.proj;
  if (o.id === pr.owner && !pr.leftOwner) return false;
  if (pr.pierced.includes(o.id)) return false;
  const owner = ownerOf(level, pr);
  if (owner?.player && o.player && level.getGameRule('pvp') === false && owner !== o) return false;
  return true;
}

/** The owner stays unhittable until the projectile has left its hitbox. */
function checkLeftOwner(level: ServerLevel, e: ProjEntity): void {
  const pr = e.proj;
  if (pr.leftOwner || !pr.owner) {
    pr.leftOwner = true;
    return;
  }
  const owner = level.entities.get(pr.owner);
  if (!owner) {
    pr.leftOwner = true;
    return;
  }
  const p = e.physics!;
  const swept = hitbox(e).expandTowards(p.vx, p.vy, p.vz).inflate(1);
  pr.leftOwner = !swept.intersects(hitbox(owner));
}

/** First entity along the movement segment. */
function findHitEntity(level: ServerLevel, e: ProjEntity, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { e: Entity; t: number } | null {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-7) return null;
  const search = hitbox(e).expandTowards(e.physics!.vx, e.physics!.vy, e.physics!.vz).inflate(1);
  let best: { e: Entity; t: number } | null = null;
  for (const o of level.getEntities(search, (o) => canHit(level, e, o), e)) {
    const t = hitbox(o).inflate(0.3).raycast(x0, y0, z0, dx / len, dy / len, dz / len, len);
    if (t >= 0 && (!best || t < best.t)) best = { e: o, t };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------------------------

function damageTypeOf(kind: ProjectileKind, owner: Entity | null): string {
  switch (kind) {
    case 'trident': return 'trident';
    case 'small_fireball': case 'fireball': return 'fireball';
    case 'snowball': case 'egg': case 'void_pearl': case 'experience_bottle': case 'llama_spit': return owner && !owner.player ? 'mob_projectile' : 'thrown';
    case 'wind_charge': case 'gust_charge': return 'wind_charge';
    default: return 'arrow';
  }
}

function discard(level: ServerLevel, e: Entity): void {
  if (!e.removed) level.entities.remove(e);
}

/** Arrow / trident hit an entity (reference AbstractArrow.onHitEntity). */
function arrowHitEntity(level: ServerLevel, e: ProjEntity, target: Entity): void {
  const pr = e.proj, p = e.physics!;
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  let dmg = pr.kind === 'trident' ? pr.damage : Math.ceil(Math.max(0, Math.min(2147483647, speed * pr.damage)));
  if (pr.pierce > 0) {
    pr.pierced.push(target.id);
    if (pr.pierced.length > pr.pierce + 1) {
      discard(level, e);
      return;
    }
  }
  if (pr.crit && pr.kind !== 'trident') dmg = Math.min(dmg + level.random.nextInt(Math.floor(dmg / 2) + 2), 2147483647);
  const owner = ownerOf(level, pr);
  const isVoidwalker = target.type === 'voidwalker';
  const fireBefore = target.physics?.fireTicks ?? 0;
  if (p.fireTicks > 0 && !isVoidwalker) level.igniteEntity(target, 5);
  if (pr.kind === 'trident' && pr.dealtDamage) return;
  if (hurt(level, target, damageTypeOf(pr.kind, owner), dmg, owner ?? e)) {
    if (isVoidwalker) return;
    if (pr.punch > 0 && target.physics) {
      const h = Math.sqrt(p.vx * p.vx + p.vz * p.vz) || 1;
      const k = pr.punch * 0.6 * (1 - (target.living?.attrs.value('knockback_resistance') ?? 0));
      target.physics.vx += (p.vx / h) * k;
      target.physics.vy += 0.1;
      target.physics.vz += (p.vz / h) * k;
    }
    for (const fx of pr.effects) addEffect(level, target, effect(fx.id, Math.max(1, Math.floor(fx.dur / 8)), fx.amp));
    if (pr.kind === 'spectral_arrow') addEffect(level, target, effect('glowing', 200, 0));
    if (owner?.player && target.player && owner !== target) {
      const sp = level.players.find((pl) => pl.entity === owner);
      sp?.send({ type: 'sound', sound: 'entity.arrow.hit_player', x: owner.transform!.x, y: owner.transform!.y, z: owner.transform!.z, volume: 0.18, pitch: 0.45, category: 'player' });
    }
    if (owner) {
      const om = mobOf(owner);
      if (om) om.lastHurtMob = target;
      const tm = mobOf(target);
      if (tm && target.type === 'hisser' && (owner.type === 'skeleton' || owner.type === 'stray' || owner.type === 'bogged')) tm.tmp['killedBySkeleton'] = true;
    }
    const t = e.transform!;
    level.playSound(t.x, t.y, t.z, pr.kind === 'trident' ? 'item.trident.hit' : 'entity.arrow.hit', 1, 1.2 / (level.random.nextFloat() * 0.2 + 0.9));
    if (pr.kind === 'trident') {
      pr.dealtDamage = true;
      p.vx *= -0.01;
      p.vy *= -0.1;
      p.vz *= -0.01;
      return;
    }
    if (pr.pierce <= 0) discard(level, e);
  } else {
    if (target.physics) target.physics.fireTicks = fireBefore;
    // Deflect off shields and immune targets
    p.vx *= -0.1; p.vy *= -0.1; p.vz *= -0.1;
    e.transform!.yaw += 180;
    if (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz < 1e-7) {
      if (pr.pickup === 1 && pr.stack) level.spawnItem(e.transform!.x, e.transform!.y + 0.1, e.transform!.z, ItemStack.fromJSON(pr.stack));
      discard(level, e);
    }
  }
}

function arrowHitBlock(level: ServerLevel, e: ProjEntity, hit: { x: number; y: number; z: number; px: number; py: number; pz: number; state: number }): void {
  const pr = e.proj, p = e.physics!, t = e.transform!;
  pr.stuck = [hit.x, hit.y, hit.z, hit.state];
  const vx = hit.px - t.x, vy = hit.py - t.y, vz = hit.pz - t.z;
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  p.vx = vx; p.vy = vy; p.vz = vz;
  t.x = hit.px - (vx / len) * 0.05;
  t.y = hit.py - (vy / len) * 0.05;
  t.z = hit.pz - (vz / len) * 0.05;
  level.playSound(t.x, t.y, t.z, pr.kind === 'trident' ? 'item.trident.hit_ground' : 'entity.arrow.hit', 1, 1.2 / (level.random.nextFloat() * 0.2 + 0.9));
  pr.inGround = true;
  pr.shake = 7;
  pr.crit = false;
  pr.pierce = 0;
  pr.pierced = [];
  if (e.meta && e.meta['crit']) { e.meta['crit'] = false; if (e.net) e.net.metaDirty = true; }
  projectileHooks.hitBlock(level, e, hit.x, hit.y, hit.z, hit.state);
  if (e.physics!.fireTicks > 0) projectileHooks.burningHitBlock(level, e, hit.x, hit.y, hit.z, hit.state);
}

/** Non-arrow projectiles: effects on impact, then removal. */
function throwableHit(level: ServerLevel, e: ProjEntity, target: Entity | null, block: { x: number; y: number; z: number; face: number; px: number; py: number; pz: number } | null): void {
  const pr = e.proj, t = e.transform!;
  const owner = ownerOf(level, pr);
  const type = damageTypeOf(pr.kind, owner);
  const hx = block ? block.px : t.x, hy = block ? block.py : t.y, hz = block ? block.pz : t.z;
  switch (pr.kind) {
    case 'snowball':
      if (target) {
        const blaze = target.type === 'blaze';
        if (blaze) hurt(level, target, type, 3, owner ?? e);
        else pushTarget(e, target, 0.4);
      }
      level.addParticle('item_snowball', hx, hy, hz, 0, 0, 0, 8);
      break;
    case 'egg':
      if (target) pushTarget(e, target, 0.4);
      if (level.random.nextInt(8) === 0) {
        const n = level.random.nextInt(32) === 0 ? 4 : 1;
        for (let i = 0; i < n; i++) level.createEntity('chicken', hx, hy, hz, { reason: 'triggered', baby: true, variant: (pr.stack?.id === 'brown_egg' ? 'warm' : pr.stack?.id === 'blue_egg' ? 'cold' : 'temperate') });
      }
      level.addParticle('item_egg', hx, hy, hz, 0, 0, 0, 8);
      break;
    case 'void_pearl': {
      for (let i = 0; i < 32; i++) level.addParticle('portal', hx, hy + level.random.nextDouble() * 2, hz, level.random.nextGaussian(), 0, level.random.nextGaussian(), 1);
      if (target) hurt(level, target, type, 0, owner);
      if (owner?.player && owner.living && !owner.living.dead) {
        const sp = level.players.find((pl) => pl.entity === owner);
        if (sp && sp.level === level) {
          if (level.random.nextFloat() < 0.05 && level.getGameRule('doMobSpawning') !== false) level.createEntity('voidmite', owner.transform!.x, owner.transform!.y, owner.transform!.z, { reason: 'triggered' });
          const ty = block ? hy : t.y;
          sp.teleport(hx, ty, hz);
          owner.physics!.fallDistance = 0;
          hurt(level, owner, 'ender_pearl', 5);
          level.playSound(hx, ty, hz, 'entity.player.teleport', 1, 1);
        }
      }
      break;
    }
    case 'experience_bottle': {
      level.levelEvent(2002, Math.floor(hx), Math.floor(hy), Math.floor(hz), 0x385dc6);
      level.spawnExperience(hx, hy, hz, 3 + level.random.nextInt(5) + level.random.nextInt(5));
      break;
    }
    case 'small_fireball':
      if (target) {
        if (!target.physics?.fireImmune) {
          const before = target.physics?.fireTicks ?? 0;
          level.igniteEntity(target, 5);
          if (!hurt(level, target, type, 5, owner ?? e) && target.physics) target.physics.fireTicks = before;
        }
      } else if (block && (owner?.player || level.getGameRule('mobGriefing') !== false)) {
        const fx = block.x + DX[block.face]!, fy = block.y + DY[block.face]!, fz = block.z + DZ[block.face]!;
        if (stateFlags[level.getBlockState(fx, fy, fz)]! & F.AIR) level.setBlock(fx, fy, fz, getBlock('fire').defaultState, 3);
      }
      break;
    case 'fireball':
      if (target) hurt(level, target, type, 6, owner ?? e);
      explode(level, e, hx, hy, hz, pr.power, level.getGameRule('mobGriefing') !== false, 'mob');
      break;
    case 'wind_charge': case 'gust_charge': {
      if (target) {
        hurt(level, target, type, 1, owner ?? e);
      }
      const radius = pr.kind === 'wind_charge' ? 1.2 : 3;
      explode(level, e, hx, hy, hz, radius, false, 'trigger', { damage: false, knockback: pr.kind === 'wind_charge' ? 1.22 : 1.1, particle: 'gust', sound: 'entity.wind_charge.wind_burst' });
      break;
    }
    case 'llama_spit':
      if (target) hurt(level, target, 'mob_projectile', 1, owner ?? e);
      break;
    default:
      break;
  }
  discard(level, e);
}

/** Zero-damage projectiles still push their target (snowballs, eggs). */
function pushTarget(e: Entity, target: Entity, strength: number): void {
  if (!target.physics) return;
  const p = e.physics!;
  knockback(target, strength, -p.vx, -p.vz);
  if (target.living) {
    target.living.hurtTime = 10;
  }
}

/** Hooks for block reactions (target blocks, bells, lightning rods, TNT, chorus flowers). */
export const projectileHooks = {
  hitBlock: (_level: ServerLevel, _e: Entity, _x: number, _y: number, _z: number, _state: number): void => {},
  /** Burning arrows ignite TNT and campfires. */
  burningHitBlock: (_level: ServerLevel, _e: Entity, _x: number, _y: number, _z: number, _state: number): void => {},
};

// ---------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------

function updateRotation(e: Entity): void {
  const p = e.physics!, t = e.transform!;
  const h = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  const yaw = (Math.atan2(p.vx, p.vz) * 180) / Math.PI;
  const pitch = (Math.atan2(p.vy, h) * 180) / Math.PI;
  const lerp = (a: number, b: number) => {
    while (b - a < -180) a -= 360;
    while (b - a >= 180) a += 360;
    return a + (b - a) * 0.2;
  };
  t.pitch = lerp(t.pitch, pitch);
  t.yaw = lerp(t.yaw, yaw);
}

function inWater(level: ServerLevel, e: Entity): boolean {
  const t = e.transform!;
  return (stateFlags[level.getBlockState(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))]! & F.WATER) !== 0;
}

/** Stuck block no longer holds the arrow (broken / changed): drop out. */
function stuckStillValid(level: ServerLevel, pr: ProjectileState): boolean {
  if (!pr.stuck) return false;
  const [x, y, z, s] = pr.stuck;
  const cur = level.getBlockState(x, y, z);
  return cur === s && getCollisionShape(cur).length > 0;
}

function tickArrow(level: ServerLevel, e: ProjEntity): void {
  const pr = e.proj, p = e.physics!, t = e.transform!;
  if (pr.shake > 0) pr.shake--;
  if (inWater(level, e) || level.isRainingAt(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))) p.fireTicks = 0;
  else if (p.fireTicks > 0) p.fireTicks--;
  // Loyal tridents fly back to their owner
  if (pr.kind === 'trident' && pr.loyalty > 0 && (pr.dealtDamage || pr.inGround || pr.returning)) {
    const owner = ownerOf(level, pr);
    if (!owner || owner.living?.dead) {
      if (pr.pickup === 1 && pr.stack && !pr.returning) level.spawnItem(t.x, t.y + 0.1, t.z, ItemStack.fromJSON(pr.stack));
      if (!owner) { discard(level, e); return; }
    } else {
      if (!pr.returning) level.playSound(t.x, t.y, t.z, 'item.trident.return', 10, 1);
      pr.returning = true;
      pr.inGround = false;
      const ot = owner.transform!;
      const dx = ot.x - t.x, dy = ot.y + (owner.physics?.eyeHeight ?? 1.5) - t.y, dz = ot.z - t.z;
      const k = 0.05 * pr.loyalty;
      p.vy *= 0.95;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      p.vx = p.vx * 0.95 + (dx / len) * k;
      p.vy += (dy / len) * k;
      p.vz = p.vz * 0.95 + (dz / len) * k;
      t.px = t.x; t.py = t.y; t.pz = t.z;
      t.x += p.vx; t.y += p.vy; t.z += p.vz;
      updateRotation(e);
      tryPickup(level, e, true);
      return;
    }
  }
  if (pr.inGround) {
    if (!stuckStillValid(level, pr)) {
      pr.inGround = false;
      pr.stuck = null;
      p.vx *= level.random.nextFloat() * 0.2;
      p.vy *= level.random.nextFloat() * 0.2;
      p.vz *= level.random.nextFloat() * 0.2;
    } else {
      if (++pr.life >= 1200) discard(level, e);
      tryPickup(level, e, false);
      return;
    }
  }
  checkLeftOwner(level, e);
  const x0 = t.x, y0 = t.y, z0 = t.z;
  let x1 = x0 + p.vx, y1 = y0 + p.vy, z1 = z0 + p.vz;
  const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  const blockHit = len > 1e-7 ? raycastBlocks(level, x0, y0, z0, p.vx / len, p.vy / len, p.vz / len, len, 'collision') : null;
  if (blockHit) { x1 = blockHit.px; y1 = blockHit.py; z1 = blockHit.pz; }
  for (let guard = 0; guard < 8 && !e.removed; guard++) {
    const eh = findHitEntity(level, e, x0, y0, z0, x1, y1, z1);
    if (eh) {
      arrowHitEntity(level, e, eh.e);
      if (e.removed || pr.pierce <= 0 || (pr.kind === 'trident' && pr.dealtDamage)) break;
      continue;
    }
    if (blockHit && !e.removed) arrowHitBlock(level, e, blockHit);
    break;
  }
  if (e.removed) return;
  if (pr.crit) level.addParticle('crit', t.x, t.y, t.z, -p.vx, -p.vy + 0.2, -p.vz, 1);
  t.px = t.x; t.py = t.y; t.pz = t.z;
  if (!pr.inGround) {
    t.x += p.vx; t.y += p.vy; t.z += p.vz;
    updateRotation(e);
    const f = inWater(level, e) ? pr.waterInertia : pr.inertia;
    if (f !== pr.inertia) level.addParticle('bubble', t.x, t.y, t.z, 0, 0, 0, 2);
    p.vx *= f; p.vy *= f; p.vz *= f;
    if (!p.noGravity) p.vy -= pr.gravity;
  }
}

function tickThrowable(level: ServerLevel, e: ProjEntity): void {
  const pr = e.proj, p = e.physics!, t = e.transform!;
  checkLeftOwner(level, e);
  if (++pr.life > 1200 && (pr.accel > 0 || pr.kind === 'wind_charge' || pr.kind === 'gust_charge')) { discard(level, e); return; }
  // Accelerating projectiles gain speed along their heading
  const x0 = t.x, y0 = t.y, z0 = t.z;
  const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  const bh = len > 1e-7 ? raycastBlocks(level, x0, y0, z0, p.vx / len, p.vy / len, p.vz / len, len, 'collision') : null;
  const x1 = bh ? bh.px : x0 + p.vx, y1 = bh ? bh.py : y0 + p.vy, z1 = bh ? bh.pz : z0 + p.vz;
  const eh = findHitEntity(level, e, x0, y0, z0, x1, y1, z1);
  if (eh) {
    throwableHit(level, e, eh.e, null);
    return;
  }
  if (bh) {
    throwableHit(level, e, null, bh);
    return;
  }
  t.px = t.x; t.py = t.y; t.pz = t.z;
  t.x += p.vx; t.y += p.vy; t.z += p.vz;
  updateRotation(e);
  const water = inWater(level, e);
  if (pr.accel > 0) {
    const l = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 1;
    const inertia = water ? 0.8 : pr.inertia;
    p.vx = (p.vx + (p.vx / l) * pr.accel) * inertia;
    p.vy = (p.vy + (p.vy / l) * pr.accel) * inertia;
    p.vz = (p.vz + (p.vz / l) * pr.accel) * inertia;
    level.addParticle(pr.kind === 'fireball' || pr.kind === 'small_fireball' ? 'smoke' : 'gust', t.x, t.y + 0.5, t.z, 0, 0, 0, 1);
  } else {
    const f = water ? pr.waterInertia : pr.inertia;
    p.vx *= f; p.vy *= f; p.vz *= f;
    p.vy -= pr.gravity;
  }
  if (t.y < level.minY - 64) discard(level, e);
}

/** Players pick up stuck arrows and returning tridents (reference playerTouch). */
function tryPickup(level: ServerLevel, e: ProjEntity, returning: boolean): void {
  const pr = e.proj;
  if (!returning && pr.shake > 0) return;
  const box = hitbox(e).inflate(1, 0.5, 1);
  for (const pl of level.players) {
    const pe = pl.entity;
    if (pe.living?.dead || pl.data.gameMode === 'spectator') continue;
    if (!box.intersects(hitbox(pe))) continue;
    if (returning && pe.id !== pr.owner) continue;
    let ok = false;
    if (pr.pickup === 1 && pr.stack) {
      const s = ItemStack.fromJSON(pr.stack);
      ok = pl.inventory.add(s, getItem(s.id)?.maxStack ?? 64);
      if (ok) pl.inventory.revision++;
    } else if (pr.pickup === 2 || returning) ok = pl.data.gameMode === 'creative' || returning;
    if (!ok && !returning) continue;
    level.tracker.broadcast(e, { type: 'takeItem', item: e.id, collector: pe.id, count: 1 });
    level.playSound(e.transform!.x, e.transform!.y, e.transform!.z, 'entity.item.pickup', 0.2, ((level.random.nextFloat() - level.random.nextFloat()) * 0.7 + 1) * 2);
    discard(level, e);
    return;
  }
}

export function tickProjectile(level: ServerLevel, e: ProjEntity): void {
  const k = e.proj.kind;
  if (k === 'arrow' || k === 'spectral_arrow' || k === 'trident') tickArrow(level, e);
  else tickThrowable(level, e);
}

export function tickProjectiles(level: ServerLevel): void {
  for (const e of [...level.entities.all()]) {
    if (!e.removed && e['proj']) tickProjectile(level, e as ProjEntity);
  }
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

for (const kind of Object.keys(SIZES) as ProjectileKind[]) {
  ENTITY_CODECS.set(kind, {
    save: (e) => {
      const pr = { ...projOf(e)! };
      // Entity ids do not survive reloads; players are found again by name
      if (!pr.ownerName) pr.owner = 0;
      return { proj: JSON.parse(JSON.stringify(pr)) as ProjectileState, fire: e.physics?.fireTicks ?? 0 };
    },
    load: (level, s) => {
      const pr = s.data['proj'] as ProjectileState;
      const e = createProjectile(level, kind, s.pos[0], s.pos[1], s.pos[2]);
      e.proj = { ...e.proj, ...pr, owner: 0 };
      return e;
    },
  });
}
