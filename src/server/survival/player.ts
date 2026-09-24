/**
 * Player survival: hunger and regeneration, air and drowning, fire and lava, freezing,
 * suffocation, the void, movement exhaustion, death (drops, messages, death screen) and
 * respawning, plus HUD state synchronisation and persistence.
 */
import type { Entity } from '../../common/entity/ecs';
import { newFoodData, addExhaustion, eatFood, deathXp, Experience, effect } from '../../common/entity/living';
import { getCollisionShape, stateFlags, F, blockOf } from '../../common/block/registry';
import { getItem } from '../../common/item/items';
import { ItemStack } from '../../common/item/stack';
import { TextComponent, has } from '../../common/lang/i18n';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { StrataServer } from '../server';
import { makeLiving, hurt, heal, maxHealth, tickLiving, addEffect, removeEffect, clearEffects, hasEffect, livingHooks, refreshEquipment } from './living';
import { dropFromPlayer, spawnExperience } from './items';

export function newExperience(): Experience {
  return { level: 0, progress: 0, total: 0, seed: (Math.random() * 0xffffffff) >>> 0 };
}

/** Make sure a player entity carries the survival components. */
export function ensureSurvival(p: ServerPlayer): void {
  const e = p.entity;
  if (!e.living) e.living = makeLiving(20);
  if (!e.food) e.food = newFoodData();
  if (!e.xp) e.xp = newExperience();
}

// ---------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------

function eyeInsideSolid(level: ServerLevel, e: Entity): boolean {
  const t = e.transform!, ph = e.physics!;
  const ey = t.y + ph.eyeHeight;
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) {
    const bx = Math.floor(t.x + dx), by = Math.floor(ey), bz = Math.floor(t.z + dz);
    const s = level.getBlockState(bx, by, bz);
    if (!(stateFlags[s]! & F.SOLID) || !(stateFlags[s]! & F.OPAQUE_CUBE)) continue;
    const shape = getCollisionShape(s);
    for (let i = 0; i < shape.length; i += 6) {
      if (t.x + dx > bx + shape[i]! && t.x + dx < bx + shape[i + 3]! && ey > by + shape[i + 1]! && ey < by + shape[i + 4]! && t.z + dz > bz + shape[i + 2]! && t.z + dz < bz + shape[i + 5]!) return true;
    }
  }
  return false;
}

function tickFood(level: ServerLevel, p: ServerPlayer): void {
  const e = p.entity, f = e.food!, l = e.living!;
  const difficulty = level.getDifficulty();
  const natural = level.getGameRule('naturalRegeneration') !== false;
  const max = maxHealth(e);
  if (difficulty === 0 && natural) {
    if (l.health < max && level.getGameTime() % 20 === 0) heal(e, 1);
    if (f.food < 20 && level.getGameTime() % 10 === 0) f.food++;
  }
  if (f.exhaustion > 4) {
    f.exhaustion -= 4;
    if (f.saturation > 0) f.saturation = Math.max(f.saturation - 1, 0);
    else if (difficulty !== 0) f.food = Math.max(f.food - 1, 0);
  }
  if (natural && f.saturation > 0 && l.health < max && f.food >= 20) {
    if (++f.timer >= 10) {
      const amt = Math.min(f.saturation, 6);
      heal(e, amt / 6);
      addExhaustion(f, amt);
      f.timer = 0;
    }
  } else if (natural && f.food >= 18 && l.health < max) {
    if (++f.timer >= 80) {
      heal(e, 1);
      addExhaustion(f, 6);
      f.timer = 0;
    }
  } else if (f.food <= 0) {
    if (++f.timer >= 80) {
      if (l.health > 10 || difficulty === 3 || (l.health > 1 && difficulty === 2)) hurt(level, e, 'starve', 1);
      f.timer = 0;
    }
  } else f.timer = 0;
}

