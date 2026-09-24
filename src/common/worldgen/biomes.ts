/**
 * Biome registry: climate values, colours and categories. Feature lists and spawn tables are
 * attached by worldgen/features and server/spawning modules.
 */
export type Precipitation = 'none' | 'rain' | 'snow';
export type BiomeCategory =
  | 'plains' | 'forest' | 'taiga' | 'jungle' | 'savanna' | 'desert' | 'badlands' | 'swamp' | 'mountain' | 'ocean'
  | 'river' | 'beach' | 'icy' | 'mushroom' | 'underground' | 'inferno' | 'verge' | 'none';

export interface Biome {
  id: number;
  name: string;
  temperature: number;
  downfall: number;
  precipitation: Precipitation;
  category: BiomeCategory;
  /** Overrides (0xRRGGBB) */
  grass?: number;
  foliage?: number;
  dryFoliage?: number;
  water: number;
  waterFog: number;
  fog: number;
  sky: number;
  /** Grass colour modifier: 'swamp' noise or 'dark_forest' darkening. */
  grassModifier?: 'swamp' | 'dark_forest' | 'none';
  /** Ambient particles (e.g. crimson spores). */
  particles?: { type: string; chance: number };
  /** Music key. */
  music: string;
  /** Temperature modifier (frozen oceans use noise-based warm spots). */
  frozen?: boolean;
  dimension: 'overworld' | 'inferno' | 'verge';
  /** Mob spawn cost (soul sand valley etc.) & creature spawn probability. */
  creatureProbability: number;
  hasStructures: string[];
}

export const BIOMES: Biome[] = [];
export const BIOME_BY_NAME = new Map<string, Biome>();

function skyColor(temp: number): number {
  // Hue shifts with temperature: colder → bluer, warmer → cyan-ish
  const t = Math.max(-1, Math.min(1, temp / 3));
  const h = 0.62 - t * 0.05;
  const s = 0.5 + t * 0.1;
  return hsv(h, s, 1);
}

