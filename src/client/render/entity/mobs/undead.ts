/**
 * Undead humanoids on the shared humanoid model: zombies and husks (drowned join later) with
 * original procedural skins painted on the player texture layout, reaching arm poses and
 * equipment.
 */
import { ENTITY_RENDERERS, renderHumanoid } from '../renderers';
import { ENTITY_SIZES } from '../../../entities';
import type { ClientEntity } from '../../../entities';
import { registerEntityTexture, EntityCanvas, ENTITY_TEX } from '../textures';
import { createPlayerModel, PlayerModel } from '../player';
import { MOBS } from '../../../../common/entity/mobs';
import { paintBox, furFill, valueNoise, shadeRGB, mixRGB, rgb, dot, faceRect, PlacedBox, Face } from './kit';
import type { RGB } from '../../textures/painter';

/** Regions of the humanoid texture layout (see player.ts). */
export const HUMANOID_BOXES = {
  head: { part: 'head', name: 'head', u: 0, v: 0, w: 8, h: 8, d: 8 },
  hood: { part: 'hood', name: 'hood', u: 32, v: 0, w: 8, h: 8, d: 8 },
  body: { part: 'body', name: 'body', u: 0, v: 16, w: 8, h: 12, d: 4 },
  jacket: { part: 'jacket', name: 'jacket', u: 24, v: 16, w: 8, h: 12, d: 4 },
  rightArm: { part: 'rightArm', name: 'rightArm', u: 48, v: 16, w: 4, h: 12, d: 4 },
  leftArm: { part: 'leftArm', name: 'leftArm', u: 64, v: 16, w: 4, h: 12, d: 4 },
  rightLeg: { part: 'rightLeg', name: 'rightLeg', u: 80, v: 16, w: 4, h: 12, d: 4 },
  leftLeg: { part: 'leftLeg', name: 'leftLeg', u: 96, v: 16, w: 4, h: 12, d: 4 },
  rightSleeve: { part: 'sleeve', name: 'rightSleeve', u: 48, v: 32, w: 4, h: 12, d: 4 },
  leftSleeve: { part: 'sleeve', name: 'leftSleeve', u: 64, v: 32, w: 4, h: 12, d: 4 },
  rightPants: { part: 'pants', name: 'rightPants', u: 80, v: 32, w: 4, h: 12, d: 4 },
  leftPants: { part: 'pants', name: 'leftPants', u: 96, v: 32, w: 4, h: 12, d: 4 },
} satisfies Record<string, PlacedBox>;