/** Random teleport of chorus fruit: up to 16 tries within ±8 blocks onto solid ground. */
function chorusTeleport(level: ServerLevel, p: ServerPlayer): void {
  const t = p.entity.transform;
  const r = level.random;
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(t.x + (r.nextDouble() - 0.5) * 16), z = Math.floor(t.z + (r.nextDouble() - 0.5) * 16);
    let y = Math.min(level.maxY - 2, Math.max(level.minY + 1, Math.floor(t.y + r.nextIntBetween(-8, 7))));
    while (y > level.minY && !(stateFlags[level.getBlockState(x, y - 1, z)]! & F.SOLID)) y--;
    if (stateFlags[level.getBlockState(x, y, z)]! & (F.SOLID | F.FLUID_BLOCK)) continue;
    if (stateFlags[level.getBlockState(x, y + 1, z)]! & (F.SOLID | F.FLUID_BLOCK)) continue;
    level.playSound(t.x, t.y, t.z, 'item.chorus_fruit.teleport');
    p.teleport(x + 0.5, y, z + 0.5);
    level.playSound(x + 0.5, y, z + 0.5, 'item.chorus_fruit.teleport');
    return;
  }
}

/** Hooks filled by later systems (enchantments: respiration; brewing: potions). */
export const playerHooks = {
  airDecrease: (_p: ServerPlayer, air: number): number => air - 1,
  chorusTeleport,
  drinkPotion: (_level: ServerLevel, _p: ServerPlayer, _stack: ItemStack): void => {},
};

function tickEnvironment(level: ServerLevel, p: ServerPlayer): void {
  const e = p.entity, ph = e.physics, t = e.transform;
  const spectator = p.data.gameMode === 'spectator';
  // Lava and fire
  if (ph.inLava && !spectator) {
    level.igniteEntity(e, 15);
    hurt(level, e, 'lava', 4);
  }
  if (ph.fireTicks > 0) {
    if (hasEffect(e, 'fire_resistance') || ph.fireImmune) ph.fireTicks = Math.max(0, ph.fireTicks - 4);
    else {
      if (ph.fireTicks % 20 === 0) hurt(level, e, 'on_fire', 1);
      ph.fireTicks--;
    }
    if (ph.inWater || level.isRainingAt(Math.floor(t.x), Math.floor(t.y + ph.height), Math.floor(t.z))) ph.fireTicks = 0;
    if (ph.fireTicks === 0 && e.meta) { e.meta['onFire'] = false; if (e.net) e.net.metaDirty = true; }
  }
  // Air
  const canBreathe = !ph.underWater || hasEffect(e, 'water_breathing') || hasEffect(e, 'conduit_power') || p.data.abilities.invulnerable;
  if (!canBreathe) {
    ph.air = playerHooks.airDecrease(p, ph.air);
    if (ph.air <= -20) {
      ph.air = 0;
      hurt(level, e, 'drown', 2);
    }
  } else if (ph.air < ph.maxAir) ph.air = Math.min(ph.maxAir, ph.air + 4);
  // Freezing in powder snow
  if (ph.inPowderSnow && !spectator) ph.frozenTicks = Math.min(140 + 2, ph.frozenTicks + 1);
  else ph.frozenTicks = Math.max(0, ph.frozenTicks - 2);
  if (ph.frozenTicks >= 140 && level.getGameTime() % 40 === 0) hurt(level, e, 'freeze', 1);
  // Suffocation
  if (!ph.noPhysics && !spectator && eyeInsideSolid(level, e)) hurt(level, e, 'in_wall', 1);
  // The void
  if (t.y < level.minY - 64) hurt(level, e, 'out_of_world', 4);
}

function tickMovementExhaustion(p: ServerPlayer): void {
  const e = p.entity, t = e.transform, f = e.food!, ph = e.physics;
  if (p.data.gameMode === 'creative' || p.data.gameMode === 'spectator') return;
  const dx = t.x - t.px, dy = t.y - t.py, dz = t.z - t.pz;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  if (ph.inWater && ph.underWater) addExhaustion(f, 0.01 * Math.sqrt(dx * dx + dy * dy + dz * dz));
  else if (e.input.sprinting && ph.onGround) addExhaustion(f, 0.1 * horiz);
  const wasGround = p.ext['wasOnGround'] as boolean | undefined;
  if (wasGround && !ph.onGround && ph.vy > 0 && !e.input.flying) addExhaustion(f, e.input.sprinting ? 0.2 : 0.05);
  p.ext['wasOnGround'] = ph.onGround;
}

