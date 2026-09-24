/**
 * Player model and procedural skins. The texture layout is this project's own (128×128 layer):
 *
 *   head (0,0)  hood (32,0)  body (0,16)  jacket (24,16)  right arm (48,16)  left arm (64,16)
 *   right leg (80,16)  left leg (96,16)  sleeves (48,32)/(64,32)  trouser overlays (80,32)/(96,32)
 *
 * Skins are painted from a hash of the player name: skin tone, hair style and colour, eyes,
 * shirt/trousers/shoes palette, optional scarf.
 */
import { ModelPart } from './model';
import { registerEntityTexture, EntityCanvas } from './textures';
import type { RGB } from '../textures/painter';
import { hashString } from '../../../common/math/random';

export interface PlayerModel {
  root: ModelPart;
  head: ModelPart;
  hood: ModelPart;
  body: ModelPart;
  rightArm: ModelPart;
  leftArm: ModelPart;
  rightLeg: ModelPart;
  leftLeg: ModelPart;
}

export function createPlayerModel(slim = false): PlayerModel {
  const root = new ModelPart();
  const aw = slim ? 3 : 4;
  const head = root.add('head', new ModelPart(0, 24, 0).box(0, 0, -4, 0, -4, 8, 8, 8));
  const hood = head.add('hood', new ModelPart().box(32, 0, -4, 0, -4, 8, 8, 8, 0.5));
  const body = root.add('body', new ModelPart(0, 24, 0).box(0, 16, -4, -12, -2, 8, 12, 4));
  body.add('jacket', new ModelPart().box(24, 16, -4, -12, -2, 8, 12, 4, 0.25));
  const rightArm = root.add('rightArm', new ModelPart(-5, 22, 0).box(48, 16, -aw + 1, -10, -2, aw, 12, 4));
  rightArm.add('sleeve', new ModelPart().box(48, 32, -aw + 1, -10, -2, aw, 12, 4, 0.25));
  const leftArm = root.add('leftArm', new ModelPart(5, 22, 0).box(64, 16, -1, -10, -2, aw, 12, 4));
  leftArm.add('sleeve', new ModelPart().box(64, 32, -1, -10, -2, aw, 12, 4, 0.25));
  const rightLeg = root.add('rightLeg', new ModelPart(-1.9, 12, 0).box(80, 16, -2, -12, -2, 4, 12, 4));
  rightLeg.add('pants', new ModelPart().box(80, 32, -2, -12, -2, 4, 12, 4, 0.25));
  const leftLeg = root.add('leftLeg', new ModelPart(1.9, 12, 0).box(96, 16, -2, -12, -2, 4, 12, 4));
  leftLeg.add('pants', new ModelPart().box(96, 32, -2, -12, -2, 4, 12, 4, 0.25));
  return { root, head, hood, body, rightArm, leftArm, rightLeg, leftLeg };
}

export interface PlayerPose {
  limbSwing: number;
  limbAmount: number;
  /** Head yaw relative to the body and pitch (degrees). */
  headYaw: number;
  headPitch: number;
  /** Arm swing progress 0..1 (0 = none). */
  swing: number;
  swingOffhand: boolean;
  sneaking: boolean;
  /** Holding items (arms slightly raised). */
  holdingMain: boolean;
  holdingOff: boolean;
  /** Using an item (eating/drinking brings the arm to the mouth). */
  using: boolean;
  age: number;
  swimming: boolean;
  flying: boolean;
}

const D = Math.PI / 180;

