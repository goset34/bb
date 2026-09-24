/**
 * Mobs gameplay module: entity creation hook, per-tick AI, damage reactions, death loot and
 * experience, player interactions, spawn eggs, the /summon command and persistence codecs.
 */
import { registerGameplayModule } from '../gameplay';
import type { StrataServer } from '../server';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { Entity } from '../../common/entity/ecs';
import { ItemStack, SerializedStack } from '../../common/item/stack';
import { getItem } from '../../common/item/items';
import { rollLoot } from '../../common/loot/loot';
import { getCollisionShape, stateFlags, F } from '../../common/block/registry';
import { DX, DY, DZ, Direction } from '../../common/world/direction';
import { raycastBlocks } from '../../common/world/raycast';
import { livingHooks } from '../survival/living';
import { combatHooks } from '../survival/combat';
import { ENTITY_CODECS, SavedEntity } from '../entity/persistence';
import type { EffectInstance } from '../../common/entity/living';
import { Mob, MOB_DEFS, mobOf, SpawnReason } from './mob';
import { createMob, spawnMob, updateSize } from './factory';
import { tickMob } from './tick';
import { genericInteract, feedAnimal, useItem, handStack, setAge } from './actions';
import { COMMAND_REGISTRARS, feedback } from '../commands/index';
import { literal, argument, fail } from '../commands/dispatcher';
import { vec3, greedy, registryId, CommandSource } from '../commands/args';
import './defs/index';

// ---------------------------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------------------------

function killerWeapon(killer: Entity | null): ItemStack | null {
  if (!killer) return null;
  if (killer.player) return killer.player.inventory.mainHand;
  return (killer['equipment'] as ItemStack[] | undefined)?.[0] ?? null;
}