function syncHud(p: ServerPlayer): void {
  const e = p.entity, l = e.living!, f = e.food!, ph = e.physics;
  const key = `${l.health.toFixed(2)}|${f.food}|${f.saturation.toFixed(1)}|${l.absorption.toFixed(1)}|${maxHealth(e)}`;
  if (p.ext['hudKey'] !== key) {
    p.ext['hudKey'] = key;
    p.send({ type: 'health', health: l.health, food: f.food, saturation: f.saturation, absorption: l.absorption, maxHealth: maxHealth(e) });
  }
  const airKey = `${ph.air}|${ph.frozenTicks}`;
  if (p.ext['airKey'] !== airKey) {
    p.ext['airKey'] = airKey;
    p.send({ type: 'air', air: ph.air, maxAir: ph.maxAir, frozen: ph.frozenTicks });
  }
  if (p.ext['xpDirty'] !== false) {
    p.ext['xpDirty'] = false;
    const x = e.xp!;
    p.send({ type: 'experience', progress: x.progress, level: x.level, total: x.total });
  }
}

export function playerSurvivalTick(level: ServerLevel, p: ServerPlayer): void {
  ensureSurvival(p);
  const e = p.entity;
  tickLiving(level, e);
  if (!e.living!.dead) {
    tickEnvironment(level, p);
    if (p.data.gameMode !== 'creative' && p.data.gameMode !== 'spectator') tickFood(level, p);
    tickMovementExhaustion(p);
    tickItemUse(level, p);
  }
  syncHud(p);
}

// ---------------------------------------------------------------------------------------------
// Using items (eating, drinking)
// ---------------------------------------------------------------------------------------------

export interface UseState {
  hand: 'main' | 'off';
  item: string;
  left: number;
  /** Total use duration (ticks used = total - left). */
  total: number;
}

/** Hooks for items used over time (bows, crossbows, tridents, shields, horns). */
export const useHooks = {
  /** The use button was released after `ticks` ticks. */
  release: (_level: ServerLevel, _p: ServerPlayer, _hand: 'main' | 'off', _stack: ItemStack, _ticks: number): void => {},
  /** Called every tick while using (crossbow loading sounds). */
  tick: (_level: ServerLevel, _p: ServerPlayer, _stack: ItemStack, _ticks: number): void => {},
};

export function usingState(p: ServerPlayer): UseState | undefined {
  return p.ext['using'] as UseState | undefined;
}

/** Start using an item for a fixed duration (non-food items: bows, shields…). */
export function startUsingFor(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, duration: number): boolean {
  const cur = p.ext['using'] as UseState | undefined;
  if (cur && cur.hand === hand && cur.item === stack.id) return true;
  p.ext['using'] = { hand, item: stack.id, left: duration, total: duration } satisfies UseState;
  p.entity.input.usingItem = true;
  return true;
}

export function startUsing(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): boolean {
  const def = getItem(stack.id);
  if (!def) return false;
  const e = p.entity;
  const cur = p.ext['using'] as UseState | undefined;
  if (cur && cur.hand === hand && cur.item === stack.id) return true;
  if (def.food) {
    const creative = p.data.gameMode === 'creative';
    if (!def.food.alwaysEdible && e.food!.food >= 20 && !creative) return false;
  } else if (def.useAnim !== 'drink') return false;
  const dur = def.useDuration ?? 32;
  p.ext['using'] = { hand, item: stack.id, left: dur, total: dur } satisfies UseState;
  e.input.usingItem = true;
  return true;
}

export function stopUsing(p: ServerPlayer): void {
  delete p.ext['using'];
  p.entity.input.usingItem = false;
}

function tickItemUse(level: ServerLevel, p: ServerPlayer): void {
  const u = p.ext['using'] as UseState | undefined;
  if (!u) return;
  const inv = p.inventory;
  const stack = u.hand === 'main' ? inv.mainHand : inv.offHand;
  if (stack.id !== u.item) return stopUsing(p);
  const def = getItem(u.item);
  if (!def?.food && def?.useAnim !== 'drink') {
    // Held items (bows, shields…) run until released or their duration ends
    useHooks.tick(level, p, stack, u.total - u.left);
    if (--u.left <= 0) {
      stopUsing(p);
      useHooks.release(level, p, u.hand, stack, u.total);
    }
    return;
  }
  if (--u.left > 0) {
    if (u.left % 4 === 0 && getItem(u.item)?.food) {
      const t = p.entity.transform;
      level.playSound(t.x, t.y, t.z, 'entity.generic.eat', 0.5, 0.9 + level.random.nextFloat() * 0.2, p.entity);
    }
    return;
  }
  stopUsing(p);
  finishUsing(level, p, u.hand, stack);
}

