/**
 * Explosions (reference ServerExplosion): 16³ surface rays eat through blocks by blast
 * resistance, entities take exposure-scaled damage and knockback, blocks drop loot (with decay
 * per game rules), fire is scattered, TNT chains, and the client receives particles, sound and
 * the player's knockback.
 */
import type { Entity } from '../../common/entity/ecs';
import { blockOf, stateFlags, F, getBlock } from '../../common/block/registry';
import { move } from '../../common/entity/physics';
import { rollLoot } from '../../common/loot/loot';
import { raycastBlocks } from '../../common/world/raycast';
import { AABB } from '../../common/math/geom';
import type { ServerLevel } from '../level';
import { makePhysics, makeTransform } from '../../common/entity/components';
import { hurt } from '../survival/living';
import { popResource } from '../survival/interaction';
import { ENTITY_CODECS } from '../entity/persistence';

export type ExplosionMode = 'none' | 'block' | 'mob' | 'tnt' | 'trigger';

export interface ExplosionOptions {
  /** Entities take damage (wind charges only push). */
  damage?: boolean;
  /** Knockback multiplier (wind bursts use larger values). */
  knockback?: number;
  /** Entity that is not affected (wind charge shooter handled separately). */
  ignore?: Entity | null;
  /** Particle and sound override. */
  particle?: string;
  sound?: string;
}

/** Blast resistance of a state (fluids resist like their block, air 0). */
function resistance(state: number): number {
  const f = stateFlags[state]!;
  if (f & F.AIR) return 0;
  let r = blockOf(state).resistance;
  if (f & (F.WATER | F.LAVA)) r = Math.max(r, 100);
  return r;
}

/** Fraction of an entity's box visible from the explosion centre (reference getSeenPercent). */
export function seenPercent(level: ServerLevel, cx: number, cy: number, cz: number, e: Entity): number {
  const t = e.transform!, p = e.physics;
  const w = p?.width ?? 0.5, h = p?.height ?? 0.5;
  const minX = t.x - w / 2, maxX = t.x + w / 2, minY = t.y, maxY = t.y + h, minZ = t.z - w / 2, maxZ = t.z + w / 2;
  const d0 = 1 / ((maxX - minX) * 2 + 1), d1 = 1 / ((maxY - minY) * 2 + 1), d2 = 1 / ((maxZ - minZ) * 2 + 1);
  const d3 = (1 - Math.floor(1 / d0) * d0) / 2, d4 = (1 - Math.floor(1 / d2) * d2) / 2;
  let seen = 0, total = 0;
  for (let a = 0; a <= 1; a += d0) {
    for (let b = 0; b <= 1; b += d1) {
      for (let c = 0; c <= 1; c += d2) {
        const x = minX + (maxX - minX) * a + d3, y = minY + (maxY - minY) * b, z = minZ + (maxZ - minZ) * c + d4;
        const dx = cx - x, dy = cy - y, dz = cz - z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-6 || !raycastBlocks(level, x, y, z, dx / len, dy / len, dz / len, len, 'collision')) seen++;
        total++;
      }
    }
  }
  return total ? seen / total : 0;
}

/** Hooks for other systems (TNT minecarts, beds, anchors, block reactions such as bells). */
export const explosionHooks = {
  /** A block was destroyed by an explosion (TNT primes, others react). */
  blockExploded: (_level: ServerLevel, _x: number, _y: number, _z: number, _state: number, _source: Entity | null): void => {},
  /** Wind charges trigger interactive blocks (doors, buttons, levers, bells). */
  triggerBlock: (_level: ServerLevel, _x: number, _y: number, _z: number, _state: number): void => {},
};

