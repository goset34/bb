/**
 * StrataServer: owns the dimensions, players, time/weather, rules and the 20 TPS loop.
 * Runs inside a Web Worker (singleplayer / LAN host) or in Node (dedicated server).
 */
import { Connection } from '../common/net/connection';
import { Packet, PROTOCOL_VERSION } from '../common/net/protocol';
import { DimensionId } from '../common/world/dimension';
import { ServerLevel } from './level';
import { ServerPlayer } from './player';
import { GenService } from './gen';
import { ChunkStore, MemoryChunkStore } from './chunkmanager';
import { WorldSeed, parseSeed } from '../common/math/random';
import { GeneratorSettings, DEFAULT_SETTINGS } from '../common/worldgen/generator';
import { createGenerators } from '../common/worldgen/factory';
import { GameMode } from '../common/entity/player';
import { Entity } from '../common/entity/ecs';
import { ItemStack } from '../common/item/stack';
import { AABB } from '../common/math/geom';
import type { Chunk, BlockEntityData } from '../common/world/chunk';
import type { MiningModifiers } from '../common/item/mining';
import { NO_MODIFIERS } from '../common/item/mining';
import { TravelOptions } from '../common/entity/physics';
import { Direction } from '../common/world/direction';
import { registryChecksum } from '../common/init';
import { BIOMES } from '../common/worldgen/biomes';
import { Ticket } from './chunkmanager';

export interface WorldInfo {
  name: string;
  seed: string;
  generator: GeneratorSettings;
  gameMode: GameMode;
  difficulty: number; // 0 peaceful, 1 easy, 2 normal, 3 hard
  hardcore: boolean;
  allowCommands: boolean;
  spawn: { x: number; y: number; z: number };
  gameTime: number;
  dayTime: number;
  weather: WeatherState;
  rules: Record<string, boolean | number>;
  version: number;
  created: number;
  lastPlayed: number;
  /** Arbitrary persisted server-wide state (dragon fight, raids, maps…). */
  data: Record<string, unknown>;
}

export interface WeatherState {
  raining: boolean;
  thundering: boolean;
  rainTime: number;
  thunderTime: number;
  clearTime: number;
  rainLevel: number;
  thunderLevel: number;
}

export const DEFAULT_RULES: Record<string, boolean | number> = {
  announceAdvancements: true, blockExplosionDropDecay: true, commandBlockOutput: true, commandModificationBlockLimit: 32768,
  disableElytraMovementCheck: false, disableRaids: false, doDaylightCycle: true, doEntityDrops: true, doFireTick: true,
  doImmediateRespawn: false, doInsomnia: true, doLimitedCrafting: false, doMobLoot: true, doMobSpawning: true,
  doPatrolSpawning: true, doTileDrops: true, doTraderSpawning: true, doVinesSpread: true, doWardenSpawning: true,
  doWeatherCycle: true, drowningDamage: true, enderPearlsVanishOnDeath: true, fallDamage: true, fireDamage: true,
  forgiveDeadPlayers: true, freezeDamage: true, globalSoundEvents: true, keepInventory: false, lavaSourceConversion: false,
  logAdminCommands: true, maxCommandChainLength: 65536, maxEntityCramming: 24, mobExplosionDropDecay: true,
  mobGriefing: true, naturalRegeneration: true, playersSleepingPercentage: 100, projectilesCanBreakBlocks: true,
  randomTickSpeed: 3, reducedDebugInfo: false, sendCommandFeedback: true, showDeathMessages: true, snowAccumulationHeight: 1,
  spawnChunkRadius: 2, spawnRadius: 10, spectatorsGenerateChunks: true, tntExplosionDropDecay: false,
  universalAnger: false, waterSourceConversion: true, pvp: true, spawnMonsters: true, allowFlight: true,
};

