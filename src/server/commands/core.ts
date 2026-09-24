/**
 * Core commands: help, gamemode, defaultgamemode, difficulty, time, weather, teleport, give,
 * clear, kill, effect, experience, gamerule, seed, spawnpoint, setworldspawn, say, me, msg, list,
 * setblock, fill, clone, recipe, title, tag.
 */
import { literal, argument, Dispatcher, fail, CommandContext } from './dispatcher';
import {
  CommandSource, integer, float, bool, greedy, oneOf, time, blockPos, vec3, rotation, entities, entity, players, player,
  item, blockState, registryId, word, entityTags,
} from './args';
import { COMMAND_REGISTRARS, feedback, getDispatcher } from './index';
import type { Entity } from '../../common/entity/ecs';
import type { ServerPlayer } from '../player';
import type { StrataServer } from '../server';
import type { TextComponent } from '../../common/lang/i18n';
import { DEFAULT_RULES } from '../server';
import { GameMode } from '../../common/entity/player';
import { ItemStack } from '../../common/item/stack';
import { maxStackOf } from '../../common/menu/container';
import { EFFECTS } from '../../common/effect/effects';
import { effect as makeEffect, addXpPoints, addXpLevels, totalXpForLevel, xpNeeded } from '../../common/entity/living';
import { blockOf, stateFlags, F, BLOCK_BY_NAME } from '../../common/block/registry';
import { hurt, addEffect, removeEffect, clearEffects } from '../survival/living';
import { unlockAllRecipes } from '../survival/recipes';
import { itemNameComponent, entityName } from './names';

type S = CommandSource;
const op = (level: number) => (s: S) => s.permission >= level;

const GAMEMODES: GameMode[] = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;

function nameOf(e: Entity): TextComponent {
  return entityName(e);
}

function setGameMode(p: ServerPlayer, mode: GameMode): void {
  p.setGameMode(mode);
}