/** Pose the model for a frame (reference-like humanoid animation). */
export function posePlayer(m: PlayerModel, p: PlayerPose): void {
  m.root.reset();
  m.head.yRot = -p.headYaw * D;
  m.head.xRot = p.headPitch * D;
  const walk = p.limbSwing * 0.6662;
  const amt = p.limbAmount;
  m.rightArm.xRot = Math.cos(walk + Math.PI) * 2 * amt * 0.5;
  m.leftArm.xRot = Math.cos(walk) * 2 * amt * 0.5;
  m.rightLeg.xRot = Math.cos(walk) * 1.4 * amt;
  m.leftLeg.xRot = Math.cos(walk + Math.PI) * 1.4 * amt;
  // Idle breathing sway
  m.rightArm.zRot = -(Math.cos(p.age * 0.09) * 0.05 + 0.05);
  m.leftArm.zRot = Math.cos(p.age * 0.09) * 0.05 + 0.05;
  m.rightArm.xRot += Math.sin(p.age * 0.067) * 0.05;
  m.leftArm.xRot -= Math.sin(p.age * 0.067) * 0.05;
  if (p.holdingMain) m.rightArm.xRot = m.rightArm.xRot * 0.5 - Math.PI / 10;
  if (p.holdingOff) m.leftArm.xRot = m.leftArm.xRot * 0.5 - Math.PI / 10;
  if (p.using) {
    m.rightArm.xRot = -Math.PI * 0.42 + Math.sin(p.age * 1.3) * 0.08;
    m.rightArm.yRot = -0.35;
  }
  if (p.swing > 0) {
    const arm = p.swingOffhand ? m.leftArm : m.rightArm;
    const s = p.swing;
    const bodyTwist = Math.sin(Math.sqrt(s) * Math.PI * 2) * 0.2;
    m.body.yRot = p.swingOffhand ? -bodyTwist : bodyTwist;
    const f = 1 - s;
    const f2 = Math.sin((1 - f * f * f * f) * Math.PI);
    const f3 = Math.sin(s * Math.PI) * -(p.headPitch * D - 0.7) * 0.75;
    arm.xRot -= f2 * 1.2 + f3;
    arm.yRot += m.body.yRot * 2;
    arm.zRot += Math.sin(s * Math.PI) * -0.4;
  }
  if (p.sneaking) {
    m.body.xRot = 0.5;
    m.rightArm.xRot += 0.4;
    m.leftArm.xRot += 0.4;
    m.rightLeg.z = 4; m.leftLeg.z = 4;
    m.rightLeg.y = 12.2; m.leftLeg.y = 12.2;
    m.head.y = 19.8; m.body.y = 20.8;
    m.rightArm.y = 18.8; m.leftArm.y = 18.8;
  }
  if (p.swimming) {
    const s = p.limbSwing * 0.33;
    m.rightArm.xRot = -Math.PI + Math.sin(s) * 0.6;
    m.leftArm.xRot = -Math.PI + Math.sin(s + Math.PI) * 0.6;
    m.rightLeg.xRot = Math.cos(s * 2) * 0.3;
    m.leftLeg.xRot = Math.cos(s * 2 + Math.PI) * 0.3;
  }
}

// ---------------------------------------------------------------------------------------------
// Procedural skins
// ---------------------------------------------------------------------------------------------

const SKIN_TONES: RGB[] = [[244, 208, 180], [230, 186, 150], [205, 150, 110], [168, 114, 78], [128, 84, 56], [92, 60, 40]];
const HAIR: RGB[] = [[40, 28, 20], [86, 56, 32], [150, 100, 50], [220, 190, 120], [180, 70, 40], [30, 30, 34], [200, 200, 205], [70, 90, 140]];
const CLOTH: RGB[] = [[60, 120, 170], [170, 60, 60], [70, 140, 80], [200, 150, 50], [120, 80, 160], [50, 150, 150], [210, 110, 40], [90, 90, 100], [230, 230, 220]];
const PANTS: RGB[] = [[50, 60, 110], [60, 50, 40], [40, 40, 44], [90, 80, 60], [70, 90, 60], [120, 110, 100]];
const EYES: RGB[] = [[60, 90, 160], [70, 120, 60], [100, 70, 40], [60, 60, 70], [130, 110, 60]];

function pick<T>(arr: T[], h: number, salt: number): T {
  return arr[((h >>> salt) & 0xffff) % arr.length]!;
}

function vary(c: RGB, n: number, amp: number): RGB {
  const d = (n - 0.5) * 2 * amp;
  return [c[0] + d, c[1] + d, c[2] + d];
}

