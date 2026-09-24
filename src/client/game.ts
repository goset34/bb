/**
 * Client game session: connection handling, fixed 20 TPS client tick (prediction), render loop
 * with interpolation, HUD and debug information.
 */
import { Connection } from '../common/net/connection';
import type { Packet } from '../common/net/protocol';
import { ClientLevel } from './world';
import { LocalPlayer } from './player';
import { Input } from './input/input';
import { Device } from './render/rhi/rhi';
import { WorldRenderer, Camera } from './render/renderer';
import { MeshManager } from './render/meshmanager';
import { Hud } from './ui/hud';
import { IconRenderer } from './ui/icons';
import type { AtlasData } from './render/textures/atlas';
import type { StateTables } from '../common/block/registry';
import { stateToString, STATE_COUNT, stateFlags, F } from '../common/block/registry';
import { DimensionId, DIMENSIONS } from '../common/world/dimension';
import { ItemStack } from '../common/item/stack';
import { GameMode } from '../common/entity/player';
import { BIOMES } from '../common/worldgen/biomes';
import { t, TextComponent } from '../common/lang/i18n';
import { DIR_NAMES, dirFromYaw } from '../common/world/direction';
import type { Settings } from './settings';

export interface GameOptions {
  device: Device;
  atlas: AtlasData;
  tables: StateTables;
  conn: Connection;
  input: Input;
  uiRoot: HTMLElement;
  settings: Settings;
  playerName: string;
  meshWorkerFactory: () => Worker;
  meshWorkers: number;
  onDisconnect: (reason: string) => void;
  onPause: () => void;
  version: string;
}

export class Game {
  readonly level: ClientLevel;
  readonly player: LocalPlayer;
  readonly renderer: WorldRenderer;
  readonly meshes: MeshManager;
  readonly hud: Hud;
  readonly icons: IconRenderer;
  readonly conn: Connection;
  readonly input: Input;
  private running = false;
  private lastTickTime = 0;
  private tickAccum = 0;
  private frameTimes: number[] = [];
  fps = 0;
  private lastFrame = 0;
  private startTime = performance.now();
  loaded = false;
  loadProgress = 0;
  uiOpen = false;
  paused = false;
  private rafId = 0;
  entityId = 0;
  worldName = '';
  private suggestReq = 0;
  private onLoadedCb: (() => void) | null = null;
  readonly packetHandlers = new Map<string, (p: Packet) => void>();
  pingMs = 0;
  private lastPingSent = 0;
  serverMspt = 0;

  constructor(private readonly opts: GameOptions) {
    this.conn = opts.conn;
    this.input = opts.input;
    this.level = new ClientLevel('overworld');
    this.player = new LocalPlayer(this.level, (p) => this.conn.send(p));
    this.renderer = new WorldRenderer(opts.device, opts.atlas);
    this.renderer.settings.renderDistance = opts.settings.renderDistance;
    this.renderer.settings.fov = opts.settings.fov;
    this.renderer.settings.gamma = opts.settings.gamma;
    this.renderer.settings.caveCulling = opts.settings.caveCulling;
    this.meshes = new MeshManager(opts.device, this.level, opts.meshWorkerFactory, opts.meshWorkers, {
      tables: opts.tables,
      layers: opts.atlas.index,
      opts: { smoothLighting: opts.settings.smoothLighting, ao: opts.settings.ao, fancyLeaves: opts.settings.fancyLeaves, biomeBlend: opts.settings.biomeBlend },
    });
    this.icons = new IconRenderer(opts.atlas);
    this.hud = new Hud(this.icons);
    opts.uiRoot.appendChild(this.hud.root);
    this.conn.onPacket((p) => this.handlePacket(p));
    this.conn.onClose((r) => {
      if (this.running) opts.onDisconnect(r);
    });
    this.setupChat();
  }

  start(): void {
    this.running = true;
    this.lastTickTime = performance.now();
    this.conn.send({ type: 'hello', name: this.opts.playerName, viewDistance: this.opts.settings.renderDistance, lang: this.opts.settings.lang, protocol: 1, skin: {} });
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.meshes.dispose();
    this.hud.root.remove();
    this.conn.close();
  }

  onLoaded(cb: () => void): void {
    this.onLoadedCb = cb;
  }

  // ===========================================================================================
  // Packets
  // ===========================================================================================

