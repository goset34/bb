/**
 * Application shell: boot sequence, graphics backend selection (WebGPU → WebGL2 fallback),
 * menus, world lifecycle (integrated server + workers) and the active Game.
 */
import { initRegistries } from '../common/init';
import { exportStateTables, StateTables, STATE_COUNT, getRenderShape } from '../common/block/registry';
import { EXTRA_ITEM_SPRITES } from './render/textures/itemtex';
import { buildAtlas, AtlasData } from './render/textures/atlas';
import { ITEM_LIST } from '../common/item/items';
import { texturesOf } from './render/mesh/bake';
import { Device } from './render/rhi/rhi';
import { WebGL2Device } from './render/rhi/webgl2';
import { WebGPUDevice } from './render/rhi/webgpu';
import { Input } from './input/input';
import { Game } from './game';
import { loadSettings, saveSettings, Settings } from './settings';
import { setLang, t } from '../common/lang/i18n';
import {
  titleScreen, worldSelectScreen, createWorldScreen, loadingScreen, pauseScreen, optionsScreen, messageScreen, CreateWorldRequest, ScreenHost,
} from './ui/screens';
import { newWorldInfo, WorldInfo } from '../server/server';
import { listWorlds, saveWorldInfo, deleteWorld, exportWorldFiles, importWorldFiles } from '../server/storage/browser';
import { Connection, portTransport } from '../common/net/connection';
import { writeZip, readZip } from '../common/util/zip';
import { GeneratorSettings } from '../common/worldgen/generator';
import { Painter, finalize } from './render/textures/painter';
import { paintBlockTexture } from './render/textures/blocktex';

export const VERSION = '0.1.0';

interface RunningWorld {
  id: string;
  server: Worker;
  gens: Worker[];
  game: Game;
}

