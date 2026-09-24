/**
 * ServerLevel: authoritative world simulation for one dimension.
 */
import { Chunk } from '../common/world/chunk';
import { DIMENSIONS, DimensionId, DimensionType } from '../common/world/dimension';
import {
  LevelAccess, UPDATE_NEIGHBORS, UPDATE_CLIENTS, UPDATE_KNOWN_SHAPE, UPDATE_SUPPRESS_DROPS, UPDATE_MOVE_BY_PISTON,
} from '../common/world/level';
import {
  Block, blockOf, stateFlags, F, stateBlock, getBlock, isConductor, hasWater, S, tryGetValue,
} from '../common/block/registry';
import { P } from '../common/block/properties';
import { Direction, DIRS, DX, DY, DZ, OPPOSITE, chunkKey } from '../common/world/direction';
import { Random, WorldSeed } from '../common/math/random';
import { EntityWorld, Entity } from '../common/entity/ecs';
import { LightEngine } from '../common/world/light';
import { ChunkManager, ChunkStore, Holder, Ticket } from './chunkmanager';
import { GenService } from './gen';
import { ChunkGenerator } from '../common/worldgen/generator';
import { TickQueue } from './ticks';
import type { BlockEntityData } from '../common/world/chunk';
import type { ItemStack } from '../common/item/stack';
import { AABB } from '../common/math/geom';
import type { PhysicsWorld } from '../common/entity/physics';
import type { StrataServer } from './server';
import type { ServerPlayer } from './player';
import { ByteWriter } from '../common/util/bytes';

/** Pending neighbour/shape update (collecting updater, reference semantics). */
type Update =
  | { kind: 'neighbor'; x: number; y: number; z: number; from: Block; fx: number; fy: number; fz: number }
  | { kind: 'shape'; dir: Direction; state: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; flags: number; limit: number }
  | { kind: 'multi'; x: number; y: number; z: number; from: Block; skip: Direction | -1; idx: number };

export class ServerLevel implements LevelAccess, PhysicsWorld {
  readonly isClient = false;
  readonly dim: DimensionType;
  readonly random: Random;
  readonly minY: number;
  readonly maxY: number;
  readonly chunks: ChunkManager;
  readonly light: LightEngine;
  readonly entities = new EntityWorld();
  readonly players: ServerPlayer[] = [];
  readonly blockTicks = new TickQueue();
  readonly fluidTicks = new TickQueue();
  private readonly blockEvents: Array<{ x: number; y: number; z: number; block: Block; id: number; param: number }> = [];
  private readonly changedBlocks = new Map<string, Set<number>>();
  private readonly changedLight = new Set<string>();
  private readonly changedBE = new Set<string>();
  private updateStack: Update[] = [];
  private addedThisLayer: Update[] = [];
  private runningUpdates = false;
  private updateCount = 0;
  /** Sky darkening 0..11 (night/rain). */
  skyDarken = 0;
  /** Extension hooks for later milestones (redstone wire cache, raids, dragon fight…). */
  readonly systems: Array<{ name: string; tick(level: ServerLevel): void }> = [];
  /** Per-tick timing (ms) for the profiler. */
  readonly timings: Record<string, number> = {};

  constructor(
    readonly server: StrataServer,
    readonly dimId: DimensionId,
    readonly seed: WorldSeed,
    readonly generator: ChunkGenerator,
    gen: GenService,
    store: ChunkStore,
  ) {
    this.dim = DIMENSIONS[dimId];
    this.minY = this.dim.minY;
    this.maxY = this.dim.minY + this.dim.height;
    this.random = new Random(seed.lo ^ 0x1234567, seed.hi);
    this.light = new LightEngine({
      getChunk: (cx, cz) => this.chunks.getChunk(cx, cz),
      isLightReady: (cx, cz) => !!this.chunks.get(cx, cz)?.lightReady,
      hasSkylight: this.dim.hasSkylight,
      markLightChanged: (cx, sy, cz) => this.changedLight.add(`${cx},${sy},${cz}`),
    }, this.minY, this.dim.height);
    this.chunks = new ChunkManager(this.dim, seed, gen, generator, store, {
      onFull: (h) => this.onChunkFull(h),
      onUnload: (h) => this.onChunkUnload(h),
      light: (h) => {
        this.light.invalidateCache();
        this.light.initChunk(h.chunk!, () => { h.lightReady = true; });
        this.light.invalidateCache();
      },
    });
  }