export class GameRules {
  readonly values: Record<string, boolean | number>;
  constructor(init: Record<string, boolean | number> = {}) {
    this.values = { ...DEFAULT_RULES, ...init };
  }
  get(name: string): boolean | number {
    return this.values[name] ?? false;
  }
  set(name: string, v: boolean | number): boolean {
    if (!(name in DEFAULT_RULES)) return false;
    this.values[name] = typeof DEFAULT_RULES[name] === 'number' ? Number(v) : Boolean(v);
    return true;
  }
}

/** Extension points filled by later systems (entities, loot, survival, redstone…). */
export interface ServerHooks {
  dropBlockLoot(level: ServerLevel, x: number, y: number, z: number, state: number, breaker: Entity | null, tool: ItemStack | null): void;
  hurtEntity(level: ServerLevel, e: Entity, type: string, amount: number, attacker: Entity | null): boolean;
  igniteEntity(level: ServerLevel, e: Entity, seconds: number): void;
  addEntityEffect(level: ServerLevel, e: Entity, id: string, ticks: number, amp: number): void;
  spawnItem(level: ServerLevel, x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number, pickupDelay?: number): Entity | null;
  spawnExperience(level: ServerLevel, x: number, y: number, z: number, amount: number): void;
  createEntity(level: ServerLevel, type: string, x: number, y: number, z: number, opts: Record<string, unknown>): Entity | null;
  entityAdded(level: ServerLevel, e: Entity): void;
  explode(level: ServerLevel, source: Entity | null, x: number, y: number, z: number, power: number, fire: boolean, mode: string): void;
  gameEvent(level: ServerLevel, type: string, x: number, y: number, z: number, source: Entity | null, state: number): void;
  fallDamage(level: ServerLevel, e: Entity, dist: number, multiplier: number, state: number): void;
  entityColliders(level: ServerLevel, e: Entity, box: AABB): AABB[];
  tickEntities(level: ServerLevel): void;
  tickChunk(level: ServerLevel, c: Chunk): void;
  chunkLoaded(level: ServerLevel, c: Chunk): void;
  chunkUnloading(level: ServerLevel, c: Chunk): void;
  /** Autosave of a loaded chunk (persist its entities without removing them). */
  chunkSaving(level: ServerLevel, c: Chunk): void;
  chunkSent(p: ServerPlayer, cx: number, cz: number): void;
  forcedTickets(level: ServerLevel): Ticket[];
  blockEntityClientData(be: BlockEntityData): Record<string, unknown> | null;
  biomePrecipitation(biome: number, y: number): 'none' | 'rain' | 'snow';
  chat(p: ServerPlayer, packet: Packet): void;
  packet(p: ServerPlayer, packet: Packet): void;
  canFallFly(p: ServerPlayer): boolean;
  speedMultiplier(p: ServerPlayer): number;
  travelOptions(p: ServerPlayer, base: TravelOptions): TravelOptions;
  /** A riding player's input for this tick (true = the player does not move by itself). */
  riderInput(p: ServerPlayer): boolean;
  afterMove(p: ServerPlayer): void;
  miningModifiers(p: ServerPlayer): MiningModifiers;
  canAdventureBreak(p: ServerPlayer, x: number, y: number, z: number): boolean;
  canAdventurePlace(p: ServerPlayer, x: number, y: number, z: number): boolean;
  creativeCanBreak(p: ServerPlayer): boolean;
  beforeBreak(p: ServerPlayer, x: number, y: number, z: number, state: number): boolean;
  afterBreak(p: ServerPlayer, x: number, y: number, z: number, state: number): void;
  useItemOn(p: ServerPlayer, hand: 'main' | 'off', stack: ItemStack, x: number, y: number, z: number, face: Direction, hx: number, hy: number, hz: number): boolean;
  /** Item used without a block target (food, buckets, armor, projectiles…). */
  useItem(p: ServerPlayer, hand: 'main' | 'off'): boolean;
  blocksPlacement(e: Entity): boolean;
  blockPlaced(p: ServerPlayer, x: number, y: number, z: number, state: number, stack: ItemStack, hand: 'main' | 'off'): void;
  swing(p: ServerPlayer, hand: 'main' | 'off'): void;
  playerAction(p: ServerPlayer, action: string, x: number, y: number, z: number, face: Direction): void;
  playerJoined(p: ServerPlayer, firstJoin: boolean): void;
  playerLeft(p: ServerPlayer): void;
  playerTick(p: ServerPlayer): void;
  serverTick(): void;
  savePlayer(p: ServerPlayer): Record<string, unknown>;
  loadPlayer(p: ServerPlayer, data: Record<string, unknown>): void;
  /** A player throws/drops a stack (menus, Q key, death). */
  playerDrop(p: ServerPlayer, stack: ItemStack, randomly: boolean): void;
  /** A block entity is being removed with its block (containers drop their contents). */
  blockEntityRemoved(level: ServerLevel, be: BlockEntityData, oldState: number, suppressDrops: boolean): void;
  /** Bed right-clicked by a player entity. */
  useBed(level: ServerLevel, player: Entity, x: number, y: number, z: number): void;
  /** Items were crafted from a result slot (stats, recipe unlocks). */
  itemCrafted(p: ServerPlayer, stack: ItemStack, amount: number): void;
}

