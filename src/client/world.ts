/**
 * ClientLevel: the client's copy of the world (chunks received from the server), used for
 * rendering, prediction and local queries.
 */
import { Chunk } from '../common/world/chunk';
import { DIMENSIONS, DimensionId, DimensionType } from '../common/world/dimension';
import { chunkKey, Direction } from '../common/world/direction';
import { ByteReader } from '../common/util/bytes';
import { blockOf, stateFlags, F } from '../common/block/registry';
import { EntityWorld, Entity } from '../common/entity/ecs';
import type { PhysicsWorld } from '../common/entity/physics';
import type { LevelAccess, PlaceContext } from '../common/world/level';
import { Random } from '../common/math/random';
import { AABB } from '../common/math/geom';
import type { Block } from '../common/block/registry';
import type { BlockEntityData } from '../common/world/chunk';
import type { ItemStack } from '../common/item/stack';

export type SectionListener = (cx: number, sy: number, cz: number) => void;

export class ClientLevel implements PhysicsWorld {
  readonly chunks = new Map<number, Chunk>();
  readonly entities = new EntityWorld();
  dim: DimensionType;
  dimId: DimensionId;
  gameTime = 0;
  dayTime = 0;
  doDaylightCycle = true;
  rain = 0;
  thunder = 0;
  prevRain = 0;
  lightningFlash = 0;
  private readonly listeners: SectionListener[] = [];
  private readonly chunkListeners: Array<(cx: number, cz: number, loaded: boolean) => void> = [];
  readonly random = new Random();

  constructor(dimId: DimensionId) {
    this.dimId = dimId;
    this.dim = DIMENSIONS[dimId];
  }

  get minY(): number {
    return this.dim.minY;
  }

  get maxY(): number {
    return this.dim.minY + this.dim.height;
  }

  onSectionDirty(cb: SectionListener): void {
    this.listeners.push(cb);
  }

  onChunk(cb: (cx: number, cz: number, loaded: boolean) => void): void {
    this.chunkListeners.push(cb);
  }

  private dirty(cx: number, sy: number, cz: number): void {
    for (const l of this.listeners) l(cx, sy, cz);
  }

  /** Mark the section containing (x,y,z) dirty plus neighbours if on a border. */
  private dirtyBlock(x: number, y: number, z: number): void {
    const cx = x >> 4, sy = y >> 4, cz = z >> 4;
    const lx = x & 15, ly = y & 15, lz = z & 15;
    for (let dx = lx === 0 ? -1 : 0; dx <= (lx === 15 ? 1 : 0); dx++) {
      for (let dy = ly === 0 ? -1 : 0; dy <= (ly === 15 ? 1 : 0); dy++) {
        for (let dz = lz === 0 ? -1 : 0; dz <= (lz === 15 ? 1 : 0); dz++) this.dirty(cx + dx, sy + dy, cz + dz);
      }
    }
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getBlockState(x: number, y: number, z: number): number {
    if (y < this.dim.minY || y >= this.dim.minY + this.dim.height) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.getBlock(x & 15, y, z & 15) : 0;
  }

  getLight(x: number, y: number, z: number): number {
    if (y >= this.maxY) return 0xf0;
    if (y < this.minY) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.getLight(x & 15, y, z & 15) : 0xf0;
  }

  getBiome(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.getBiome(x & 15, y, z & 15) : 1;
  }

  // ---- packets ------------------------------------------------------------------------------
  loadChunk(data: Uint8Array): Chunk {
    const c = Chunk.read(new ByteReader(data), this.dim, true);
    const key = chunkKey(c.x, c.z);
    this.chunks.set(key, c);
    for (let i = 0; i < c.sections.length; i++) this.dirty(c.x, i + c.minSection, c.z);
    // neighbours' borders need remeshing
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const n = this.getChunk(c.x + dx, c.z + dz);
      if (n) for (let i = 0; i < n.sections.length; i++) this.dirty(n.x, i + n.minSection, n.z);
    }
    for (const l of this.chunkListeners) l(c.x, c.z, true);
    return c;
  }

  unloadChunk(cx: number, cz: number): void {
    if (!this.chunks.delete(chunkKey(cx, cz))) return;
    for (const l of this.chunkListeners) l(cx, cz, false);
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    if (c.getBlock(x & 15, y, z & 15) === state) return;
    c.setBlock(x & 15, y, z & 15, state);
    this.dirtyBlock(x, y, z);
  }

