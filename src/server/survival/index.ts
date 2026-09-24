/**
 * Survival gameplay module: installs the damage pipeline, drops, experience, hunger, item use,
 * combat, death/respawn and persistence into the server hooks.
 */
import { registerGameplayModule } from '../gameplay';
import type { StrataServer } from '../server';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { Entity } from '../../common/entity/ecs';
import { effect } from '../../common/entity/living';
import { NO_MODIFIERS } from '../../common/item/mining';
import { blockOf } from '../../common/block/registry';
import { INV_ARMOR } from '../../common/entity/player';
import { hurt, addEffect, livingHooks, hasEffect, effectAmp } from './living';
import { createItemEntity, spawnExperience, tickDrops, dropFromPlayer } from './items';
import {
  ensureSurvival, playerSurvivalTick, onPlayerDeath, respawnPlayer, savePlayerSurvival, loadPlayerSurvival, stopUsing,
} from './player';
import { dropBlockLoot, afterPlayerBreak, useItemOnBlock, useItemInAir, playerAction, damageEntityItem } from './interaction';
import { playerAttack, tickAttack, combatHooks } from './combat';
import { tickRecipes, recipeCrafted, sendAllRecipes, saveRecipes, loadRecipes } from './recipes';
import { useBed, wakeUp, tickSleep, sleepingOf } from './sleep';
import { dropContainerContents, shellBoxDrop, restoreContainer, furnaceSystem, isContainerBE, voidChestOf } from './containers';
import { popResource } from './interaction';
import type { SerializedStack } from '../../common/item/stack';

function playerOf(server: StrataServer, e: Entity): ServerPlayer | undefined {
  return e.player ? server.players.find((p) => p.entity === e) : undefined;
}

/** Send an entity's active effects to everyone tracking it (and itself). */
function syncEffects(level: ServerLevel, e: Entity): void {
  const l = e.living;
  if (!l) return;
  const effects = [...l.effects.values()].map((x) => ({ id: x.id, amp: x.amp, dur: x.dur, particles: x.particles, ambient: x.ambient, icon: x.icon }));
  level.tracker.broadcast(e, { type: 'entityEffects', id: e.id, effects });
}

function ignite(e: Entity, seconds: number): void {
  const ph = e.physics;
  if (!ph || ph.fireImmune || hasEffect(e, 'fire_resistance') && e.type !== 'player') {
    if (ph && !ph.fireImmune) ph.fireTicks = Math.max(ph.fireTicks, seconds * 20);
    return;
  }
  let ticks = seconds * 20;
  if (e.player || e['equipment']) {
    // Fire protection shortens burning (filled by the enchanting system)
    ticks = Math.floor(ticks * (1 - Math.min(0.6, livingHooks.protectionFactor(e, 'fire_duration') * 0.15)));
  }
  if (ph.fireTicks < ticks) ph.fireTicks = ticks;
  if (!e.meta) e.meta = {};
  if (e.meta['onFire'] !== true) {
    e.meta['onFire'] = true;
    if (e.net) e.net.metaDirty = true;
  }
}

