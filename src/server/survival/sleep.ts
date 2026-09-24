/**
 * Beds: respawn point, sleeping through the night (with the sleeping-percentage rule), waking up,
 * monsters-nearby and daytime checks, beds exploding outside the overworld.
 */
import { blockOf, getValue, setValue, stateFlags, F } from '../../common/block/registry';
import { P } from '../../common/block/properties';
import { DX, DZ, OPPOSITE, Direction } from '../../common/world/direction';
import { AABB } from '../../common/math/geom';
import type { ServerLevel } from '../level';
import type { ServerPlayer } from '../player';
import type { StrataServer } from '../server';

export interface SleepState {
  x: number;
  y: number;
  z: number;
  ticks: number;
}

function msg(p: ServerPlayer, key: string, args: Array<string | number> = [], actionbar = true): void {
  if (actionbar) p.send({ type: 'title', kind: 'actionbar', text: { key, args }, fadeIn: 0, stay: 40, fadeOut: 10 });
  else p.send({ type: 'chat', kind: 'system', text: { key, args }, sender: '' });
}

export function sleepingOf(p: ServerPlayer): SleepState | undefined {
  return p.ext['sleeping'] as SleepState | undefined;
}

/** Can players sleep now (night or thunderstorm). */
export function canSleepNow(level: ServerLevel): boolean {
  const t = level.getDayTime() % 24000;
  return (t >= 12542 && t <= 23459) || level.isThundering();
}

/** Right click on a bed block (x,y,z of the clicked half). */
export function useBed(level: ServerLevel, p: ServerPlayer, x: number, y: number, z: number): void {
  let state = level.getBlockState(x, y, z);
  const b = blockOf(state);
  if (!b.name.endsWith('_bed')) return;
  // Always operate on the head half
  if (getValue(state, P.bedPart) === 'foot') {
    const f = getValue(state, P.facing) as Direction;
    x += DX[f]!; z += DZ[f]!;
    state = level.getBlockState(x, y, z);
    if (blockOf(state) !== b) return;
  }
  if (!level.dim.bedWorks) {
    level.setBlock(x, y, z, 0, 3);
    level.explode(null, x + 0.5, y + 0.5, z + 0.5, 5, true, 'block');
    return;
  }
  if (getValue(state, P.occupied)) {
    msg(p, 'bed.occupied');
    return;
  }
  const t = p.entity.transform;
  if (Math.abs(t.x - (x + 0.5)) > 3 || Math.abs(t.z - (z + 0.5)) > 3 || Math.abs(t.y - y) > 2) {
    msg(p, 'bed.tooFar');
    return;
  }
  if (stateFlags[level.getBlockState(x, y + 1, z)]! & F.SOLID) {
    msg(p, 'bed.obstructed');
    return;
  }
  // Setting the spawn point happens even when sleeping is not possible
  const sp = p.ext['spawnPoint'] as { x: number; y: number; z: number; dim: string } | undefined;
  if (!sp || sp.x !== x || sp.y !== y || sp.z !== z || sp.dim !== level.dimId) {
    p.ext['spawnPoint'] = { x, y, z, dim: level.dimId, angle: t.yaw, forced: false };
    msg(p, 'bed.spawnSet', [], false);
  }
  if (!canSleepNow(level)) {
    msg(p, 'bed.noSleep');
    return;
  }
  if (p.data.gameMode !== 'creative' && monstersNearby(level, x, y, z)) {
    msg(p, 'bed.notSafe');
    return;
  }
  startSleeping(level, p, x, y, z, state);
}

/** Hostile mobs within 8 blocks horizontally and 5 vertically (mobs set `hostile`). */
function monstersNearby(level: ServerLevel, x: number, y: number, z: number): boolean {
  const box = new AABB(x - 8, y - 5, z - 8, x + 9, y + 6, z + 9);
  return level.getEntities(box, (e) => e['hostile'] === true && !e.living?.dead).length > 0;
}

function setOccupied(level: ServerLevel, x: number, y: number, z: number, occupied: boolean): void {
  const head = level.getBlockState(x, y, z);
  if (!blockOf(head).name.endsWith('_bed')) return;
  level.setBlock(x, y, z, setValue(head, P.occupied, occupied), 3);
  const f = OPPOSITE[getValue(head, P.facing) as Direction]!;
  const foot = level.getBlockState(x + DX[f]!, y, z + DZ[f]!);
  if (blockOf(foot) === blockOf(head)) level.setBlock(x + DX[f]!, y, z + DZ[f]!, setValue(foot, P.occupied, occupied), 3);
}