  applyMultiBlock(cx: number, sy: number, cz: number, entries: Int32Array): void {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const idx = Math.floor(e / 65536), state = e % 65536;
      const x = idx & 15, z = (idx >> 4) & 15, y = (sy << 4) + (idx >> 8);
      c.setBlock(x, y, z, state);
      this.dirtyBlock((cx << 4) + x, y, (cz << 4) + z);
    }
  }

  applyLight(cx: number, sy: number, cz: number, uniform: number, light: Uint8Array): void {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    const sec = c.sections[sy - c.minSection];
    if (!sec) return;
    if (uniform >= 0) sec.fillLight(uniform);
    else sec.light = light.length === 4096 ? light : null;
    // Light changes affect the neighbouring sections' borders too
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) this.dirty(cx + dx, sy + dy, cz + dz);
  }

  setBlockEntity(x: number, y: number, z: number, type: string, data: Record<string, unknown> | null): void {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    if (!type || !data) c.removeBlockEntity(x & 15, y, z & 15);
    else c.setBlockEntity({ type, x, y, z, data });
    this.dirty(x >> 4, y >> 4, z >> 4);
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
    return this.getChunk(x >> 4, z >> 4)?.getBlockEntity(x & 15, y, z & 15);
  }

  clear(): void {
    for (const k of [...this.chunks.keys()]) {
      const c = this.chunks.get(k)!;
      this.unloadChunk(c.x, c.z);
    }
    this.entities.clear();
  }

  // ---- time & sky -------------------------------------------------------------------------
  /** Celestial angle 0..1 (0 = noon? reference: 0 at sunrise+). */
  celestialAngle(partial: number): number {
    const t = this.dim.fixedTime ?? this.dayTime + (this.doDaylightCycle ? partial : 0);
    const d = (t % 24000) / 24000 - 0.25;
    let f = d - Math.floor(d);
    const e = 0.5 - Math.cos(f * Math.PI) / 2;
    f = (f * 2 + e) / 3;
    return f;
  }

  moonPhase(): number {
    return Math.floor(this.dayTime / 24000) % 8;
  }

  /** 0 (night) .. 1 (day) sky brightness factor. */
  daylight(partial: number): number {
    if (!this.dim.hasSkylight) return this.dimId === 'verge' ? 0.3 : 0.1;
    const a = this.celestialAngle(partial);
    let d = 1 - (Math.cos(a * Math.PI * 2) * 2 + 0.2);
    d = Math.max(0, Math.min(1, d));
    d = 1 - d;
    d *= 1 - this.rain * 5 / 16;
    d *= 1 - this.thunder * this.rain * 5 / 16;
    return d;
  }

  // ---- physics world hooks (prediction) -------------------------------------------------
  entityColliders(_e: Entity, _box: AABB): AABB[] {
    return [];
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    return (stateFlags[this.getBlockState(x, y, z)]! & F.SOLID) !== 0;
  }

  blockName(x: number, y: number, z: number): string {
    return blockOf(this.getBlockState(x, y, z)).name;
  }
}

/**
 * Minimal LevelAccess adaptor for client-side placement prediction. Operations with server-only
 * effects are no-ops; the server will correct any divergence.
 */
export class PredictionLevel implements LevelAccess {
  readonly isClient = true;
  readonly random = new Random();
  constructor(readonly world: ClientLevel) {}
  get dim(): DimensionType { return this.world.dim; }
  get minY(): number { return this.world.minY; }
  get maxY(): number { return this.world.maxY; }
  getGameTime(): number { return this.world.gameTime; }
  getDayTime(): number { return this.world.dayTime; }
  isLoaded(x: number, z: number): boolean { return this.world.isLoaded(x, z); }
  getBlockState(x: number, y: number, z: number): number { return this.world.getBlockState(x, y, z); }
  setBlock(x: number, y: number, z: number, state: number): boolean { this.world.setBlock(x, y, z, state); return true; }
  removeBlock(x: number, y: number, z: number): boolean { this.world.setBlock(x, y, z, 0); return true; }
  destroyBlock(x: number, y: number, z: number): boolean { this.world.setBlock(x, y, z, 0); return true; }
  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined { return this.world.getBlockEntity(x, y, z); }
  setBlockEntity(): void {}
  removeBlockEntity(): void {}
  blockEntityChanged(): void {}
  scheduleTick(): void {}
  hasScheduledTick(): boolean { return false; }
  scheduleFluidTick(): void {}
  updateNeighborsAt(): void {}
  updateNeighborsAtExceptFromFacing(): void {}
  neighborChanged(): void {}
  blockEvent(): void {}
  updateNeighbourForOutputSignal(): void {}
  getSignal(): number { return 0; }
  getDirectSignal(): number { return 0; }
  getDirectSignalTo(): number { return 0; }
  hasNeighborSignal(): boolean { return false; }
  getBestNeighborSignal(): number { return 0; }
  hasSignal(): boolean { return false; }
  getSkyLight(x: number, y: number, z: number): number { return this.world.getLight(x, y, z) >> 4; }
  getBlockLight(x: number, y: number, z: number): number { return this.world.getLight(x, y, z) & 15; }
  getMaxLocalRawBrightness(x: number, y: number, z: number): number { const l = this.world.getLight(x, y, z); return Math.max(l >> 4, l & 15); }
  canSeeSky(x: number, y: number, z: number): boolean { const c = this.world.getChunk(x >> 4, z >> 4); return !!c && y >= c.opaque.get(x & 15, z & 15); }
  getHeight(type: 'surface' | 'motion' | 'opaque', x: number, z: number): number { const c = this.world.getChunk(x >> 4, z >> 4); if (!c) return this.minY; return (type === 'surface' ? c.surface : type === 'motion' ? c.motion : c.opaque).get(x & 15, z & 15); }
  getBiome(x: number, y: number, z: number): number { return this.world.getBiome(x, y, z); }
  isRaining(): boolean { return this.world.rain > 0.2; }
  isThundering(): boolean { return this.world.thunder > 0.9; }
  isRainingAt(): boolean { return false; }
  getSkyDarken(): number { return 0; }
  isDay(): boolean { return true; }
  playSound(): void {}
  levelEvent(): void {}
  addParticle(): void {}
  gameEvent(): void {}
  spawnItem(): Entity | null { return null; }
  spawnExperience(): void {}
  addFreshEntity(): boolean { return false; }
  createEntity(): Entity | null { return null; }
  getEntities(): Entity[] { return []; }
  getPlayers(): Entity[] { return []; }
  explode(): void {}
  getDifficulty(): number { return 2; }
  getGameRule(): boolean | number { return false; }
  hurtEntity(): boolean { return false; }
  igniteEntity(): void {}
  addEntityEffect(): void {}
  placeFeature(): boolean { return false; }
  dropBlockLoot(): void {}
  openMenu(): void {}
  useBed(): void {}
}

export type { Block, PlaceContext, ItemStack, Direction };