function install(server: StrataServer): void {
  const h = server.hooks;

  h.hurtEntity = (level, e, type, amount, attacker) => hurt(level, e, type, amount, attacker);
  h.igniteEntity = (_level, e, seconds) => ignite(e, seconds);
  h.addEntityEffect = (level, e, id, ticks, amp) => { addEffect(level, e, effect(id, ticks, amp)); };
  h.dropBlockLoot = (level, x, y, z, state, breaker, tool) => dropBlockLoot(level, x, y, z, state, breaker, tool);
  h.spawnItem = (level, x, y, z, stack, vx, vy, vz, delay) => createItemEntity(level, x, y, z, stack, vx, vy, vz, delay);
  h.spawnExperience = (level, x, y, z, amount) => spawnExperience(level, x, y, z, amount);

  const prevTickEntities = h.tickEntities;
  h.tickEntities = (level) => {
    prevTickEntities(level);
    tickDrops(level);
    // Burning non-player entities
    for (const e of level.entities.all()) {
      if (e.player || !e.physics || e.removed) continue;
      const ph = e.physics;
      if (ph.fireTicks > 0) {
        ph.fireTicks--;
        if (e.living && ph.fireTicks % 20 === 0) hurt(level, e, 'on_fire', 1);
        if (ph.inWater) ph.fireTicks = 0;
        if (ph.fireTicks === 0 && e.meta?.['onFire']) { e.meta['onFire'] = false; if (e.net) e.net.metaDirty = true; }
      }
    }
  };

  const prevFall = h.fallDamage;
  h.fallDamage = (level, e, dist, mul, state) => {
    prevFall(level, e, dist, mul, state);
    const l = e.living;
    if (!l || l.dead) return;
    if (e.player && (e.player.abilities.invulnerable || e.player.abilities.flying)) return;
    if (level.getGameRule('fallDamage') === false && e.player) return;
    const safe = l.attrs.value('safe_fall_distance');
    const dmg = Math.ceil((dist - safe) * mul * l.attrs.value('fall_damage_multiplier'));
    if (dmg <= 0) return;
    const t = e.transform!;
    level.playSound(t.x, t.y, t.z, dmg > 4 ? 'entity.generic.big_fall' : 'entity.generic.small_fall', 1, 1);
    hurt(level, e, 'fall', dmg);
    if (state) level.levelEvent(2006, Math.floor(t.x), Math.floor(t.y - 0.2), Math.floor(t.z), state);
  };

  h.afterBreak = (p, x, y, z, state) => afterPlayerBreak(p, x, y, z, state);
  h.playerDrop = (p, stack, randomly) => { dropFromPlayer(p.level, p, stack, randomly); };
  const prevCrafted = h.itemCrafted;
  h.itemCrafted = (p, stack, n) => {
    prevCrafted(p, stack, n);
    recipeCrafted(p, stack.id);
  };
  const prevUseOn = h.useItemOn;
  h.useItemOn = (p, hand, stack, x, y, z, face, hx, hy, hz) => prevUseOn(p, hand, stack, x, y, z, face, hx, hy, hz) || useItemOnBlock(p, hand, stack, x, y, z, face);
  const prevUse = h.useItem;
  h.useItem = (p, hand) => prevUse(p, hand) || useItemInAir(p, hand);
  const prevAction = h.playerAction;
  h.playerAction = (p, action, x, y, z, face) => {
    prevAction(p, action, x, y, z, face);
    playerAction(p, action);
  };

  h.miningModifiers = (p) => {
    const e = p.entity;
    const tool = p.inventory.mainHand;
    const helmet = p.inventory.get(INV_ARMOR + 3);
    const haste = Math.max(effectAmp(e, 'haste'), effectAmp(e, 'conduit_power')) + 1;
    const l = e.living;
    return {
      ...NO_MODIFIERS,
      efficiency: tool.getEnchant('efficiency'),
      haste,
      miningFatigue: effectAmp(e, 'mining_fatigue') + 1,
      inWater: e.physics.underWater,
      aquaAffinity: helmet.getEnchant('aqua_affinity') > 0,
      onGround: e.physics.onGround || e.input.flying,
      breakSpeed: l ? l.attrs.value('block_break_speed') : 1,
    };
  };

  for (const level of server.levels.values()) level.systems.push(furnaceSystem(level));
  const prevBERemoved = h.blockEntityRemoved;
  h.blockEntityRemoved = (level, be, oldState, suppress) => {
    prevBERemoved(level, be, oldState, suppress);
    if (suppress) return;
    if (be.type === 'shell_box') {
      const stack = shellBoxDrop(level, be, blockOf(oldState).name);
      const creative = level.breaker?.player?.gameMode === 'creative';
      if (!creative || stack.data.container) popResource(level, be.x, be.y, be.z, stack);
      return;
    }
    dropContainerContents(level, be);
  };
  const prevPlaced = h.blockPlaced;
  h.blockPlaced = (p, x, y, z, state, stack, hand) => {
    prevPlaced(p, x, y, z, state, stack, hand);
    restoreContainer(p.level, x, y, z, stack);
  };
  const prevBEData = h.blockEntityClientData;
  h.blockEntityClientData = (be) => (isContainerBE(be.type) ? { name: be.data['name'] ?? null } : prevBEData(be));

  h.useBed = (level, e, x, y, z) => {
    const p = playerOf(server, e);
    if (p) useBed(level, p, x, y, z);
  };
  const prevServerTick = h.serverTick;
  h.serverTick = () => {
    prevServerTick();
    tickSleep(server);
  };

  const prevSwing = h.swing;
  h.swing = (p, hand) => {
    prevSwing(p, hand);
    p.level.tracker.broadcast(p.entity, { type: 'entityAnimation', id: p.entity.id, anim: hand === 'main' ? 0 : 3 }, false);
  };

  const prevPacket = h.packet;
  h.packet = (p, packet) => {
    switch (packet.type) {
      case 'clientCommand':
        if (packet['action'] === 'respawn') respawnPlayer(server, p);
        return;
      case 'playerCommand':
        if (packet['action'] === 'stop_sleeping' && sleepingOf(p)) wakeUp(p.level, p);
        else prevPacket(p, packet);
        return;
      case 'swing':
        h.swing(p, packet['hand'] === 'off' ? 'off' : 'main');
        return;
      case 'interact': {
        const target = p.level.entities.get(packet['entityId'] as number);
        if (!target || target.removed || p.entity.living?.dead) return;
        const tt = target.transform!, pt = p.entity.transform;
        const range = (p.entity.living?.attrs.value('entity_interaction_range') ?? 3) + (p.data.gameMode === 'creative' ? 2 : 0) + 3;
        if ((tt.x - pt.x) ** 2 + (tt.y - pt.y) ** 2 + (tt.z - pt.z) ** 2 > range * range) return;
        if (packet['kind'] === 'attack') playerAttack(p, target);
        else combatHooks.interact(p, target, packet['hand'] === 'off' ? 'off' : 'main');
        return;
      }
    }
    prevPacket(p, packet);
  };

  const prevJoined = h.playerJoined;
  h.playerJoined = (p, first) => {
    prevJoined(p, first);
    ensureSurvival(p);
    p.ext['hudKey'] = '';
    p.ext['airKey'] = '';
    p.ext['xpDirty'] = true;
    syncEffects(p.level, p.entity);
    tickRecipes(p);
    sendAllRecipes(p);
    if (p.entity.living!.dead) p.send({ type: 'playerDeath', message: { key: 'deathScreen.title' }, score: p.entity.xp!.total });
  };

  const prevTick = h.playerTick;
  h.playerTick = (p) => {
    prevTick(p);
    playerSurvivalTick(p.level, p);
    tickAttack(p);
    if ((p.server.gameTime + p.entity.id) % 10 === 0) tickRecipes(p);
    // Pose flags visible to other players
    const e = p.entity;
    const m = (e.meta ??= {});
    const flags: Array<[string, boolean]> = [['sneaking', e.input.sneaking && !e.input.flying], ['using', e.input.usingItem], ['swimming', e.input.swimming], ['fallFlying', e.input.fallFlying]];
    for (const [k, v] of flags) {
      if (m[k] !== v) {
        m[k] = v;
        if (e.net) e.net.metaDirty = true;
      }
    }
  };

  const prevLeft = h.playerLeft;
  h.playerLeft = (p) => {
    prevLeft(p);
    if (sleepingOf(p)) wakeUp(p.level, p);
    stopUsing(p);
    p.level.tracker.forgetPlayer(p);
  };

  const prevSave = h.savePlayer;
  h.savePlayer = (p) => ({ ...prevSave(p), survival: savePlayerSurvival(p), recipes: saveRecipes(p), voidChest: voidChestOf(p).toJSON() });
  const prevLoad = h.loadPlayer;
  h.loadPlayer = (p, d) => {
    prevLoad(p, d);
    if (d['survival']) loadPlayerSurvival(p.level, p, d['survival'] as Record<string, unknown>);
    loadRecipes(p, d['recipes'] as Parameters<typeof loadRecipes>[1]);
    if (d['voidChest']) voidChestOf(p).load(d['voidChest'] as Array<SerializedStack | null>);
  };

  livingHooks.onDeath = (level, e, type, attacker) => {
    const p = playerOf(server, e);
    if (!p) return;
    if (sleepingOf(p)) wakeUp(level, p);
    onPlayerDeath(server, level, p, type, attacker);
  };
  const prevHurt = livingHooks.onHurt;
  livingHooks.onHurt = (level, e, type, amount, attacker) => {
    prevHurt(level, e, type, amount, attacker);
    const p = playerOf(server, e);
    if (p && sleepingOf(p)) wakeUp(level, p);
  };
  livingHooks.onEffectsChanged = (level, e) => syncEffects(level, e);
  livingHooks.damageItem = (level, e, stack, amount) => damageEntityItem(level, e, stack, amount);
}

registerGameplayModule(install);
