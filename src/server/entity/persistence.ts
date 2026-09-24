/**
 * Entity persistence: entities are stored in the chunk they stand in (chunk.extra.entities) when
 * the chunk unloads or autosaves, and recreated when it loads. Each type registers a codec.
 */
import type { Entity } from '../../common/entity/ecs';
import type { Chunk } from '../../common/world/chunk';
import type { ServerLevel } from '../level';

export interface SavedEntity {
  type: string;
  pos: [number, number, number];
  rot: [number, number];
  vel: [number, number, number];
  fire?: number;
  air?: number;
  fall?: number;
  name?: string;
  tags?: string[];
  data: Record<string, unknown>;
}

export interface EntityCodec {
  /** Type-specific state (health, variant, inventory…). */
  save(e: Entity): Record<string, unknown>;
  /** Recreate the entity (not yet added to the level). */
  load(level: ServerLevel, s: SavedEntity): Entity | null;
}

export const ENTITY_CODECS = new Map<string, EntityCodec>();

export function saveEntity(e: Entity): SavedEntity | null {
  const codec = ENTITY_CODECS.get(e.type);
  if (!codec || !e.transform || e.player) return null;
  const t = e.transform, p = e.physics;
  const tags = e['tags'] as Set<string> | undefined;
  return {
    type: e.type,
    pos: [t.x, t.y, t.z],
    rot: [t.yaw, t.pitch],
    vel: p ? [p.vx, p.vy, p.vz] : [0, 0, 0],
    fire: p?.fireTicks || undefined,
    air: p && p.air !== p.maxAir ? p.air : undefined,
    fall: p?.fallDistance || undefined,
    name: e['customName'] as string | undefined,
    tags: tags && tags.size ? [...tags] : undefined,
    data: codec.save(e),
  };
}

export function loadEntity(level: ServerLevel, s: SavedEntity): Entity | null {
  const codec = ENTITY_CODECS.get(s.type);
  if (!codec) return null;
  const e = codec.load(level, s);
  if (!e) return null;
  const t = e.transform!;
  t.x = t.px = s.pos[0]; t.y = t.py = s.pos[1]; t.z = t.pz = s.pos[2];
  t.yaw = t.pyaw = t.headYaw = t.bodyYaw = s.rot[0]; t.pitch = t.ppitch = s.rot[1];
  if (e.physics) {
    e.physics.vx = s.vel[0]; e.physics.vy = s.vel[1]; e.physics.vz = s.vel[2];
    if (s.fire) e.physics.fireTicks = s.fire;
    if (s.air !== undefined) e.physics.air = s.air;
    if (s.fall) e.physics.fallDistance = s.fall;
  }
  if (s.name) e['customName'] = s.name;
  if (s.tags) e['tags'] = new Set(s.tags);
  return e;
}

function inChunk(e: Entity, c: Chunk): boolean {
  const t = e.transform;
  return !!t && Math.floor(t.x) >> 4 === c.x && Math.floor(t.z) >> 4 === c.z;
}

/** Serialise entities standing in the chunk; `remove` also takes them out of the level. */
export function storeChunkEntities(level: ServerLevel, c: Chunk, remove: boolean): void {
  const list: SavedEntity[] = [];
  const victims: Entity[] = [];
  for (const e of level.entities.all()) {
    if (e.removed || e.player || !inChunk(e, c)) continue;
    if (e['noSave'] === true) {
      if (remove) victims.push(e);
      continue;
    }
    const s = saveEntity(e);
    if (s) list.push(s);
    if (remove) victims.push(e);
  }
  const had = Array.isArray(c.extra['entities']) && (c.extra['entities'] as unknown[]).length > 0;
  if (list.length) c.extra['entities'] = list;
  else delete c.extra['entities'];
  if (list.length || had) c.dirty = true;
  for (const e of victims) level.entities.remove(e);
}

/** Recreate stored and world-generation entities of a freshly loaded chunk. */
export function restoreChunkEntities(level: ServerLevel, c: Chunk): void {
  const saved = c.extra['entities'] as SavedEntity[] | undefined;
  if (saved) {
    for (const s of saved) {
      const e = loadEntity(level, s);
      if (e) level.addFreshEntity(e);
    }
    delete c.extra['entities'];
  }
  const pending = c.extra['pendingEntities'] as Array<{ type: string; x: number; y: number; z: number; data: Record<string, unknown> }> | undefined;
  if (pending) {
    for (const p of pending) level.createEntity(p.type, p.x, p.y, p.z, { ...p.data, worldgen: true });
    delete c.extra['pendingEntities'];
    c.dirty = true;
  }
}