function dropLoot(m: Mob, killer: Entity | null): void {
  const level = m.level;
  const recentlyHit = m.tickCount - m.lastHurtByPlayerTime <= 100 || !!killer?.player;
  const playerKiller = killer?.player ? killer : recentlyHit ? m.lastHurtByPlayer : null;
  const weapon = killerWeapon(playerKiller ?? killer);
  const doLoot = level.getGameRule('doMobLoot') !== false;
  if (doLoot && !m.isBaby) {
    const id = m.def.loot === undefined ? `entities/${m.def.id}` : m.def.loot;
    if (id) {
      const stacks = rollLoot(id, {
        rng: m.random, tool: weapon, killedByPlayer: recentlyHit,
        flags: { onFire: m.e.physics.fireTicks > 0, ...(m.def.lootFlags?.(m) ?? {}) },
      });
      for (const s of stacks) level.spawnItem(m.x, m.y + m.height / 2, m.z, s);
    }
    // Equipment
    const looting = weapon?.getEnchant('looting') ?? 0;
    for (let i = 0; i < 6; i++) {
      const s = m.equipment[i]!;
      if (s.isEmpty()) continue;
      const chance = m.guaranteedDrops[i] ? 2 : m.dropChances[i]!;
      if (!((recentlyHit || chance > 1) && m.random.nextFloat() - looting * 0.01 < chance)) continue;
      const drop = s.copy();
      const max = getItem(drop.id)?.maxDamage ?? 0;
      if (chance <= 1 && max > 0) drop.damage = max - m.random.nextInt(1 + m.random.nextInt(Math.max(max - 3, 1)));
      level.spawnItem(m.x, m.y + m.height / 2, m.z, drop);
      m.equipment[i] = ItemStack.empty();
    }
  }
  if (doLoot && recentlyHit && !m.isBaby) {
    let xp = typeof m.def.xp === 'function' ? m.def.xp(m) : m.def.xp ?? 0;
    if (xp > 0) for (const s of m.equipment) if (!s.isEmpty()) xp += 1 + m.random.nextInt(3);
    if (xp > 0) level.spawnExperience(m.x, m.y, m.z, xp);
  }
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

interface SavedMob {
  data: Record<string, unknown>;
  health: number;
  absorption: number;
  attrs: ReturnType<Mob['e']['living']['attrs']['toJSON']>;
  effects: EffectInstance[];
  equipment: Array<SerializedStack | null>;
  drops: number[];
  guaranteed: boolean[];
  restrict?: [number, number, number, number];
  pickup?: boolean;
}

function saveMob(e: Entity): Record<string, unknown> {
  const m = mobOf(e)!;
  const s: SavedMob = {
    data: m.data,
    health: e.living!.health,
    absorption: e.living!.absorption,
    attrs: e.living!.attrs.toJSON(),
    effects: [...e.living!.effects.values()],
    equipment: m.equipment.map((x) => (x.isEmpty() ? null : x.toJSON())),
    drops: m.dropChances,
    guaranteed: m.guaranteedDrops,
    restrict: m.restrictCenter && m.restrictRadius >= 0 ? [...m.restrictCenter, m.restrictRadius] : undefined,
    pickup: m.canPickUpLoot || undefined,
  };
  return JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
}

function loadMob(level: ServerLevel, saved: SavedEntity): Entity | null {
  const e = createMob(level, saved.type, saved.pos[0], saved.pos[1], saved.pos[2], { reason: 'chunk_generation', fromSave: true, yaw: saved.rot[0] });
  if (!e) return null;
  const m = mobOf(e)!;
  const d = saved.data as unknown as SavedMob;
  m.data = d.data ?? {};
  if (d.attrs) {
    // Replace base values and modifiers from disk
    for (const a of e.living.attrs.map.values()) for (const mod of [...a.modifiers()]) a.remove(mod.id);
    e.living.attrs.load(d.attrs);
  }
  e.living.health = d.health ?? e.living.health;
  e.living.absorption = d.absorption ?? 0;
  for (const fx of d.effects ?? []) e.living.effects.set(fx.id, fx);
  (d.equipment ?? []).forEach((s, i) => { if (s && i < 6) m.equipment[i] = ItemStack.fromJSON(s); });
  if (d.drops) m.dropChances = d.drops;
  if (d.guaranteed) m.guaranteedDrops = d.guaranteed;
  if (d.restrict) m.restrictTo(d.restrict[0], d.restrict[1], d.restrict[2], d.restrict[3]);
  m.canPickUpLoot = !!d.pickup;
  m.def.loaded?.(m);
  updateSize(m);
  m.def.syncMeta?.(m);
  return e;
}

// ---------------------------------------------------------------------------------------------
// Spawn eggs
// ---------------------------------------------------------------------------------------------

function eggMob(stack: ItemStack): string | null {
  if (!stack.id.endsWith('_spawn_egg')) return null;
  const type = stack.id.slice(0, -'_spawn_egg'.length);
  return MOB_DEFS.has(type) ? type : null;
}

function eggOptions(stack: ItemStack): Record<string, unknown> {
  const o: Record<string, unknown> = { ...(stack.data.entity ?? {}) };
  if (stack.data.name) o['name'] = stack.data.name;
  return o;
}

function useEggOnBlock(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, x: number, y: number, z: number, face: Direction): boolean {
  const type = eggMob(stack);
  if (!type) return false;
  const level = p.level;
  const state = level.getBlockState(x, y, z);
  const open = getCollisionShape(state).length === 0;
  const px = open ? x : x + DX[face]!, py = open ? y : y + DY[face]!, pz = open ? z : z + DZ[face]!;
  // Stand on top of partial blocks at the spawn position, or on the floor below
  let fy = py;
  const shape = getCollisionShape(level.getBlockState(px, py, pz));
  let top = 0;
  for (let i = 0; i < shape.length; i += 6) top = Math.max(top, shape[i + 4]!);
  if (top > 0) fy = py + top;
  const m = spawnMob(level, type, px + 0.5, fy, pz + 0.5, 'spawn_egg', eggOptions(stack));
  if (!m) return false;
  m.e.transform.yaw = m.e.transform.bodyYaw = m.e.transform.headYaw = (p.entity.transform.yaw + 180) % 360;
  useItem(p, hand, stack);
  level.gameEvent('entity_place', px, py, pz, p.entity);
  return true;
}

/** Spawn egg used in the air while looking at water (fish, squid). */
function useEggInAir(p: ServerPlayer, hand: 'main' | 'off'): boolean {
  const stack = handStack(p, hand);
  const type = eggMob(stack);
  if (!type) return false;
  const t = p.entity.transform;
  const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
  const dx = -Math.sin(yaw) * Math.cos(pitch), dy = -Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
  const hit = raycastBlocks(p.level, t.x, t.y + p.entity.physics.eyeHeight, t.z, dx, dy, dz, 5, 'outline', 'source');
  if (!hit || !(stateFlags[hit.state]! & F.WATER)) return false;
  const m = spawnMob(p.level, type, hit.x + 0.5, hit.y, hit.z + 0.5, 'spawn_egg', eggOptions(stack));
  if (!m) return false;
  useItem(p, hand, stack);
  return true;
}

// ---------------------------------------------------------------------------------------------
// /summon
// ---------------------------------------------------------------------------------------------

type S = CommandSource;

function summon(c: { source: S; get<T>(n: string): T }, withPos: boolean, withData: boolean): number {
  const type = c.get<string>('entity');
  const pos = withPos ? c.get<[number, number, number]>('pos') : [c.source.x, c.source.y, c.source.z];
  let data: Record<string, unknown> = {};
  if (withData) {
    try {
      data = JSON.parse(c.get<string>('data')) as Record<string, unknown>;
    } catch {
      fail('argument.nbt.invalid', c.get<string>('data'));
    }
  }
  const level = c.source.level;
  if (!level.isLoaded(pos[0], pos[2])) fail('commands.summon.invalidPosition');
  const e = level.createEntity(type, pos[0], pos[1], pos[2], { ...data, reason: 'command' });
  if (!e) fail('commands.summon.failed');
  feedback(c.source, { key: 'commands.summon.success', args: [{ key: `entity.${type}` }] });
  return 1;
}

function registerSummon(d: import('../commands/dispatcher').Dispatcher<S>): void {
  const ids = registryId(() => MOB_DEFS.keys(), 'entity.notFound');
  d.register(literal<S>('summon').require((s) => s.permission >= 2).then(argument<S, string>('entity', ids)
    .run((c) => summon(c, false, false))
    .then(argument<S, [number, number, number]>('pos', vec3)
      .run((c) => summon(c, true, false))
      .then(argument<S, string>('data', greedy).run((c) => summon(c, true, true))))));
}
COMMAND_REGISTRARS.push((d) => registerSummon(d));

// ---------------------------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------------------------

/** Apply /summon or spawn egg data keys to a fresh mob. */
function applySpawnData(m: Mob, opts: Record<string, unknown>): void {
  if (opts['noAI'] === true || opts['NoAI'] === true) m.data['noAI'] = true;
  if (opts['persistent'] === true || opts['PersistenceRequired'] === true) m.setPersistent();
  if (typeof opts['name'] === 'string') {
    m.e['customName'] = opts['name'];
    m.setMeta('customName', opts['name']);
  }
  if (typeof opts['health'] === 'number') m.e.living.health = Math.min(m.maxHealth, opts['health']);
  if (opts['baby'] === true && m.def.ageable) setAge(m, -24000);
  if (typeof opts['data'] === 'object' && opts['data']) Object.assign(m.data, opts['data']);
  m.def.syncMeta?.(m);
}

function install(server: StrataServer): void {
  const h = server.hooks;
  for (const id of MOB_DEFS.keys()) ENTITY_CODECS.set(id, { save: saveMob, load: loadMob });

  const prevCreate = h.createEntity;
  h.createEntity = (level, type, x, y, z, opts) => {
    if (!MOB_DEFS.has(type)) return prevCreate(level, type, x, y, z, opts);
    const reason = (opts['reason'] as SpawnReason | undefined) ?? (opts['worldgen'] ? 'chunk_generation' : 'command');
    const m = spawnMob(level, type, x, y, z, reason, opts);
    if (!m) return null;
    applySpawnData(m, opts);
    if (opts['worldgen'] || reason === 'structure') m.setPersistent();
    return m.e;
  };

  const prevTick = h.tickEntities;
  h.tickEntities = (level) => {
    prevTick(level);
    for (const e of [...level.entities.all()]) {
      const m = mobOf(e);
      if (m && !e.removed) tickMob(m);
    }
  };

  const prevAdjust = livingHooks.adjustDamage;
  livingHooks.adjustDamage = (level, e, type, amount, attacker) => {
    const a = prevAdjust(level, e, type, amount, attacker);
    const m = mobOf(e);
    if (!m) return a;
    if (type === 'fall' && m.def.noFallDamage) return 0;
    if (type === 'drown' && m.def.waterBreather && !m.def.aquatic && !m.def.hurtByWater) return 0;
    return m.def.hurtFilter ? m.def.hurtFilter(m, type, a, attacker) : a;
  };

  const prevHurt = livingHooks.onHurt;
  livingHooks.onHurt = (level, e, type, amount, attacker) => {
    prevHurt(level, e, type, amount, attacker);
    const m = mobOf(e);
    if (!m) return;
    m.noActionTime = 0;
    m.tmp['lastHurtTick'] = m.tickCount;
    m.tmp['lastHurtPanics'] = type !== 'in_wall' && type !== 'cramming' && type !== 'starve';
    if (attacker && attacker !== e && attacker.living) {
      m.setLastHurtBy(attacker);
      if (attacker.player) {
        m.lastHurtByPlayer = attacker;
        m.lastHurtByPlayerTime = m.tickCount;
      }
    }
    m.def.onHurt?.(m, type, amount, attacker);
    if (!e.living!.dead && m.def.hurtSound) m.playSound(m.def.hurtSound);
  };

  const prevDeath = livingHooks.onDeath;
  livingHooks.onDeath = (level, e, type, attacker) => {
    prevDeath(level, e, type, attacker);
    const m = mobOf(e);
    if (!m) return;
    if (m.def.deathSound) m.playSound(m.def.deathSound);
    m.goals.stopAll();
    m.targets.stopAll();
    m.nav.stop();
    dropLoot(m, attacker);
    m.def.onDeath?.(m, type, attacker);
    if (e['customName'] && level.getGameRule('showDeathMessages') !== false) {
      for (const p of level.players) p.send({ type: 'chat', kind: 'system', text: { key: 'death.named', args: [String(e['customName'])] } });
    }
  };

  const prevInteract = combatHooks.interact;
  combatHooks.interact = (p, target, hand) => {
    const m = mobOf(target);
    if (m && m.alive) {
      const stack = handStack(p, hand);
      // Spawn egg of the same type: baby
      if (eggMob(stack) === m.def.id && m.def.ageable) {
        const baby = spawnMob(m.level, m.def.id, m.x, m.y, m.z, 'spawn_egg', { baby: true });
        if (baby) {
          setAge(baby, -24000);
          useItem(p, hand, stack);
          return true;
        }
      }
      if (genericInteract(m, p, hand)) return true;
      if (m.def.interact?.(m, p, hand)) return true;
      if (feedAnimal(m, p, hand)) return true;
    }
    return prevInteract(p, target, hand);
  };

  const prevUseOn = h.useItemOn;
  h.useItemOn = (p, hand, stack, x, y, z, face, hx, hy, hz) => prevUseOn(p, hand, stack, x, y, z, face, hx, hy, hz) || useEggOnBlock(p, hand, stack, x, y, z, face);
  const prevUse = h.useItem;
  h.useItem = (p, hand) => prevUse(p, hand) || useEggInAir(p, hand);

  const prevEffects = livingHooks.onEffectsChanged;
  livingHooks.onEffectsChanged = (level, e) => {
    prevEffects(level, e);
    const m = mobOf(e);
    if (m) m.e.input.speed = m.speed;
  };
}

registerGameplayModule(install);