function startSleeping(level: ServerLevel, p: ServerPlayer, x: number, y: number, z: number, head: number): void {
  p.ext['sleeping'] = { x, y, z, ticks: 0 } satisfies SleepState;
  p.ext['timeSinceRest'] = 0;
  p.frozen = true;
  setOccupied(level, x, y, z, true);
  const facing = getValue(head, P.facing) as Direction;
  const yaw = [0, 0, 180, 0, 90, 270][facing]!;
  p.teleport(x + 0.5, y + 0.6875, z + 0.5, yaw, 0);
  const e = p.entity;
  e.meta ??= {};
  e.meta['sleeping'] = true;
  e.meta['bedFacing'] = facing;
  if (e.net) e.net.metaDirty = true;
  p.send({ type: 'gameEvent', event: 'sleep', value: facing });
  p.entity.physics.height = 0.2;
  p.entity.physics.eyeHeight = 0.2;
}

/** Wake a sleeping player (next to the bed). */
export function wakeUp(level: ServerLevel, p: ServerPlayer): void {
  const s = sleepingOf(p);
  if (!s) return;
  delete p.ext['sleeping'];
  p.frozen = false;
  setOccupied(level, s.x, s.y, s.z, false);
  const e = p.entity;
  if (e.meta) { e.meta['sleeping'] = false; if (e.net) e.net.metaDirty = true; }
  e.physics.height = 1.8;
  e.physics.eyeHeight = 1.62;
  // Stand on a free spot around the bed
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
    const bx = s.x + dx, bz = s.z + dz;
    for (const by of [s.y, s.y + 1]) {
      const feet = level.getBlockState(bx, by, bz), headSt = level.getBlockState(bx, by + 1, bz);
      if (stateFlags[feet]! & F.SOLID || stateFlags[headSt]! & F.SOLID) continue;
      const below = level.getBlockState(bx, by - 1, bz);
      if (!(stateFlags[below]! & F.SOLID) && !blockOf(below).name.endsWith('_bed')) continue;
      const yOff = blockOf(below).name.endsWith('_bed') ? 0.5625 - 1 : 0;
      p.teleport(bx + 0.5, by + yOff, bz + 0.5);
      p.send({ type: 'gameEvent', event: 'wake', value: 0 });
      return;
    }
  }
  p.teleport(s.x + 0.5, s.y + 0.6, s.z + 0.5);
  p.send({ type: 'gameEvent', event: 'wake', value: 0 });
}

/** Per server tick: count sleepers, skip the night when enough players slept 100 ticks. */
export function tickSleep(server: StrataServer): void {
  const level = server.overworld;
  const players = level.players.filter((p) => p.joined && p.data.gameMode !== 'spectator');
  let sleeping = 0, deep = 0;
  for (const p of level.players) {
    p.ext['timeSinceRest'] = ((p.ext['timeSinceRest'] as number | undefined) ?? 0) + (p.entity.living?.dead ? 0 : 1);
    const s = sleepingOf(p);
    if (!s) continue;
    s.ticks++;
    sleeping++;
    if (s.ticks >= 100) deep++;
    // The bed may have been destroyed or it became day
    const st = level.getBlockState(s.x, s.y, s.z);
    if (!blockOf(st).name.endsWith('_bed') || (!canSleepNow(level) && s.ticks > 1)) wakeUp(level, p);
  }
  for (const other of server.levels.values()) if (other !== level) for (const p of other.players) if (sleepingOf(p)) wakeUp(other, p);
  if (sleeping === 0 || players.length === 0) return;
  const pct = Number(server.rules.get('playersSleepingPercentage'));
  const needed = Math.max(1, Math.ceil((players.length * Math.max(0, pct)) / 100));
  if (players.length > 1 && server.gameTime % 20 === 0) {
    for (const p of players) msg(p, 'sleep.players', [sleeping, needed]);
  }
  if (pct <= 100 && deep >= needed) {
    if (server.rules.get('doDaylightCycle') !== false) {
      server.dayTime += 24000 - (server.dayTime % 24000);
      server.broadcast({ type: 'time', gameTime: server.gameTime, dayTime: server.dayTime, doCycle: !!server.rules.get('doDaylightCycle') });
    }
    if (server.rules.get('doWeatherCycle') !== false && (server.weather.raining || server.weather.thundering)) server.setWeather('clear', 12000 + Math.floor(Math.random() * 168000));
    for (const p of [...level.players]) wakeUp(level, p);
  }
}