function hsv(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function def(name: string, temperature: number, downfall: number, category: BiomeCategory, extra: Partial<Biome> = {}): Biome {
  const precipitation: Precipitation = extra.precipitation ?? (downfall === 0 ? 'none' : temperature < 0.15 ? 'snow' : 'rain');
  const b: Biome = {
    id: BIOMES.length, name, temperature, downfall, precipitation, category,
    water: 0x3a74dc, waterFog: 0x05063a, fog: 0xc0d8ff, sky: skyColor(temperature),
    music: 'overworld', dimension: 'overworld', creatureProbability: 0.1, hasStructures: [],
    ...extra,
  };
  BIOMES.push(b);
  BIOME_BY_NAME.set(name, b);
  return b;
}

// ---- Overworld --------------------------------------------------------------------------------
def('the_void', 0.5, 0.5, 'none', { precipitation: 'none' });
def('plains', 0.8, 0.4, 'plains');
def('sunflower_plains', 0.8, 0.4, 'plains');
def('snowy_plains', 0.0, 0.5, 'icy');
def('ice_spikes', 0.0, 0.5, 'icy');
def('desert', 2.0, 0.0, 'desert', { music: 'desert' });
def('swamp', 0.8, 0.9, 'swamp', { grassModifier: 'swamp', water: 0x5e7a60, waterFog: 0x222518, foliage: 0x6a7039, music: 'swamp' });
def('mangrove_swamp', 0.8, 0.9, 'swamp', { grassModifier: 'swamp', water: 0x3b7c69, waterFog: 0x4c6158, foliage: 0x8db127, music: 'swamp' });
def('forest', 0.7, 0.8, 'forest', { music: 'forest' });
def('flower_forest', 0.7, 0.8, 'forest', { music: 'forest' });
def('birch_forest', 0.6, 0.6, 'forest', { music: 'forest' });
def('dark_forest', 0.7, 0.8, 'forest', { grassModifier: 'dark_forest', music: 'forest' });
def('old_growth_birch_forest', 0.6, 0.6, 'forest', { music: 'forest' });
def('old_growth_pine_taiga', 0.3, 0.8, 'taiga', { music: 'taiga' });
def('old_growth_spruce_taiga', 0.25, 0.8, 'taiga', { music: 'taiga' });
def('taiga', 0.25, 0.8, 'taiga', { music: 'taiga' });
def('snowy_taiga', -0.5, 0.4, 'taiga', { water: 0x3e56d4, music: 'taiga' });
def('savanna', 2.0, 0.0, 'savanna', { precipitation: 'none' });
def('savanna_plateau', 2.0, 0.0, 'savanna', { precipitation: 'none' });
def('windswept_hills', 0.2, 0.3, 'mountain');
def('windswept_gravelly_hills', 0.2, 0.3, 'mountain');
def('windswept_forest', 0.2, 0.3, 'mountain');
def('windswept_savanna', 2.0, 0.0, 'savanna', { precipitation: 'none' });
def('jungle', 0.95, 0.9, 'jungle', { music: 'jungle', creatureProbability: 0.1 });
def('sparse_jungle', 0.95, 0.8, 'jungle', { music: 'jungle' });
def('bamboo_jungle', 0.95, 0.9, 'jungle', { music: 'jungle' });
def('badlands', 2.0, 0.0, 'badlands', { grass: 0x927f4f, foliage: 0x9d8150, sky: 0x6ea3ff, music: 'badlands', precipitation: 'none' });
def('eroded_badlands', 2.0, 0.0, 'badlands', { grass: 0x927f4f, foliage: 0x9d8150, sky: 0x6ea3ff, music: 'badlands', precipitation: 'none' });
def('wooded_badlands', 2.0, 0.0, 'badlands', { grass: 0x927f4f, foliage: 0x9d8150, sky: 0x6ea3ff, music: 'badlands', precipitation: 'none' });
def('meadow', 0.5, 0.8, 'mountain', { water: 0x1452cc, music: 'meadow' });
def('cherry_grove', 0.5, 0.8, 'mountain', { water: 0x5fb4ea, grass: 0xb4d964, foliage: 0xb4d964, fog: 0xffd8e8, music: 'cherry' });
def('grove', -0.2, 0.8, 'mountain', { music: 'grove' });
def('snowy_slopes', -0.3, 0.9, 'mountain', { music: 'peaks' });
def('frozen_peaks', -0.7, 0.9, 'mountain', { music: 'peaks' });
def('jagged_peaks', -0.7, 0.9, 'mountain', { music: 'peaks' });
def('stony_peaks', 1.0, 0.3, 'mountain', { music: 'peaks' });
def('river', 0.5, 0.5, 'river');
def('frozen_river', 0.0, 0.5, 'river', { water: 0x3a3bc7 });
def('beach', 0.8, 0.4, 'beach');
def('snowy_beach', 0.05, 0.3, 'beach', { water: 0x3e56d4 });
def('stony_shore', 0.2, 0.3, 'beach');
def('warm_ocean', 0.5, 0.5, 'ocean', { water: 0x40d4ec, waterFog: 0x041f33, music: 'ocean' });
def('lukewarm_ocean', 0.5, 0.5, 'ocean', { water: 0x44acf0, waterFog: 0x051d33, music: 'ocean' });
def('deep_lukewarm_ocean', 0.5, 0.5, 'ocean', { water: 0x44acf0, waterFog: 0x051d33, music: 'ocean' });
def('ocean', 0.5, 0.5, 'ocean', { music: 'ocean' });
def('deep_ocean', 0.5, 0.5, 'ocean', { music: 'ocean' });
def('cold_ocean', 0.5, 0.5, 'ocean', { water: 0x3c56d4, waterFog: 0x050532, music: 'ocean' });
def('deep_cold_ocean', 0.5, 0.5, 'ocean', { water: 0x3c56d4, waterFog: 0x050532, music: 'ocean' });
def('frozen_ocean', 0.0, 0.5, 'ocean', { water: 0x3a38c8, waterFog: 0x050532, frozen: true, music: 'ocean' });
def('deep_frozen_ocean', 0.5, 0.5, 'ocean', { water: 0x3a38c8, waterFog: 0x050532, frozen: true, music: 'ocean' });
def('mushroom_fields', 0.9, 1.0, 'mushroom', { music: 'mushroom' });
def('dripstone_caves', 0.8, 0.4, 'underground', { music: 'dripstone' });
def('lush_caves', 0.5, 0.5, 'underground', { music: 'lush' });
def('deep_dark', 0.8, 0.4, 'underground', { music: 'deep_dark', creatureProbability: 0 });
def('pale_garden', 0.7, 0.8, 'forest', { water: 0x76889d, waterFog: 0x556980, grass: 0x778272, foliage: 0x878d76, fog: 0x817770, sky: 0xb9b9b9, music: 'pale_garden' });

// ---- Inferno ----------------------------------------------------------------------------------
def('inferno_wastes', 2.0, 0.0, 'inferno', { precipitation: 'none', dimension: 'inferno', fog: 0x330808, sky: 0, music: 'inferno_wastes' });
def('crimson_forest', 2.0, 0.0, 'inferno', { precipitation: 'none', dimension: 'inferno', fog: 0x330303, sky: 0, music: 'crimson', particles: { type: 'crimson_spore', chance: 0.025 } });
def('warped_forest', 2.0, 0.0, 'inferno', { precipitation: 'none', dimension: 'inferno', fog: 0x1a051a, sky: 0, music: 'warped', particles: { type: 'warped_spore', chance: 0.01428 } });
def('soul_sand_valley', 2.0, 0.0, 'inferno', { precipitation: 'none', dimension: 'inferno', fog: 0x1b4745, sky: 0, music: 'soul_sand', particles: { type: 'ash', chance: 0.00625 } });
def('basalt_deltas', 2.0, 0.0, 'inferno', { precipitation: 'none', dimension: 'inferno', fog: 0x685f70, sky: 0, music: 'basalt', particles: { type: 'white_ash', chance: 0.118093334 } });

// ---- Verge --------------------------------------------------------------------------------------
def('the_verge', 0.5, 0.5, 'verge', { precipitation: 'none', dimension: 'verge', fog: 0x0a080c, sky: 0, music: 'verge' });
def('verge_highlands', 0.5, 0.5, 'verge', { precipitation: 'none', dimension: 'verge', fog: 0x0a080c, sky: 0, music: 'verge' });
def('verge_midlands', 0.5, 0.5, 'verge', { precipitation: 'none', dimension: 'verge', fog: 0x0a080c, sky: 0, music: 'verge' });
def('small_verge_islands', 0.5, 0.5, 'verge', { precipitation: 'none', dimension: 'verge', fog: 0x0a080c, sky: 0, music: 'verge' });
def('verge_barrens', 0.5, 0.5, 'verge', { precipitation: 'none', dimension: 'verge', fog: 0x0a080c, sky: 0, music: 'verge' });

export function biome(name: string): Biome {
  const b = BIOME_BY_NAME.get(name);
  if (!b) throw new Error('Unknown biome ' + name);
  return b;
}

export function biomeId(name: string): number {
  return biome(name).id;
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

/** Procedural colormap: interpolate between tuned corner colours by (temperature, downfall). */
function colormap(temp: number, downfall: number, corners: [number, number, number][]): number {
  const t = Math.max(0, Math.min(1, temp));
  const d = Math.max(0, Math.min(1, downfall)) * t;
  // Barycentric over triangle: hot-dry (0), cold (1), hot-wet (2)
  const w0 = t - d;
  const w1 = 1 - t;
  const w2 = d;
  const c = [0, 1, 2].map((k) => corners[0]![k]! * w0 + corners[1]![k]! * w1 + corners[2]![k]! * w2);
  return (Math.round(c[0]!) << 16) | (Math.round(c[1]!) << 8) | Math.round(c[2]!);
}

const GRASS_CORNERS: [number, number, number][] = [[196, 184, 92], [128, 180, 150], [62, 176, 44]];
const FOLIAGE_CORNERS: [number, number, number][] = [[174, 164, 42], [96, 160, 118], [26, 162, 12]];

export function grassColor(b: Biome, x = 0, z = 0): number {
  if (b.grass !== undefined) return b.grass;
  let c = colormap(b.temperature, b.downfall, GRASS_CORNERS);
  if (b.grassModifier === 'swamp') {
    const n = Math.sin(x * 0.0225) * Math.cos(z * 0.0225);
    c = n < -0.1 ? 0x4b7a3a : 0x6b6d38;
  } else if (b.grassModifier === 'dark_forest') {
    c = (((c & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
  }
  return c;
}

export function foliageColor(b: Biome): number {
  if (b.foliage !== undefined) return b.foliage;
  return colormap(b.temperature, b.downfall, FOLIAGE_CORNERS);
}

export const BIRCH_FOLIAGE = 0x7fa55a;
export const SPRUCE_FOLIAGE = 0x5f9160;
export const MANGROVE_FOLIAGE = 0x8db127;
export const LILY_PAD_COLOR = 0x228b30;

/** Temperature at a height (colder with altitude above sea level + 17). */
export function temperatureAt(b: Biome, y: number, noise = 0): number {
  let t = b.temperature;
  if (b.frozen) t = noise > 0.1 ? 0.2 : t;
  if (y > 80) t -= (y - 80) * 0.00125 + noise * 0.05;
  return t;
}

export function coldEnoughToSnow(b: Biome, y: number): boolean {
  return temperatureAt(b, y) < 0.15 && b.precipitation !== 'none';
}