/** Paint a player skin for `name` (texture key "player/<name>"). */
export function paintPlayerSkin(c: EntityCanvas, key: string): void {
  const name = key.slice('player/'.length) || 'Jugador';
  const h = hashString(name);
  const skin = pick(SKIN_TONES, h, 0);
  const hair = pick(HAIR, h, 3);
  const shirt = pick(CLOTH, h, 7);
  const trim = pick(CLOTH, h, 11);
  const pants = pick(PANTS, h, 13);
  const eyes = pick(EYES, h, 17);
  const shoes: RGB = [(pants[0] * 0.5) | 0, (pants[1] * 0.45) | 0, (pants[2] * 0.4) | 0];
  const longHair = ((h >>> 19) & 3) === 0;
  const hasScarf = ((h >>> 21) & 3) === 1;
  const n = (x: number, y: number) => c.noise(x, y);
  // Clear to transparent
  c.clear(0, 0, 128, 128);
  // Head
  c.box(0, 0, 8, 8, 8, (f, x, y) => {
    const base = vary(skin, n(x + 100, y), 6);
    if (f === 'top') return vary(hair, n(x, y + 40), 14);
    if (f === 'bottom') return vary(skin, n(x, y + 50), 4);
    if (f === 'back') return y < (longHair ? 8 : 6) ? vary(hair, n(x + 3, y), 14) : base;
    if (f === 'west' || f === 'east') {
      if (y < 2 || (y < (longHair ? 8 : 5) && (f === 'west' ? x < 3 : x > 4))) return vary(hair, n(x + 7, y), 14);
      if (y === 4 && ((f === 'west' && x === 4) || (f === 'east' && x === 3))) return vary(skin, 0.2, 10);
      return base;
    }
    // front: fringe, eyebrows, eyes, nose shading, mouth
    if (y < 2) return vary(hair, n(x + 11, y), 14);
    if (y === 2 && (x === 0 || x === 7 || (longHair && (x === 1 || x === 6)))) return vary(hair, n(x, y), 10);
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return vary(hair, 0.3, 4);
    if (y === 4 && (x === 1 || x === 6)) return [240, 240, 240];
    if (y === 4 && (x === 2 || x === 5)) return eyes;
    if (y === 5 && (x === 3 || x === 4)) return vary(skin, 0.15, 12);
    if (y === 6 && x >= 3 && x <= 4) return [skin[0] * 0.72, skin[1] * 0.55, skin[2] * 0.52];
    return base;
  });
  // Body: shirt with collar and trim, belt at the bottom
  c.box(0, 16, 8, 12, 4, (f, x, y, fw) => {
    if (f === 'top') return vary(shirt, n(x, y + 60), 8);
    if (f === 'bottom') return vary(pants, n(x, y + 61), 6);
    if (y >= 10) return y === 10 ? [58, 40, 30] : vary(pants, n(x, y + 62), 6);
    if (f === 'front') {
      if (y === 0 && x >= 2 && x <= 5) return vary(skin, 0.5, 5);
      if (y === 1 && x >= 3 && x <= 4) return vary(skin, 0.5, 5);
      if (x === 3 || x === 4) return y > 1 ? vary(trim, n(x, y), 8) : vary(shirt, n(x, y), 8);
    }
    if (hasScarf && y < 2) return vary(trim, n(x + fw, y + 70), 10);
    const stripe = (y === 5 || y === 6) && f !== 'back' ? 0.85 : 1;
    const sc = vary(shirt, n(x, y + 63), 8);
    return [sc[0] * stripe, sc[1] * stripe, sc[2] * stripe];
  });
  // Arms: sleeves down to the elbow, then skin; hands darker
  for (const [u, side] of [[48, 0], [64, 1]] as const) {
    c.box(u, 16, 4, 12, 4, (f, x, y) => {
      if (f === 'top') return vary(shirt, n(x + u, y), 8);
      if (f === 'bottom') return vary(skin, n(x + u, y + 5), 6);
      if (y < 5) return y === 4 ? vary(trim, n(x + u, y), 6) : vary(shirt, n(x + u + side, y), 8);
      return vary(y >= 10 ? [skin[0] * 0.94, skin[1] * 0.92, skin[2] * 0.9] : skin, n(x + u, y + 9), 5);
    });
  }
  // Legs: trousers with shoes
  for (const u of [80, 96]) {
    c.box(u, 16, 4, 12, 4, (f, x, y) => {
      if (f === 'top') return vary(pants, n(x + u, y), 6);
      if (f === 'bottom') return vary(shoes, n(x + u, y + 3), 6);
      if (y >= 10) return vary(y === 10 ? [shoes[0] + 30, shoes[1] + 25, shoes[2] + 20] : shoes, n(x + u, y), 6);
      return vary(pants, n(x + u, y + 7), f === 'front' && (x === 0 || x === 3) ? 3 : 7);
    });
  }
  // Overlays stay transparent except a scarf knot on the jacket for scarf wearers
  if (hasScarf) {
    c.box(24, 16, 8, 12, 4, (f, x, y) => (y < 2 && f !== 'top' && f !== 'bottom' ? vary(trim, n(x + 90, y), 12) : f === 'front' && y >= 2 && y < 5 && x === 5 ? vary(trim, n(x, y + 91), 10) : null));
  }
}

registerEntityTexture((n) => n.startsWith('player/'), paintPlayerSkin);

/** Flat front view (16×32 texels) of a humanoid skin with worn armor layers, for UI portraits. */
export function skinPortrait(skin: Uint8ClampedArray, armor: Array<Uint8ClampedArray | null> = []): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 32);
  const blit = (src: Uint8ClampedArray, sx: number, sy: number, w: number, hh: number, dx: number, dy: number) => {
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const so = ((sy + y) * 128 + sx + x) * 4;
        if (src[so + 3]! < 16) continue;
        const d = ((dy + y) * 16 + dx + x) * 4;
        img.data[d] = src[so]!; img.data[d + 1] = src[so + 1]!; img.data[d + 2] = src[so + 2]!; img.data[d + 3] = 255;
      }
    }
  };
  const parts = (src: Uint8ClampedArray) => {
    blit(src, 8, 8, 8, 8, 4, 0);      // head front
    blit(src, 4, 20, 8, 12, 4, 8);    // body front
    blit(src, 52, 20, 4, 12, 0, 8);   // right arm front (viewer's left)
    blit(src, 68, 20, 4, 12, 12, 8);  // left arm front
    blit(src, 84, 20, 4, 12, 4, 20);  // right leg front
    blit(src, 100, 20, 4, 12, 8, 20); // left leg front
  };
  parts(skin);
  // Overlay layers (hood, jacket, sleeves, trousers)
  blit(skin, 40, 8, 8, 8, 4, 0);
  blit(skin, 28, 20, 8, 12, 4, 8);
  for (const a of armor) if (a) parts(a);
  ctx.putImageData(img, 0, 0);
  c.className = 'portrait';
  return c;
}
