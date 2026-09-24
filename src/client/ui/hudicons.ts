/**
 * Procedural HUD icons (9×9 status icons, 18×18 effect icons) drawn from small ASCII masks and
 * palettes, cached as data URLs. All designs are original to this project.
 */

type Palette = Record<string, string | null>;

const cache = new Map<string, string>();

function draw(mask: string[], pal: Palette, scale = 1): string {
  const h = mask.length, w = mask[0]!.length;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = pal[mask[y]![x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c.toDataURL();
}

function cached(key: string, make: () => string): string {
  let v = cache.get(key);
  if (!v) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const HEART = [
  '.ooo.ooo.',
  'ohhfofffo',
  'ohffffffo',
  'offfffffo',
  '.offfffo.',
  '..offfo..',
  '...ofo...',
  '....o....',
  '.........',
];

const HEART_HARDCORE = [
  '.ooo.ooo.',
  'ohhfofffo',
  'ohfffkffo',
  'offfkfkfo',
  '.offfffo.',
  '..offfo..',
  '...ofo...',
  '....o....',
  '.........',
];

const SHANK = [
  '......oo.',
  '.....obbo',
  '....obbo.',
  '..ooobo..',
  '.ommmmo..',
  'ohmmmmo..',
  'ommmmmo..',
  '.ommmo...',
  '..ooo....',
];

const ARMOR = [
  'oo.....oo',
  'ofo...ofo',
  'offoooffo',
  'ohfffffoo',
  '.ohffffo.',
  '.offfffo.',
  '.offfffo.',
  '.ooooooo.',
  '.........',
];

const BUBBLE = [
  '..ooooo..',
  '.oh....o.',
  'oh......o',
  'o.......o',
  'o.......o',
  'o.......o',
  '.o.....o.',
  '..ooooo..',
  '.........',
];

const BUBBLE_POP = [
  '.........',
  '..o...o..',
  '...o.o...',
  '.o.....o.',
  '.........',
  '.o.....o.',
  '...o.o...',
  '..o...o..',
  '.........',
];

export type HeartKind = 'normal' | 'poison' | 'wither' | 'frozen' | 'absorb';

const HEART_COLORS: Record<HeartKind, [string, string]> = {
  normal: ['#e0282c', '#ff8f8f'],
  poison: ['#7c9a23', '#c5dd71'],
  wither: ['#2e2a2a', '#6c6464'],
  frozen: ['#7ec7f0', '#e6f7ff'],
  absorb: ['#e7b829', '#fff29a'],
};

/** Heart icon: `fill` 0 = empty container, 1 = half, 2 = full. */
export function heartIcon(kind: HeartKind, fill: 0 | 1 | 2, hardcore: boolean, blink: boolean): string {
  return cached(`heart:${kind}:${fill}:${hardcore}:${blink}`, () => {
    const [f, hl] = HEART_COLORS[kind];
    const mask = (hardcore ? HEART_HARDCORE : HEART).map((row) => row.split('').map((ch, x) => {
      if (ch === 'o') return 'o';
      if (ch === '.') return '.';
      if (fill === 0) return 'e';
      if (fill === 1 && x >= 5) return 'e';
      return ch;
    }).join(''));
    return draw(mask, { o: blink ? '#ffffff' : '#1a0a0a', f, h: hl, k: '#ffffff', e: '#3a1414' });
  });
}

export function foodIcon(fill: 0 | 1 | 2, hunger: boolean): string {
  return cached(`food:${fill}:${hunger}`, () => {
    const meat = hunger ? '#6c8b2a' : '#c4722f', hl = hunger ? '#a3c55a' : '#f0a868', bone = '#f0e8d8';
    const mask = SHANK.map((row) => row.split('').map((ch, x) => {
      if (ch === 'o' || ch === '.') return ch;
      if (fill === 0) return 'e';
      if (fill === 1 && x < 4) return 'e';
      return ch;
    }).join(''));
    return draw(mask, { o: '#2a160a', m: meat, h: hl, b: bone, e: '#3c2618' });
  });
}

export function armorIcon(fill: 0 | 1 | 2): string {
  return cached(`armor:${fill}`, () => {
    const mask = ARMOR.map((row) => row.split('').map((ch, x) => {
      if (ch === 'o' || ch === '.') return ch;
      if (fill === 0) return 'e';
      if (fill === 1 && x >= 5) return 'e';
      return ch;
    }).join(''));
    return draw(mask, { o: '#262626', f: '#d8d8d8', h: '#ffffff', e: '#4a4a4a' });
  });
}

export function bubbleIcon(popping: boolean): string {
  return cached(`bubble:${popping}`, () => draw(popping ? BUBBLE_POP : BUBBLE, { o: '#2f64c8', h: '#ffffff', '.': null }));
}

// ---------------------------------------------------------------------------------------------
// Effect icons (18×18): tinted rounded badge with a glyph
// ---------------------------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  up: ['...#...', '..###..', '.#####.', '...#...', '...#...', '...#...', '...#...'],
  down: ['...#...', '...#...', '...#...', '...#...', '.#####.', '..###..', '...#...'],
  pick: ['#####..', '..#.#..', '...#...', '..#.#..', '.#...#.', '#......', '.......'],
  sword: ['......#', '.....#.', '....#..', '#..#...', '.##....', '.##....', '#..#...'],
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...', '.......'],
  cross: ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
  shield: ['#######', '#.....#', '#.....#', '#.....#', '.#...#.', '..#.#..', '...#...'],
  flame: ['...#...', '..##...', '..###..', '.####..', '.#####.', '#######', '.#####.'],
  eye: ['.......', '.#####.', '#.###.#', '#.#.#.#', '#.###.#', '.#####.', '.......'],
  bubble: ['..###..', '.#...#.', '#.#...#', '#.....#', '#.....#', '.#...#.', '..###..'],
  ghost: ['.#####.', '#######', '#.#.#.#', '#######', '#######', '#######', '#.#.#.#'],
  skull: ['.#####.', '#######', '#..#..#', '#######', '.#####.', '.#.#.#.', '.......'],
  drop: ['...#...', '..###..', '.#####.', '#######', '#######', '.#####.', '..###..'],
  spiral: ['.#####.', '#.....#', '#.###.#', '#.#.#.#', '#.#...#', '#.####.', '.......'],
  feather: ['.....##', '....###', '...###.', '..###..', '.###...', '.#.....', '#......'],
  star: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '#.....#'],
  wave: ['.......', '.##..##', '#..##..', '.......', '.##..##', '#..##..', '.......'],
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  cloud: ['.......', '..###..', '.#####.', '#######', '#######', '.......', '.......'],
  bolt: ['...###.', '..###..', '.#####.', '...##..', '..##...', '.##....', '#......'],
  omen: ['#######', '#.#.#.#', '#######', '..###..', '..#.#..', '..#.#..', '.#...#.'],
};

const EFFECT_GLYPH: Record<string, string> = {
  speed: 'up', slowness: 'down', haste: 'pick', mining_fatigue: 'pick', strength: 'sword', weakness: 'sword',
  instant_health: 'heart', instant_damage: 'skull', jump_boost: 'up', nausea: 'spiral', regeneration: 'heart', resistance: 'shield',
  fire_resistance: 'flame', water_breathing: 'bubble', invisibility: 'ghost', blindness: 'eye', night_vision: 'eye', hunger: 'drop',
  poison: 'drop', withering: 'skull', health_boost: 'cross', absorption: 'heart', saturation: 'drop', glowing: 'star', levitation: 'feather',
  luck: 'star', unluck: 'star', slow_falling: 'feather', conduit_power: 'wave', dolphins_grace: 'wave', bad_omen: 'omen',
  hero_of_the_village: 'shield', darkness: 'moon', trial_omen: 'omen', raid_omen: 'omen', wind_charged: 'cloud', weaving: 'spiral',
  oozing: 'drop', infested: 'spiral',
};

export function effectIcon(id: string, color: number): string {
  return cached(`effect:${id}:${color}`, () => {
    const s = 18;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
    // badge
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(2, 1, 14, 16); ctx.fillRect(1, 2, 16, 14);
    ctx.fillStyle = `rgb(${r * 0.55 | 0},${g * 0.55 | 0},${b * 0.55 | 0})`;
    ctx.fillRect(2, 2, 14, 14);
    ctx.fillStyle = `rgb(${Math.min(255, r * 0.8 + 30) | 0},${Math.min(255, g * 0.8 + 30) | 0},${Math.min(255, b * 0.8 + 30) | 0})`;
    ctx.fillRect(3, 3, 12, 12);
    const glyph = GLYPHS[EFFECT_GLYPH[id] ?? 'star']!;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (glyph[y]![x] !== '#') continue;
        ctx.fillStyle = '#101010';
        ctx.fillRect(3 + x + 2, 3 + y + 2 + 1, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(3 + x + 2, 3 + y + 2, 1, 1);
      }
    }
    return c.toDataURL();
  });
}