  private handlePacket(p: Packet): void {
    const custom = this.packetHandlers.get(p.type);
    if (custom) {
      custom(p);
      return;
    }
    switch (p.type) {
      case 'login':
        this.entityId = p['entityId'] as number;
        this.player.entity.id = this.entityId;
        this.player.entity.player.name = p['name'] as string;
        this.worldName = p['worldName'] as string;
        this.switchDimension(p['dim'] as DimensionId);
        this.player.setGameMode(p['gameMode'] as GameMode);
        break;
      case 'respawn':
        this.switchDimension(p['dim'] as DimensionId);
        this.player.setGameMode(p['gameMode'] as GameMode);
        break;
      case 'gameMode':
        this.player.setGameMode(p['mode'] as GameMode);
        break;
      case 'abilities': {
        const a = this.player.entity.player.abilities;
        a.flying = p['flying'] as boolean;
        a.mayFly = p['mayFly'] as boolean;
        a.instabuild = p['instabuild'] as boolean;
        a.invulnerable = p['invulnerable'] as boolean;
        a.mayBuild = p['mayBuild'] as boolean;
        a.flySpeed = p['flySpeed'] as number;
        a.walkSpeed = p['walkSpeed'] as number;
        this.player.entity.input.flying = a.flying;
        break;
      }
      case 'chunk':
        this.level.loadChunk(p['data'] as Uint8Array);
        break;
      case 'unloadChunk':
        this.level.unloadChunk(p['cx'] as number, p['cz'] as number);
        break;
      case 'blockUpdate':
        this.level.setBlock(p['x'] as number, p['y'] as number, p['z'] as number, p['state'] as number);
        break;
      case 'multiBlockUpdate':
        this.level.applyMultiBlock(p['cx'] as number, p['sy'] as number, p['cz'] as number, p['entries'] as Int32Array);
        break;
      case 'lightUpdate':
        this.level.applyLight(p['cx'] as number, p['sy'] as number, p['cz'] as number, p['uniform'] as number, p['light'] as Uint8Array);
        break;
      case 'blockEntity':
        this.level.setBlockEntity(p['x'] as number, p['y'] as number, p['z'] as number, p['beType'] as string, p['data'] as Record<string, unknown> | null);
        break;
      case 'playerPosition':
        this.player.onTeleport(p);
        break;
      case 'moveAck':
        this.player.onMoveAck(p);
        break;
      case 'time':
        this.level.gameTime = p['gameTime'] as number;
        this.level.dayTime = p['dayTime'] as number;
        this.level.doDaylightCycle = p['doCycle'] as boolean;
        break;
      case 'weather':
        this.level.rain = p['rain'] as number;
        this.level.thunder = p['thunder'] as number;
        break;
      case 'keepAlive':
        this.conn.send({ type: 'keepAlive', id: p['id'] as number });
        break;
      case 'pong':
        this.pingMs = performance.now() - this.lastPingSent;
        break;
      case 'chat':
        this.hud.addChat(p['text'] as TextComponent, p['sender'] as string);
        break;
      case 'containerContent':
        if ((p['windowId'] as number) === 0) {
          const slots = p['slots'] as ItemStack[];
          const inv = this.player.inventory;
          for (let i = 0; i < slots.length && i < inv.slots.length; i++) inv.slots[i] = slots[i]!;
          inv.revision++;
        }
        break;
      case 'containerSlot':
        if ((p['windowId'] as number) === 0) this.player.inventory.set(p['slot'] as number, p['stack'] as ItemStack);
        break;
      case 'setCarried':
        this.player.inventory.selected = p['slot'] as number;
        break;
      case 'loadProgress': {
        const total = p['total'] as number, loaded = p['loaded'] as number;
        this.loadProgress = total ? loaded / total : 0;
        break;
      }
      case 'commandSuggestions':
        if ((p['requestId'] as number) === this.suggestReq) this.hud.setSuggestions(p['suggestions'] as string[]);
        break;
      case 'disconnect':
        this.running = false;
        this.opts.onDisconnect(JSON.stringify(p['reason']));
        break;
    }
  }

  private switchDimension(dim: DimensionId): void {
    this.meshes.clear();
    this.level.clear();
    this.level.dimId = dim;
    this.level.dim = DIMENSIONS[dim];
  }

  // ===========================================================================================
  // Chat
  // ===========================================================================================

