/**
 * Combat gameplay module: explosions, primed TNT, lightning, projectile entities, ranged weapons,
 * shields and riptide attacks.
 */
import { registerGameplayModule } from '../gameplay';
import type { StrataServer } from '../server';
import type { Entity } from '../../common/entity/ecs';
import { livingHooks } from '../survival/living';
import { usingState } from '../survival/player';
import { metaProviders } from '../entity/tracker';
import { explode, primeTnt, tickTnt, ExplosionMode } from './explosion';
import { createProjectile, tickProjectiles, projOf, ProjectileKind, shoot } from './projectiles';
import { spawnLightning, tickLightning, tickChunkLightning } from './lightning';
import { installRanged, shieldBlock, tickSpinAttack } from './ranged';

const PROJECTILES = new Set<ProjectileKind>(['arrow', 'spectral_arrow', 'trident', 'snowball', 'egg', 'void_pearl', 'experience_bottle', 'small_fireball', 'fireball', 'wind_charge', 'gust_charge', 'llama_spit']);

function install(server: StrataServer): void {
  const h = server.hooks;
  h.explode = (level, source, x, y, z, power, fire, mode) => explode(level, source, x, y, z, power, fire, mode as ExplosionMode);

  const prevCreate = h.createEntity;
  h.createEntity = (level, type, x, y, z, opts) => {
    if (type === 'tnt') {
      const igniter = typeof opts['igniter'] === 'number' ? level.entities.get(opts['igniter']) ?? null : null;
      return primeTnt(level, x, y, z, igniter, typeof opts['fuse'] === 'number' ? opts['fuse'] : 80);
    }
    if (type === 'lightning_bolt') return spawnLightning(level, x, y, z, opts['visualOnly'] === true);
    if (PROJECTILES.has(type as ProjectileKind)) {
      const owner = typeof opts['owner'] === 'number' ? level.entities.get(opts['owner']) ?? null : null;
      const e = createProjectile(level, type as ProjectileKind, x, y, z, { owner, power: typeof opts['power'] === 'number' ? opts['power'] : undefined });
      const v = opts['motion'] as [number, number, number] | undefined;
      if (v) shoot(level, e, v[0], v[1], v[2], Math.hypot(v[0], v[1], v[2]), 0);
      level.addFreshEntity(e);
      return e;
    }
    return prevCreate(level, type, x, y, z, opts);
  };

  const prevTick = h.tickEntities;
  h.tickEntities = (level) => {
    prevTick(level);
    tickProjectiles(level);
    for (const e of [...level.entities.all()]) {
      if (e.removed) continue;
      if (e.type === 'tnt') tickTnt(level, e);
      else if (e.type === 'lightning_bolt') tickLightning(level, e);
    }
  };

  const prevChunk = h.tickChunk;
  h.tickChunk = (level, c) => {
    prevChunk(level, c);
    tickChunkLightning(level, c);
  };

  // Item stacks carried by projectiles (tridents, thrown items) for rendering
  metaProviders.push((e: Entity, m) => {
    const pr = projOf(e);
    if (pr?.stack && e.type !== 'arrow' && e.type !== 'spectral_arrow') m['item'] = pr.stack;
  });

  installRanged();

  const prevAdjust = livingHooks.adjustDamage;
  livingHooks.adjustDamage = (level, e, type, amount, attacker) => {
    const a = prevAdjust(level, e, type, amount, attacker);
    if (!e.player || a <= 0) return a;
    const p = server.players.find((pl) => pl.entity === e);
    return p ? shieldBlock(level, p, type, a, attacker) : a;
  };

  const prevPlayerTick = h.playerTick;
  h.playerTick = (p) => {
    prevPlayerTick(p);
    tickSpinAttack(p.level, p);
    // Visible use state for other players' poses (bow drawing, shield raised)
    const u = usingState(p);
    const e = p.entity;
    const m = (e.meta ??= {});
    const item = u ? u.item : '';
    if (m['useItem'] !== item) {
      m['useItem'] = item;
      m['useHand'] = u?.hand ?? 'main';
      if (e.net) e.net.metaDirty = true;
    }
    if (p.ext['spinAttack'] !== undefined !== (m['spinning'] === true)) {
      m['spinning'] = p.ext['spinAttack'] !== undefined;
      if (e.net) e.net.metaDirty = true;
    }
  };
}

registerGameplayModule(install);