type Fill = (f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB | null;

interface UndeadStyle {
  skin: number;
  blotch: number;
  shirt: number;
  pants: number;
  eye: RGB;
  /** Wrapped bandage strips instead of clothes holes (husks). */
  wraps?: number;
  /** Kelp strands hanging from the body (drowned). */
  kelp?: number;
}

/** Paint an undead skin on the humanoid layout. */
export function paintUndead(c: EntityCanvas, s: UndeadStyle): void {
  c.clear(0, 0, ENTITY_TEX, ENTITY_TEX);
  const skin = rgb(s.skin), blotch = rgb(s.blotch);
  const skinFill: Fill = (f, x, y, fw, fh, ax, ay) => {
    const base = furFill(c, skin, 10, 0.1, 3)(f, x, y, fw, fh, ax, ay)!;
    return valueNoise(c, ax, ay, 2, 5) > 0.66 ? mixRGB(base, blotch, 0.6) : base;
  };
  const cloth = (col: number, tears: number): Fill => (f, x, y, fw, fh, ax, ay) => {
    if (valueNoise(c, ax, ay, 1.6, 13) > 1 - tears) return skinFill(f, x, y, fw, fh, ax, ay);
    const base = furFill(c, rgb(col), 8, 0.14, 2, 2)(f, x, y, fw, fh, ax, ay)!;
    return y === 0 && f !== 'top' && f !== 'bottom' ? shadeRGB(base, 0.8) : base;
  };
  const B = HUMANOID_BOXES;
  paintBox(c, B.head, skinFill);
  paintBox(c, B.body, cloth(s.shirt, 0.22));
  paintBox(c, B.rightArm, (f, x, y, fw, fh, ax, ay) => (y < 4 && f !== 'bottom' ? cloth(s.shirt, 0.3)(f, x, y, fw, fh, ax, ay) : skinFill(f, x, y, fw, fh, ax, ay)));
  paintBox(c, B.leftArm, (f, x, y, fw, fh, ax, ay) => (y < 4 && f !== 'bottom' ? cloth(s.shirt, 0.3)(f, x, y, fw, fh, ax, ay) : skinFill(f, x, y, fw, fh, ax, ay)));
  const legs: Fill = (f, x, y, fw, fh, ax, ay) => (y >= fh - 2 || f === 'bottom' ? skinFill(f, x, y, fw, fh, ax, ay) : cloth(s.pants, 0.18)(f, x, y, fw, fh, ax, ay));
  paintBox(c, B.rightLeg, legs);
  paintBox(c, B.leftLeg, legs);
  if (s.wraps !== undefined) {
    const wrap = rgb(s.wraps);
    for (const b of [B.head, B.rightArm, B.leftArm, B.body]) {
      // Diagonal cloth strips every few rows, frayed at random
      paintBox(c, b, (f, x, y, fw, fh, ax, ay) => ((y + (x >> 2)) % 5 === 0 && c.noise(ax, ay, 31) > 0.35 && f !== 'top' && f !== 'bottom' ? furFill(c, wrap, 6, 0.04)(f, x, y, fw, fh, ax, ay) : null));
    }
  }
  if (s.kelp !== undefined) {
    const kelp = rgb(s.kelp);
    paintBox(c, B.jacket, (f, x, _y, _fw, _fh, ax, ay) => (f !== 'top' && f !== 'bottom' && c.noise(ax >> 0, 0, 41) > 0.72 && (x % 3 === 1) ? shadeRGB(kelp, 0.8 + c.noise(ax, ay) * 0.4) : null));
  }
  // Face: dark sunken sockets, faint glowing pupils, a gaping mouth
  const h = B.head;
  const socket = shadeRGB(skin, 0.35);
  faceRect(c, h, 'front', 1, 3, 2, 2, socket);
  faceRect(c, h, 'front', 5, 3, 2, 2, socket);
  dot(c, h, 'front', 2, 4, s.eye);
  dot(c, h, 'front', 5, 4, s.eye);
  faceRect(c, h, 'front', 3, 6, 2, 1, shadeRGB(skin, 0.3));
  dot(c, h, 'front', 2, 6, shadeRGB(skin, 0.55));
  dot(c, h, 'front', 5, 6, shadeRGB(skin, 0.55));
  dot(c, h, 'front', 4, 5, shadeRGB(skin, 0.7));
  // Tufts of hair on top
  paintBox(c, B.hood, (f, _x, _y, _fw, _fh, ax, ay) => (f === 'top' && c.noise(ax, ay, 17) > 0.6 ? shadeRGB(rgb(s.blotch), 0.5) : null));
}

/** Arms stretched forward, raised further while attacking (reference zombie arms). */
export function zombieArms(m: PlayerModel, e: ClientEntity, partial: number): void {
  const i = e.interp;
  const attack = i.swinging ? Math.max(0, (i.swingTime + partial) / 6) : 0;
  const aggressive = e.data['aggressive'] === true;
  const f = Math.sin(attack * Math.PI);
  const f1 = Math.sin((1 - (1 - attack) * (1 - attack)) * Math.PI);
  m.rightArm.zRot = 0;
  m.leftArm.zRot = 0;
  m.rightArm.yRot = -(0.1 - f * 0.6);
  m.leftArm.yRot = 0.1 - f * 0.6;
  const base = -Math.PI / (aggressive ? 1.5 : 2.25);
  m.rightArm.xRot = base + f * 1.2 - f1 * 0.4;
  m.leftArm.xRot = base + f * 1.2 - f1 * 0.4;
  const age = i.age + partial;
  m.rightArm.zRot += Math.cos(age * 0.09) * 0.05 + 0.05;
  m.leftArm.zRot -= Math.cos(age * 0.09) * 0.05 + 0.05;
  m.rightArm.xRot += Math.sin(age * 0.067) * 0.05;
  m.leftArm.xRot -= Math.sin(age * 0.067) * 0.05;
}

/** Register a humanoid mob drawn with renderHumanoid. */
export function registerHumanoidMob(id: string, texture: string, paint: (c: EntityCanvas) => void, adjust: (m: PlayerModel, e: ClientEntity, partial: number) => void, slim = false): void {
  const model = createPlayerModel(slim);
  const info = MOBS.get(id);
  if (info) ENTITY_SIZES[id] = [info.width, info.height];
  registerEntityTexture(texture, (c) => paint(c));
  ENTITY_RENDERERS.set(id, (e, ctx, x, y, z) => {
    renderHumanoid(ctx, e, x, y, z, texture, model, adjust);
    const name = e.data['customName'];
    if (typeof name === 'string' && name && e.interp.deathTime === 0) {
      ctx.labels.push({ text: name, x: x + ctx.cam[0], y: y + ctx.cam[1] + (e.data['baby'] ? 1.3 : 2.3), z: z + ctx.cam[2], sneaking: false });
    }
  });
}

registerHumanoidMob('zombie', 'mob/zombie', (c) => paintUndead(c, { skin: 0x5e8a58, blotch: 0x3e5e3a, shirt: 0x2e7a86, pants: 0x3a3a6a, eye: [190, 210, 120] }), zombieArms);
registerHumanoidMob('husk', 'mob/husk', (c) => paintUndead(c, { skin: 0xa08c62, blotch: 0x7a6642, shirt: 0x8a7050, pants: 0x5e4a34, eye: [230, 200, 110], wraps: 0xd8c8a0 }), zombieArms);