export function explode(level: ServerLevel, source: Entity | null, x: number, y: number, z: number, radius: number, fire: boolean, mode: ExplosionMode, o: ExplosionOptions = {}): void {
  const r = level.random;
  const griefing = level.getGameRule('mobGriefing') !== false;
  let interaction: 'keep' | 'destroy' | 'decay' | 'trigger' = 'keep';
  if (mode === 'block') interaction = level.getGameRule('blockExplosionDropDecay') === false ? 'destroy' : 'decay';
  else if (mode === 'mob') interaction = griefing ? (level.getGameRule('mobExplosionDropDecay') === false ? 'destroy' : 'decay') : 'keep';
  else if (mode === 'tnt') interaction = level.getGameRule('tntExplosionDropDecay') === true ? 'decay' : 'destroy';
  else if (mode === 'trigger') interaction = 'trigger';
  level.gameEvent('explode', x, y, z, source ?? undefined);

  // ---- Blocks hit by rays
  const blocks = new Map<string, [number, number, number]>();
  for (let j = 0; j < 16; j++) {
    for (let k = 0; k < 16; k++) {
      for (let l = 0; l < 16; l++) {
        if (!(j === 0 || j === 15 || k === 0 || k === 15 || l === 0 || l === 15)) continue;
        let dx = (j / 15) * 2 - 1, dy = (k / 15) * 2 - 1, dz = (l / 15) * 2 - 1;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= len; dy /= len; dz /= len;
        let f = radius * (0.7 + r.nextFloat() * 0.6);
        let px = x, py = y, pz = z;
        for (; f > 0; f -= 0.22500001) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          if (by < level.minY || by >= level.maxY) break;
          const s = level.getBlockState(bx, by, bz);
          if (!(stateFlags[s]! & F.AIR) || stateFlags[s]! & (F.WATER | F.LAVA)) f -= (resistance(s) + 0.3) * 0.3;
          if (f > 0 && !(stateFlags[s]! & F.AIR)) blocks.set(`${bx},${by},${bz}`, [bx, by, bz]);
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
        }
      }
    }
  }

  // ---- Entities
  const f2 = radius * 2;
  const box = new AABB(Math.floor(x - f2 - 1), Math.floor(y - f2 - 1), Math.floor(z - f2 - 1), Math.floor(x + f2 + 1), Math.floor(y + f2 + 1), Math.floor(z + f2 + 1));
  const attacker = source ? ((source['owner'] as Entity | undefined) ?? (source['igniter'] as Entity | undefined) ?? source) : null;
  const damageType = attacker?.player ? 'player_explosion' : 'explosion';
  const doDamage = o.damage ?? true;
  const kbMul = o.knockback ?? 1;
  for (const e of level.getEntities(box, undefined, source ?? undefined)) {
    if (e === o.ignore || !e.transform) continue;
    if (e.player?.gameMode === 'spectator') continue;
    const t = e.transform, p = e.physics;
    const dist = Math.sqrt((t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2) / f2;
    if (dist > 1) continue;
    let dx = t.x - x, dy = (e.type === 'tnt' ? t.y : t.y + (p?.eyeHeight ?? 0)) - y, dz = t.z - z;
    const d4 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d4 === 0) continue;
    dx /= d4; dy /= d4; dz /= d4;
    const seen = seenPercent(level, x, y, z, e);
    if (doDamage && e.living) {
      const d1 = (1 - dist) * seen;
      const dmg = Math.floor(((d1 * d1 + d1) / 2) * 7 * f2 + 1);
      hurt(level, e, damageType, dmg, attacker);
    } else if (doDamage && e.item) {
      // Items and orbs are destroyed by blasts
      if (!e.removed && e.item.stack.id !== 'nether_star') level.entities.remove(e);
      continue;
    }
    let kb = (1 - dist) * seen * kbMul;
    if (e.living) kb *= 1 - e.living.attrs.value('explosion_knockback_resistance');
    if (e.player && e.player.abilities.flying && e.player.gameMode === 'creative') continue;
    if (p) {
      p.vx += dx * kb;
      p.vy += dy * kb;
      p.vz += dz * kb;
      if (e.player) {
        const sp = level.players.find((pl) => pl.entity === e);
        sp?.send({ type: 'explosion', x, y, z, power: radius, blocks: new Int32Array(0), kx: dx * kb, ky: dy * kb, kz: dz * kb });
      } else if (e.net) e.net.forceSync = true;
      if (!e.player && p.vy > 0) p.onGround = false;
    }
  }

  // ---- Blocks
  const list = [...blocks.values()];
  r.shuffle(list);
  if (interaction === 'trigger') {
    for (const [bx, by, bz] of list) explosionHooks.triggerBlock(level, bx, by, bz, level.getBlockState(bx, by, bz));
  } else if (interaction !== 'keep') {
    const drops = level.getGameRule('doTileDrops') !== false;
    for (const [bx, by, bz] of list) {
      const s = level.getBlockState(bx, by, bz);
      if (stateFlags[s]! & F.AIR) continue;
      const b = blockOf(s);
      if (b.name === 'tnt') {
        level.setBlock(bx, by, bz, 0, 3);
        primeTnt(level, bx + 0.5, by, bz + 0.5, attacker, r.nextInt(20) + 10);
        continue;
      }
      if (stateFlags[s]! & (F.WATER | F.LAVA) && !(stateFlags[s]! & F.WATERLOGGED)) continue;
      if (drops && !b.settings.noDrops && !b.name.endsWith('shell_box')) {
        for (const st of rollLoot(`blocks/${b.name}`, { rng: r, tool: null, state: s, explosion: interaction === 'decay' ? radius : undefined })) popResource(level, bx, by, bz, st);
      }
      level.setBlock(bx, by, bz, 0, 3);
      explosionHooks.blockExploded(level, bx, by, bz, s, source);
    }
  }
  if (fire) {
    const fireState = getBlock('fire').defaultState;
    for (const [bx, by, bz] of list) {
      if (r.nextInt(3) !== 0) continue;
      if (!(stateFlags[level.getBlockState(bx, by, bz)]! & F.AIR)) continue;
      const below = level.getBlockState(bx, by - 1, bz);
      if (stateFlags[below]! & F.OPAQUE_CUBE) level.setBlock(bx, by, bz, fireState, 3);
    }
  }

  // ---- Effects
  const big = radius >= 2 && interaction !== 'keep' && interaction !== 'trigger';
  level.addParticle(o.particle ?? (big ? 'explosion_emitter' : 'explosion'), x, y, z, 0, 0, 0, 1);
  level.playSound(x, y, z, o.sound ?? 'entity.generic.explode', 4, (1 + (r.nextFloat() - r.nextFloat()) * 0.2) * 0.7);
}