function defaultHooks(server: StrataServer): ServerHooks {
  return {
    dropBlockLoot() {},
    hurtEntity: () => false,
    igniteEntity() {},
    addEntityEffect() {},
    spawnItem: () => null,
    spawnExperience() {},
    createEntity: () => null,
    entityAdded() {},
    explode() {},
    gameEvent() {},
    fallDamage() {},
    entityColliders: () => [],
    tickEntities() {},
    tickChunk() {},
    chunkLoaded() {},
    chunkUnloading() {},
    chunkSaving() {},
    chunkSent() {},
    forcedTickets: () => [],
    blockEntityClientData: (be) => be.data,
    biomePrecipitation: (b) => BIOMES[b]?.precipitation ?? 'rain',
    chat(p, packet) {
      if (packet.type === 'chat') server.broadcast({ type: 'chat', kind: 'chat', text: { text: String(packet['message']) }, sender: p.name });
    },
    packet() {},
    canFallFly: () => false,
    speedMultiplier: () => 1,
    travelOptions: (_p, base) => base,
    riderInput: () => false,
    afterMove() {},
    miningModifiers: () => NO_MODIFIERS,
    canAdventureBreak: () => false,
    canAdventurePlace: () => false,
    creativeCanBreak: () => true,
    beforeBreak: () => true,
    afterBreak() {},
    useItemOn: () => false,
    useItem: () => false,
    blocksPlacement: (e) => e.type !== 'item' && e.type !== 'xp_orb',
    blockPlaced() {},
    swing() {},
    playerAction() {},
    playerJoined() {},
    playerLeft() {},
    playerTick() {},
    serverTick() {},
    savePlayer: () => ({}),
    loadPlayer() {},
    playerDrop(p, stack) {
      const t = p.entity.transform;
      const yaw = (t.yaw * Math.PI) / 180, pitch = (t.pitch * Math.PI) / 180;
      p.level.spawnItem(t.x, t.y + p.entity.physics.eyeHeight - 0.3, t.z, stack, -Math.sin(yaw) * Math.cos(pitch) * 0.3, -Math.sin(pitch) * 0.3 + 0.1, Math.cos(yaw) * Math.cos(pitch) * 0.3, 40);
    },
    itemCrafted() {},
    useBed() {},
    blockEntityRemoved() {},
  };
}

export interface ServerOptions {
  info: WorldInfo;
  gen: GenService;
  store?: ChunkStore;
  singleplayer: boolean;
  maxViewDistance?: number;
  /** Persist world info / players (implemented by storage layer). */
  persistence?: {
    saveInfo(info: WorldInfo): Promise<void>;
    savePlayer(uuid: string, data: Record<string, unknown>): Promise<void>;
    loadPlayer(uuid: string): Promise<Record<string, unknown> | null>;
  };
}

