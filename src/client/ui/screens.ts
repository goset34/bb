/** Menu screens (DOM): title, world selection, world creation, loading, pause, options, errors. */
import { h, button, slider, cycleButton, clear } from './dom';
import { t, setLang, getLang, Lang } from '../../common/lang/i18n';
import type { Settings } from '../settings';
import type { WorldInfo } from '../../server/server';
import type { WorldType } from '../../common/worldgen/generator';
import type { GameMode } from '../../common/entity/player';

export interface ScreenHost {
  root: HTMLElement;
  settings: Settings;
  saveSettings(): void;
  show(screen: HTMLElement): void;
  version: string;
}

export interface CreateWorldRequest {
  name: string;
  seed: string;
  gameMode: GameMode;
  hardcore: boolean;
  difficulty: number;
  worldType: WorldType;
  allowCommands: boolean;
  bonusChest: boolean;
  structures: boolean;
  flatLayers?: string;
  singleBiome?: string;
}

export function screen(cls: string, ...children: Array<Node | null | false>): HTMLDivElement {
  return h('div', { class: `screen ${cls}` }, ...children);
}

export function titleScreen(host: ScreenHost, actions: { singleplayer(): void; multiplayer(): void; options(): void; langChanged(): void }): HTMLDivElement {
  const langBtn = cycleButton<Lang>((l) => `${t('menu.language')}: ${l === 'es' ? 'Español' : 'English'}`, ['es', 'en'], getLang(), (l) => {
    host.settings.lang = l;
    setLang(l);
    host.saveSettings();
    actions.langChanged();
  }, 'half');
  return screen('title-screen',
    h('div', { class: 'title-logo' }, t('game.title')),
    h('div', { class: 'title-sub txt' }, t('game.subtitle')),
    button(t('menu.singleplayer'), actions.singleplayer),
    button(t('menu.multiplayer'), actions.multiplayer),
    h('div', { class: 'row' }, button(t('menu.options'), actions.options, 'half'), langBtn),
    h('div', { class: 'txt', style: { position: 'absolute', left: '0.5em', bottom: '0.4em', color: '#ccc' } }, `STRATA ${host.version}`),
    h('div', { class: 'txt', style: { position: 'absolute', right: '0.5em', bottom: '0.4em', color: '#ccc' } }, 'Todos los recursos generados proceduralmente'),
  );
}

export function worldSelectScreen(host: ScreenHost, worlds: Array<{ id: string; info: WorldInfo }>, actions: { play(id: string): void; create(): void; remove(id: string): void; exportWorld(id: string): void; importWorld(file: File): void; back(): void }): HTMLDivElement {
  let selected = worlds[0]?.id ?? null;
  const list = h('div', { class: 'list' });
  const playBtn = button(t('selectWorld.play'), () => selected && actions.play(selected), 'half');
  const delBtn = button(t('selectWorld.delete'), () => {
    if (!selected) return;
    const w = worlds.find((x) => x.id === selected);
    if (w && confirm(t('selectWorld.deleteConfirm', w.info.name))) actions.remove(selected);
  }, 'half');
  const expBtn = button(t('selectWorld.export'), () => selected && actions.exportWorld(selected), 'half');
  const render = () => {
    clear(list);
    if (!worlds.length) list.appendChild(h('div', { class: 'item txt' }, t('selectWorld.empty')));
    for (const w of worlds) {
      const mode = w.info.hardcore ? t('gameMode.hardcore') : t(`gameMode.${w.info.gameMode}`);
      const date = new Date(w.info.lastPlayed).toLocaleString();
      const it = h('div', { class: `item txt ${w.id === selected ? 'sel' : ''}` },
        h('div', { class: 'n' }, w.info.name),
        h('div', { class: 'd' }, `${t('selectWorld.lastPlayed', date)} · ${mode} · ${t(`worldType.${w.info.generator.type}`)}`),
      );
      it.addEventListener('click', () => { selected = w.id; render(); });
      it.addEventListener('dblclick', () => actions.play(w.id));
      list.appendChild(it);
    }
    playBtn.disabled = delBtn.disabled = expBtn.disabled = !selected;
  };
  render();
  const fileInput = h('input', { type: 'file', accept: '.zip,.strata', style: { display: 'none' } }) as HTMLInputElement;
  fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) actions.importWorld(fileInput.files[0]); });
  return screen('dirt',
    h('div', { class: 'txt', style: { fontSize: '1.4em' } }, t('selectWorld.title')),
    list,
    h('div', { class: 'row' }, playBtn, button(t('selectWorld.create'), actions.create, 'half')),
    h('div', { class: 'row' }, delBtn, expBtn),
    h('div', { class: 'row' }, button(t('selectWorld.import'), () => fileInput.click(), 'half'), button(t('menu.back'), actions.back, 'half')),
    fileInput,
  );
}

