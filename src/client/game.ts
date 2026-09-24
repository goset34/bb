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
import { t, TextComponent, resolveText } from '../common/lang/i18n';
import { DIR_NAMES, dirFromYaw } from '../common/world/direction';
import type { Settings } from './settings';
import { ClientEntities } from './entities';
import { EntityRenderer } from './render/entity/entityrenderer';
import './render/entity/renderers';
import { StatusHud } from './ui/status';
import { h, button } from './ui/dom';
import * as M from '../common/math/mat4';
import { InventoryMenu, MENU_TYPES } from '../common/menu/menus';
import '../common/menu/furnace';
import type { Menu, MenuPlayer, ClickMode } from '../common/menu/menu';
import { ContainerScreen } from './ui/containers';
import { CreativeScreen } from './ui/creative';
import { RecipeBook } from './ui/recipebook';
import { skinPortrait } from './render/entity/player';
import { ClientFx } from './fx';
import { getItem } from '../common/item/items';

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
  /** Save and return to the title screen. */
  onQuit: () => void;
  version: string;
}

export class Game {
  readonly level: ClientLevel;
  readonly player: LocalPlayer;
  readonly renderer: WorldRenderer;
  readonly meshes: MeshManager;
  readonly hud: Hud;
  readonly icons: IconRenderer;
  readonly entities: ClientEntities;
  readonly entityRenderer: EntityRenderer;
  readonly status: StatusHud;
  readonly fx: ClientFx;
  private readonly totemEl: HTMLImageElement;
  private deathEl: HTMLElement | null = null;
  private readonly nametags: HTMLDivElement;
  hardcore = false;
  difficulty = 2;
  /** Player inventory menu (window 0), the open container menu and its screen. */
  readonly invMenu: InventoryMenu;
  private openMenu: Menu | null = null;
  private screen: ContainerScreen | CreativeScreen | null = null;
  readonly recipeBook: RecipeBook;
  readonly menuPlayer: MenuPlayer;
  advancedTooltips = false;
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
  private lastCam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 70 };

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
    this.entities = new ClientEntities(this.level);
    this.player.entities = this.entities;
    this.entityRenderer = new EntityRenderer(opts.device, this.renderer, opts.atlas, this.level, this.entities, this.player);
    this.renderer.layers.push(this.entityRenderer);
    this.fx = new ClientFx(this.level, this.entities, this.player, opts.atlas, this.entityRenderer);
    this.totemEl = h('img', { class: 'totem-pop', alt: '', draggable: 'false' });
    this.status = new StatusHud(this.icons);
    this.nametags = h('div', { class: 'nametags' });
    this.hud.root.prepend(this.nametags, this.status.root, this.totemEl);
    const pl = this.player;
    this.menuPlayer = {
      inventory: pl.inventory,
      get creative() { return pl.gameMode === 'creative'; },
      drop: () => {},
    };
    this.invMenu = new InventoryMenu(pl.inventory);
    this.recipeBook = new RecipeBook(this.icons, this.menuPlayer, (windowId, recipe, all) => this.conn.send({ type: 'placeRecipe', windowId, recipe, all }));
    opts.input.onKey((code) => {
      if (!this.screen) return false;
      return this.screen.key(code);
    });
    this.entities.onEvent((_e, id, ev) => {
      if (id !== this.entityId) return;
      if (ev === 'hurt') this.player.onHurt();
    });
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
    // Server-set velocity of the local player (riptide, knockback) and explosion pushes
    if (p.type === 'entityVelocity' && p['id'] === this.entityId) {
      const ph = this.player.entity.physics;
      ph.vx = p['vx'] as number; ph.vy = p['vy'] as number; ph.vz = p['vz'] as number;
      return;
    }
    if (p.type === 'explosion') {
      const ph = this.player.entity.physics;
      ph.vx += p['kx'] as number; ph.vy += p['ky'] as number; ph.vz += p['kz'] as number;
      return;
    }
    if (this.entities.handle(p)) return;
    if (this.fx.handle(p, this.entityRenderer.breaking)) return;
    switch (p.type) {
      case 'login':
        this.entityId = p['entityId'] as number;
        this.player.entity.id = this.entityId;
        this.entities.localId = this.entityId;
        this.player.entity.player.name = p['name'] as string;
        this.entityRenderer.localSkin = `player/${p['name'] as string}`;
        this.worldName = p['worldName'] as string;
        this.hardcore = p['hardcore'] as boolean;
        this.difficulty = p['difficulty'] as number;
        this.status.hardcore = this.hardcore;
        this.switchDimension(p['dim'] as DimensionId);
        this.player.setGameMode(p['gameMode'] as GameMode);
        break;
      case 'respawn':
        if (p['dim'] !== this.level.dimId) this.switchDimension(p['dim'] as DimensionId);
        this.player.setGameMode(p['gameMode'] as GameMode);
        this.player.dead = false;
        this.hideDeathScreen();
        break;
      case 'health': {
        const pl = this.player;
        pl.health = p['health'] as number;
        pl.food = p['food'] as number;
        pl.saturation = p['saturation'] as number;
        pl.absorption = p['absorption'] as number;
        pl.maxHealth = p['maxHealth'] as number;
        if (pl.health <= 0) pl.dead = true;
        break;
      }
      case 'air':
        this.player.air = p['air'] as number;
        this.player.maxAir = p['maxAir'] as number;
        this.player.frozen = p['frozen'] as number;
        break;
      case 'experience':
        this.player.xpProgress = p['progress'] as number;
        this.player.xpLevel = p['level'] as number;
        this.player.xpTotal = p['total'] as number;
        break;
      case 'playerDeath':
        this.closeScreen(true);
        this.player.dead = true;
        this.showDeathScreen(p['message'] as TextComponent, p['score'] as number);
        break;
      case 'title':
        this.hud.title(p['kind'] as string, p['text'] as TextComponent, p['fadeIn'] as number, p['stay'] as number, p['fadeOut'] as number);
        break;
      case 'gameEvent':
        if (p['event'] === 'difficulty') this.difficulty = p['value'] as number;
        if (p['event'] === 'sleep') this.startSleeping(p['value'] as number);
        if (p['event'] === 'wake') this.stopSleeping();
        break;
      case 'cooldown':
        this.player.cooldowns.set(p['item'] as string, this.level.gameTime + (p['ticks'] as number));
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
      case 'containerContent': {
        const m = this.menuById(p['windowId'] as number);
        if (!m) break;
        const slots = p['slots'] as ItemStack[];
        for (let i = 0; i < slots.length && i < m.slots.length; i++) {
          const sl = m.slots[i]!;
          sl.container.set(sl.slot, slots[i]!);
        }
        m.carried = p['carried'] as ItemStack;
        m.stateId = p['stateId'] as number;
        this.player.inventory.revision++;
        break;
      }
      case 'containerSlot': {
        const m = this.menuById(p['windowId'] as number);
        if (!m) break;
        const slot = p['slot'] as number;
        const stack = p['stack'] as ItemStack;
        if (slot === -1) m.carried = stack;
        else if (m.slots[slot]) {
          const sl = m.slots[slot]!;
          sl.container.set(sl.slot, stack);
        }
        m.stateId = p['stateId'] as number;
        this.player.inventory.revision++;
        break;
      }
      case 'containerData': {
        const m = this.menuById(p['windowId'] as number);
        if (m) m.setData(p['prop'] as number, p['value'] as number);
        break;
      }
      case 'containerOpen': {
        const make = MENU_TYPES.get(p['kind'] as string) ?? MENU_TYPES.get('generic')!;
        const m = make({ windowId: p['windowId'] as number, inventory: this.player.inventory, size: p['size'] as number, extra: p['extra'] as Record<string, unknown> });
        this.closeScreen(false);
        this.openMenu = m;
        this.showScreen(new ContainerScreen(this.screenHost(), m, p['title'] as TextComponent));
        break;
      }
      case 'containerClose':
        if (this.openMenu && this.openMenu.windowId === (p['windowId'] as number)) this.closeScreen(false);
        break;
      case 'recipes': {
        const ids = p['ids'] as string[];
        if (p['action'] === 'init') this.recipeBook.known.clear();
        if (p['action'] === 'remove') for (const id of ids) this.recipeBook.known.delete(id);
        else for (const id of ids) this.recipeBook.known.add(id);
        if (p['action'] === 'add' && ids.length) this.hud.toast(t('recipeBook.unlocked'), t('recipeBook.unlockedDetail', ids.length));
        break;
      }
      case 'setCarried':
        this.player.inventory.selected = p['slot'] as number;
        break;
      case 'loadProgress': {
        const total = p['total'] as number, loaded = p['loaded'] as number;
        this.loadProgress = total ? loaded / total : 0;
        break;
      }
      case 'commandSuggestions':
        if ((p['requestId'] as number) === this.suggestReq) this.hud.setSuggestions(p['suggestions'] as string[], p['start'] as number);
        break;
      case 'disconnect':
        this.running = false;
        this.opts.onDisconnect(JSON.stringify(p['reason']));
        break;
    }
  }

  private switchDimension(dim: DimensionId): void {
    this.meshes.clear();
    this.entities.clear();
    this.fx.particles.clear();
    this.entityRenderer.breaking.clear();
    this.level.clear();
    this.level.dimId = dim;
    this.level.dim = DIMENSIONS[dim];
  }

  // ===========================================================================================
  // Chat
  // ===========================================================================================

  private readonly chatHistory: string[] = [];
  private historyPos = -1;

  private setupChat(): void {
    const inp = this.hud.chatInput;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const msg = inp.value.trim();
        if (msg) {
          if (this.chatHistory[this.chatHistory.length - 1] !== msg) this.chatHistory.push(msg);
          if (this.chatHistory.length > 100) this.chatHistory.shift();
          if (msg.startsWith('/')) this.conn.send({ type: 'command', command: msg.slice(1) });
          else this.conn.send({ type: 'chat', message: msg });
        }
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.hud.cycleSuggestion(e.shiftKey ? -1 : 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (this.hud.hasSuggestions && inp.value.startsWith('/')) { this.hud.cycleSuggestion(dir); return; }
        if (!this.chatHistory.length) return;
        if (this.historyPos < 0) this.historyPos = this.chatHistory.length;
        this.historyPos = Math.max(0, Math.min(this.chatHistory.length, this.historyPos + dir));
        inp.value = this.chatHistory[this.historyPos] ?? '';
      }
    });
    inp.addEventListener('input', () => {
      this.historyPos = -1;
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
    this.historyPos = -1;
    if (prefix.startsWith('/')) {
      this.suggestReq++;
      this.conn.send({ type: 'commandSuggest', requestId: this.suggestReq, text: prefix.slice(1) });
    }
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
    this.lastCam = cam;
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
    this.status.update(this.player, this.entities, this.level.gameTime);
    this.screen?.render();
    this.updateTotem(partial);
    if (this.sleepEl) {
      const shade = this.sleepEl.firstChild as HTMLElement;
      shade.style.opacity = String(Math.min(0.85, (this.player.sleepTicks + partial) / 100 * 0.85));
    }
    this.updateNametags();
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
    if (!this.paused && !this.player.dead) {
      if (inp.pressed('drop')) this.player.drop(inp.isCodeDown('ControlLeft') || inp.isCodeDown('ControlRight'));
      if (inp.pressed('swapHands')) this.player.swapHands();
      if (inp.pressed('inventory')) this.openInventory();
    }
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
    this.entities.tick();
    this.fx.tick();
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
    let roll = 0;
    const pl = this.player;
    if (pl.hurtTilt > 0) {
      const k = (pl.hurtTilt - partial) / 10;
      roll = (-Math.sin(k * k * k * k * Math.PI) * 14 * Math.PI) / 180;
    }
    if (pl.dead) {
      const d = Math.min(1, (pl.anim.deathTime + partial) / 20);
      y -= d * (pl.entity.physics.eyeHeight - 0.2);
      roll = (d * 40 * Math.PI) / 180;
    }
    return { x, y, z, yaw, pitch, fov, roll };
  }

  // ===========================================================================================
  // Menus
  // ===========================================================================================

  private menuById(id: number): Menu | null {
    if (id === 0) return this.invMenu;
    return this.openMenu && this.openMenu.windowId === id ? this.openMenu : null;
  }

  private screenHost() {
    return {
      icons: this.icons,
      menuPlayer: this.menuPlayer,
      recipeBook: this.recipeBook,
      advancedTooltips: this.advancedTooltips,
      sendClick: (menu: Menu, slot: number, button: number, mode: ClickMode) => {
        menu.clicked(slot, button, mode, this.menuPlayer);
        this.conn.send({ type: 'containerClick', windowId: menu.windowId, stateId: menu.stateId, slot, button, mode });
        this.player.inventory.revision++;
      },
      close: () => this.closeScreen(true),
      keyAction: (code: string) => this.keyAction(code),
      isCtrl: () => this.input.isCodeDown('ControlLeft') || this.input.isCodeDown('ControlRight'),
      portrait: () => {
        const tex = this.entityRenderer.textures;
        const inv = this.player.inventory;
        const armor = [36, 37, 38, 39].map((i) => {
          const mat = getItem(inv.get(i).id)?.armor?.material;
          return mat ? tex.pixels(`armor/${mat}${i === 37 ? '/legs' : ''}`) : null;
        });
        return skinPortrait(tex.pixels(this.entityRenderer.localSkin), armor);
      },
    };
  }

  /** Action bound to a key code (for screens). */
  private keyAction(code: string): string | null {
    for (const [a, c] of Object.entries(this.input.bindings)) if (c === code) return a;
    return null;
  }

  private showScreen(sc: ContainerScreen | CreativeScreen): void {
    this.screen = sc;
    this.uiOpen = true;
    this.input.captured = false;
    this.input.releaseAll();
    this.input.releaseLock();
    this.opts.uiRoot.appendChild(sc.el);
  }

  /** Close the open screen; `notify` tells the server (returns crafting grid items). */
  closeScreen(notify: boolean): void {
    const sc = this.screen;
    if (!sc) return;
    sc.destroy();
    this.screen = null;
    const m = this.openMenu ?? (sc instanceof ContainerScreen ? this.invMenu : null);
    if (m) {
      m.removed(this.menuPlayer);
      if (notify) this.conn.send({ type: 'containerClose', windowId: m.windowId });
    }
    this.openMenu = null;
    this.player.inventory.revision++;
    if (!this.player.dead) {
      this.uiOpen = false;
      this.input.captured = true;
      this.input.requestLock();
    }
  }

  openInventory(): void {
    if (this.screen || this.player.dead) return;
    if (this.player.gameMode === 'creative') {
      this.showScreen(new CreativeScreen({
        icons: this.icons, menu: this.invMenu, player: this.menuPlayer, advancedTooltips: this.advancedTooltips,
        sendSlot: (slot, stack) => this.conn.send({ type: 'creativeSlot', slot, stack }),
        close: () => this.closeScreen(true),
        keyAction: (code) => this.keyAction(code),
      }));
      return;
    }
    if (this.player.gameMode === 'spectator') return;
    this.showScreen(new ContainerScreen(this.screenHost(), this.invMenu, { key: 'container.inventory' }));
  }

  // ===========================================================================================
  // Death screen
  // ===========================================================================================

  private showDeathScreen(message: TextComponent, score: number): void {
    this.hideDeathScreen();
    this.uiOpen = true;
    this.input.captured = false;
    this.input.releaseLock();
    const respawn = button(this.hardcore ? t('deathScreen.spectate') : t('deathScreen.respawn'), () => {
      this.conn.send({ type: 'clientCommand', action: 'respawn' });
    });
    const title = button(t('deathScreen.titleScreen'), () => this.opts.onQuit());
    respawn.disabled = true;
    title.disabled = true;
    setTimeout(() => { respawn.disabled = false; title.disabled = false; }, 1000);
    this.deathEl = h('div', { class: 'screen death' },
      h('div', { class: 'death-title txt' }, this.hardcore ? t('deathScreen.title.hardcore') : t('deathScreen.title')),
      h('div', { class: 'death-cause txt' }, resolveText(message)),
      h('div', { class: 'death-score txt' }, t('deathScreen.score', score)),
      respawn, title,
    );
    this.opts.uiRoot.appendChild(this.deathEl);
  }

  private hideDeathScreen(): void {
    if (!this.deathEl) return;
    this.deathEl.remove();
    this.deathEl = null;
    this.uiOpen = false;
    this.input.captured = true;
    this.input.requestLock();
  }

  // ===========================================================================================
  // Sleeping
  // ===========================================================================================

  private sleepEl: HTMLDivElement | null = null;

  private startSleeping(facing: number): void {
    this.closeScreen(true);
    this.player.sleeping = facing;
    this.player.sleepTicks = 0;
    this.player.entity.physics.eyeHeight = 0.2;
    this.uiOpen = true;
    this.input.captured = false;
    this.input.releaseLock();
    const leave = button(t('sleep.leave'), () => this.conn.send({ type: 'playerCommand', action: 'stop_sleeping', data: 0 }));
    this.sleepEl = h('div', { class: 'screen sleep' }, h('div', { class: 'sleep-shade' }), leave);
    this.opts.uiRoot.appendChild(this.sleepEl);
  }

  private stopSleeping(): void {
    this.player.sleeping = null;
    this.player.entity.physics.eyeHeight = 1.62;
    this.sleepEl?.remove();
    this.sleepEl = null;
    if (!this.player.dead && !this.screen) {
      this.uiOpen = false;
      this.input.captured = true;
      this.input.requestLock();
    }
  }

  /** Totem of undying pop-up animation (local player). */
  private updateTotem(partial: number): void {
    const k = this.fx.totemTicks;
    if (k <= 0) { this.totemEl.style.display = 'none'; return; }
    const t = (40 - k + partial) / 40;
    this.totemEl.src = this.icons.icon('totem_of_undying');
    this.totemEl.style.display = '';
    const s = t < 0.3 ? t / 0.3 * 3 : 3 + (t - 0.3) * 2;
    this.totemEl.style.transform = `translate(-50%, -50%) scale(${s}) rotate(${Math.sin(t * 12) * 10 * (1 - t)}deg)`;
    this.totemEl.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
  }

  /** Position HTML name tags over other players. */
  private updateNametags(): void {
    const labels = this.entityRenderer.labels;
    const el = this.nametags;
    while (el.children.length < labels.length) el.appendChild(h('div', { class: 'nametag txt' }));
    while (el.children.length > labels.length) el.lastChild!.remove();
    const vp = this.renderer.matrices.viewProj;
    const cam = this.lastCam;
    const w = this.opts.uiRoot.clientWidth, hh = this.opts.uiRoot.clientHeight;
    labels.forEach((l, i) => {
      const node = el.children[i] as HTMLDivElement;
      const p = M.transformPoint(vp, l.x - cam.x, l.y - cam.y, l.z - cam.z);
      const cw = p[3]!;
      if (cw <= 0.05) { node.style.display = 'none'; return; }
      node.style.display = '';
      node.textContent = l.text;
      node.classList.toggle('sneak', l.sneaking);
      node.style.left = `${((p[0]! / cw) * 0.5 + 0.5) * w}px`;
      node.style.top = `${(0.5 - (p[1]! / cw) * 0.5) * hh}px`;
    });
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

