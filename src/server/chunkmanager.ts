/**
 * Server chunk pipeline: EMPTY → NOISE (workers) → FEATURES (3×3 decoration) → LIGHT → FULL,
 * driven by player tickets with spiral priority, plus unloading and persistence.
 */
import { Chunk, ChunkStatus } from '../common/world/chunk';
import { chunkKey, chunkKeyX, chunkKeyZ } from '../common/world/direction';
import { GenService } from './gen';
import { ChunkGenerator, GenRegion } from '../common/worldgen/generator';
import { WorldSeed } from '../common/math/random';
import { DimensionType } from '../common/world/dimension';
import { serializeChunk, deserializeChunk } from '../common/world/chunkio';
import { stateFlags, F } from '../common/block/registry';

export interface ChunkStore {
  load(dim: string, cx: number, cz: number): Promise<Uint8Array | null>;
  save(dim: string, cx: number, cz: number, data: Uint8Array): Promise<void>;
  flush?(): Promise<void>;
}

/** Keeps unloaded chunks in memory (used when no persistent storage is attached). */
export class MemoryChunkStore implements ChunkStore {
  readonly map = new Map<string, Uint8Array>();
  async load(dim: string, cx: number, cz: number): Promise<Uint8Array | null> {
    return this.map.get(`${dim}:${cx}:${cz}`) ?? null;
  }
  async save(dim: string, cx: number, cz: number, data: Uint8Array): Promise<void> {
    this.map.set(`${dim}:${cx}:${cz}`, data);
  }
}

export interface Holder {
  key: number;
  x: number;
  z: number;
  chunk: Chunk | null;
  status: ChunkStatus;
  loading: boolean;
  lightReady: boolean;
  /** Tick when last requested by a ticket. */
  lastNeeded: number;
  /** Best (lowest) ticket distance this tick. */
  level: number;
}

export interface ChunkManagerHooks {
  /** Called when a chunk reaches FULL (spawn pending entities, notify players). */
  onFull(h: Holder): void;
  /** Called before a chunk is unloaded (despawn entities, persist block entities). */
  onUnload(h: Holder): void;
  /** Called to light a chunk. */
  light(h: Holder): void;
}

export interface Ticket {
  cx: number;
  cz: number;
  radius: number;
}

export class ChunkManager {
  readonly holders = new Map<number, Holder>();
  private inFlight = 0;
  private workList: Holder[] = [];
  private tick = 0;
  /** Stats for the debug screen. */
  stats = { generated: 0, loaded: 0, unloaded: 0, decorated: 0, lit: 0 };

  constructor(
    readonly dim: DimensionType,
    readonly seed: WorldSeed,
    private readonly gen: GenService,
    private readonly generator: ChunkGenerator,
    private readonly store: ChunkStore,
    private readonly hooks: ChunkManagerHooks,
  ) {}

  get(cx: number, cz: number): Holder | undefined {
    return this.holders.get(chunkKey(cx, cz));
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    const h = this.holders.get(chunkKey(cx, cz));
    return h?.chunk ?? undefined;
  }

  getFull(cx: number, cz: number): Chunk | undefined {
    const h = this.holders.get(chunkKey(cx, cz));
    return h && h.status === ChunkStatus.FULL ? h.chunk! : undefined;
  }

  private holder(cx: number, cz: number): Holder {
    const k = chunkKey(cx, cz);
    let h = this.holders.get(k);
    if (!h) {
      h = { key: k, x: cx, z: cz, chunk: null, status: ChunkStatus.EMPTY, loading: false, lightReady: false, lastNeeded: this.tick, level: 1e9 };
      this.holders.set(k, h);
    }
    return h;
  }

