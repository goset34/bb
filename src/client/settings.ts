/** Client settings (persisted in localStorage when available). */
import type { Lang } from '../common/lang/i18n';
import type { Action } from './input/input';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra' | 'unlimited';
export type Backend = 'auto' | 'webgpu' | 'webgl2';

export interface Settings {
  lang: Lang;
  playerName: string;
  renderDistance: number;
  fov: number;
  gamma: number;
  guiScale: number;
  sensitivity: number;
  invertY: boolean;
  preset: GraphicsPreset;
  backend: Backend;
  smoothLighting: boolean;
  ao: boolean;
  fancyLeaves: boolean;
  clouds: boolean;
  caveCulling: boolean;
  biomeBlend: number;
  textureRes: 16 | 32 | 64 | 128;
  viewBobbing: boolean;
  masterVolume: number;
  musicVolume: number;
  blockVolume: number;
  hostileVolume: number;
  friendlyVolume: number;
  playerVolume: number;
  ambientVolume: number;
  subtitles: boolean;
  colorblind: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  reduceFlashing: boolean;
  bindings: Partial<Record<Action, string>>;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: navigator.language?.toLowerCase().startsWith('es') ? 'es' : navigator.language ? 'en' : 'es',
  playerName: 'Jugador',
  renderDistance: 10,
  fov: 70,
  gamma: 0.5,
  guiScale: 2,
  sensitivity: 0.5,
  invertY: false,
  preset: 'high',
  backend: 'auto',
  smoothLighting: true,
  ao: true,
  fancyLeaves: true,
  clouds: true,
  caveCulling: true,
  biomeBlend: 2,
  textureRes: 16,
  viewBobbing: true,
  masterVolume: 1,
  musicVolume: 0.5,
  blockVolume: 1,
  hostileVolume: 1,
  friendlyVolume: 1,
  playerVolume: 1,
  ambientVolume: 1,
  subtitles: false,
  colorblind: 'none',
  reduceFlashing: false,
  bindings: {},
};

const KEY = 'strata.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