export class StrataServer {
  readonly levels = new Map<DimensionId, ServerLevel>();
  readonly players: ServerPlayer[] = [];
  readonly info: WorldInfo;
  readonly seed: WorldSeed;
  readonly rules: GameRules;
  readonly singleplayer: boolean;
  readonly maxViewDistance: number;
  hooks: ServerHooks;
  gameTime: number;
  dayTime: number;
  weather: WeatherState;
  running = false;
  paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTickAt = 0;
  /** Milliseconds per tick averaged (for /debug and F3). */
  mspt = 0;
  tps = 20;
  private tickTimes: number[] = [];
  private lastAutosave = 0;
  readonly persistence: ServerOptions['persistence'];
  readonly gen: GenService;
  private readonly onTickListeners: Array<() => void> = [];

  constructor(opts: ServerOptions) {
    this.info = opts.info;
    this.seed = parseSeed(opts.info.seed);
    this.rules = new GameRules(opts.info.rules);
    this.singleplayer = opts.singleplayer;
    this.maxViewDistance = opts.maxViewDistance ?? 32;
    this.gameTime = opts.info.gameTime;
    this.dayTime = opts.info.dayTime;
    this.weather = { ...opts.info.weather };
    this.hooks = defaultHooks(this);
    this.persistence = opts.persistence;
    this.gen = opts.gen;
    const store = opts.store ?? new MemoryChunkStore();
    const generators = createGenerators(this.seed, opts.info.generator ?? DEFAULT_SETTINGS);
    for (const [dim, g] of generators) this.levels.set(dim, new ServerLevel(this, dim, this.seed, g, opts.gen, store));
    if (!this.info.data['spawnInitialized']) {
      const s = this.overworld.generator.findSpawn();
      this.info.spawn = { x: Math.floor(s.x), y: Math.ceil(s.y), z: Math.floor(s.z) };
      this.info.data['spawnInitialized'] = true;
    }
  }

  level(dim: DimensionId): ServerLevel {
    return this.levels.get(dim)!;
  }

  get overworld(): ServerLevel {
    return this.levels.get('overworld')!;
  }

  onTick(cb: () => void): void {
    this.onTickListeners.push(cb);
  }

  // ===========================================================================================
  // Connections
  // ===========================================================================================

  /** Accept a new client connection; waits for the `hello` packet. */
  accept(conn: Connection, uuidHint?: string): void {
    let accepted = false;
    conn.onPacket((p) => {
      if (accepted || p.type !== 'hello') return;
      accepted = true;
      if ((p['protocol'] as number) !== PROTOCOL_VERSION) {
        conn.send({ type: 'disconnect', reason: { key: 'disconnect.outdated' } });
        conn.close();
        return;
      }
      const name = String(p['name'] || 'Jugador').slice(0, 16).replace(/[^A-Za-z0-9_]/g, '_') || 'Jugador';
      if (this.players.some((pl) => pl.name === name)) {
        conn.send({ type: 'disconnect', reason: { key: 'disconnect.duplicate' } });
        conn.close();
        return;
      }
      const uuid = uuidHint ?? `offline:${name.toLowerCase()}`;
      const player = new ServerPlayer(this, conn, name, uuid);
      player.viewDistance = Math.max(2, Math.min(this.maxViewDistance, p['viewDistance'] as number));
      player.lang = p['lang'] as string;
      void this.join(player);
    });
    conn.onClose(() => {
      const pl = this.players.find((x) => x.conn === conn);
      if (pl) this.removePlayer(pl);
    });
  }

