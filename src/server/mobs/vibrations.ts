/**
 * Vibrations: game events that echo listeners (the echo warden, shriekers and, later, sensors)
 * can perceive, with the reference frequencies. Movement emits step, swim and landing events;
 * sneaking entities move silently and wool dampens what happens on it.
 */
import type { Entity } from '../../common/entity/ecs';
import { blockOf, blockHasTag } from '../../common/block/registry';
import type { ServerLevel } from '../level';

/** Vibration frequency per game event (1 = faint steps … 15 = death and explosions). */
export const VIBRATION_FREQ: Record<string, number> = {
  step: 1, swim: 1, flap: 2, projectile_land: 2, hit_ground: 2, splash: 3, item_interact_finish: 3, projectile_shoot: 4,
  instrument_play: 4, elytra_glide: 5, equip: 5, unequip: 5, entity_dismount: 6, entity_mount: 6, entity_interact: 6, shear: 6,
  entity_damage: 7, drink: 8, eat: 8, container_close: 9, block_close: 9, block_deactivate: 9, block_detach: 9,
  container_open: 10, block_open: 10, block_activate: 10, block_attach: 10, prime_fuse: 10, note_block_play: 10,
  block_change: 11, block_destroy: 12, fluid_pickup: 12, block_place: 13, fluid_place: 13, entity_place: 14,
  lightning_strike: 14, teleport: 14, entity_die: 15, explode: 15,
};

export interface Vibration {
  type: string;
  x: number;
  y: number;
  z: number;
  source: Entity | null;
  frequency: number;
}

type Listener = (level: ServerLevel, v: Vibration) => void;
const listeners: Listener[] = [];

export function addVibrationListener(fn: Listener): void {
  listeners.push(fn);
}

/** Events on wool or wool carpets, or from sneaking entities' movement, make no vibration. */
function dampened(level: ServerLevel, type: string, x: number, y: number, z: number, source: Entity | null): boolean {
  if ((type === 'step' || type === 'hit_ground' || type === 'swim' || type === 'flap') && source?.input?.sneaking) return true;
  const b = blockOf(level.getBlockState(Math.floor(x), Math.floor(y) - 1, Math.floor(z)));
  const at = blockOf(level.getBlockState(Math.floor(x), Math.floor(y), Math.floor(z)));
  return (type === 'step' || type === 'hit_ground') && (blockHasTag(b, 'wool') || blockHasTag(at, 'wool_carpets') || b.name.endsWith('_wool') || at.name.endsWith('_carpet'));
}

export function dispatchVibration(level: ServerLevel, type: string, x: number, y: number, z: number, source: Entity | null): void {
  const f = VIBRATION_FREQ[type];
  if (!f || !listeners.length) return;
  if (source?.player?.gameMode === 'spectator') return;
  if (dampened(level, type, x, y, z, source)) return;
  const v: Vibration = { type, x, y, z, source, frequency: f };
  for (const l of listeners) l(level, v);
}

/** Step / swim / landing events from walking entities (reference Entity.move step bookkeeping). */
export function trackMovementVibrations(level: ServerLevel, e: Entity): void {
  const t = e.transform, p = e.physics;
  if (!t || !p) return;
  const dx = t.x - (e['vibLastX'] as number | undefined ?? t.x), dz = t.z - (e['vibLastZ'] as number | undefined ?? t.z);
  e['vibLastX'] = t.x;
  e['vibLastZ'] = t.z;
  const walked = (e['vibWalk'] as number | undefined ?? 0) + Math.sqrt(dx * dx + dz * dz);
  e['vibWalk'] = walked;
  const next = (e['vibNextStep'] as number | undefined) ?? 1;
  if (walked > next) {
    e['vibNextStep'] = walked + 1;
    if (p.inWater) dispatchVibration(level, 'swim', t.x, t.y, t.z, e);
    else if (p.onGround) dispatchVibration(level, 'step', t.x, t.y, t.z, e);
  }
  const wasOnGround = e['vibOnGround'] as boolean | undefined;
  if (p.onGround && wasOnGround === false && (e['vibFall'] as number | undefined ?? 0) > 0.5) dispatchVibration(level, 'hit_ground', t.x, t.y, t.z, e);
  e['vibOnGround'] = p.onGround;
  e['vibFall'] = p.fallDistance;
}