  // =============================================================================================
  // Basic access
  // =============================================================================================

  getGameTime(): number {
    return this.server.gameTime;
  }

  getDayTime(): number {
    return this.dim.fixedTime ?? this.server.dayTime;
  }

  isLoaded(x: number, z: number): boolean {
    return !!this.chunks.getFull(Math.floor(x) >> 4, Math.floor(z) >> 4);
  }

  getChunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.getFull(x >> 4, z >> 4);
  }

  getBlockState(x: number, y: number, z: number): number {
    if (y < this.minY || y >= this.maxY) return 0;
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.getBlock(x & 15, y, z & 15);
  }

  // =============================================================================================
  // setBlock with reference update semantics
  // =============================================================================================

  setBlock(x: number, y: number, z: number, state: number, flags = 3, limit = 512): boolean {
    if (y < this.minY || y >= this.maxY) return false;
    const c = this.chunks.getFull(x >> 4, z >> 4);
    if (!c) return false;
    const old = c.getBlock(x & 15, y, z & 15);
    if (old === state) return false;
    c.setBlock(x & 15, y, z & 15, state);
    const oldBlock = blockOf(old);
    const newBlock = blockOf(state);
    const moved = (flags & UPDATE_MOVE_BY_PISTON) !== 0;
    // Block entities
    if (oldBlock !== newBlock) {
      if (stateFlags[old]! & F.HAS_BE) c.removeBlockEntity(x & 15, y, z & 15);
      oldBlock.behavior.onRemove(old, this, x, y, z, state, moved);
    }
    this.light.onBlockChanged(x, y, z, old, state);
    if (flags & UPDATE_CLIENTS) this.markBlockChanged(x, y, z);
    if (oldBlock !== newBlock || !moved) newBlock.behavior.onPlace(state, this, x, y, z, old, moved);
    if (flags & UPDATE_NEIGHBORS) {
      this.updateNeighborsAt(x, y, z, oldBlock);
      if (newBlock.behavior.hasAnalogOutput(state)) this.updateNeighbourForOutputSignal(x, y, z, newBlock);
    }
    if (!(flags & UPDATE_KNOWN_SHAPE) && limit > 0) {
      const f = flags & ~(UPDATE_NEIGHBORS | UPDATE_SUPPRESS_DROPS);
      this.updateNeighbourShapes(x, y, z, state, f, limit - 1);
    }
    return true;
  }

  removeBlock(x: number, y: number, z: number, moved = false): boolean {
    const s = this.getBlockState(x, y, z);
    const water = hasWater(s) && !(stateFlags[s]! & F.FLUID_BLOCK) ? this.waterSource() : 0;
    return this.setBlock(x, y, z, water, 3 | (moved ? UPDATE_MOVE_BY_PISTON : 0));
  }

  private waterSource(): number {
    return S('water');
  }

  destroyBlock(x: number, y: number, z: number, drop: boolean, breaker?: Entity): boolean {
    const s = this.getBlockState(x, y, z);
    if (stateFlags[s]! & F.AIR) return false;
    const b = blockOf(s);
    this.levelEvent(2001, x, y, z, s);
    if (drop) this.server.hooks.dropBlockLoot(this, x, y, z, s, breaker ?? null, null);
    const keep = (stateFlags[s]! & F.WATERLOGGED) || b.name === 'seagrass' || b.name === 'tall_seagrass' || b.name === 'kelp' || b.name === 'kelp_plant' || b.name === 'bubble_column' ? this.waterSource() : 0;
    this.gameEvent('block_destroy', x, y, z, breaker, s);
    return this.setBlock(x, y, z, keep, 3);
  }

  private updateNeighbourShapes(x: number, y: number, z: number, state: number, flags: number, limit: number): void {
    // Order: west, east, north, south, down, up (reference UPDATE_SHAPE_ORDER)
    const order: Direction[] = [4, 5, 2, 3, 0, 1];
    for (const d of order) {
      this.addUpdate({ kind: 'shape', dir: OPPOSITE[d]!, state, x: x + DX[d]!, y: y + DY[d]!, z: z + DZ[d]!, nx: x, ny: y, nz: z, flags, limit });
    }
  }

  private runShapeUpdate(u: Extract<Update, { kind: 'shape' }>): void {
    const cur = this.getBlockState(u.x, u.y, u.z);
    if (stateFlags[cur]! & F.AIR) return;
    const next = blockOf(cur).behavior.updateShape(cur, u.dir, u.state, this, u.x, u.y, u.z, u.nx, u.ny, u.nz);
    if (next === cur) return;
    // updateOrDestroy
    if (stateFlags[next]! & F.AIR || next === 0) {
      if (!(stateFlags[cur]! & F.AIR)) this.destroyBlockByShape(u.x, u.y, u.z, cur, u.flags, u.limit);
    } else {
      this.setBlock(u.x, u.y, u.z, next, u.flags & ~UPDATE_SUPPRESS_DROPS, u.limit);
    }
  }

  private destroyBlockByShape(x: number, y: number, z: number, cur: number, flags: number, limit: number): void {
    const drops = !(flags & UPDATE_SUPPRESS_DROPS);
    this.levelEvent(2001, x, y, z, cur);
    if (drops) this.server.hooks.dropBlockLoot(this, x, y, z, cur, null, null);
    const keep = stateFlags[cur]! & F.WATERLOGGED ? this.waterSource() : 0;
    this.setBlock(x, y, z, keep, flags | UPDATE_NEIGHBORS, limit);
  }

  updateNeighborsAt(x: number, y: number, z: number, block: Block): void {
    this.addUpdate({ kind: 'multi', x, y, z, from: block, skip: -1, idx: 0 });
  }

  updateNeighborsAtExceptFromFacing(x: number, y: number, z: number, block: Block, skip: Direction): void {
    this.addUpdate({ kind: 'multi', x, y, z, from: block, skip, idx: 0 });
  }

  neighborChanged(x: number, y: number, z: number, fromBlock: Block, fx: number, fy: number, fz: number): void {
    this.addUpdate({ kind: 'neighbor', x, y, z, from: fromBlock, fx, fy, fz });
  }

  /** Collecting neighbour updater: depth-first processing without deep recursion. */
  private addUpdate(u: Update): void {
    const wasRunning = this.runningUpdates;
    if (wasRunning && this.updateCount >= 1000000) return;
    this.updateCount++;
    this.addedThisLayer.push(u);
    if (!wasRunning) this.runUpdates();
  }

  private runUpdates(): void {
    this.runningUpdates = true;
    try {
      for (;;) {
        // Push newly added updates in reverse so that they run in insertion order before older ones
        while (this.addedThisLayer.length) this.updateStack.push(this.addedThisLayer.pop()!);
        const u = this.updateStack[this.updateStack.length - 1];
        if (!u) break;
        if (u.kind === 'multi') {
          // Reference order: west, east, down, up, north, south
          const order: Direction[] = [4, 5, 0, 1, 2, 3];
          while (u.idx < 6 && order[u.idx] === u.skip) u.idx++;
          if (u.idx >= 6) {
            this.updateStack.pop();
            continue;
          }
          const d = order[u.idx++]!;
          while (u.idx < 6 && order[u.idx] === u.skip) u.idx++;
          if (u.idx >= 6) this.updateStack.pop();
          this.runNeighbor(u.x + DX[d]!, u.y + DY[d]!, u.z + DZ[d]!, u.from, u.x, u.y, u.z);
        } else {
          this.updateStack.pop();
          if (u.kind === 'neighbor') this.runNeighbor(u.x, u.y, u.z, u.from, u.fx, u.fy, u.fz);
          else this.runShapeUpdate(u);
        }
      }
    } finally {
      this.updateStack.length = 0;
      this.addedThisLayer.length = 0;
      this.runningUpdates = false;
      this.updateCount = 0;
    }
  }

  private runNeighbor(x: number, y: number, z: number, from: Block, fx: number, fy: number, fz: number): void {
    if (y < this.minY || y >= this.maxY) return;
    const s = this.getBlockState(x, y, z);
    if (stateFlags[s]! & F.AIR) return;
    blockOf(s).behavior.neighborChanged(s, this, x, y, z, from.id, fx, fy, fz, false);
  }

  updateNeighbourForOutputSignal(x: number, y: number, z: number, block: Block): void {
    for (const d of [2, 3, 4, 5] as Direction[]) {
      let nx = x + DX[d]!, nz = z + DZ[d]!;
      let s = this.getBlockState(nx, y, nz);
      const name = blockOf(s).name;
      if (name === 'comparator') {
        this.neighborChanged(nx, y, nz, block, x, y, z);
      } else if (isConductor(s)) {
        nx += DX[d]!;
        nz += DZ[d]!;
        s = this.getBlockState(nx, y, nz);
        if (blockOf(s).name === 'comparator') this.neighborChanged(nx, y, nz, block, x, y, z);
      }
    }
  }

  // =============================================================================================
  // Block entities
  // =============================================================================================

  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    return c?.getBlockEntity(x & 15, y, z & 15);
  }

  setBlockEntity(be: BlockEntityData): void {
    const c = this.chunks.getChunk(be.x >> 4, be.z >> 4);
    if (!c) return;
    c.setBlockEntity(be);
    this.blockEntityChanged(be.x, be.y, be.z);
  }

  removeBlockEntity(x: number, y: number, z: number): void {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    c?.removeBlockEntity(x & 15, y, z & 15);
  }

  blockEntityChanged(x: number, y: number, z: number): void {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    if (c) c.dirty = true;
    this.changedBE.add(`${x},${y},${z}`);
  }

  // =============================================================================================
  // Ticks & events
  // =============================================================================================

  scheduleTick(x: number, y: number, z: number, block: Block, delay: number, priority = 0): void {
    this.blockTicks.schedule(x, y, z, block.id, this.getGameTime() + delay, priority);
  }

  hasScheduledTick(x: number, y: number, z: number, block: Block): boolean {
    return this.blockTicks.has(x, y, z, block.id);
  }

  scheduleFluidTick(x: number, y: number, z: number, fluid: 'water' | 'lava', delay: number): void {
    this.fluidTicks.schedule(x, y, z, fluid === 'water' ? -1 : -2, this.getGameTime() + delay, 0);
  }

  blockEvent(x: number, y: number, z: number, block: Block, id: number, param: number): void {
    for (const e of this.blockEvents) if (e.x === x && e.y === y && e.z === z && e.block === block && e.id === id && e.param === param) return;
    this.blockEvents.push({ x, y, z, block, id, param });
  }

  /** Fluid tick handler registered by the fluid system (H5). */
  fluidTickHandler: ((level: ServerLevel, x: number, y: number, z: number, fluid: 'water' | 'lava') => void) | null = null;

  // =============================================================================================
  // Redstone signal queries (reference semantics)
  // =============================================================================================

  getSignal(x: number, y: number, z: number, dir: Direction): number {
    const s = this.getBlockState(x, y, z);
    const i = blockOf(s).behavior.getSignal(s, this, x, y, z, dir);
    return isConductor(s) ? Math.max(i, this.getDirectSignalTo(x, y, z)) : i;
  }

  getDirectSignal(x: number, y: number, z: number, dir: Direction): number {
    const s = this.getBlockState(x, y, z);
    return blockOf(s).behavior.getDirectSignal(s, this, x, y, z, dir);
  }

  getDirectSignalTo(x: number, y: number, z: number): number {
    let m = 0;
    for (const d of DIRS) {
      m = Math.max(m, this.getDirectSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d));
      if (m >= 15) return m;
    }
    return m;
  }

  hasSignal(x: number, y: number, z: number, dir: Direction): boolean {
    return this.getSignal(x, y, z, dir) > 0;
  }

  hasNeighborSignal(x: number, y: number, z: number): boolean {
    // Reference order: down, up, north, south, west, east (direction points *from* neighbour)
    for (const d of DIRS) {
      if (this.getSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d) > 0) return true;
    }
    return false;
  }

  getBestNeighborSignal(x: number, y: number, z: number): number {
    let m = 0;
    for (const d of DIRS) {
      const s = this.getSignal(x + DX[d]!, y + DY[d]!, z + DZ[d]!, d);
      if (s >= 15) return 15;
      if (s > m) m = s;
    }
    return m;
  }

  // =============================================================================================
  // Light & environment
  // =============================================================================================

  getSkyLight(x: number, y: number, z: number): number {
    if (!this.dim.hasSkylight) return 0;
    if (y >= this.maxY) return 15;
    if (y < this.minY) return 0;
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    return c ? c.getLight(x & 15, y, z & 15) >> 4 : 15;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < this.minY || y >= this.maxY) return 0;
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    return c ? c.getLight(x & 15, y, z & 15) & 15 : 0;
  }

  getMaxLocalRawBrightness(x: number, y: number, z: number): number {
    return Math.max(this.getSkyLight(x, y, z) - this.skyDarken, this.getBlockLight(x, y, z));
  }

  canSeeSky(x: number, y: number, z: number): boolean {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    return y >= c.opaque.get(x & 15, z & 15);
  }

  getHeight(type: 'surface' | 'motion' | 'opaque', x: number, z: number): number {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    if (!c) return this.minY;
    const hm = type === 'surface' ? c.surface : type === 'motion' ? c.motion : c.opaque;
    return hm.get(x & 15, z & 15);
  }

  getBiome(x: number, y: number, z: number): number {
    const c = this.chunks.getChunk(x >> 4, z >> 4);
    return c ? c.getBiome(x & 15, y, z & 15) : this.generator.biomeAt(x, y, z);
  }

  isRaining(): boolean {
    return this.dim.hasSkylight && this.server.weather.rainLevel > 0.2;
  }

  isThundering(): boolean {
    return this.dim.hasSkylight && this.server.weather.thunderLevel > 0.9 && this.isRaining();
  }

  isRainingAt(x: number, y: number, z: number): boolean {
    if (!this.isRaining() || !this.canSeeSky(x, y, z)) return false;
    return this.getHeight('motion', x, z) <= y && this.server.hooks.biomePrecipitation(this.getBiome(x, y, z), y) === 'rain';
  }

  getSkyDarken(): number {
    return this.skyDarken;
  }

  isDay(): boolean {
    return this.dim.hasSkylight && this.skyDarken < 4;
  }

  private computeSkyDarken(): void {
    if (!this.dim.hasSkylight) {
      this.skyDarken = 0;
      return;
    }
    const t = this.getDayTime() % 24000;
    const angle = celestialAngle(t);
    let d = 1 - (Math.cos(angle * Math.PI * 2) * 2 + 0.5);
    d = Math.max(0, Math.min(1, d));
    d = 1 - d;
    d *= 1 - (this.server.weather.rainLevel * 5) / 16;
    d *= 1 - (this.server.weather.thunderLevel * this.server.weather.rainLevel * 5) / 16;
    d = 1 - d;
    this.skyDarken = Math.floor(d * 11);
  }

  // =============================================================================================
  // Effects (sounds, particles, level events, game events)
  // =============================================================================================

  playSound(x: number, y: number, z: number, sound: string, volume = 1, pitch = 1, except?: Entity): void {
    this.broadcastNear(x, y, z, 16 * Math.max(1, volume), { type: 'sound', sound, x, y, z, volume, pitch, category: 'block' }, except);
  }

  levelEvent(type: number, x: number, y: number, z: number, data: number, except?: Entity): void {
    this.broadcastNear(x, y, z, 64, { type: 'levelEvent', event: type, x, y, z, data }, except);
  }

  addParticle(type: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, count = 1, data = 0): void {
    this.broadcastNear(x, y, z, 64, { type: 'particles', particle: type, x, y, z, dx: vx, dy: vy, dz: vz, speed: 0, count, data });
  }

  gameEvent(type: string, x: number, y: number, z: number, source?: Entity, blockState?: number): void {
    this.server.hooks.gameEvent(this, type, x, y, z, source ?? null, blockState ?? 0);
  }

  broadcastNear(x: number, y: number, z: number, range: number, packet: { type: string } & Record<string, unknown>, except?: Entity): void {
    for (const p of this.players) {
      if (except && p.entity === except) continue;
      const t = p.entity.transform!;
      const dx = t.x - x, dy = t.y - y, dz = t.z - z;
      if (dx * dx + dy * dy + dz * dz <= range * range) p.send(packet);
    }
  }

  broadcast(packet: { type: string } & Record<string, unknown>): void {
    for (const p of this.players) p.send(packet);
  }

  // =============================================================================================
  // Entities
  // =============================================================================================

  spawnItem(x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number, pickupDelay = 10): Entity | null {
    return this.server.hooks.spawnItem(this, x, y, z, stack, vx, vy, vz, pickupDelay);
  }

  spawnExperience(x: number, y: number, z: number, amount: number): void {
    this.server.hooks.spawnExperience(this, x, y, z, amount);
  }

  addFreshEntity(e: Entity): boolean {
    this.entities.add(e);
    this.server.hooks.entityAdded(this, e);
    return true;
  }

  createEntity(type: string, x: number, y: number, z: number, opts?: Record<string, unknown>): Entity | null {
    return this.server.hooks.createEntity(this, type, x, y, z, opts ?? {});
  }

  getEntities(box: AABB, filter?: (e: Entity) => boolean, except?: Entity): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.all()) {
      if (e === except || e.removed) continue;
      const t = e.transform, p = e.physics;
      if (!t) continue;
      const hw = (p?.width ?? 0.5) / 2, h = p?.height ?? 0.5;
      if (t.x + hw <= box.minX || t.x - hw >= box.maxX || t.y + h <= box.minY || t.y >= box.maxY || t.z + hw <= box.minZ || t.z - hw >= box.maxZ) continue;
      if (filter && !filter(e)) continue;
      out.push(e);
    }
    return out;
  }

  getPlayers(): Entity[] {
    return this.players.map((p) => p.entity);
  }

  explode(source: Entity | null, x: number, y: number, z: number, power: number, fire: boolean, mode: 'none' | 'block' | 'mob' | 'tnt' | 'trigger'): void {
    this.server.hooks.explode(this, source, x, y, z, power, fire, mode);
  }

  getDifficulty(): number {
    return this.server.info.difficulty;
  }

  getGameRule(name: string): boolean | number {
    return this.server.rules.get(name);
  }

  // PhysicsWorld hooks
  onEntityInside(e: Entity, state: number, x: number, y: number, z: number): void {
    blockOf(state).behavior.entityInside(state, this, x, y, z, e);
  }

  onStepOn(e: Entity, state: number, x: number, y: number, z: number): void {
    blockOf(state).behavior.stepOn(state, this, x, y, z, e);
  }

  onFallOn(e: Entity, state: number, x: number, y: number, z: number, fallDistance: number): void {
    const mul = blockOf(state).behavior.fallOn(state, this, x, y, z, e, fallDistance);
    this.server.hooks.fallDamage(this, e, fallDistance, mul, state);
  }

  entityColliders(e: Entity, box: AABB): AABB[] {
    return this.server.hooks.entityColliders(this, e, box);
  }

  // =============================================================================================
  // Chunk lifecycle hooks
  // =============================================================================================

  private onChunkFull(h: Holder): void {
    const c = h.chunk!;
    const ticks = c.extra['pendingTicks'] as Array<number[]> | undefined;
    if (ticks) {
      for (const [x, y, z, delay] of ticks) {
        const s = this.getBlockState(x!, y!, z!);
        const b = blockOf(s);
        if (b.name === 'water' || b.name === 'lava') this.scheduleFluidTick(x!, y!, z!, b.name, delay!);
        else this.scheduleTick(x!, y!, z!, b, delay!);
      }
      delete c.extra['pendingTicks'];
    }
    const saved = c.extra['ticks'] as Array<[number, number, number, number, number, number]> | undefined;
    if (saved) {
      const now = this.getGameTime();
      for (const [x, y, z, id, dt, pr] of saved) {
        if (id < 0) this.fluidTicks.schedule(x, y, z, id, now + dt, pr);
        else this.blockTicks.schedule(x, y, z, id, now + dt, pr);
      }
      delete c.extra['ticks'];
    }
    this.server.hooks.chunkLoaded(this, c);
  }

  private onChunkUnload(h: Holder): void {
    const c = h.chunk!;
    const now = this.getGameTime();
    const ticks: Array<[number, number, number, number, number, number]> = [];
    for (const t of this.blockTicks.extractChunk(c.x, c.z)) ticks.push([t.x, t.y, t.z, t.id, Math.max(0, t.time - now), t.priority]);
    for (const t of this.fluidTicks.extractChunk(c.x, c.z)) ticks.push([t.x, t.y, t.z, t.id, Math.max(0, t.time - now), t.priority]);
    if (ticks.length) {
      c.extra['ticks'] = ticks;
      c.dirty = true;
    }
    this.server.hooks.chunkUnloading(this, c);
    for (const p of this.players) p.forgetChunk(c.x, c.z);
  }

  // =============================================================================================
  // Tick
  // =============================================================================================

  private markBlockChanged(x: number, y: number, z: number): void {
    const key = `${x >> 4},${y >> 4},${z >> 4}`;
    let s = this.changedBlocks.get(key);
    if (!s) this.changedBlocks.set(key, (s = new Set()));
    s.add(((y & 15) << 8) | ((z & 15) << 4) | (x & 15));
  }

  tick(): void {
    const time = (name: string, fn: () => void) => {
      const t0 = performance.now();
      fn();
      this.timings[name] = (this.timings[name] ?? 0) * 0.9 + (performance.now() - t0) * 0.1;
    };
    time('chunks', () => {
      const tickets: Ticket[] = this.players.map((p) => ({ cx: Math.floor(p.entity.transform!.x) >> 4, cz: Math.floor(p.entity.transform!.z) >> 4, radius: p.viewDistance }));
      tickets.push(...this.server.hooks.forcedTickets(this));
      this.chunks.update(tickets, 20);
    });
    this.computeSkyDarken();
    time('blockTicks', () => this.runScheduledTicks());
    time('randomTicks', () => this.runRandomTicks());
    time('blockEvents', () => this.runBlockEvents());
    time('systems', () => {
      for (const s of this.systems) s.tick(this);
    });
    time('entities', () => this.server.hooks.tickEntities(this));
    time('light', () => {
      if (this.light.hasPending) this.light.run();
      this.light.flushChanged();
    });
    time('sync', () => this.flushChanges());
  }

  private runScheduledTicks(): void {
    const now = this.getGameTime();
    const loaded = (t: { x: number; z: number }) => !!this.chunks.getFull(t.x >> 4, t.z >> 4);
    for (const t of this.blockTicks.drainDue(now, 65536, loaded)) {
      const s = this.getBlockState(t.x, t.y, t.z);
      if (stateBlock[s] !== t.id) continue;
      blockOf(s).behavior.tick(s, this, t.x, t.y, t.z, this.random);
    }
    for (const t of this.fluidTicks.drainDue(now, 65536, loaded)) {
      this.fluidTickHandler?.(this, t.x, t.y, t.z, t.id === -1 ? 'water' : 'lava');
    }
  }

  private runRandomTicks(): void {
    const speed = this.getGameRule('randomTickSpeed') as number;
    if (speed <= 0) return;
    const range = 8; // chunks around players (simulation distance)
    const done = new Set<number>();
    for (const p of this.players) {
      const pcx = Math.floor(p.entity.transform!.x) >> 4, pcz = Math.floor(p.entity.transform!.z) >> 4;
      for (let dz = -range; dz <= range; dz++) for (let dx = -range; dx <= range; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (done.has(key)) continue;
        done.add(key);
        const c = this.chunks.getFull(cx, cz);
        if (!c) continue;
        c.inhabitedTime++;
        this.server.hooks.tickChunk(this, c);
        for (let si = 0; si < c.sections.length; si++) {
          const sec = c.sections[si]!;
          if (sec.tickables === 0) continue;
          const baseY = (si + c.minSection) << 4;
          for (let i = 0; i < speed; i++) {
            const r = this.random.nextU32();
            const lx = r & 15, ly = (r >>> 4) & 15, lz = (r >>> 8) & 15;
            const s = sec.get((ly << 8) | (lz << 4) | lx);
            if (!(stateFlags[s]! & F.RANDOM_TICKS)) continue;
            blockOf(s).behavior.randomTick(s, this, (cx << 4) + lx, baseY + ly, (cz << 4) + lz, this.random);
          }
        }
      }
    }
  }

  private runBlockEvents(): void {
    let guard = 0;
    while (this.blockEvents.length && guard++ < 65536) {
      const events = this.blockEvents.splice(0, this.blockEvents.length);
      for (const e of events) {
        const s = this.getBlockState(e.x, e.y, e.z);
        if (blockOf(s) !== e.block) continue;
        if (e.block.behavior.triggerEvent(s, this, e.x, e.y, e.z, e.id, e.param)) {
          this.broadcastNear(e.x, e.y, e.z, 64, { type: 'blockEvent', x: e.x, y: e.y, z: e.z, block: e.block.id, id: e.id, param: e.param });
        }
      }
    }
  }

  /** Send block, light and block entity changes to players that have the chunks. */
  private flushChanges(): void {
    for (const [key, set] of this.changedBlocks) {
      const [cx, sy, cz] = key.split(',').map(Number) as [number, number, number];
      const viewers = this.players.filter((p) => p.hasChunk(cx, cz));
      if (!viewers.length) continue;
      const c = this.chunks.getChunk(cx, cz);
      if (!c) continue;
      let packet: { type: string } & Record<string, unknown>;
      if (set.size === 1) {
        const idx = [...set][0]!;
        const x = (cx << 4) + (idx & 15), y = (sy << 4) + (idx >> 8), z = (cz << 4) + ((idx >> 4) & 15);
        packet = { type: 'blockUpdate', x, y, z, state: c.getBlock(x & 15, y, z & 15) };
      } else {
        const entries = new Int32Array(set.size);
        let i = 0;
        for (const idx of set) {
          const y = (sy << 4) + (idx >> 8);
          entries[i++] = idx * 65536 + c.getBlock(idx & 15, y, (idx >> 4) & 15);
        }
        packet = { type: 'multiBlockUpdate', cx, sy, cz, entries };
      }
      for (const p of viewers) p.send(packet);
    }
    this.changedBlocks.clear();
    for (const key of this.changedLight) {
      const [cx, sy, cz] = key.split(',').map(Number) as [number, number, number];
      const viewers = this.players.filter((p) => p.hasChunk(cx, cz));
      if (!viewers.length) continue;
      const c = this.chunks.getChunk(cx, cz);
      if (!c) continue;
      const sec = c.sections[sy - c.minSection];
      if (!sec) continue;
      const packet = sec.light
        ? { type: 'lightUpdate', cx, sy, cz, uniform: -1, light: sec.light.slice() }
        : { type: 'lightUpdate', cx, sy, cz, uniform: sec.uniformLight, light: new Uint8Array(0) };
      for (const p of viewers) p.send(packet);
    }
    this.changedLight.clear();
    for (const key of this.changedBE) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const viewers = this.players.filter((p) => p.hasChunk(x >> 4, z >> 4));
      if (!viewers.length) continue;
      const be = this.getBlockEntity(x, y, z);
      const data = be ? this.server.hooks.blockEntityClientData(be) : null;
      for (const p of viewers) p.send({ type: 'blockEntity', x, y, z, beType: be?.type ?? '', data });
    }
    this.changedBE.clear();
  }

  /** Serialise a FULL chunk for sending to clients. */
  encodeChunkForClient(c: Chunk): Uint8Array {
    const w = new ByteWriter(48 * 1024);
    c.write(w, true, (be) => this.server.hooks.blockEntityClientData(be));
    return w.finish();
  }

  /** Utility: first air block above the motion-blocking surface (for spawning / teleport). */
  topY(x: number, z: number): number {
    return this.getHeight('motion', x, z);
  }

  /** Fill helper used by commands. Returns number of blocks changed. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number, mode: 'replace' | 'destroy' | 'hollow' | 'outline' | 'keep' = 'replace'): number {
    let n = 0;
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.max(this.minY, Math.min(y0, y1)), Math.min(this.maxY - 1, Math.max(y0, y1))];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) {
      const edge = x === ax || x === bx || y === ay || y === by || z === az || z === bz;
      let target = state;
      if (mode === 'hollow' && !edge) target = 0;
      if (mode === 'outline' && !edge) continue;
      if (mode === 'keep' && !(stateFlags[this.getBlockState(x, y, z)]! & F.AIR)) continue;
      if (mode === 'destroy') this.destroyBlock(x, y, z, true);
      if (this.setBlock(x, y, z, target, 2 | UPDATE_KNOWN_SHAPE)) n++;
    }
    return n;
  }

  /** Waterlogged helper used by behaviours. */
  isWaterSource(state: number): boolean {
    return blockOf(state).name === 'water' && (tryGetValue(state, P.level15) ?? 1) === 0;
  }

  getBlockDef(name: string): Block {
    return getBlock(name);
  }
}

/** Celestial angle 0..1 for a day time (reference curve). */
export function celestialAngle(dayTime: number): number {
  const d = ((dayTime % 24000) / 24000 - 0.25);
  let f = d - Math.floor(d);
  const e = 0.5 - Math.cos(f * Math.PI) / 2;
  f = (f * 2 + e) / 3;
  return f;
}