  private async join(player: ServerPlayer): Promise<void> {
    const saved = this.persistence ? await this.persistence.loadPlayer(player.uuid).catch(() => null) : null;
    const dim = (saved?.['dim'] as DimensionId | undefined) ?? 'overworld';
    const level = this.level(dim) ?? this.overworld;
    player.level = level;
    level.entities.add(player.entity);
    player.data.gameMode = this.info.gameMode;
    this.players.push(player);
    level.players.push(player);
    const firstJoin = !saved;
    const spawn = this.info.spawn;
    player.entity.transform.x = spawn.x + 0.5;
    player.entity.transform.y = spawn.y;
    player.entity.transform.z = spawn.z + 0.5;
    if (saved) {
      const pos = saved['pos'] as number[] | undefined;
      const rot = saved['rot'] as number[] | undefined;
      const t = player.entity.transform;
      if (pos) { t.x = pos[0]!; t.y = pos[1]!; t.z = pos[2]!; }
      if (rot) { t.yaw = rot[0]!; t.pitch = rot[1]!; }
      if (typeof saved['gameMode'] === 'string') player.data.gameMode = saved['gameMode'] as GameMode;
      if (saved['inventory']) player.inventory.load(saved['inventory'] as Parameters<typeof player.inventory.load>[0]);
      if (saved['flying'] === true) player.data.abilities.flying = true;
      this.hooks.loadPlayer(player, saved);
    }
    player.send({
      type: 'login', entityId: player.entity.id, name: player.name, dim: level.dimId, gameMode: player.data.gameMode,
      hardcore: this.info.hardcore, difficulty: this.info.difficulty, viewDistance: player.viewDistance,
      seedHash: this.seed.lo, worldName: this.info.name, rules: this.rules.values, tables: { checksum: registryChecksum() },
    });
    player.setGameMode(player.data.gameMode);
    player.send({ type: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doCycle: !!this.rules.get('doDaylightCycle') });
    player.send({ type: 'weather', rain: this.weather.rainLevel, thunder: this.weather.thunderLevel });
    player.send({ type: 'spawnPosition', x: spawn.x, y: spawn.y, z: spawn.z, angle: 0 });
    const t = player.entity.transform;
    player.teleport(t.x, t.y, t.z, t.yaw, t.pitch);
    player.syncInventory();
    player.joined = true;
    this.hooks.playerJoined(player, firstJoin);
    this.broadcast({ type: 'chat', kind: 'system', text: { key: 'multiplayer.player.joined', args: [player.name], color: 'yellow' }, sender: '' });
  }

  removePlayer(p: ServerPlayer): void {
    if (p.disconnected) return;
    p.disconnected = true;
    void this.savePlayer(p);
    this.hooks.playerLeft(p);
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    const li = p.level.players.indexOf(p);
    if (li >= 0) p.level.players.splice(li, 1);
    p.level.entities.remove(p.entity);
    this.broadcast({ type: 'chat', kind: 'system', text: { key: 'multiplayer.player.left', args: [p.name], color: 'yellow' }, sender: '' });
  }

  disconnect(p: ServerPlayer, reason: Record<string, unknown>): void {
    p.send({ type: 'disconnect', reason });
    p.conn.close();
    this.removePlayer(p);
  }

  async savePlayer(p: ServerPlayer): Promise<void> {
    if (!this.persistence) return;
    const t = p.entity.transform;
    const data: Record<string, unknown> = {
      name: p.name, dim: p.level.dimId, pos: [t.x, t.y, t.z], rot: [t.yaw, t.pitch], gameMode: p.data.gameMode,
      inventory: p.inventory.toJSON(), flying: p.data.abilities.flying,
      ...this.hooks.savePlayer(p),
    };
    await this.persistence.savePlayer(p.uuid, data);
  }

  broadcast(packet: Packet): void {
    for (const p of this.players) p.send(packet);
  }