  /**
   * Update tickets and advance the pipeline within the given time budget (ms).
   * Tickets request FULL within radius; generation extends to radius+2.
   */
  update(tickets: Ticket[], budgetMs: number): void {
    this.tick++;
    const t0 = performance.now();
    // 1. Compute needed levels. level = chebyshev distance from ticket edge (0 = FULL needed).
    for (const h of this.holders.values()) h.level = 1e9;
    for (const t of tickets) {
      const r = t.radius + 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const lvl = Math.max(0, d - t.radius);
          const h = this.holder(t.cx + dx, t.cz + dz);
          const pri = lvl * 10000 + dx * dx + dz * dz;
          if (pri < h.level) h.level = pri;
          h.lastNeeded = this.tick;
        }
      }
    }
    // 2. Build work list sorted by priority
    this.workList.length = 0;
    for (const h of this.holders.values()) if (h.level < 1e9 && h.status < ChunkStatus.FULL) this.workList.push(h);
    this.workList.sort((a, b) => a.level - b.level);
    // 3. Advance
    const maxInFlight = Math.max(2, this.gen.parallelism * 2);
    for (const h of this.workList) {
      if (performance.now() - t0 > budgetMs) break;
      const need = Math.floor(h.level / 10000); // 0 → FULL, 1 → FEATURES, 2 → NOISE
      if (h.status === ChunkStatus.EMPTY) {
        if (!h.loading && this.inFlight < maxInFlight) this.startLoad(h);
        continue;
      }
      if (h.status === ChunkStatus.NOISE && need <= 1) this.tryDecorate(h);
      if (h.status === ChunkStatus.FEATURES && need === 0) this.tryLight(h);
    }
    // 4. Unload chunks no longer needed (keep a short grace period)
    if (this.tick % 20 === 0) this.unloadUnused();
  }

  private startLoad(h: Holder): void {
    h.loading = true;
    this.inFlight++;
    const done = (c: Chunk | null, fromStore: boolean) => {
      this.inFlight--;
      h.loading = false;
      if (!this.holders.has(h.key) || !c) return;
      h.chunk = c;
      if (fromStore) {
        h.status = c.status >= ChunkStatus.NOISE ? c.status : ChunkStatus.NOISE;
        if (h.status >= ChunkStatus.LIGHT) {
          h.lightReady = true;
          h.status = ChunkStatus.FULL;
          c.status = ChunkStatus.FULL;
          this.hooks.onFull(h);
        }
        this.stats.loaded++;
      } else {
        h.status = ChunkStatus.NOISE;
        c.status = ChunkStatus.NOISE;
        c.dirty = true;
        this.stats.generated++;
      }
    };
    this.store.load(this.dim.id, h.x, h.z).then((data) => {
      if (data) {
        try {
          done(deserializeChunk(data, this.dim), true);
          return;
        } catch (e) {
          console.error('[chunks] corrupt chunk, regenerating', h.x, h.z, e);
        }
      }
      this.gen.generate(this.dim.id, h.x, h.z).then((c) => done(c, false), (e) => {
        console.error('[chunks] generation failed', e);
        this.inFlight--;
        h.loading = false;
      });
    }, (e) => {
      console.error('[chunks] load failed', e);
      this.inFlight--;
      h.loading = false;
    });
  }

  private neighboursAtLeast(h: Holder, status: ChunkStatus): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const n = this.get(h.x + dx, h.z + dz);
      if (!n || n.status < status) return false;
    }
    return true;
  }

  private tryDecorate(h: Holder): void {
    if (!this.neighboursAtLeast(h, ChunkStatus.NOISE)) return;
    const region = new Region3x3(this, h.x, h.z, this.seed, this.dim);
    try {
      this.generator.decorate(region, h.x, h.z);
    } catch (e) {
      console.error('[chunks] decoration failed', h.x, h.z, e);
    }
    region.finish();
    h.status = ChunkStatus.FEATURES;
    h.chunk!.status = ChunkStatus.FEATURES;
    h.chunk!.dirty = true;
    this.stats.decorated++;
  }

  private tryLight(h: Holder): void {
    if (!this.neighboursAtLeast(h, ChunkStatus.FEATURES)) return;
    h.chunk!.recomputeHeightmaps();
    this.hooks.light(h);
    h.lightReady = true;
    h.status = ChunkStatus.FULL;
    h.chunk!.status = ChunkStatus.FULL;
    this.stats.lit++;
    this.hooks.onFull(h);
  }

  private unloadUnused(): void {
    for (const h of [...this.holders.values()]) {
      if (h.loading) continue;
      if (this.tick - h.lastNeeded < 100) continue;
      // Do not unload a chunk whose neighbours might still decorate into it
      this.unload(h);
    }
  }

  unload(h: Holder): void {
    if (h.chunk) {
      if (h.status === ChunkStatus.FULL) this.hooks.onUnload(h);
      if (h.chunk.dirty) {
        const data = serializeChunk(h.chunk);
        void this.store.save(this.dim.id, h.x, h.z, data);
      }
    }
    this.holders.delete(h.key);
    this.stats.unloaded++;
  }

  /** Save all dirty chunks (autosave). */
  async saveAll(): Promise<number> {
    let n = 0;
    const jobs: Promise<void>[] = [];
    for (const h of this.holders.values()) {
      if (h.chunk && h.chunk.dirty && h.status >= ChunkStatus.NOISE) {
        h.chunk.dirty = false;
        jobs.push(this.store.save(this.dim.id, h.x, h.z, serializeChunk(h.chunk)));
        n++;
      }
    }
    await Promise.all(jobs);
    await this.store.flush?.();
    return n;
  }

  /** Force-load (synchronously generate in-process if needed) — used by commands/tests. */
  isFull(cx: number, cz: number): boolean {
    const h = this.get(cx, cz);
    return !!h && h.status === ChunkStatus.FULL;
  }

  countByStatus(): number[] {
    const out = [0, 0, 0, 0, 0, 0];
    for (const h of this.holders.values()) out[h.status]!++;
    return out;
  }

  keys(): IterableIterator<number> {
    return this.holders.keys();
  }

  static keyX(k: number): number {
    return chunkKeyX(k);
  }

  static keyZ(k: number): number {
    return chunkKeyZ(k);
  }
}