export function createWorldScreen(host: ScreenHost, actions: { create(req: CreateWorldRequest): void; back(): void }): HTMLDivElement {
  const req: CreateWorldRequest = {
    name: t('createWorld.defaultName'), seed: '', gameMode: 'survival', hardcore: false, difficulty: 2, worldType: 'normal',
    allowCommands: true, bonusChest: false, structures: true, flatLayers: 'bedrock,2*dirt,grass_block', singleBiome: 'plains',
  };
  const nameIn = h('input', { class: 'input', value: req.name, maxlength: '32' }) as HTMLInputElement;
  const seedIn = h('input', { class: 'input', value: '', maxlength: '64' }) as HTMLInputElement;
  const flatIn = h('input', { class: 'input', value: 'bedrock,2*dirt,grass_block' }) as HTMLInputElement;
  const flatField = h('div', { class: 'field', style: { display: 'none' } }, h('label', { class: 'txt' }, t('createWorld.flatPreset')), flatIn);
  const biomeIn = h('input', { class: 'input', value: 'plains' }) as HTMLInputElement;
  const biomeField = h('div', { class: 'field', style: { display: 'none' } }, h('label', { class: 'txt' }, t('createWorld.singleBiome')), biomeIn);
  const modes: Array<GameMode | 'hardcore'> = ['survival', 'creative', 'adventure', 'spectator', 'hardcore'];
  const types: WorldType[] = ['normal', 'flat', 'floating_islands', 'amplified', 'single_biome', 'debug_simple'];
  return screen('dirt',
    h('div', { class: 'txt', style: { fontSize: '1.4em' } }, t('createWorld.title')),
    h('div', { class: 'field' }, h('label', { class: 'txt' }, t('createWorld.name')), nameIn),
    h('div', { class: 'field' }, h('label', { class: 'txt' }, t('createWorld.seed')), seedIn),
    h('div', { class: 'row' },
      cycleButton<GameMode | 'hardcore'>((m) => `${t('createWorld.gameMode')}: ${t(`gameMode.${m}`)}`, modes, 'survival', (m) => {
        req.hardcore = m === 'hardcore';
        req.gameMode = m === 'hardcore' ? 'survival' : m;
        if (req.hardcore) req.difficulty = 3;
      }, 'half'),
      cycleButton<number>((d) => `${t('createWorld.difficulty')}: ${t(`difficulty.${d}`)}`, [2, 3, 0, 1], 2, (d) => { req.difficulty = d; }, 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton<WorldType>((w) => `${t('createWorld.worldType')}: ${t(`worldType.${w}`)}`, types, 'normal', (w) => {
        req.worldType = w;
        flatField.style.display = w === 'flat' ? '' : 'none';
        biomeField.style.display = w === 'single_biome' ? '' : 'none';
      }, 'half'),
      cycleButton<boolean>((b) => `${t('createWorld.allowCommands')}: ${b ? t('options.on') : t('options.off')}`, [true, false], true, (b) => { req.allowCommands = b; }, 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton<boolean>((b) => `${t('createWorld.structures')}: ${b ? t('options.on') : t('options.off')}`, [true, false], true, (b) => { req.structures = b; }, 'half'),
      cycleButton<boolean>((b) => `${t('createWorld.bonusChest')}: ${b ? t('options.on') : t('options.off')}`, [false, true], false, (b) => { req.bonusChest = b; }, 'half'),
    ),
    flatField, biomeField,
    h('div', { class: 'row' },
      button(t('createWorld.create'), () => {
        req.name = nameIn.value.trim() || t('createWorld.defaultName');
        req.seed = seedIn.value.trim();
        req.flatLayers = flatIn.value;
        req.singleBiome = biomeIn.value.trim() || 'plains';
        actions.create(req);
      }, 'half'),
      button(t('menu.cancel'), actions.back, 'half'),
    ),
  );
}

export function loadingScreen(text: string): { el: HTMLDivElement; set(text: string, progress: number): void } {
  const label = h('div', { class: 'txt' }, text);
  const bar = h('div');
  const el = screen('dirt', label, h('div', { class: 'progress' }, bar));
  return {
    el,
    set(txt: string, progress: number) {
      label.textContent = txt;
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    },
  };
}

export function pauseScreen(host: ScreenHost, actions: { resume(): void; options(): void; saveQuit(): void; openLan?(): void; advancements?(): void; stats?(): void }): HTMLDivElement {
  return screen('dim',
    h('div', { class: 'txt', style: { fontSize: '1.3em', marginBottom: '1em' } }, t('menu.paused')),
    button(t('menu.returnToGame'), actions.resume),
    h('div', { class: 'row' },
      button(t('menu.advancements'), () => actions.advancements?.(), 'half'),
      button(t('menu.statistics'), () => actions.stats?.(), 'half'),
    ),
    h('div', { class: 'row' },
      button(t('menu.options'), actions.options, 'half'),
      button(t('menu.openToLan'), () => actions.openLan?.(), 'half'),
    ),
    button(t('menu.saveAndQuit'), actions.saveQuit),
  );
}

export function optionsScreen(host: ScreenHost, actions: { back(): void; changed(key: keyof Settings): void }): HTMLDivElement {
  const s = host.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    s[k] = v;
    host.saveSettings();
    actions.changed(k);
  };
  const onOff = (b: boolean) => (b ? t('options.on') : t('options.off'));
  return screen('dirt',
    h('div', { class: 'txt', style: { fontSize: '1.3em' } }, t('options.title')),
    h('div', { class: 'row' },
      slider({ min: 2, max: 32, step: 1, value: s.renderDistance, label: (v) => t('options.renderDistance', v), onChange: (v) => set('renderDistance', v) }),
    ),
    h('div', { class: 'row' },
      slider({ min: 30, max: 110, step: 1, value: s.fov, label: (v) => t('options.fov', v), onChange: (v) => set('fov', v) }),
    ),
    h('div', { class: 'row' },
      slider({ min: 0, max: 1, step: 0.05, value: s.gamma, label: (v) => t('options.gamma', Math.round(v * 100) + '%'), onChange: (v) => set('gamma', v) }),
    ),
    h('div', { class: 'row' },
      slider({ min: 0, max: 1, step: 0.01, value: s.sensitivity, label: (v) => t('options.sensitivity', Math.round(v * 200) + '%'), onChange: (v) => set('sensitivity', v) }),
    ),
    h('div', { class: 'row' },
      cycleButton((p) => `${t('options.preset')}: ${t(`options.preset.${p}`)}`, ['low', 'medium', 'high', 'ultra', 'unlimited'] as const, s.preset, (p) => set('preset', p), 'half'),
      cycleButton((b) => `${t('options.backend')}: ${b === 'auto' ? t('options.backend.auto') : b.toUpperCase()}`, ['auto', 'webgpu', 'webgl2'] as const, s.backend, (b) => set('backend', b), 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton((b) => `${t('options.smoothLighting')}: ${onOff(b)}`, [true, false], s.smoothLighting, (b) => set('smoothLighting', b), 'half'),
      cycleButton((b) => `${t('options.fancyLeaves')}: ${onOff(b)}`, [true, false], s.fancyLeaves, (b) => set('fancyLeaves', b), 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton((b) => `${t('options.caveCulling')}: ${onOff(b)}`, [true, false], s.caveCulling, (b) => set('caveCulling', b), 'half'),
      cycleButton((b) => `${t('options.viewBobbing')}: ${onOff(b)}`, [true, false], s.viewBobbing, (b) => set('viewBobbing', b), 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton((n) => `${t('options.guiScale', n)}`, [1, 2, 3, 4], s.guiScale, (n) => set('guiScale', n), 'half'),
      cycleButton((n) => `${t('options.textureRes')}: ${n}×${n}`, [16, 32, 64, 128] as const, s.textureRes, (n) => set('textureRes', n), 'half'),
    ),
    h('div', { class: 'row' },
      cycleButton((b) => `${t('options.invertY')}: ${onOff(b)}`, [false, true], s.invertY, (b) => set('invertY', b), 'half'),
      cycleButton((n) => t('options.biomeBlend', `${n * 2 + 1}×${n * 2 + 1}`), [0, 1, 2, 3], s.biomeBlend, (n) => set('biomeBlend', n), 'half'),
    ),
    button(t('menu.done'), actions.back),
  );
}

export function messageScreen(title: string, detail: string, back: () => void): HTMLDivElement {
  return screen('dirt',
    h('div', { class: 'txt', style: { fontSize: '1.3em' } }, title),
    h('div', { class: 'error-box' }, detail),
    button(t('menu.back'), back),
  );
}