  // ===========================================================================================
  // Main loop
  // ===========================================================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextTickAt = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      if (now - this.nextTickAt > 2000) this.nextTickAt = now; // can't keep up: skip ticks
      let guard = 0;
      while (now >= this.nextTickAt && guard++ < 5) {
        if (!this.paused) this.tick();
        this.nextTickAt += 50;
      }
      this.timer = setTimeout(loop, Math.max(0, this.nextTickAt - performance.now()));
    };
    loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  tick(): void {
    const t0 = performance.now();
    this.gameTime++;
    if (this.rules.get('doDaylightCycle')) this.dayTime++;
    this.tickWeather();
    this.hooks.serverTick();
    for (const p of this.players) {
      if (!p.joined) continue;
      p.processInputs();
      this.hooks.playerTick(p);
      p.tick();
    }
    for (const level of this.levels.values()) {
      if (level.players.length === 0 && level.chunks.holders.size === 0 && this.hooks.forcedTickets(level).length === 0) continue;
      level.tick();
    }
    for (const p of this.players) if (p.joined) p.streamChunks(this.singleplayer ? 8 : 4);
    if (this.gameTime % 20 === 0) {
      this.broadcast({ type: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doCycle: !!this.rules.get('doDaylightCycle') });
    }
    for (const cb of this.onTickListeners) cb();
    if (this.gameTime - this.lastAutosave >= 6000) {
      this.lastAutosave = this.gameTime;
      void this.saveAll();
    }
    const dt = performance.now() - t0;
    this.tickTimes.push(dt);
    if (this.tickTimes.length > 100) this.tickTimes.shift();
    this.mspt = this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length;
  }

  private tickWeather(): void {
    const w = this.weather;
    if (this.rules.get('doWeatherCycle')) {
      if (w.clearTime > 0) {
        w.clearTime--;
        w.thunderTime = w.thundering ? 0 : 1;
        w.rainTime = w.raining ? 0 : 1;
        w.thundering = false;
        w.raining = false;
      } else {
        if (w.thunderTime > 0) {
          if (--w.thunderTime === 0) w.thundering = !w.thundering;
        } else {
          w.thunderTime = w.thundering ? 3600 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
        }
        if (w.rainTime > 0) {
          if (--w.rainTime === 0) w.raining = !w.raining;
        } else {
          w.rainTime = w.raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
        }
      }
    }
    const prevRain = w.rainLevel, prevThunder = w.thunderLevel;
    w.rainLevel = Math.max(0, Math.min(1, w.rainLevel + (w.raining ? 0.01 : -0.01)));
    w.thunderLevel = Math.max(0, Math.min(1, w.thunderLevel + (w.thundering ? 0.01 : -0.01)));
    if (Math.abs(prevRain - w.rainLevel) > 1e-6 || Math.abs(prevThunder - w.thunderLevel) > 1e-6) {
      if (this.gameTime % 5 === 0 || w.rainLevel === 0 || w.rainLevel === 1) this.broadcast({ type: 'weather', rain: w.rainLevel, thunder: w.thunderLevel });
    }
  }

  setWeather(kind: 'clear' | 'rain' | 'thunder', duration: number): void {
    const w = this.weather;
    if (kind === 'clear') {
      w.clearTime = duration; w.rainTime = 0; w.thunderTime = 0; w.raining = false; w.thundering = false;
    } else {
      w.clearTime = 0; w.rainTime = duration; w.thunderTime = kind === 'thunder' ? duration : 0; w.raining = true; w.thundering = kind === 'thunder';
    }
  }

  /** Save chunks, players and world info. */
  async saveAll(): Promise<void> {
    for (const p of this.players) await this.savePlayer(p);
    for (const level of this.levels.values()) await level.chunks.saveAll();
    this.info.gameTime = this.gameTime;
    this.info.dayTime = this.dayTime;
    this.info.weather = { ...this.weather };
    this.info.rules = { ...this.rules.values };
    this.info.lastPlayed = Date.now();
    await this.persistence?.saveInfo(this.info);
  }
}

export function newWorldInfo(name: string, seed: string, generator: GeneratorSettings, gameMode: GameMode, difficulty: number, hardcore: boolean, allowCommands: boolean): WorldInfo {
  return {
    name, seed, generator, gameMode, difficulty, hardcore, allowCommands,
    spawn: { x: 0, y: 80, z: 0 }, gameTime: 0, dayTime: 1000,
    weather: { raining: false, thundering: false, rainTime: 0, thunderTime: 0, clearTime: 0, rainLevel: 0, thunderLevel: 0 },
    rules: {}, version: 1, created: Date.now(), lastPlayed: Date.now(), data: {},
  };
}