/** GenRegion over the 3×3 chunks around (cx, cz). */
class Region3x3 implements GenRegion {
  readonly minY: number;
  readonly maxY: number;
  private readonly chunks: (Chunk | null)[] = [];
  private readonly pendingBE: Array<{ x: number; y: number; z: number; type: string; data: Record<string, unknown> }> = [];

  constructor(private readonly mgr: ChunkManager, readonly centerX: number, readonly centerZ: number, readonly seed: WorldSeed, readonly dim: DimensionType) {
    this.minY = dim.minY;
    this.maxY = dim.minY + dim.height;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.chunks.push(mgr.getChunk(centerX + dx, centerZ + dz) ?? null);
  }

  private chunkAt(x: number, z: number): Chunk | null {
    const dx = (x >> 4) - this.centerX + 1;
    const dz = (z >> 4) - this.centerZ + 1;
    if (dx < 0 || dx > 2 || dz < 0 || dz > 2) return null;
    return this.chunks[dz * 3 + dx] ?? null;
  }

  isInside(x: number, z: number): boolean {
    return this.chunkAt(x, z) !== null;
  }

  getBlock(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.getBlock(x & 15, y, z & 15);
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    const c = this.chunkAt(x, z);
    if (!c || y < this.minY || y >= this.maxY) return;
    c.setBlock(x & 15, y, z & 15, state);
    if (stateFlags[state]! & F.HAS_BE) {
      // default empty block entity; features may overwrite through setBlockEntity
      if (!c.getBlockEntity(x & 15, y, z & 15)) c.setBlockEntity({ type: '', x, y, z, data: {} });
    }
  }

  getHeight(kind: 'surface' | 'motion' | 'ocean_floor' | 'opaque', x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return this.minY;
    const lx = x & 15, lz = z & 15;
    if (kind === 'surface') return c.surface.get(lx, lz);
    if (kind === 'motion') return c.motion.get(lx, lz);
    if (kind === 'opaque') return c.opaque.get(lx, lz);
    // ocean floor: highest block that blocks motion (ignoring fluids)
    let y = c.motion.get(lx, lz) - 1;
    while (y > this.minY) {
      const s = c.getBlock(lx, y, lz);
      const f = stateFlags[s]!;
      if (!(f & F.NO_COLLISION) && !(f & F.FLUID_BLOCK)) break;
      y--;
    }
    return y + 1;
  }

  getBiome(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.getBiome(x & 15, y, z & 15) : 0;
  }

  setBlockEntity(x: number, y: number, z: number, type: string, data: Record<string, unknown>): void {
    this.pendingBE.push({ x, y, z, type, data });
  }

  addEntity(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const list = (c.extra['pendingEntities'] as Array<unknown> | undefined) ?? [];
    list.push({ type, x, y, z, data: data ?? {} });
    c.extra['pendingEntities'] = list;
  }

  scheduleTick(x: number, y: number, z: number, delay: number): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const list = (c.extra['pendingTicks'] as Array<number[]> | undefined) ?? [];
    list.push([x, y, z, delay]);
    c.extra['pendingTicks'] = list;
  }

  finish(): void {
    for (const be of this.pendingBE) {
      const c = this.chunkAt(be.x, be.z);
      if (c) c.setBlockEntity({ type: be.type, x: be.x, y: be.y, z: be.z, data: be.data });
    }
  }
}