  private setupChat(): void {
    const inp = this.hud.chatInput;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const msg = inp.value.trim();
        if (msg) {
          if (msg.startsWith('/')) this.conn.send({ type: 'command', command: msg.slice(1) });
          else this.conn.send({ type: 'chat', message: msg });
        }
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    });
    inp.addEventListener('input', () => {
      if (inp.value.startsWith('/')) {
        this.suggestReq++;
        this.conn.send({ type: 'commandSuggest', requestId: this.suggestReq, text: inp.value.slice(1) });
      } else this.hud.setSuggestions([]);
    });
  }

  openChat(prefix = ''): void {
    this.uiOpen = true;
    this.input.captured = false;
    this.input.releaseLock();
    this.hud.openChat(prefix);
  }

  closeChat(): void {
    this.hud.closeChat();
    this.uiOpen = false;
    this.input.captured = true;
    this.input.requestLock();
  }

  // ===========================================================================================
  // Frame
  // ===========================================================================================

  private frame(now: number): void {
    const dt = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.fps = Math.round(1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length));
    this.handleGlobalKeys();
    // Mouse look every frame
    if (!this.uiOpen && !this.paused) {
      const [mx, my] = this.input.consumeMouse();
      this.player.look(mx, my);
    } else this.input.consumeMouse();
    // Fixed-rate ticks
    this.tickAccum += now - this.lastTickTime;
    this.lastTickTime = now;
    if (this.tickAccum > 1000) this.tickAccum = 1000;
    while (this.tickAccum >= 50) {
      this.tick();
      this.tickAccum -= 50;
    }
    const partial = this.tickAccum / 50;
    // Loading state
    if (!this.loaded && this.level.chunks.size > 0) {
      const t0 = this.player.entity.transform;
      const cx = Math.floor(t0.x) >> 4, cz = Math.floor(t0.z) >> 4;
      if (this.loadProgress >= 0.99 || (this.meshes.get(cx, Math.floor(t0.y) >> 4, cz) && this.level.hasChunk(cx, cz))) {
        this.loaded = true;
        this.onLoadedCb?.();
      }
    }
    // Render
    const cam = this.camera(partial);
    this.meshes.update(cam.x, cam.y, cam.z, now);
    const sel = this.player.selectionShape();
    this.renderer.selection = sel?.shape ?? null;
    if (sel) this.renderer.selectionOrigin = [sel.x, sel.y, sel.z];
    this.renderer.time = (now - this.startTime) / 1000;
    this.opts.device.beginFrame();
    this.renderer.render(cam, this.level, this.meshes, partial, now);
    this.opts.device.endFrame();
    // HUD
    this.hud.update(this.player.inventory, now);
    if (this.hud.showDebug) this.hud.setDebug(...this.debugLines());
    else this.hud.setDebug([], []);
    this.input.endFrame();
  }

  private handleGlobalKeys(): void {
    const inp = this.input;
    if (this.uiOpen) return;
    if (inp.pressed('debug')) this.hud.showDebug = !this.hud.showDebug;
    if (inp.pressed('hideGui')) this.hud.hidden = !this.hud.hidden;
    if (inp.pressed('perspective')) this.player.thirdPerson = ((this.player.thirdPerson + 1) % 3) as 0 | 1 | 2;
    if (inp.pressed('chat')) this.openChat('');
    else if (inp.pressed('command')) this.openChat('/');
    if (inp.pressed('pause') && !this.paused) this.opts.onPause();
    const inv = this.player.inventory;
    const wheel = inp.consumeWheel();
    let sel = inv.selected;
    if (wheel !== 0) sel = (((sel + wheel) % 9) + 9) % 9;
    for (let i = 1; i <= 9; i++) if (inp.pressed(`hotbar${i}` as 'hotbar1')) sel = i - 1;
    if (sel !== inv.selected) {
      inv.selected = sel;
      this.conn.send({ type: 'setCarried', slot: sel });
    }
  }

  private tick(): void {
    this.level.gameTime++;
    if (this.level.doDaylightCycle) this.level.dayTime++;
    if (this.level.lightningFlash > 0) this.level.lightningFlash = Math.max(0, this.level.lightningFlash - 0.1);
    if (this.loaded && !this.paused) this.player.tick(this.input, this.uiOpen);
    else if (this.loaded) this.player.tick(this.input, true);
    if (performance.now() - this.lastPingSent > 2000) {
      this.lastPingSent = performance.now();
      this.conn.send({ type: 'ping', id: 1 });
    }
  }

  camera(partial: number): Camera {
    const e = this.player.entity;
    const tr = e.transform;
    let [x, y, z] = this.player.eyePos(partial);
    let yaw = tr.yaw, pitch = tr.pitch;
    const inp = e.input;
    let fov = this.renderer.settings.fov;
    if (inp.sprinting && !inp.flying) fov *= 1.12;
    else if (inp.flying && inp.sprinting) fov *= 1.1;
    if (this.input.isDown('zoom') && !this.uiOpen) fov *= 0.3;
    if (this.player.thirdPerson) {
      const back = this.player.thirdPerson === 1 ? 1 : -1;
      if (back < 0) { yaw += 180; pitch = -pitch; }
      const rad = (yaw * Math.PI) / 180, pr = (pitch * Math.PI) / 180;
      const dx = Math.sin(rad) * Math.cos(pr), dy = Math.sin(pr), dz = -Math.cos(rad) * Math.cos(pr);
      let dist = 4;
      for (let d = 0.1; d <= 4; d += 0.1) {
        const bx = Math.floor(x + dx * d), by = Math.floor(y + dy * d), bz = Math.floor(z + dz * d);
        if (stateFlags[this.level.getBlockState(bx, by, bz)]! & F.OPAQUE_CUBE) { dist = Math.max(0.1, d - 0.3); break; }
      }
      x += dx * dist; y += dy * dist; z += dz * dist;
    } else if (this.opts.settings.viewBobbing && e.physics.onGround) {
      const b = this.player.prevBob + (this.player.bob - this.player.prevBob) * partial;
      y += Math.abs(Math.cos(b * Math.PI)) * 0.04;
    }
    return { x, y, z, yaw, pitch, fov };
  }

  private debugLines(): [string[], string[]] {
    const e = this.player.entity.transform;
    const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    const light = this.level.getLight(bx, by, bz);
    const biome = BIOMES[this.level.getBiome(bx, by, bz)];
    const dev = this.opts.device;
    const facing = DIR_NAMES[dirFromYaw(e.yaw)];
    const r = this.renderer.stats, m = this.meshes.stats;
    const left = [
      t('debug.title', this.opts.version, dev.info.backend),
      `${this.fps} fps  (mesh ${m.avgMs.toFixed(1)} ms, pend ${m.pending}, up ${m.uploadsLastFrame})`,
      t('debug.sections', r.visibleSections, r.drawCalls, Math.round(r.triangles / 1000), r.cullMs.toFixed(2)),
      t('debug.chunks', this.level.chunks.size, this.meshes.meshes.size),
      `Dim: ${this.level.dimId}`,
      '',
      `XYZ: ${e.x.toFixed(3)} / ${e.y.toFixed(5)} / ${e.z.toFixed(3)}`,
      t('debug.block', `${bx} ${by} ${bz}`, `${bx & 15} ${by & 15} ${bz & 15}`),
      `Chunk: ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      t('debug.facing', t('direction.' + facing), e.yaw.toFixed(1), e.pitch.toFixed(1)),
      t('debug.light', Math.max(light >> 4, light & 15), light >> 4, light & 15),
      t('debug.biome', biome ? t('biome.' + biome.name) : '?'),
      t('debug.time', Math.floor(this.level.dayTime / 24000), Math.floor(this.level.dayTime % 24000), this.level.rain.toFixed(2)),
      t('debug.ping', this.pingMs.toFixed(0), this.player.corrections),
      t('debug.net', (this.conn.bytesIn / 1024).toFixed(0), (this.conn.bytesOut / 1024).toFixed(0)),
    ];
    const right = [
      `${dev.info.renderer}`,
      t('debug.gpuMemory', (dev.stats.textureBytes / 1048576).toFixed(1), (dev.stats.bufferBytes / 1048576).toFixed(1)),
      t('debug.states', STATE_COUNT),
      t('debug.memory', memoryMb()),
    ];
    const tgt = this.player.target;
    if (tgt) {
      right.push('', t('debug.target', tgt.x, tgt.y, tgt.z), stateToString(tgt.state));
    }
    return [left, right];
  }
}

function memoryMb(): string {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return m ? `${Math.round(m.usedJSHeapSize / 1048576)} / ${Math.round(m.jsHeapSizeLimit / 1048576)} MiB` : 'n/d';
}

