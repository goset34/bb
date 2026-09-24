/**
 * Worn armor: inflated copies of the humanoid boxes textured with procedural per-material
 * armor layers ("armor/<material>" for helmet/chestplate/boots, "armor/<material>/legs").
 */
import { ModelPart } from './model';
import { registerEntityTexture, EntityCanvas } from './textures';
import type { RGB } from '../textures/painter';

const MATERIAL_COLORS: Record<string, { base: RGB; dark: RGB; light: RGB; holes?: boolean }> = {
  leather: { base: [240, 240, 240], dark: [190, 190, 190], light: [255, 255, 255] },
  copper: { base: [196, 110, 72], dark: [140, 70, 45], light: [232, 150, 110] },
  chainmail: { base: [150, 152, 158], dark: [80, 82, 88], light: [200, 202, 208], holes: true },
  iron: { base: [210, 210, 214], dark: [140, 140, 146], light: [245, 245, 248] },
  golden: { base: [236, 196, 60], dark: [176, 128, 30], light: [255, 238, 130] },
  diamond: { base: [80, 212, 210], dark: [30, 140, 150], light: [170, 250, 245] },
  infernium: { base: [80, 64, 72], dark: [44, 34, 40], light: [124, 104, 110] },
  turtle: { base: [70, 150, 60], dark: [40, 96, 36], light: [120, 196, 96] },
};

/** Armor pieces as model parts matching the player skeleton (pivots identical). */
export interface ArmorModel {
  head: ModelPart;
  body: ModelPart;
  rightArm: ModelPart;
  leftArm: ModelPart;
  /** Legging parts (second texture). */
  waist: ModelPart;
  rightThigh: ModelPart;
  leftThigh: ModelPart;
  rightBoot: ModelPart;
  leftBoot: ModelPart;
}

export function createArmorModel(): ArmorModel {
  return {
    head: new ModelPart(0, 24, 0).box(0, 0, -4, 0, -4, 8, 8, 8, 1.0),
    body: new ModelPart(0, 24, 0).box(0, 16, -4, -12, -2, 8, 12, 4, 1.0),
    rightArm: new ModelPart(-5, 22, 0).box(48, 16, -3, -10, -2, 4, 12, 4, 1.0),
    leftArm: new ModelPart(5, 22, 0).box(64, 16, -1, -10, -2, 4, 12, 4, 1.0),
    waist: new ModelPart(0, 24, 0).box(0, 16, -4, -12, -2, 8, 12, 4, 0.5),
    rightThigh: new ModelPart(-1.9, 12, 0).box(80, 16, -2, -12, -2, 4, 12, 4, 0.5),
    leftThigh: new ModelPart(1.9, 12, 0).box(96, 16, -2, -12, -2, 4, 12, 4, 0.5),
    rightBoot: new ModelPart(-1.9, 12, 0).box(80, 16, -2, -12, -2, 4, 12, 4, 1.0),
    leftBoot: new ModelPart(1.9, 12, 0).box(96, 16, -2, -12, -2, 4, 12, 4, 1.0),
  };
}

function vary(c: RGB, n: number, amp: number): RGB {
  const d = (n - 0.5) * 2 * amp;
  return [c[0] + d, c[1] + d, c[2] + d];
}

function paintArmor(c: EntityCanvas, key: string): void {
  const parts = key.split('/');
  const mat = parts[1] ?? 'iron';
  const legs = parts[2] === 'legs';
  const m = MATERIAL_COLORS[mat] ?? MATERIAL_COLORS['iron']!;
  c.clear(0, 0, 128, 128);
  const n = (x: number, y: number) => c.noise(x, y);
  const plate = (x: number, y: number, fw: number, fh: number, sx: number): RGB | null => {
    if (m.holes && (x + y) % 2 === 1 && y > 0 && y < fh - 1) return null;
    const edge = x === 0 || y === 0 || x === fw - 1 || y === fh - 1;
    if (edge) return vary(m.dark, n(x + sx, y), 6);
    if (y === 1 || x === 1) return vary(m.light, n(x + sx, y + 3), 6);
    return vary(m.base, n(x + sx, y + 7), 9);
  };
  if (!legs) {
    // Helmet: all faces except the lower part of the front (visor opening)
    c.box(0, 0, 8, 8, 8, (f, x, y, fw, fh) => {
      if (f === 'bottom') return null;
      if (f === 'front' && y >= 3 && x >= 1 && x <= 6) return y === 3 ? vary(m.dark, n(x, y), 4) : null;
      if ((f === 'west' || f === 'east' || f === 'back') && y >= 6) return y === 6 ? vary(m.dark, n(x, y), 4) : null;
      return plate(x, y, fw, fh, 1);
    });
    // Chestplate
    c.box(0, 16, 8, 12, 4, (f, x, y, fw, fh) => {
      if (y >= 10 && f !== 'top') return null;
      if (f === 'front' && y === 0 && x >= 2 && x <= 5) return null;
      return plate(x, y, fw, fh, 20);
    });
    // Shoulder pads
    for (const u of [48, 64]) c.box(u, 16, 4, 12, 4, (f, x, y, fw) => (y < 5 || f === 'top' ? plate(x, Math.min(y, 4), fw, 5, u) : null));
    // Boots
    for (const u of [80, 96]) c.box(u, 16, 4, 12, 4, (f, x, y, fw) => (y >= 8 || f === 'bottom' ? plate(x, y - 8, fw, 4, u + 5) : null));
  } else {
    // Leggings: waist band + thighs
    c.box(0, 16, 8, 12, 4, (f, x, y, fw) => (y >= 9 && f !== 'top' && f !== 'bottom' ? plate(x, y - 9, fw, 3, 40) : null));
    for (const u of [80, 96]) c.box(u, 16, 4, 12, 4, (f, x, y, fw, fh) => (y < 9 && f !== 'bottom' && f !== 'top' ? plate(x, y, fw, Math.min(fh, 9), u + 9) : null));
  }
}

registerEntityTexture((n) => n.startsWith('armor/'), paintArmor);