export function finishUsing(level: ServerLevel, p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack): void {
  const def = getItem(stack.id);
  if (!def) return;
  const e = p.entity;
  const t = e.transform;
  const creative = p.data.gameMode === 'creative';
  if (def.food) {
    eatFood(e.food!, def.food.nutrition, def.food.saturation);
    for (const fx of def.food.effects ?? []) if (level.random.nextFloat() < fx.chance) addEffect(level, e, effect(fx.id, fx.dur, fx.amp));
    level.playSound(t.x, t.y, t.z, 'entity.player.burp', 0.5, 0.9 + level.random.nextFloat() * 0.1);
  }
  if (stack.id === 'milk_bucket') clearEffects(level, e);
  if (stack.id === 'honey_bottle') removeEffect(level, e, 'poison');
  if (stack.id === 'suspicious_stew') for (const s of stack.data.suspicious ?? []) addEffect(level, e, effect(s.id, s.dur, 0));
  if (stack.id === 'ominous_bottle') addEffect(level, e, effect('bad_omen', 120000, (stack.data.ominous ?? 0), false, false));
  if (stack.id === 'chorus_fruit') playerHooks.chorusTeleport(level, p);
  if (stack.id === 'potion') playerHooks.drinkPotion(level, p, stack);
  if (creative) return;
  const inv = p.inventory;
  const slot = hand === 'main' ? inv.selected : 40;
  const remainder = def.food?.remainder ?? def.craftRemainder;
  stack.shrink(1);
  if (stack.isEmpty()) inv.set(slot, remainder ? new ItemStack(remainder, 1) : ItemStack.empty());
  else if (remainder && !inv.add(new ItemStack(remainder, 1), 64)) dropFromPlayer(level, p, new ItemStack(remainder, 1));
  inv.revision++;
}

// ---------------------------------------------------------------------------------------------
// Death and respawn
// ---------------------------------------------------------------------------------------------

function deathMessage(p: ServerPlayer, type: string, attacker: Entity | null): TextComponent {
  const who: TextComponent | null = attacker?.player ? { text: attacker.player.name } : attacker ? { key: `entity.${attacker.type}` } : null;
  let base = `death.${type}`;
  if (type === 'fall' && p.entity.physics.fallDistance > 5) base = 'death.fall.high';
  let key = who && has(`${base}.by`, 'en') ? `${base}.by` : base;
  if (!has(key, 'en')) key = who ? 'death.generic.by' : 'death.generic';
  const args: TextComponent[] = [{ text: p.name }];
  if (who && key.endsWith('.by')) args.push(who);
  return { key, args };
}

export function onPlayerDeath(server: StrataServer, level: ServerLevel, p: ServerPlayer, type: string, attacker: Entity | null): void {
  const msg = deathMessage(p, type, attacker);
  if (server.rules.get('showDeathMessages') !== false) server.broadcast({ type: 'chat', kind: 'system', text: msg, sender: '' });
  const keep = server.rules.get('keepInventory') === true;
  stopUsing(p);
  p.menus.close(true);
  if (!keep) {
    const inv = p.inventory;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i]!;
      if (s.isEmpty()) continue;
      dropFromPlayer(level, p, s, true);
    }
    inv.clear();
    const t = p.entity.transform;
    const amount = p.data.gameMode === 'spectator' ? 0 : deathXp(p.entity.xp!);
    if (amount > 0) spawnExperience(level, t.x, t.y + 0.5, t.z, amount);
    p.entity.xp!.level = 0; p.entity.xp!.progress = 0; p.entity.xp!.total = 0;
    p.ext['xpDirty'] = true;
    p.syncInventory();
  }
  p.entity.input.forward = 0;
  p.entity.input.strafe = 0;
  p.send({ type: 'playerDeath', message: msg, score: p.entity.xp!.total });
}

