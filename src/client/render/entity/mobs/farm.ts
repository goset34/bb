/**
 * Farm animal visuals (original models and procedural textures): pig, cow, mushcow, sheep with
 * dyeable wool and chicken, each with climate variants.
 */
import {
  buildModel, registerMobVisual, paintModel, furFill, eyes, dot, faceRect, quadrupedPose, rgb, shadeRGB, mixRGB, valueNoise,
  BuiltModel, AnimState, DEG, PlacedBox, Face,
} from './kit';
import type { EntityCanvas } from '../textures';
import { ENTITY_TEX } from '../textures';
import { TEX_SKIN } from '../mesh';
import type { RGB } from '../../textures/painter';
import type { ClientEntity } from '../../../entities';

const variantOf = (e: ClientEntity, def = 'temperate') => (e.data['variant'] as string | undefined) ?? def;
const sinceEvent = (e: ClientEntity, ev: string): number => {
  const t = e.data[`event:${ev}`] as number | undefined;
  return t === undefined ? Infinity : e.interp.age - t;
};

type Fill = (f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB | null;

/** Hooves / feet: the bottom rows of leg sides darker. */
function legFill(c: EntityCanvas, base: RGB, hoof: RGB, rows: number): Fill {
  const fur = furFill(c, base, 10, 0.1);
  return (f, x, y, fw, fh, ax, ay) => {
    if (f === 'bottom') return shadeRGB(hoof, 0.8);
    if (f !== 'top' && y >= fh - rows) return shadeRGB(hoof, 0.9 + c.noise(ax, ay) * 0.15);
    return fur(f, x, y, fw, fh, ax, ay);
  };
}

// =============================================================================================
// Pig
// =============================================================================================

const pigModel = buildModel({
  body: { at: [0, 9, 0], box: { x: -5, y: -4, z: -8, w: 10, h: 8, d: 16 }, parts: {
    tail: { at: [0, 2, -8], rot: [-40, 0, 0], box: { x: -0.5, y: -0.5, z: -2, w: 1, h: 1, d: 2 } },
  } },
  head: { at: [0, 11, 8], box: [
    { x: -4, y: -4, z: -1, w: 8, h: 8, d: 7 },
    { x: -2.5, y: -3, z: 6, w: 5, h: 3, d: 2, name: 'snout' },
  ], parts: {
    earR: { at: [-3, 3.5, 3], rot: [35, 0, 25], box: { x: -1.5, y: 0, z: -0.5, w: 3, h: 2, d: 1 } },
    earL: { at: [3, 3.5, 3], rot: [35, 0, -25], box: { x: -1.5, y: 0, z: -0.5, w: 3, h: 2, d: 1, same: 'earR' } },
  } },
  fr: { at: [-3, 5, 5], box: { x: -1.5, y: -5, z: -1.5, w: 3, h: 5, d: 3 } },
  fl: { at: [3, 5, 5], box: { x: -1.5, y: -5, z: -1.5, w: 3, h: 5, d: 3, same: 'fr' } },
  br: { at: [-3, 5, -6], box: { x: -1.5, y: -5, z: -1.5, w: 3, h: 5, d: 3, same: 'fr' } },
  bl: { at: [3, 5, -6], box: { x: -1.5, y: -5, z: -1.5, w: 3, h: 5, d: 3, same: 'fr' } },
});

const PIG_COLORS: Record<string, { skin: number; snout: number; spots: number | null; hoof: number }> = {
  temperate: { skin: 0xeba3a2, snout: 0xd97d86, spots: null, hoof: 0x8a5a54 },
  warm: { skin: 0xd79b6a, snout: 0xb8684e, spots: 0x6e3b2a, hoof: 0x4e2e22 },
  cold: { skin: 0x9c8378, snout: 0x7c5f59, spots: null, hoof: 0x3e302c },
};

function paintPig(c: EntityCanvas, name: string): void {
  const v = PIG_COLORS[name.split('/')[2] ?? 'temperate'] ?? PIG_COLORS['temperate']!;
  const skin = rgb(v.skin), snout = rgb(v.snout), hoof = rgb(v.hoof);
  const fur = furFill(c, skin, 8, 0.1, 4);
  const cold = name.endsWith('/cold');
  paintModel(c, pigModel, (b) => {
    if (b.name === 'snout') return furFill(c, snout, 6, 0.05);
    if (b.part.startsWith('ear')) return furFill(c, shadeRGB(skin, 0.92), 6, 0.05);
    if (b.part === 'fr') return legFill(c, skin, hoof, 1);
    return (f, x, y, fw, fh, ax, ay) => {
      let col = fur(f, x, y, fw, fh, ax, ay);
      if (v.spots !== null && valueNoise(c, ax, ay, 2.5, 3) > 0.68) col = mixRGB(col, rgb(v.spots), 0.8);
      // Shaggy coat for cold pigs: darker streaks
      if (cold && b.part === 'body' && c.noise(ax, ay >> 1, 9) > 0.7) col = shadeRGB(col, 0.82);
      return col;
    };
  });
  const head = pigModel.box('head');
  eyes(c, head, 2, 5, [30, 24, 22]);
  const sn = pigModel.box('snout');
  dot(c, sn, 'front', 1, 1, shadeRGB(snout, 0.45));
  dot(c, sn, 'front', 3, 1, shadeRGB(snout, 0.45));
  faceRect(c, sn, 'front', 0, 0, 5, 1, shadeRGB(snout, 1.1));
}

function posePig(m: BuiltModel, a: AnimState): void {
  quadrupedPose(m, a);
  m.part('tail').zRot = Math.sin(a.age * 0.3) * 0.3;
}

registerMobVisual({
  id: 'pig', model: pigModel, texture: (e) => `mob/pig/${variantOf(e)}`, pose: posePig,
  babyHead: ['head'], babyHeadScale: 1.45,
  extra(ctx, e) {
    if (e.data['saddled'] !== true) return;
    // Saddle: a leather pad and girth on the back
    const mesh = ctx.mesh;
    mesh.layer = ctx.textures.layer('mob/saddle');
    mesh.flags = TEX_SKIN;
    saddleModel.root.reset();
    saddleModel.root.render(mesh, ENTITY_TEX);
  },
}, [['mob/pig', paintPig], ['mob/saddle', paintSaddle]]);

const saddleModel = buildModel({
  pad: { at: [0, 9, 0], box: [{ x: -5, y: 3.5, z: -3, w: 10, h: 1, d: 6, inflate: 0.3 }, { x: -5.4, y: -3, z: -1, w: 0.4, h: 7, d: 2, name: 'strapR' }, { x: 5, y: -3, z: -1, w: 0.4, h: 7, d: 2, name: 'strapL' }] },
});

function paintSaddle(c: EntityCanvas): void {
  const leather = rgb(0x7a4a2a);
  paintModel(c, saddleModel, (b) => b.name === 'pad'
    ? (f, x, y, fw, fh, ax, ay) => (x === 0 || y === 0 || x === fw - 1 || y === fh - 1 ? rgb(0x4a2a16) : furFill(c, leather, 8, 0.08)(f, x, y, fw, fh, ax, ay))
    : furFill(c, rgb(0x3a2414), 6, 0.05));
}

// =============================================================================================
// Cow and mushcow
// =============================================================================================

function cowModel(mushrooms: boolean): BuiltModel {
  return buildModel({
    body: { at: [0, 13, 0], box: [
      { x: -6, y: -5, z: -9, w: 12, h: 10, d: 18 },
      { x: -2, y: -6, z: -6, w: 4, h: 1, d: 5, name: 'udder' },
    ], parts: {
      tail: { at: [0, 4, -9], rot: [20, 0, 0], box: { x: -0.5, y: -9, z: -0.5, w: 1, h: 9, d: 1 } },
      ...(mushrooms ? {
        m1: { at: [2, 5, 4], box: [{ x: -0.5, y: 0, z: -0.5, w: 1, h: 2, d: 1, name: 'stem' }, { x: -2, y: 2, z: -2, w: 4, h: 2, d: 4, name: 'cap' }] },
        m2: { at: [-2.5, 5, -1], box: [{ x: -0.5, y: 0, z: -0.5, w: 1, h: 2, d: 1, same: 'stem' }, { x: -2, y: 2, z: -2, w: 4, h: 2, d: 4, same: 'cap' }] },
        m3: { at: [1.5, 5, -6], box: [{ x: -0.5, y: 0, z: -0.5, w: 1, h: 2, d: 1, same: 'stem' }, { x: -2, y: 2, z: -2, w: 4, h: 2, d: 4, same: 'cap' }] },
      } : {}),
    } },
    head: { at: [0, 16, 9], box: [
      { x: -4, y: -4, z: -1, w: 8, h: 8, d: 7 },
      { x: -3, y: -4, z: 6, w: 6, h: 4, d: 1.5, name: 'muzzle' },
    ], parts: {
      hornR: { at: [-4, 3, 2], rot: [0, 0, 20], box: { x: -2, y: 0, z: -0.5, w: 2, h: 1, d: 1 }, parts: {
        tipR: { at: [-2, 0, 0], box: { x: -1, y: 0, z: -0.5, w: 1, h: 2, d: 1 } } } },
      hornL: { at: [4, 3, 2], rot: [0, 0, -20], box: { x: 0, y: 0, z: -0.5, w: 2, h: 1, d: 1, same: 'hornR' }, parts: {
        tipL: { at: [2, 0, 0], box: { x: 0, y: 0, z: -0.5, w: 1, h: 2, d: 1, same: 'tipR' } } } },
      earR: { at: [-4, 1.5, 3], rot: [0, 0, 30], box: { x: -2.5, y: -0.5, z: -1, w: 2.5, h: 1, d: 2 } },
      earL: { at: [4, 1.5, 3], rot: [0, 0, -30], box: { x: 0, y: -0.5, z: -1, w: 2.5, h: 1, d: 2, same: 'earR' } },
    } },
    fr: { at: [-3.5, 8, 6], box: { x: -2, y: -8, z: -2, w: 4, h: 8, d: 4 } },
    fl: { at: [3.5, 8, 6], box: { x: -2, y: -8, z: -2, w: 4, h: 8, d: 4, same: 'fr' } },
    br: { at: [-3.5, 8, -6], box: { x: -2, y: -8, z: -2, w: 4, h: 8, d: 4, same: 'fr' } },
    bl: { at: [3.5, 8, -6], box: { x: -2, y: -8, z: -2, w: 4, h: 8, d: 4, same: 'fr' } },
  });
}

const cow = cowModel(false);
const mushcow = cowModel(true);

const COW_COLORS: Record<string, { base: number; patch: number | null; muzzle: number; shaggy: boolean }> = {
  temperate: { base: 0x6b4630, patch: 0xe8e0d0, muzzle: 0xd9b8a8, shaggy: false },
  warm: { base: 0xc07a44, patch: 0xe8c8a0, muzzle: 0x8a5a44, shaggy: false },
  cold: { base: 0x5a3a26, patch: null, muzzle: 0x3a2a22, shaggy: true },
  red: { base: 0xb02a20, patch: 0xefe8e2, muzzle: 0xe0c0b8, shaggy: false },
  brown: { base: 0x8c6242, patch: 0xefe8e2, muzzle: 0xe0c0b8, shaggy: false },
};

function paintCow(model: BuiltModel) {
  return (c: EntityCanvas, name: string): void => {
    const variant = name.split('/')[2] ?? 'temperate';
    const v = COW_COLORS[variant] ?? COW_COLORS['temperate']!;
    const base = rgb(v.base);
    const fur = furFill(c, base, v.shaggy ? 18 : 9, 0.12, 3);
    const mush = variant === 'red' || variant === 'brown';
    paintModel(c, model, (b) => {
      if (b.name === 'muzzle') return furFill(c, rgb(v.muzzle), 6, 0.05);
      if (b.name === 'udder') return furFill(c, rgb(0xe8a8a8), 5, 0.05);
      if (b.part.startsWith('horn') || b.part.startsWith('tip')) return furFill(c, rgb(0xd8d0bc), 5, 0.05);
      if (b.name === 'stem') return furFill(c, rgb(0xe8e0d4), 5, 0.05);
      if (b.name === 'cap') {
        const cap = variant === 'brown' ? rgb(0x9a6a48) : rgb(0xc8281e);
        return (f, x, y, fw, fh, ax, ay) => (variant === 'red' && f === 'top' && c.noise(ax, ay, 4) > 0.75 ? [240, 236, 228] : furFill(c, cap, 6, 0.05)(f, x, y, fw, fh, ax, ay));
      }
      if (b.part === 'tail') return (f, x, y, fw, fh, ax, ay) => (y >= fh - 2 ? shadeRGB(base, 0.5) : fur(f, x, y, fw, fh, ax, ay));
      if (b.part === 'fr') return legFill(c, base, rgb(0x2a2420), 2);
      return (f, x, y, fw, fh, ax, ay) => {
        let col = fur(f, x, y, fw, fh, ax, ay);
        if (v.patch !== null) {
          const n = valueNoise(c, ax, ay, mush ? 2 : 4, 11);
          if (n > (mush ? 0.72 : 0.62)) col = furFill(c, rgb(v.patch), 6, 0.05)(f, x, y, fw, fh, ax, ay);
        }
        if (v.shaggy && c.noise(ax, ay >> 1, 5) > 0.6) col = shadeRGB(col, 1.25);
        return col;
      };
    });
    eyes(c, model.box('head'), 3, 5, [20, 16, 14]);
    const mz = model.box('muzzle');
    dot(c, mz, 'front', 1, 2, shadeRGB(rgb(v.muzzle), 0.4));
    dot(c, mz, 'front', 4, 2, shadeRGB(rgb(v.muzzle), 0.4));
    // White blaze on the forehead
    if (v.patch !== null) faceRect(c, model.box('head'), 'front', 3, 0, 2, 3, furFill(c, rgb(v.patch), 5, 0.02)('front', 0, 0, 1, 1, 0, 0));
  };
}

const poseCow = (m: BuiltModel, a: AnimState) => {
  quadrupedPose(m, a, 'head', 1.2);
  m.part('tail').zRot = Math.sin(a.age * 0.08) * 0.15;
};

registerMobVisual({ id: 'cow', model: cow, texture: (e) => `mob/cow/${variantOf(e)}`, pose: poseCow, babyHead: ['head'], babyHeadScale: 1.45 }, [['mob/cow', paintCow(cow)]]);
registerMobVisual({
  id: 'mushcow', model: mushcow, texture: (e) => `mob/mushcow/${variantOf(e, 'red')}`,
  pose(m, a) {
    poseCow(m, a);
    for (const n of ['m1', 'm2', 'm3']) m.part(n).visible = !a.baby;
  },
  babyHead: ['head'], babyHeadScale: 1.45,
}, [['mob/mushcow', paintCow(mushcow)]]);

// =============================================================================================
// Sheep
// =============================================================================================

const sheepParts = {
  body: { at: [0, 12, 0] as [number, number, number], box: { x: -4, y: -3.5, z: -7, w: 8, h: 7, d: 14 } },
  head: { at: [0, 15, 7] as [number, number, number], rot: [15, 0, 0] as [number, number, number], box: { x: -3, y: -3, z: -1, w: 6, h: 6, d: 7 }, parts: {
    earR: { at: [-3, 2, 2] as [number, number, number], rot: [0, 0, 60] as [number, number, number], box: { x: -3, y: -0.5, z: -1, w: 3, h: 1, d: 2 } },
    earL: { at: [3, 2, 2] as [number, number, number], rot: [0, 0, -60] as [number, number, number], box: { x: 0, y: -0.5, z: -1, w: 3, h: 1, d: 2, same: 'earR' } },
  } },
  fr: { at: [-2.5, 8.5, 5] as [number, number, number], box: { x: -1.5, y: -8.5, z: -1.5, w: 3, h: 8.5, d: 3 } },
  fl: { at: [2.5, 8.5, 5] as [number, number, number], box: { x: -1.5, y: -8.5, z: -1.5, w: 3, h: 8.5, d: 3, same: 'fr' } },
  br: { at: [-2.5, 8.5, -5] as [number, number, number], box: { x: -1.5, y: -8.5, z: -1.5, w: 3, h: 8.5, d: 3, same: 'fr' } },
  bl: { at: [2.5, 8.5, -5] as [number, number, number], box: { x: -1.5, y: -8.5, z: -1.5, w: 3, h: 8.5, d: 3, same: 'fr' } },
};
const sheep = buildModel(sheepParts);
const wool = buildModel({
  body: { at: [0, 12, 0], box: { x: -4, y: -3.5, z: -7, w: 8, h: 7, d: 14, inflate: 1.8 } },
  head: { at: [0, 15, 7], rot: [15, 0, 0], box: { x: -3, y: -1, z: -1, w: 6, h: 4, d: 5, inflate: 0.7 } },
  fr: { at: [-2.5, 8.5, 5], box: { x: -1.5, y: -3.5, z: -1.5, w: 3, h: 3.5, d: 3, inflate: 0.6 } },
  fl: { at: [2.5, 8.5, 5], box: { x: -1.5, y: -3.5, z: -1.5, w: 3, h: 3.5, d: 3, inflate: 0.6, same: 'fr' } },
  br: { at: [-2.5, 8.5, -5], box: { x: -1.5, y: -3.5, z: -1.5, w: 3, h: 3.5, d: 3, inflate: 0.6, same: 'fr' } },
  bl: { at: [2.5, 8.5, -5], box: { x: -1.5, y: -3.5, z: -1.5, w: 3, h: 3.5, d: 3, inflate: 0.6, same: 'fr' } },
});

export const DYE_RGB: Record<string, number> = {
  white: 0xf4f4f0, orange: 0xf08a28, magenta: 0xc458c4, light_blue: 0x5ab4e8, yellow: 0xf4d43a, lime: 0x88cc30, pink: 0xf2a0b8,
  gray: 0x585c60, light_gray: 0xa4a4a0, cyan: 0x1a9494, purple: 0x8a38b8, blue: 0x3848a8, brown: 0x7c5434, green: 0x5a7428,
  red: 0xb4302a, black: 0x1e1e24,
};

function paintSheep(c: EntityCanvas): void {
  const skin = rgb(0xc8b8a8), face = rgb(0xe6dccc);
  paintModel(c, sheep, (b) => {
    if (b.part === 'head' || b.part.startsWith('ear')) return furFill(c, face, 6, 0.06);
    if (b.part === 'fr') return legFill(c, face, rgb(0x3a3430), 1);
    return furFill(c, skin, 7, 0.1);
  });
  eyes(c, sheep.box('head'), 2, 4, [26, 22, 20]);
  const h = sheep.box('head');
  dot(c, h, 'front', 2, 4, [150, 120, 118]);
  dot(c, h, 'front', 3, 4, [150, 120, 118]);
}

/** Wool is painted in grey levels and tinted by the fleece colour. */
function paintWool(c: EntityCanvas): void {
  paintModel(c, wool, () => (f, _x, _y, _fw, _fh, ax, ay) => {
    const curl = valueNoise(c, ax, ay, 1.5, 21);
    const v = 200 + curl * 50 + (c.noise(ax, ay) - 0.5) * 16 - (f === 'bottom' ? 30 : 0);
    return [v, v, v];
  });
}

function poseSheep(m: BuiltModel, a: AnimState, e: ClientEntity): void {
  quadrupedPose(m, a, 'head', 1.2);
  // Grazing: head down for 40 ticks with a chewing bob
  const t = sinceEvent(e, 'eatGrass');
  if (t < 40) {
    const k = t < 4 ? t / 4 : t > 36 ? (40 - t) / 4 : 1;
    const head = m.part('head');
    head.y -= 9 * k;
    head.xRot = (15 + 60 * k) * DEG + (t > 4 && t < 36 ? Math.sin(t * 0.9) * 0.15 : 0);
  }
}

registerMobVisual({
  id: 'sheep', model: sheep, texture: () => 'mob/sheep', pose: poseSheep, babyHead: ['head'], babyHeadScale: 1.45,
  extra(ctx, e, a) {
    if (e.data['sheared'] === true) return;
    wool.root.reset();
    poseSheep(wool, a, e);
    if (a.baby) wool.part('head').scale = 1.45;
    const mesh = ctx.mesh;
    mesh.layer = ctx.textures.layer('mob/sheep_wool');
    mesh.flags = TEX_SKIN;
    const name = e.data['customName'];
    let col = DYE_RGB[(e.data['color'] as string | undefined) ?? 'white'] ?? DYE_RGB['white']!;
    // A sheep named after the rainbow cycles through every colour
    if (name === 'arcoiris' || name === 'rainbow') {
      const t = (e.interp.age + a.partial) / 25;
      const keys = Object.keys(DYE_RGB);
      const i0 = Math.floor(t) % keys.length, i1 = (i0 + 1) % keys.length;
      const c0 = rgb(DYE_RGB[keys[i0]!]!), c1 = rgb(DYE_RGB[keys[i1]!]!);
      const m = mixRGB(c0, c1, t - Math.floor(t));
      col = (Math.round(m[0]) << 16) | (Math.round(m[1]) << 8) | Math.round(m[2]);
    }
    mesh.setColor(col);
    wool.root.render(mesh, ENTITY_TEX);
    mesh.setColor(0xffffff);
  },
}, [['mob/sheep_wool', paintWool], ['mob/sheep', paintSheep]]);

// =============================================================================================
// Chicken
// =============================================================================================

const chicken = buildModel({
  body: { at: [0, 8, 0], box: [
    { x: -3, y: -3, z: -4, w: 6, h: 6, d: 8 },
    { x: -2, y: 0, z: -6, w: 4, h: 4, d: 2, name: 'tailFeathers' },
  ] },
  head: { at: [0, 10, 3.5], box: [
    { x: -2, y: 0, z: -1.5, w: 4, h: 5, d: 3 },
    { x: -1.5, y: 2, z: 1.5, w: 3, h: 1.5, d: 2, name: 'beak' },
    { x: -1, y: 0.5, z: 1.5, w: 2, h: 1.5, d: 1, name: 'wattle' },
    { x: -0.5, y: 5, z: -1, w: 1, h: 1.5, d: 2.5, name: 'comb' },
  ] },
  wingR: { at: [-3, 10, 0], box: { x: -1, y: -4, z: -3, w: 1, h: 4, d: 6 } },
  wingL: { at: [3, 10, 0], box: { x: 0, y: -4, z: -3, w: 1, h: 4, d: 6, same: 'wingR' } },
  legR: { at: [-1.5, 5, 0.5], box: [{ x: -0.5, y: -5, z: -0.5, w: 1, h: 5, d: 1 }, { x: -1.5, y: -5, z: -1, w: 3, h: 0.01, d: 3, name: 'foot' }] },
  legL: { at: [1.5, 5, 0.5], box: [{ x: -0.5, y: -5, z: -0.5, w: 1, h: 5, d: 1, same: 'legR' }, { x: -1.5, y: -5, z: -1, w: 3, h: 0.01, d: 3, same: 'foot' }] },
});

const CHICKEN_COLORS: Record<string, [number, number]> = {
  temperate: [0xf2f0e8, 0xd8d4c8], warm: [0xc8763a, 0x8a4a22], cold: [0x8e98a4, 0x5a6470],
};

function paintChicken(c: EntityCanvas, name: string): void {
  const [a, b2] = CHICKEN_COLORS[name.split('/')[2] ?? 'temperate'] ?? CHICKEN_COLORS['temperate']!;
  const feathers = rgb(a), dark = rgb(b2);
  const orange = rgb(0xe8a030), red = rgb(0xd02a22);
  paintModel(c, chicken, (b: PlacedBox) => {
    if (b.name === 'beak' || b.part === 'legR' || b.name === 'foot') return furFill(c, orange, 6, 0.05);
    if (b.name === 'wattle' || b.name === 'comb') return furFill(c, red, 8, 0.05);
    if (b.name === 'tailFeathers' || b.part === 'wingR') return (f, x, y, fw, fh, ax, ay) => (y % 2 === 1 ? furFill(c, dark, 6, 0.05)(f, x, y, fw, fh, ax, ay) : furFill(c, feathers, 8, 0.08)(f, x, y, fw, fh, ax, ay));
    return (f, x, y, fw, fh, ax, ay) => (c.noise(ax, ay, 3) > 0.85 ? dark : furFill(c, feathers, 8, 0.08)(f, x, y, fw, fh, ax, ay));
  });
  const h = chicken.box('head');
  dot(c, h, 'front', 0, 1, [20, 20, 20]);
  dot(c, h, 'front', 3, 1, [20, 20, 20]);
  dot(c, h, 'west', 1, 1, [20, 20, 20]);
  dot(c, h, 'east', 1, 1, [20, 20, 20]);
}

registerMobVisual({
  id: 'chicken', model: chicken, texture: (e) => `mob/chicken/${variantOf(e)}`,
  pose(m, a) {
    const head = m.part('head');
    head.yRot = -a.headYaw * DEG;
    head.xRot = a.headPitch * DEG;
    const w = a.limbSwing * 0.6662;
    m.part('legR').xRot = Math.cos(w) * 1.4 * a.limbAmount;
    m.part('legL').xRot = Math.cos(w + Math.PI) * 1.4 * a.limbAmount;
    const flap = a.data['flapping'] === true ? (Math.sin(a.age * 1.3) + 1) * 0.9 : 0;
    m.part('wingR').zRot = flap;
    m.part('wingL').zRot = -flap;
    // Head bob while walking
    head.z += Math.sin(w * 2) * a.limbAmount * 0.6;
  },
  babyHead: ['head'], babyHeadScale: 1.4,
}, [['mob/chicken', paintChicken]]);
