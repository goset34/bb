/** Chunk (de)serialisation for storage (includes status, light and server extras). */
import { Chunk, ChunkStatus } from './chunk';
import { ByteReader, ByteWriter } from '../util/bytes';
import { DimensionType } from './dimension';
import { stateToString, parseState, STATE_COUNT } from '../block/registry';

export const CHUNK_FORMAT_VERSION = 1;

/**
 * Storage format stores a per-chunk palette of state *names* so saves survive registry
 * changes between versions. Numeric ids are remapped on load.
 */
export function serializeChunk(c: Chunk): Uint8Array {
  const w = new ByteWriter(32 * 1024);
  w.u8(CHUNK_FORMAT_VERSION);
  w.u8(c.status);
  w.f64(c.inhabitedTime);
  // Collect used states for the name table
  const used = new Set<number>();
  for (const s of c.sections) {
    if (s.isUniform) used.add(s.uniformState);
    else for (let i = 0; i < 4096; i++) used.add(s.get(i));
  }
  const ids = [...used];
  w.varUint(ids.length);
  for (const id of ids) {
    w.varUint(id);
    w.string(stateToString(id));
  }
  w.json(c.extra);
  c.write(w, true);
  return w.finish();
}

export function deserializeChunk(data: Uint8Array, dim: DimensionType): Chunk {
  const r = new ByteReader(data);
  const version = r.u8();
  if (version !== CHUNK_FORMAT_VERSION) throw new Error('Unsupported chunk format ' + version);
  const status = r.u8() as ChunkStatus;
  const inhabited = r.f64();
  const n = r.varUint();
  const remapTable = new Map<number, number>();
  let identity = true;
  for (let i = 0; i < n; i++) {
    const id = r.varUint();
    const name = r.string();
    const now = parseState(name) ?? 0;
    remapTable.set(id, now);
    if (now !== id) identity = false;
  }
  const extra = r.json<Record<string, unknown>>();
  const remap = identity ? undefined : (s: number) => remapTable.get(s) ?? (s < STATE_COUNT ? s : 0);
  const c = Chunk.read(r, dim, true, remap);
  c.status = status;
  c.inhabitedTime = inhabited;
  c.extra = extra ?? {};
  c.dirty = false;
  return c;
}