function registerCore(d: Dispatcher<S>, server: StrataServer): void {
  // ---- help ------------------------------------------------------------------------------------
  d.register(literal<S>('help')
    .run((c) => {
      const cmds = getDispatcher(server).root.children.filter((n) => n.requires(c.source)).map((n) => `/${n.name}`).sort();
      feedback(c.source, { key: 'commands.help.list', args: [cmds.join(', ')] });
      return cmds.length;
    })
    .then(argument<S, string>('command', word(() => getDispatcher(server).root.children.map((n) => n.name))).run((c) => {
      const name = c.get<string>('command');
      const node = getDispatcher(server).root.children.find((n) => n.name === name);
      if (!node || !node.requires(c.source)) fail('commands.help.failed');
      for (const line of getDispatcher(server).usage(node, c.source, `/${name}`).slice(0, 12)) c.source.send({ text: line, color: 'gray' });
      return 1;
    })));

  // ---- gamemode --------------------------------------------------------------------------------
  const gm = literal<S>('gamemode').require(op(2));
  gm.then(argument<S, GameMode>('mode', oneOf(GAMEMODES))
    .run((c) => {
      const p = c.source.player;
      if (!p) fail('permissions.requires.player');
      setGameMode(p, c.get('mode'));
      feedback(c.source, { key: 'commands.gamemode.success.self', args: [{ key: `gameMode.${c.get<string>('mode')}` }] });
      return 1;
    })
    .then(argument<S, ServerPlayer[]>('targets', players).run((c) => {
      const mode = c.get<GameMode>('mode');
      for (const p of c.get<ServerPlayer[]>('targets')) {
        setGameMode(p, mode);
        if (p !== c.source.player) p.send({ type: 'chat', kind: 'system', text: { key: 'gameMode.changed', args: [{ key: `gameMode.${mode}` }] }, sender: '' });
        feedback(c.source, { key: 'commands.gamemode.success.other', args: [p.name, { key: `gameMode.${mode}` }] });
      }
      return c.get<ServerPlayer[]>('targets').length;
    })));
  d.register(gm);
  d.register(literal<S>('defaultgamemode').require(op(2)).then(argument<S, GameMode>('mode', oneOf(GAMEMODES)).run((c) => {
    server.info.gameMode = c.get('mode');
    feedback(c.source, { key: 'commands.defaultgamemode.success', args: [{ key: `gameMode.${c.get<string>('mode')}` }] });
    return 1;
  })));

  // ---- difficulty ------------------------------------------------------------------------------
  d.register(literal<S>('difficulty').require(op(2))
    .run((c) => { feedback(c.source, { key: 'commands.difficulty.query', args: [{ key: `options.difficulty.${DIFFICULTIES[server.info.difficulty]}` }] }); return server.info.difficulty; })
    .then(argument<S, string>('difficulty', oneOf(DIFFICULTIES)).run((c) => {
      const v = DIFFICULTIES.indexOf(c.get('difficulty') as typeof DIFFICULTIES[number]);
      if (server.info.hardcore) fail('commands.difficulty.hardcore');
      if (server.info.difficulty === v) fail('commands.difficulty.failure', c.get<string>('difficulty'));
      server.info.difficulty = v;
      server.broadcast({ type: 'gameEvent', event: 'difficulty', value: v });
      feedback(c.source, { key: 'commands.difficulty.success', args: [{ key: `options.difficulty.${c.get<string>('difficulty')}` }] });
      return v;
    })));

  // ---- time ------------------------------------------------------------------------------------
  const setTime = (c: CommandContext<S>, v: number) => {
    server.dayTime = Math.floor(server.dayTime / 24000) * 24000 + v;
    server.broadcast({ type: 'time', gameTime: server.gameTime, dayTime: server.dayTime, doCycle: !!server.rules.get('doDaylightCycle') });
    feedback(c.source, { key: 'commands.time.set', args: [v] });
    return v;
  };
  const timeNode = literal<S>('time').require(op(2))
    .then(literal<S>('set')
      .then(literal<S>('day').run((c) => setTime(c, 1000)))
      .then(literal<S>('noon').run((c) => setTime(c, 6000)))
      .then(literal<S>('night').run((c) => setTime(c, 13000)))
      .then(literal<S>('midnight').run((c) => setTime(c, 18000)))
      .then(argument<S, number>('time', time).run((c) => {
        const v = c.get<number>('time');
        server.dayTime = v;
        server.broadcast({ type: 'time', gameTime: server.gameTime, dayTime: server.dayTime, doCycle: !!server.rules.get('doDaylightCycle') });
        feedback(c.source, { key: 'commands.time.set', args: [v] });
        return v;
      })))
    .then(literal<S>('add').then(argument<S, number>('time', time).run((c) => {
      server.dayTime += c.get<number>('time');
      server.broadcast({ type: 'time', gameTime: server.gameTime, dayTime: server.dayTime, doCycle: !!server.rules.get('doDaylightCycle') });
      feedback(c.source, { key: 'commands.time.set', args: [server.dayTime % 24000] });
      return server.dayTime % 24000;
    })))
    .then(literal<S>('query')
      .then(literal<S>('daytime').run((c) => { const v = server.dayTime % 24000; feedback(c.source, { key: 'commands.time.query', args: [v] }); return v; }))
      .then(literal<S>('gametime').run((c) => { const v = server.gameTime % 2147483647; feedback(c.source, { key: 'commands.time.query', args: [v] }); return v; }))
      .then(literal<S>('day').run((c) => { const v = Math.floor(server.dayTime / 24000); feedback(c.source, { key: 'commands.time.query', args: [v] }); return v; })));
  d.register(timeNode);

  // ---- weather ---------------------------------------------------------------------------------
  const weather = (kind: 'clear' | 'rain' | 'thunder') => {
    const run = (c: CommandContext<S>, dur: number) => {
      server.setWeather(kind, dur);
      feedback(c.source, { key: `commands.weather.set.${kind}` });
      return dur;
    };
    return literal<S>(kind).run((c) => run(c, kind === 'clear' ? 6000 + Math.floor(Math.random() * 12000) : 3600 + Math.floor(Math.random() * 12000)))
      .then(argument<S, number>('duration', time).run((c) => run(c, c.get('duration'))));
  };
  d.register(literal<S>('weather').require(op(2)).then(weather('clear'), weather('rain'), weather('thunder')));

  // ---- teleport --------------------------------------------------------------------------------
  const tpTo = (targets: Entity[], x: number, y: number, z: number, yaw?: number, pitch?: number) => {
    for (const e of targets) {
      const p = server.players.find((pl) => pl.entity === e);
      const t = e.transform!;
      if (p) p.teleport(x, y, z, yaw ?? t.yaw, pitch ?? t.pitch);
      else {
        t.x = t.px = x; t.y = t.py = y; t.z = t.pz = z;
        if (yaw !== undefined) t.yaw = yaw;
        if (pitch !== undefined) t.pitch = pitch;
        if (e.physics) { e.physics.vx = e.physics.vy = e.physics.vz = 0; e.physics.fallDistance = 0; }
        if (e.net) e.net.forceSync = true;
      }
    }
  };
  const tp = literal<S>('teleport').require(op(2))
    .then(argument<S, [number, number, number]>('location', vec3).run((c) => {
      if (!c.source.entity) fail('permissions.requires.entity');
      const [x, y, z] = c.get<[number, number, number]>('location');
      tpTo([c.source.entity], x, y, z);
      feedback(c.source, { key: 'commands.teleport.success.location.single', args: [nameOf(c.source.entity), x.toFixed(2), y.toFixed(2), z.toFixed(2)] });
      return 1;
    }))
    .then(argument<S, Entity>('destination', entity).run((c) => {
      if (!c.source.entity) fail('permissions.requires.entity');
      const dst = c.get<Entity>('destination').transform!;
      tpTo([c.source.entity], dst.x, dst.y, dst.z, dst.yaw, dst.pitch);
      feedback(c.source, { key: 'commands.teleport.success.entity.single', args: [nameOf(c.source.entity), nameOf(c.get<Entity>('destination'))] });
      return 1;
    }))
    .then(argument<S, Entity[]>('targets', entities)
      .then(argument<S, [number, number, number]>('location', vec3).run((c) => {
        const [x, y, z] = c.get<[number, number, number]>('location');
        const list = c.get<Entity[]>('targets');
        tpTo(list, x, y, z);
        feedback(c.source, list.length === 1
          ? { key: 'commands.teleport.success.location.single', args: [nameOf(list[0]!), x.toFixed(2), y.toFixed(2), z.toFixed(2)] }
          : { key: 'commands.teleport.success.location.multiple', args: [list.length, x.toFixed(2), y.toFixed(2), z.toFixed(2)] });
        return list.length;
      }).then(argument<S, [number, number]>('rotation', rotation).run((c) => {
        const [x, y, z] = c.get<[number, number, number]>('location');
        const [yaw, pitch] = c.get<[number, number]>('rotation');
        const list = c.get<Entity[]>('targets');
        tpTo(list, x, y, z, yaw, pitch);
        feedback(c.source, { key: 'commands.teleport.success.location.multiple', args: [list.length, x.toFixed(2), y.toFixed(2), z.toFixed(2)] });
        return list.length;
      })))
      .then(argument<S, Entity>('destination', entity).run((c) => {
        const dst = c.get<Entity>('destination').transform!;
        const list = c.get<Entity[]>('targets');
        tpTo(list, dst.x, dst.y, dst.z, dst.yaw, dst.pitch);
        feedback(c.source, { key: 'commands.teleport.success.entity.multiple', args: [list.length, nameOf(c.get<Entity>('destination'))] });
        return list.length;
      })));
  d.register(tp);
  d.alias('tp', 'teleport');

  // ---- give ------------------------------------------------------------------------------------
  const give = (c: CommandContext<S>, count: number) => {
    const proto = c.get<ItemStack>('item');
    const max = maxStackOf(proto);
    if (count > max * 100) fail('commands.give.failed.toomanyitems', max * 100, itemNameComponent(proto));
    const targets = c.get<ServerPlayer[]>('targets');
    for (const p of targets) {
      let left = count;
      while (left > 0) {
        const n = Math.min(max, left);
        left -= n;
        const s = proto.copyWithCount(n);
        p.inventory.add(s, max);
        if (!s.isEmpty()) server.hooks.playerDrop(p, s, false);
      }
      const t = p.entity.transform;
      p.level.playSound(t.x, t.y, t.z, 'entity.item.pickup', 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2);
    }
    feedback(c.source, targets.length === 1
      ? { key: 'commands.give.success.single', args: [count, itemNameComponent(proto), targets[0]!.name] }
      : { key: 'commands.give.success.multiple', args: [count, itemNameComponent(proto), targets.length] });
    return targets.length;
  };
  d.register(literal<S>('give').require(op(2)).then(argument<S, ServerPlayer[]>('targets', players)
    .then(argument<S, ItemStack>('item', item).run((c) => give(c, 1))
      .then(argument<S, number>('count', integer(1, 6400)).run((c) => give(c, c.get('count')))))));

  // ---- clear -----------------------------------------------------------------------------------
  const clear = (c: CommandContext<S>, targets: ServerPlayer[], id: string | null, max: number) => {
    let total = 0;
    for (const p of targets) {
      const inv = p.inventory;
      for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i]!;
        if (s.isEmpty() || (id && s.id !== id)) continue;
        const n = max < 0 ? s.count : Math.min(s.count, max - total);
        if (n <= 0) break;
        total += n;
        if (max !== 0) {
          s.shrink(n);
          if (s.isEmpty()) inv.set(i, ItemStack.empty());
        }
      }
      inv.revision++;
    }
    if (total === 0) fail(targets.length === 1 ? 'clear.failed.single' : 'clear.failed.multiple', targets.length === 1 ? targets[0]!.name : targets.length);
    feedback(c.source, targets.length === 1 ? { key: 'commands.clear.success.single', args: [total, targets[0]!.name] } : { key: 'commands.clear.success.multiple', args: [total, targets.length] });
    return total;
  };
  d.register(literal<S>('clear').require(op(2))
    .run((c) => { if (!c.source.player) fail('permissions.requires.player'); return clear(c, [c.source.player], null, -1); })
    .then(argument<S, ServerPlayer[]>('targets', players).run((c) => clear(c, c.get('targets'), null, -1))
      .then(argument<S, ItemStack>('item', item).run((c) => clear(c, c.get('targets'), c.get<ItemStack>('item').id, -1))
        .then(argument<S, number>('maxCount', integer(0)).run((c) => clear(c, c.get('targets'), c.get<ItemStack>('item').id, c.get('maxCount')))))));

  // ---- kill ------------------------------------------------------------------------------------
  const kill = (c: CommandContext<S>, list: Entity[]) => {
    for (const e of list) {
      const lvl = server.levels.get(server.players.find((p) => p.entity === e)?.level.dimId ?? c.source.level.dimId)!;
      if (e.living) hurt(lvl, e, 'generic_kill', 3.4e38);
      else lvl.entities.remove(e);
    }
    feedback(c.source, list.length === 1 ? { key: 'commands.kill.success.single', args: [nameOf(list[0]!)] } : { key: 'commands.kill.success.multiple', args: [list.length] });
    return list.length;
  };
  d.register(literal<S>('kill').require(op(2))
    .run((c) => { if (!c.source.entity) fail('permissions.requires.entity'); return kill(c, [c.source.entity]); })
    .then(argument<S, Entity[]>('targets', entities).run((c) => kill(c, c.get('targets')))));

  // ---- effect ----------------------------------------------------------------------------------
  const effectId = registryId(() => EFFECTS.keys(), 'effect.effectNotFound');
  const giveEffect = (c: CommandContext<S>, seconds: number | 'infinite', amp: number, hide: boolean) => {
    const id = c.get<string>('effect');
    const def = EFFECTS.get(id)!;
    const ticks = seconds === 'infinite' ? -1 : def.instant ? 1 : seconds * 20;
    let n = 0;
    for (const e of c.get<Entity[]>('targets')) {
      if (!e.living) continue;
      if (addEffect(c.source.level, e, makeEffect(id, ticks, amp, false, !hide))) n++;
    }
    if (n === 0) fail('commands.effect.give.failed');
    feedback(c.source, { key: 'commands.effect.give.success', args: [{ key: `effect.${id}` }, n] });
    return n;
  };
  d.register(literal<S>('effect').require(op(2))
    .then(literal<S>('give').then(argument<S, Entity[]>('targets', entities).then(argument<S, string>('effect', effectId)
      .run((c) => giveEffect(c, 30, 0, false))
      .then(literal<S>('infinite').run((c) => giveEffect(c, 'infinite', 0, false))
        .then(argument<S, number>('amplifier', integer(0, 255)).run((c) => giveEffect(c, 'infinite', c.get('amplifier'), false))
          .then(argument<S, boolean>('hideParticles', bool).run((c) => giveEffect(c, 'infinite', c.get('amplifier'), c.get('hideParticles'))))))
      .then(argument<S, number>('seconds', integer(1, 1000000)).run((c) => giveEffect(c, c.get('seconds'), 0, false))
        .then(argument<S, number>('amplifier', integer(0, 255)).run((c) => giveEffect(c, c.get('seconds'), c.get('amplifier'), false))
          .then(argument<S, boolean>('hideParticles', bool).run((c) => giveEffect(c, c.get('seconds'), c.get('amplifier'), c.get('hideParticles')))))))))
    .then(literal<S>('clear')
      .run((c) => { if (!c.source.entity) fail('permissions.requires.entity'); clearEffects(c.source.level, c.source.entity); feedback(c.source, { key: 'commands.effect.clear.everything.success', args: [1] }); return 1; })
      .then(argument<S, Entity[]>('targets', entities).run((c) => {
        const list = c.get<Entity[]>('targets');
        for (const e of list) clearEffects(c.source.level, e);
        feedback(c.source, { key: 'commands.effect.clear.everything.success', args: [list.length] });
        return list.length;
      }).then(argument<S, string>('effect', effectId).run((c) => {
        const list = c.get<Entity[]>('targets');
        for (const e of list) removeEffect(c.source.level, e, c.get('effect'));
        feedback(c.source, { key: 'commands.effect.clear.specific.success', args: [{ key: `effect.${c.get<string>('effect')}` }, list.length] });
        return list.length;
      })))));

  // ---- experience ------------------------------------------------------------------------------
  const xpAdd = (c: CommandContext<S>, levels: boolean) => {
    const amount = c.get<number>('amount');
    const list = c.get<ServerPlayer[]>('targets');
    for (const p of list) {
      const x = p.entity.xp;
      if (!x) continue;
      if (levels) addXpLevels(x, amount);
      else addXpPoints(x, amount);
      p.ext['xpDirty'] = true;
    }
    feedback(c.source, { key: `commands.experience.add.${levels ? 'levels' : 'points'}.success`, args: [amount, list.length] });
    return list.length;
  };
  const xpSet = (c: CommandContext<S>, levels: boolean) => {
    const amount = c.get<number>('amount');
    const list = c.get<ServerPlayer[]>('targets');
    for (const p of list) {
      const x = p.entity.xp;
      if (!x) continue;
      if (levels) {
        x.level = amount;
        x.total = totalXpForLevel(amount) + Math.floor(x.progress * xpNeeded(amount));
      } else {
        if (amount > xpNeeded(x.level)) fail('commands.experience.set.points.invalid');
        x.progress = amount / xpNeeded(x.level);
      }
      p.ext['xpDirty'] = true;
    }
    feedback(c.source, { key: `commands.experience.set.${levels ? 'levels' : 'points'}.success`, args: [amount, list.length] });
    return list.length;
  };
  const xpNode = literal<S>('experience').require(op(2))
    .then(literal<S>('add').then(argument<S, ServerPlayer[]>('targets', players).then(argument<S, number>('amount', integer()).run((c) => xpAdd(c, false))
      .then(literal<S>('points').run((c) => xpAdd(c, false))).then(literal<S>('levels').run((c) => xpAdd(c, true))))))
    .then(literal<S>('set').then(argument<S, ServerPlayer[]>('targets', players).then(argument<S, number>('amount', integer(0)).run((c) => xpSet(c, false))
      .then(literal<S>('points').run((c) => xpSet(c, false))).then(literal<S>('levels').run((c) => xpSet(c, true))))))
    .then(literal<S>('query').then(argument<S, ServerPlayer>('target', player)
      .then(literal<S>('points').run((c) => { const x = c.get<ServerPlayer>('target').entity.xp!; const v = Math.floor(x.progress * xpNeeded(x.level)); feedback(c.source, { key: 'commands.experience.query.points', args: [c.get<ServerPlayer>('target').name, v] }); return v; }))
      .then(literal<S>('levels').run((c) => { const v = c.get<ServerPlayer>('target').entity.xp!.level; feedback(c.source, { key: 'commands.experience.query.levels', args: [c.get<ServerPlayer>('target').name, v] }); return v; }))));
  d.register(xpNode);
  d.alias('xp', 'experience');

  // ---- gamerule --------------------------------------------------------------------------------
  const gr = literal<S>('gamerule').require(op(2));
  for (const [name, def] of Object.entries(DEFAULT_RULES)) {
    const node = literal<S>(name).run((c) => {
      const v = server.rules.get(name);
      feedback(c.source, { key: 'commands.gamerule.query', args: [name, String(v)] });
      return typeof v === 'number' ? v : v ? 1 : 0;
    });
    node.then(argument<S, number | boolean>('value', typeof def === 'number' ? integer() : bool).run((c) => {
      const v = c.get<number | boolean>('value');
      server.rules.set(name, v);
      if (name === 'doDaylightCycle') server.broadcast({ type: 'time', gameTime: server.gameTime, dayTime: server.dayTime, doCycle: !!v });
      server.broadcast({ type: 'gameEvent', event: `rule:${name}`, value: typeof v === 'number' ? v : v ? 1 : 0 });
      feedback(c.source, { key: 'commands.gamerule.set', args: [name, String(v)] });
      return typeof v === 'number' ? v : v ? 1 : 0;
    }));
    gr.then(node);
  }
  d.register(gr);

  // ---- seed, list, say, me, msg ----------------------------------------------------------------
  d.register(literal<S>('seed').require((s) => s.permission >= 2 || server.singleplayer).run((c) => {
    feedback(c.source, { key: 'commands.seed.success', args: [String(server.info.seed)] });
    return 1;
  }));
  d.register(literal<S>('list').run((c) => {
    const names = server.players.map((p) => p.name);
    c.source.send({ key: 'commands.list.players', args: [names.length, server.singleplayer ? 1 : 20, names.join(', ')] });
    return names.length;
  }));
  d.register(literal<S>('say').require(op(2)).then(argument<S, string>('message', greedy).run((c) => {
    server.broadcast({ type: 'chat', kind: 'system', text: { key: 'chat.type.announcement', args: [c.source.name, c.get<string>('message')] }, sender: '' });
    return 1;
  })));
  d.register(literal<S>('me').then(argument<S, string>('action', greedy).run((c) => {
    server.broadcast({ type: 'chat', kind: 'system', text: { key: 'chat.type.emote', args: [c.source.name, c.get<string>('action')] }, sender: '' });
    return 1;
  })));
  const msg = literal<S>('msg').then(argument<S, ServerPlayer[]>('targets', players).then(argument<S, string>('message', greedy).run((c) => {
    const text = c.get<string>('message');
    for (const p of c.get<ServerPlayer[]>('targets')) {
      p.send({ type: 'chat', kind: 'system', text: { key: 'commands.message.display.incoming', args: [c.source.name, text], color: 'gray', italic: true }, sender: '' });
      c.source.send({ key: 'commands.message.display.outgoing', args: [p.name, text], color: 'gray', italic: true });
    }
    return c.get<ServerPlayer[]>('targets').length;
  })));
  d.register(msg);
  d.alias('tell', 'msg');
  d.alias('w', 'msg');

  // ---- spawnpoint, setworldspawn -----------------------------------------------------------------
  const spawnpoint = (c: CommandContext<S>, targets: ServerPlayer[], pos: [number, number, number], angle: number) => {
    for (const p of targets) p.ext['spawnPoint'] = { x: pos[0], y: pos[1], z: pos[2], dim: c.source.level.dimId, angle, forced: true };
    feedback(c.source, targets.length === 1
      ? { key: 'commands.spawnpoint.success.single', args: [pos[0], pos[1], pos[2], angle, c.source.level.dimId, targets[0]!.name] }
      : { key: 'commands.spawnpoint.success.multiple', args: [pos[0], pos[1], pos[2], angle, c.source.level.dimId, targets.length] });
    return targets.length;
  };
  const here = (s: S): [number, number, number] => [Math.floor(s.x), Math.floor(s.y), Math.floor(s.z)];
  d.register(literal<S>('spawnpoint').require(op(2))
    .run((c) => { if (!c.source.player) fail('permissions.requires.player'); return spawnpoint(c, [c.source.player], here(c.source), 0); })
    .then(argument<S, ServerPlayer[]>('targets', players).run((c) => spawnpoint(c, c.get('targets'), here(c.source), 0))
      .then(argument<S, [number, number, number]>('pos', blockPos).run((c) => spawnpoint(c, c.get('targets'), c.get('pos'), 0))
        .then(argument<S, number>('angle', float(-180, 180)).run((c) => spawnpoint(c, c.get('targets'), c.get('pos'), c.get('angle')))))));
  const setWorldSpawn = (c: CommandContext<S>, pos: [number, number, number], angle: number) => {
    server.info.spawn = { x: pos[0], y: pos[1], z: pos[2] };
    server.broadcast({ type: 'spawnPosition', x: pos[0], y: pos[1], z: pos[2], angle });
    feedback(c.source, { key: 'commands.setworldspawn.success', args: [pos[0], pos[1], pos[2], angle] });
    return 1;
  };
  d.register(literal<S>('setworldspawn').require(op(2))
    .run((c) => setWorldSpawn(c, here(c.source), 0))
    .then(argument<S, [number, number, number]>('pos', blockPos).run((c) => setWorldSpawn(c, c.get('pos'), 0))
      .then(argument<S, number>('angle', float(-180, 180)).run((c) => setWorldSpawn(c, c.get('pos'), c.get('angle'))))));

  // ---- setblock / fill / clone ---------------------------------------------------------------------
  const inWorld = (s: S, x: number, y: number, z: number) => y >= s.level.minY && y < s.level.maxY && s.level.isLoaded(x, z);
  const place = (s: S, x: number, y: number, z: number, st: number, mode: 'replace' | 'destroy' | 'keep'): boolean => {
    const cur = s.level.getBlockState(x, y, z);
    if (mode === 'keep' && !(stateFlags[cur]! & F.AIR)) return false;
    if (cur === st) return false;
    if (mode === 'destroy' && !(stateFlags[cur]! & F.AIR)) {
      s.level.destroyBlock(x, y, z, true);
      if (stateFlags[st]! & F.AIR) return true;
    }
    s.level.removeBlockEntity(x, y, z);
    return s.level.setBlock(x, y, z, st, 3);
  };
  const setblock = (c: CommandContext<S>, mode: 'replace' | 'destroy' | 'keep') => {
    const [x, y, z] = c.get<[number, number, number]>('pos');
    if (!inWorld(c.source, x, y, z)) fail('argument.pos.outofworld');
    if (!place(c.source, x, y, z, c.get('block'), mode)) fail('commands.setblock.failed');
    feedback(c.source, { key: 'commands.setblock.success', args: [x, y, z] });
    return 1;
  };
  d.register(literal<S>('setblock').require(op(2)).then(argument<S, [number, number, number]>('pos', blockPos).then(argument<S, number>('block', blockState)
    .run((c) => setblock(c, 'replace'))
    .then(literal<S>('replace').run((c) => setblock(c, 'replace')))
    .then(literal<S>('destroy').run((c) => setblock(c, 'destroy')))
    .then(literal<S>('keep').run((c) => setblock(c, 'keep'))))));

  const limit = () => Number(server.rules.get('commandModificationBlockLimit')) || 32768;
  const box = (a: [number, number, number], b: [number, number, number]) => ({
    x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), z0: Math.min(a[2], b[2]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), z1: Math.max(a[2], b[2]),
  });
  const fill = (c: CommandContext<S>, mode: 'replace' | 'destroy' | 'keep' | 'hollow' | 'outline', filter: number | null) => {
    const b = box(c.get('from'), c.get('to'));
    const vol = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * (b.z1 - b.z0 + 1);
    if (vol > limit()) fail('commands.fill.toobig', limit(), vol);
    for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) if (!c.source.level.isLoaded(x, z)) fail('argument.pos.unloaded');
    const st = c.get<number>('block');
    const air = BLOCK_BY_NAME.get('air')!.defaultState;
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
      if (y < c.source.level.minY || y >= c.source.level.maxY) continue;
      const edge = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1 || z === b.z0 || z === b.z1;
      if (filter !== null && blockOf(c.source.level.getBlockState(x, y, z)) !== blockOf(filter)) continue;
      if ((mode === 'hollow' || mode === 'outline') && !edge) {
        if (mode === 'hollow' && place(c.source, x, y, z, air, 'replace')) n++;
        continue;
      }
      if (place(c.source, x, y, z, st, mode === 'hollow' || mode === 'outline' ? 'replace' : mode)) n++;
    }
    if (n === 0) fail('commands.fill.failed');
    feedback(c.source, { key: 'commands.fill.success', args: [n] });
    return n;
  };
  d.register(literal<S>('fill').require(op(2)).then(argument<S, [number, number, number]>('from', blockPos).then(argument<S, [number, number, number]>('to', blockPos).then(argument<S, number>('block', blockState)
    .run((c) => fill(c, 'replace', null))
    .then(literal<S>('replace').run((c) => fill(c, 'replace', null)).then(argument<S, number>('filter', blockState).run((c) => fill(c, 'replace', c.get('filter')))))
    .then(literal<S>('destroy').run((c) => fill(c, 'destroy', null)))
    .then(literal<S>('keep').run((c) => fill(c, 'keep', null)))
    .then(literal<S>('hollow').run((c) => fill(c, 'hollow', null)))
    .then(literal<S>('outline').run((c) => fill(c, 'outline', null)))))));

  const clone = (c: CommandContext<S>, mask: 'replace' | 'masked', move: boolean) => {
    const b = box(c.get('begin'), c.get('end'));
    const [dx, dy, dz] = c.get<[number, number, number]>('destination');
    const vol = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * (b.z1 - b.z0 + 1);
    if (vol > limit()) fail('commands.clone.toobig', limit(), vol);
    const lvl = c.source.level;
    const blocks: Array<[number, number, number, number, ReturnType<typeof lvl.getBlockEntity>]> = [];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
      const st = lvl.getBlockState(x, y, z);
      if (mask === 'masked' && (stateFlags[st]! & F.AIR)) continue;
      const be = lvl.getBlockEntity(x, y, z);
      blocks.push([x - b.x0, y - b.y0, z - b.z0, st, be ? JSON.parse(JSON.stringify(be)) : undefined]);
    }
    const air = BLOCK_BY_NAME.get('air')!.defaultState;
    if (move) for (const [ox, oy, oz] of blocks) { lvl.removeBlockEntity(b.x0 + ox, b.y0 + oy, b.z0 + oz); lvl.setBlock(b.x0 + ox, b.y0 + oy, b.z0 + oz, air, 2 | 16); }
    let n = 0;
    for (const [ox, oy, oz, st, be] of blocks) {
      const x = dx + ox, y = dy + oy, z = dz + oz;
      lvl.removeBlockEntity(x, y, z);
      if (lvl.setBlock(x, y, z, st, 2 | 16)) n++;
      if (be) lvl.setBlockEntity({ ...be, x, y, z });
    }
    for (const [ox, oy, oz, st] of blocks) lvl.updateNeighborsAt(dx + ox, dy + oy, dz + oz, blockOf(st));
    if (n === 0) fail('commands.clone.failed');
    feedback(c.source, { key: 'commands.clone.success', args: [n] });
    return n;
  };
  d.register(literal<S>('clone').require(op(2)).then(argument<S, [number, number, number]>('begin', blockPos).then(argument<S, [number, number, number]>('end', blockPos).then(argument<S, [number, number, number]>('destination', blockPos)
    .run((c) => clone(c, 'replace', false))
    .then(literal<S>('replace').run((c) => clone(c, 'replace', false)).then(literal<S>('move').run((c) => clone(c, 'replace', true))).then(literal<S>('normal').run((c) => clone(c, 'replace', false))))
    .then(literal<S>('masked').run((c) => clone(c, 'masked', false)).then(literal<S>('move').run((c) => clone(c, 'masked', true))).then(literal<S>('normal').run((c) => clone(c, 'masked', false))))))));

  // ---- recipe ----------------------------------------------------------------------------------
  d.register(literal<S>('recipe').require(op(2)).then(literal<S>('give').then(argument<S, ServerPlayer[]>('targets', players).then(literal<S>('*').run((c) => {
    for (const p of c.get<ServerPlayer[]>('targets')) unlockAllRecipes(p);
    feedback(c.source, { key: 'commands.recipe.give.success', args: [c.get<ServerPlayer[]>('targets').length] });
    return 1;
  })))));

  // ---- title -----------------------------------------------------------------------------------
  const title = (kind: string) => argument<S, string>('text', greedy).run((c) => {
    const text = parseTextArg(c.get<string>('text'));
    for (const p of c.get<ServerPlayer[]>('targets')) p.send({ type: 'title', kind, text, fadeIn: 10, stay: 70, fadeOut: 20 });
    feedback(c.source, { key: `commands.title.show.${kind}`, args: [c.get<ServerPlayer[]>('targets').length] });
    return 1;
  });
  d.register(literal<S>('title').require(op(2)).then(argument<S, ServerPlayer[]>('targets', players)
    .then(literal<S>('title').then(title('title')))
    .then(literal<S>('subtitle').then(title('subtitle')))
    .then(literal<S>('actionbar').then(title('actionbar')))
    .then(literal<S>('clear').run((c) => { for (const p of c.get<ServerPlayer[]>('targets')) p.send({ type: 'title', kind: 'clear', text: {}, fadeIn: 0, stay: 0, fadeOut: 0 }); return 1; }))
    .then(literal<S>('reset').run((c) => { for (const p of c.get<ServerPlayer[]>('targets')) p.send({ type: 'title', kind: 'reset', text: {}, fadeIn: 10, stay: 70, fadeOut: 20 }); return 1; }))
    .then(literal<S>('times').then(argument<S, number>('fadeIn', integer(0)).then(argument<S, number>('stay', integer(0)).then(argument<S, number>('fadeOut', integer(0)).run((c) => {
      for (const p of c.get<ServerPlayer[]>('targets')) p.send({ type: 'title', kind: 'times', text: {}, fadeIn: c.get('fadeIn'), stay: c.get('stay'), fadeOut: c.get('fadeOut') });
      return 1;
    })))))));

  // ---- tag -------------------------------------------------------------------------------------
  d.register(literal<S>('tag').require(op(2)).then(argument<S, Entity[]>('targets', entities)
    .then(literal<S>('add').then(argument<S, string>('name', word()).run((c) => {
      let n = 0;
      for (const e of c.get<Entity[]>('targets')) { const t = entityTags(e); if (!t.has(c.get('name'))) { t.add(c.get('name')); n++; } }
      if (!n) fail('commands.tag.add.failed');
      feedback(c.source, { key: 'commands.tag.add.success', args: [c.get<string>('name'), n] });
      return n;
    })))
    .then(literal<S>('remove').then(argument<S, string>('name', word()).run((c) => {
      let n = 0;
      for (const e of c.get<Entity[]>('targets')) if (entityTags(e).delete(c.get('name'))) n++;
      if (!n) fail('commands.tag.remove.failed');
      feedback(c.source, { key: 'commands.tag.remove.success', args: [c.get<string>('name'), n] });
      return n;
    })))
    .then(literal<S>('list').run((c) => {
      const tags = new Set<string>();
      for (const e of c.get<Entity[]>('targets')) for (const t of entityTags(e)) tags.add(t);
      feedback(c.source, { key: 'commands.tag.list', args: [c.get<Entity[]>('targets').length, tags.size, [...tags].join(', ')] });
      return tags.size;
    }))));
}

/** Text argument: JSON text component or plain text. */
export function parseTextArg(s: string): Record<string, unknown> {
  const trimmed = s.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const v = JSON.parse(trimmed) as unknown;
      if (typeof v === 'string') return { text: v };
      if (v && typeof v === 'object') return v as Record<string, unknown>;
    } catch { /* plain text */ }
  }
  return { text: s };
}

COMMAND_REGISTRARS.push(registerCore);