// ---------------------------------------------------------------------------------------------
// Primed TNT
// ---------------------------------------------------------------------------------------------

/** Build a primed TNT entity (not yet added). */
function makeTnt(level: ServerLevel, x: number, y: number, z: number, igniter: Entity | null, fuse: number): Entity {
  const physics = makePhysics(0.98, 0.98, 0.15);
  physics.gravity = 0.04;
  physics.stepHeight = 0;
  const a = level.random.nextDouble() * Math.PI * 2;
  physics.vx = -Math.sin(a) * 0.02;
  physics.vy = 0.2;
  physics.vz = -Math.cos(a) * 0.02;
  const e: Entity = {
    id: 0, type: 'tnt', removed: false, transform: makeTransform(x, y, z), physics,
    meta: { fuse }, fuse, igniter: igniter ?? undefined,
  };
  return e;
}

export function primeTnt(level: ServerLevel, x: number, y: number, z: number, igniter: Entity | null, fuse = 80): Entity {
  const e = makeTnt(level, x, y, z, igniter, fuse);
  level.addFreshEntity(e);
  level.playSound(x, y, z, 'entity.tnt.primed', 1, 1);
  level.gameEvent('prime_fuse', x, y, z, igniter ?? undefined);
  return e;
}


/** Reference PrimedTnt.tick. */
export function tickTnt(level: ServerLevel, e: Entity): void {
  const p = e.physics!, t = e.transform!;
  t.px = t.x; t.py = t.y; t.pz = t.z;
  if (!p.noGravity) p.vy -= 0.04;
  move(level, e as Parameters<typeof move>[1], p.vx, p.vy, p.vz);
  p.vx *= 0.98;
  p.vy *= 0.98;
  p.vz *= 0.98;
  if (p.onGround) {
    p.vx *= 0.7;
    p.vz *= 0.7;
    p.vy *= -0.5;
  }
  const fuse = (e['fuse'] as number) - 1;
  e['fuse'] = fuse;
  if (fuse <= 0) {
    level.entities.remove(e);
    explode(level, e, t.x, t.y + 0.0625, t.z, (e['power'] as number | undefined) ?? 4, false, 'tnt');
    return;
  }
  if (p.inWater) p.fireTicks = 0;
  if (fuse % 5 === 0) level.addParticle('smoke', t.x, t.y + 0.5, t.z, 0, 0, 0, 1);
}

ENTITY_CODECS.set('tnt', {
  save: (e) => ({ fuse: e['fuse'] }),
  load: (level, s) => makeTnt(level, s.pos[0], s.pos[1], s.pos[2], null, (s.data['fuse'] as number) ?? 80),
});