export class App implements ScreenHost {
  readonly root: HTMLElement;
  readonly uiRoot: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  settings: Settings;
  device!: Device;
  input!: Input;
  tables!: StateTables;
  atlas!: AtlasData;
  version = VERSION;
  private current: HTMLElement | null = null;
  private world: RunningWorld | null = null;
  private pauseEl: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = root.querySelector('canvas#view') as HTMLCanvasElement;
    this.uiRoot = root.querySelector('#ui') as HTMLElement;
    this.settings = loadSettings();
    setLang(this.settings.lang);
    this.applyGuiScale();
    (window as unknown as { __strata: App }).__strata = this;
  }

  saveSettings(): void {
    saveSettings(this.settings);
  }

  show(el: HTMLElement): void {
    if (this.current) this.current.remove();
    this.current = el;
    this.uiRoot.appendChild(el);
  }

  private applyGuiScale(): void {
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.guiScale));
  }

  // ===========================================================================================
  // Boot
  // ===========================================================================================

  async boot(): Promise<void> {
    const load = loadingScreen(t('menu.loading'));
    this.show(load.el);
    await nextFrame();
    initRegistries();
    this.tables = exportStateTables();
    load.set(t('menu.buildingTextures'), 0.1);
    await nextFrame();
    this.atlas = await this.buildTextures((p) => load.set(t('menu.buildingTextures'), 0.1 + p * 0.8));
    this.makeDirtBackground();
    try {
      this.device = await this.createDevice();
    } catch (e) {
      this.show(messageScreen(t('error.noGraphics'), String((e as Error)?.message ?? e), () => location.reload()));
      return;
    }
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    Object.assign(this.input.bindings, this.settings.bindings);
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.root);
    this.canvas.addEventListener('click', () => {
      if (this.world && !this.pauseEl && !this.world.game.uiOpen) this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.world && !this.pauseEl && !this.world.game.uiOpen && this.world.game.loaded) this.pause();
    });
    this.showTitle();
  }

  private async buildTextures(progress: (p: number) => void): Promise<AtlasData> {
    const names = new Set<string>();
    for (let s = 0; s < STATE_COUNT; s++) texturesOf(getRenderShape(s), names);
    for (let i = 0; i < 10; i++) names.add(`destroy_stage_${i}`);
    for (const it of ITEM_LIST) if (!it.block) names.add(`item/${it.id}`);
    for (const id of EXTRA_ITEM_SPRITES) names.add(`item/${id}`);
    names.add('missing');
    const size = this.settings.textureRes;
    // Yield to the browser between batches so the progress bar updates
    const list = [...names];
    const atlasPromise = new Promise<AtlasData>((resolve) => {
      let last = performance.now();
      const result = buildAtlas(list, size, (done, total) => {
        if (performance.now() - last > 100) {
          progress(done / total);
          last = performance.now();
        }
      });
      resolve(result);
    });
    return atlasPromise;
  }

  private makeDirtBackground(): void {
    const p = new Painter(16, 'dirt');
    paintBlockTexture(p, 'dirt');
    const out = finalize(p);
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(16, 16);
    img.data.set(out.rgba);
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--dirt-bg', `url(${c.toDataURL()})`);
  }

  private async createDevice(): Promise<Device> {
    const params = new URLSearchParams(location.search);
    const forced = params.get('gfx') ?? (this.settings.backend !== 'auto' ? this.settings.backend : null);
    if (forced !== 'webgl2' && 'gpu' in navigator) {
      try {
        const d = await WebGPUDevice.create(this.canvas);
        console.info('[gfx] WebGPU', d.info.renderer);
        return d;
      } catch (e) {
        console.warn('[gfx] WebGPU unavailable, falling back to WebGL2:', e);
      }
    }
    const d = new WebGL2Device(this.canvas);
    console.info('[gfx] WebGL2', d.info.renderer);
    return d;
  }

  private resize(): void {
    if (!this.device) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.root.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.root.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.device.resize(w, h);
  }

  // ===========================================================================================
  // Menus
  // ===========================================================================================

  showTitle(): void {
    this.show(titleScreen(this, {
      singleplayer: () => void this.showWorlds(),
      multiplayer: () => this.showMessage(t('multiplayer.title'), 'El cliente multijugador se activa en el hito H10.'),
      options: () => this.showOptions(() => this.showTitle()),
      langChanged: () => this.showTitle(),
    }));
  }

  private showMessage(title: string, detail: string): void {
    this.show(messageScreen(title, detail, () => this.showTitle()));
  }

  async showWorlds(): Promise<void> {
    let worlds: Array<{ id: string; info: WorldInfo }> = [];
    try {
      worlds = await listWorlds();
    } catch (e) {
      console.warn('[storage] IndexedDB unavailable', e);
    }
    this.show(worldSelectScreen(this, worlds, {
      play: (id) => {
        const w = worlds.find((x) => x.id === id);
        if (w) void this.startWorld(id, w.info, true);
      },
      create: () => this.showCreate(),
      remove: async (id) => { await deleteWorld(id); void this.showWorlds(); },
      exportWorld: async (id) => {
        const files = await exportWorldFiles(id);
        const zip = writeZip(files.map((f) => ({ name: `world/${f.name}`, data: f.data })));
        const name = worlds.find((w) => w.id === id)?.info.name ?? 'mundo';
        downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${name.replace(/[^\w\-]+/g, '_')}.strata.zip`);
      },
      importWorld: async (file) => {
        const files = await readZip(new Uint8Array(await file.arrayBuffer()));
        await importWorldFiles(files);
        void this.showWorlds();
      },
      back: () => this.showTitle(),
    }));
  }

  private showCreate(): void {
    this.show(createWorldScreen(this, {
      create: (req) => void this.createWorld(req),
      back: () => void this.showWorlds(),
    }));
  }

  showOptions(back: () => void): void {
    this.show(optionsScreen(this, {
      back,
      changed: (k) => this.applySetting(k),
    }));
  }

  private applySetting(k: keyof Settings): void {
    const g = this.world?.game;
    switch (k) {
      case 'guiScale': this.applyGuiScale(); break;
      case 'sensitivity': this.input.sensitivity = this.settings.sensitivity; break;
      case 'invertY': this.input.invertY = this.settings.invertY; break;
      case 'renderDistance':
        if (g) {
          g.renderer.settings.renderDistance = this.settings.renderDistance;
          g.conn.send({ type: 'settings', viewDistance: this.settings.renderDistance, lang: this.settings.lang, mainHand: 'right' });
        }
        break;
      case 'fov': if (g) g.renderer.settings.fov = this.settings.fov; break;
      case 'gamma': if (g) g.renderer.settings.gamma = this.settings.gamma; break;
      case 'caveCulling': if (g) g.renderer.settings.caveCulling = this.settings.caveCulling; break;
      case 'smoothLighting': case 'fancyLeaves': case 'biomeBlend': case 'ao':
        g?.meshes.setOptions({ smoothLighting: this.settings.smoothLighting, fancyLeaves: this.settings.fancyLeaves, biomeBlend: this.settings.biomeBlend, ao: this.settings.ao });
        break;
    }
  }

  // ===========================================================================================
  // Worlds
  // ===========================================================================================

  private async createWorld(req: CreateWorldRequest): Promise<void> {
    const gen: GeneratorSettings = { type: req.worldType, structures: req.structures, bonusChest: req.bonusChest };
    if (req.worldType === 'flat') gen.flatLayers = parseFlatLayers(req.flatLayers ?? '');
    if (req.worldType === 'single_biome') gen.singleBiome = req.singleBiome;
    const info = newWorldInfo(req.name, req.seed, gen, req.gameMode, req.difficulty, req.hardcore, req.allowCommands);
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    try {
      await saveWorldInfo(id, info);
    } catch (e) {
      console.warn('[storage] cannot persist world info', e);
    }
    await this.startWorld(id, info, true);
  }

  async startWorld(id: string, info: WorldInfo, persist: boolean): Promise<void> {
    const load = loadingScreen(t('menu.startingServer'));
    this.show(load.el);
    const hc = Math.max(2, navigator.hardwareConcurrency || 4);
    const genCount = Math.max(1, Math.min(6, Math.floor(hc / 2) - 1));
    const meshCount = Math.max(1, Math.min(4, Math.floor(hc / 4)));
    const server = new Worker(new URL('../workers/server.worker.ts', import.meta.url), { type: 'module', name: 'server' });
    const gens: Worker[] = [];
    const genPorts: MessagePort[] = [];
    for (let i = 0; i < genCount; i++) {
      const w = new Worker(new URL('../workers/gen.worker.ts', import.meta.url), { type: 'module', name: `gen${i}` });
      const ch = new MessageChannel();
      w.postMessage({ type: 'init', seed: info.seed, settings: info.generator, tables: this.tables, port: ch.port1 }, [ch.port1]);
      genPorts.push(ch.port2);
      gens.push(w);
    }
    const clientChannel = new MessageChannel();
    server.postMessage({ type: 'init', info, tables: this.tables, genPorts, clientPort: clientChannel.port1, worldId: id, persist }, [...genPorts, clientChannel.port1]);
    server.onerror = (e) => {
      console.error('[server worker]', e);
      this.show(messageScreen(t('error.generic', 'server'), String(e.message), () => this.quitToTitle()));
    };
    const conn = new Connection(portTransport(clientChannel.port2 as unknown as Parameters<typeof portTransport>[0]), 'client');
    const game = new Game({
      device: this.device, atlas: this.atlas, tables: this.tables, conn, input: this.input, uiRoot: this.uiRoot, settings: this.settings,
      playerName: this.settings.playerName, meshWorkers: meshCount, version: VERSION,
      meshWorkerFactory: () => new Worker(new URL('../workers/mesh.worker.ts', import.meta.url), { type: 'module', name: 'mesh' }),
      onDisconnect: (reason) => {
        this.stopWorld();
        this.show(messageScreen(t('disconnect.lost'), reason, () => this.showTitle()));
      },
      onPause: () => this.pause(),
      onQuit: () => void this.saveAndQuit(),
    });
    this.world = { id, server, gens, game };
    const progressTimer = setInterval(() => load.set(t('menu.preparingSpawn', Math.round(game.loadProgress * 100)), game.loadProgress), 100);
    game.onLoaded(() => {
      clearInterval(progressTimer);
      if (this.current === load.el) {
        this.current.remove();
        this.current = null;
      }
      this.input.requestLock();
    });
    game.start();
  }

  pause(): void {
    const w = this.world;
    if (!w || this.pauseEl) return;
    w.game.paused = true;
    this.input.releaseLock();
    this.input.captured = false;
    const el = pauseScreen(this, {
      resume: () => this.resume(),
      options: () => {
        el.remove();
        this.pauseEl = null;
        this.showOptions(() => {
          if (this.current) this.current.remove();
          this.current = null;
          w.game.paused = false;
          this.pause();
        });
      },
      saveQuit: () => void this.saveAndQuit(),
    });
    this.pauseEl = el;
    this.uiRoot.appendChild(el);
    w.server.postMessage({ type: 'pause', paused: true });
  }

  resume(): void {
    const w = this.world;
    if (!w) return;
    this.pauseEl?.remove();
    this.pauseEl = null;
    w.game.paused = false;
    this.input.captured = true;
    this.input.requestLock();
    w.server.postMessage({ type: 'pause', paused: false });
  }

  private async saveAndQuit(): Promise<void> {
    const w = this.world;
    if (!w) return;
    this.pauseEl?.remove();
    this.pauseEl = null;
    const load = loadingScreen(t('menu.savingWorld'));
    this.show(load.el);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      w.server.onmessage = (ev) => {
        if ((ev.data as { type: string }).type === 'stopped') {
          clearTimeout(timeout);
          resolve();
        }
      };
      w.server.postMessage({ type: 'stop' });
    });
    this.quitToTitle();
  }

  private stopWorld(): void {
    const w = this.world;
    if (!w) return;
    w.game.stop();
    w.server.terminate();
    for (const g of w.gens) g.terminate();
    this.world = null;
    this.input.releaseLock();
    this.input.captured = true;
  }

  quitToTitle(): void {
    this.stopWorld();
    this.showTitle();
  }

  get game(): Game | null {
    return this.world?.game ?? null;
  }
}

export function parseFlatLayers(spec: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const part of spec.split(',')) {
    const s = part.trim();
    if (!s) continue;
    const m = /^(?:(\d+)\*)?([a-z0-9_]+)$/.exec(s);
    if (!m) continue;
    out.push([m[2]!, m[1] ? parseInt(m[1], 10) : 1]);
  }
  return out;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