export function respawnPlayer(server: StrataServer, p: ServerPlayer): void {
  const e = p.entity, l = e.living!;
  if (!l.dead) return;
  const level = p.level;
  clearEffects(level, e);
  l.dead = false;
  l.deathTime = 0;
  l.health = maxHealth(e);
  l.absorption = 0;
  l.invulnerable = 0;
  e.food = newFoodData();
  e.physics.fireTicks = 0;
  e.physics.air = e.physics.maxAir;
  e.physics.frozenTicks = 0;
  e.physics.fallDistance = 0;
  e.physics.vx = e.physics.vy = e.physics.vz = 0;
  if (server.info.hardcore) p.setGameMode('spectator');
  const spawn = respawnPosition(server, p);
  p.send({ type: 'respawn', dim: level.dimId, gameMode: p.data.gameMode, keepData: false });
  p.teleport(spawn.x, spawn.y, spawn.z, spawn.yaw, 0);
  p.ext['hudKey'] = '';
  p.ext['xpDirty'] = true;
  p.syncInventory();
  refreshEquipment(e);
}

/** Bed / respawn anchor if set and valid, else the world spawn with the spawn radius. */
export function respawnPosition(server: StrataServer, p: ServerPlayer): { x: number; y: number; z: number; yaw: number } {
  const sp = p.ext['spawnPoint'] as { x: number; y: number; z: number; dim: string; angle: number } | undefined;
  const level = p.level;
  if (sp && sp.dim === level.dimId) {
    const s = level.getBlockState(sp.x, sp.y, sp.z);
    const n = blockOf(s).name;
    if (n.endsWith('_bed') || n === 'respawn_anchor') {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
        const x = sp.x + dx, z = sp.z + dz;
        for (let y = sp.y - 1; y <= sp.y + 1; y++) {
          if (!(stateFlags[level.getBlockState(x, y, z)]! & F.SOLID) && !(stateFlags[level.getBlockState(x, y + 1, z)]! & F.SOLID) && (stateFlags[level.getBlockState(x, y - 1, z)]! & F.SOLID)) {
            return { x: x + 0.5, y, z: z + 0.5, yaw: sp.angle };
          }
        }
      }
    }
    delete p.ext['spawnPoint'];
    p.send({ type: 'chat', kind: 'system', text: { key: 'spawn.notValid' }, sender: '' });
  }
  const s = server.info.spawn;
  const radius = Math.max(0, Number(server.rules.get('spawnRadius')));
  const r = level.random;
  for (let i = 0; i < 20; i++) {
    const x = s.x + (radius > 0 ? r.nextIntBetween(-radius, radius) : 0);
    const z = s.z + (radius > 0 ? r.nextIntBetween(-radius, radius) : 0);
    if (!level.isLoaded(x, z)) continue;
    const y = level.getHeight('motion', x, z);
    const below = level.getBlockState(x, y - 1, z);
    if (stateFlags[below]! & F.FLUID_BLOCK) continue;
    return { x: x + 0.5, y, z: z + 0.5, yaw: 0 };
  }
  return { x: s.x + 0.5, y: s.y, z: s.z + 0.5, yaw: 0 };
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

export function savePlayerSurvival(p: ServerPlayer): Record<string, unknown> {
  ensureSurvival(p);
  const e = p.entity, l = e.living!;
  return {
    health: l.health, absorption: l.absorption, dead: l.dead, food: e.food, xp: e.xp, fire: e.physics.fireTicks, air: e.physics.air,
    effects: [...l.effects.values()], spawnPoint: p.ext['spawnPoint'], attrs: l.attrs.toJSON(),
  };
}

export function loadPlayerSurvival(level: ServerLevel, p: ServerPlayer, d: Record<string, unknown>): void {
  ensureSurvival(p);
  const e = p.entity, l = e.living!;
  if (d['attrs']) l.attrs.load(d['attrs'] as Parameters<typeof l.attrs.load>[0]);
  for (const fx of (d['effects'] as Array<Parameters<typeof addEffect>[2]> | undefined) ?? []) addEffect(level, e, fx);
  if (typeof d['health'] === 'number') l.health = d['health'];
  if (typeof d['absorption'] === 'number') l.absorption = d['absorption'];
  if (d['food']) e.food = { ...newFoodData(), ...(d['food'] as object) };
  if (d['xp']) e.xp = { ...newExperience(), ...(d['xp'] as object) };
  if (typeof d['fire'] === 'number') e.physics.fireTicks = d['fire'];
  if (typeof d['air'] === 'number') e.physics.air = d['air'];
  if (d['spawnPoint']) p.ext['spawnPoint'] = d['spawnPoint'];
  if (d['dead'] === true || l.health <= 0) {
    l.dead = true;
    l.health = 0;
  }
  livingHooks.onHealthChanged(e);
}
