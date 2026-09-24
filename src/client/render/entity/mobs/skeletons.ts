/**
 * Skeleton family (skeleton, stray with tattered cloth, bogged with moss and mushrooms) on a
 * thin-limbed humanoid, and the hisser: a hooded, scaly original design that swells, flashes
 * and crackles with an aura when charged.
 */
import { ENTITY_RENDERERS, renderHumanoid } from '../renderers';
import { ENTITY_SIZES } from '../../../entities';
import type { ClientEntity } from '../../../entities';
import { registerEntityTexture, EntityCanvas, ENTITY_TEX } from '../textures';
import type { PlayerModel } from '../player';
import { MOBS } from '../../../../common/entity/mobs';
import { TEX_SKIN, TEX_EMISSIVE, TEX_TRANSLUCENT } from '../mesh';
import {
  buildModel, BuiltModel, paintModel, furFill, valueNoise, shadeRGB, mixRGB, rgb, dot, faceRect, registerMobVisual,
  quadrupedPose, DEG, AnimState, Face,
} from './kit';
import { zombieArms } from './undead';
import type { RGB } from '../../textures/painter';

// =============================================================================================
// Skeletons
// =============================================================================================

function skeletonModel(): BuiltModel {
  return buildModel({
    head: { at: [0, 24, 0], box: { x: -4, y: 0, z: -4, w: 8, h: 8, d: 8 }, parts: {
      hood: { box: { x: -4, y: 0, z: -4, w: 8, h: 8, d: 8, inflate: 0.5 } },
    } },
    body: { at: [0, 24, 0], box: { x: -4, y: -12, z: -2, w: 8, h: 12, d: 4 }, parts: {
      jacket: { box: { x: -4, y: -12, z: -2, w: 8, h: 12, d: 4, inflate: 0.4 } },
    } },
    rightArm: { at: [-5, 22, 0], box: { x: -1, y: -10, z: -1, w: 2, h: 12, d: 2 } },
    leftArm: { at: [5, 22, 0], box: { x: -1, y: -10, z: -1, w: 2, h: 12, d: 2 } },
    rightLeg: { at: [-2, 12, 0], box: { x: -1, y: -12, z: -1, w: 2, h: 12, d: 2 } },
    leftLeg: { at: [2, 12, 0], box: { x: -1, y: -12, z: -1, w: 2, h: 12, d: 2 } },
  });
}

function asHumanoid(m: BuiltModel): PlayerModel {
  return {
    root: m.root, head: m.part('head'), hood: m.part('hood'), body: m.part('body'),
    rightArm: m.part('rightArm'), leftArm: m.part('leftArm'), rightLeg: m.part('rightLeg'), leftLeg: m.part('leftLeg'),
  };
}

type Fill = (f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB | null;

interface BoneStyle {
  bone: number;
  /** Cloth colour for tattered overlays (strays). */
  cloth?: number;
  /** Moss tint and mushroom caps (bogged). */
  moss?: number;
  eye: RGB;
}

function paintSkeleton(c: EntityCanvas, m: BuiltModel, s: BoneStyle): void {
  const bone = rgb(s.bone);
  const boneFill = furFill(c, bone, 9, 0.06, 2);
  const mossy: Fill = (f, x, y, fw, fh, ax, ay) => {
    const base = boneFill(f, x, y, fw, fh, ax, ay)!;
    if (s.moss !== undefined && valueNoise(c, ax, ay, 2, 3) > 0.58) return mixRGB(base, rgb(s.moss), 0.7);
    return base;
  };
  paintModel(c, m, (b) => {
    if (b.part === 'hood') {
      if (s.cloth !== undefined) return (f, _x, y, _fw, fh, ax, ay) => (f === 'bottom' || f === 'front' && y > 2 || c.noise(ax, ay, 5) > 0.8 ? null : furFill(c, rgb(s.cloth!), 8, 0.12)(f, 0, y, 1, fh, ax, ay));
      if (s.moss !== undefined) return (f, _x, _y, _fw, _fh, ax, ay) => (f === 'top' && valueNoise(c, ax, ay, 1.5, 7) > 0.45 ? rgb(s.moss!) : null);
      return () => null;
    }
    if (b.part === 'jacket') {
      if (s.cloth === undefined) return () => null;
      // Tattered cloth: ragged bottom edge and holes
      return (f, x, y, fw, fh, ax, ay) => {
        if (f === 'top' || f === 'bottom') return null;
        const ragged = y > fh - 2 - Math.floor(c.noise(ax, 0, 9) * 4);
        if (ragged || valueNoise(c, ax, ay, 1.5, 17) > 0.72) return null;
        return furFill(c, rgb(s.cloth!), 10, 0.15)(f, x, y, fw, fh, ax, ay);
      };
    }
    if (b.part === 'body') {
      // Ribcage: spine in the middle, ribs every other row, gaps transparent
      return (f, x, y, fw, fh, ax, ay) => {
        if (f === 'top' || f === 'bottom') return y === 1 || x === Math.floor(fw / 2) ? mossy(f, x, y, fw, fh, ax, ay) : null;
        const spine = (f === 'front' || f === 'back') ? x === 3 || x === 4 : x === 1 || x === 2;
        const pelvis = y >= fh - 3;
        const rib = y < fh - 4 && y % 2 === 0;
        return spine || pelvis || rib ? mossy(f, x, y, fw, fh, ax, ay) : null;
      };
    }
    return (f, x, y, fw, fh, ax, ay) => {
      const col = mossy(f, x, y, fw, fh, ax, ay)!;
      // Knuckles and joints
      if (y === 5 || y === 6) return shadeRGB(col, 0.86);
      return col;
    };
  });
  // Skull face: deep sockets with a faint glint, nose cavity, teeth
  const h = m.box('head');
  const socket: RGB = [26, 24, 22];
  faceRect(c, h, 'front', 1, 3, 2, 2, socket);
  faceRect(c, h, 'front', 5, 3, 2, 2, socket);
  dot(c, h, 'front', 2, 4, s.eye);
  dot(c, h, 'front', 5, 4, s.eye);
  dot(c, h, 'front', 3, 5, socket);
  dot(c, h, 'front', 4, 5, socket);
  faceRect(c, h, 'front', 2, 6, 4, 1, (i) => (i % 2 === 0 ? shadeRGB(bone, 0.35) : null));
  if (s.moss !== undefined) {
    // Mushroom caps sprouting from the skull (hood layer)
    const hood = m.box('hood');
    for (const [x, y] of [[1, 2], [5, 4], [3, 6]] as const) {
      faceRect(c, hood, 'top', x, y, 2, 2, [180, 50, 40]);
      dot(c, hood, 'top', x, y, [236, 226, 210]);
    }
  }
}

function skeletonArms(m: PlayerModel, e: ClientEntity, partial: number): void {
  const main = e.interp.equipment[0];
  const aggressive = e.data['aggressive'] === true;
  if (aggressive && (!main || main.id !== 'bow')) zombieArms(m, e, partial);
}

function registerSkeleton(id: string, style: BoneStyle): void {
  const built = skeletonModel();
  const model = asHumanoid(built);
  const info = MOBS.get(id);
  if (info) ENTITY_SIZES[id] = [info.width, info.height];
  const tex = `mob/${id}`;
  registerEntityTexture(tex, (c) => paintSkeleton(c, built, style));
  ENTITY_RENDERERS.set(id, (e, ctx, x, y, z) => {
    built.part('hood').visible = !(id === 'bogged' && e.data['sheared'] === true);
    renderHumanoid(ctx, e, x, y, z, tex, model, skeletonArms);
    const name = e.data['customName'];
    if (typeof name === 'string' && name && e.interp.deathTime === 0) ctx.labels.push({ text: name, x: x + ctx.cam[0], y: y + ctx.cam[1] + 2.35, z: z + ctx.cam[2], sneaking: false });
  });
}

registerSkeleton('skeleton', { bone: 0xd8d6cc, eye: [120, 120, 110] });
registerSkeleton('stray', { bone: 0xc6d4d6, cloth: 0x5e7a82, eye: [160, 200, 220] });
registerSkeleton('bogged', { bone: 0xb8b494, moss: 0x5a7a3a, eye: [150, 190, 90] });

// =============================================================================================
// Hisser
// =============================================================================================

const hisser = buildModel({
  body: { at: [0, 6, 0], box: [
    { x: -4, y: 0, z: -2.5, w: 8, h: 12, d: 5 },
    { x: -2.5, y: 6, z: 2.5, w: 5, h: 5, d: 1, name: 'sac' },
  ] },
  head: { at: [0, 18, 0], box: { x: -4, y: 0, z: -4, w: 8, h: 7, d: 8 }, parts: {
    frill: { at: [0, 2, -3], rot: [-12, 0, 0], box: { x: -7, y: 0, z: -1, w: 14, h: 9, d: 1 } },
  } },
  fr: { at: [-2.5, 6, 2], box: { x: -1.5, y: -6, z: -1.5, w: 3, h: 6, d: 3 } },
  fl: { at: [2.5, 6, 2], box: { x: -1.5, y: -6, z: -1.5, w: 3, h: 6, d: 3, same: 'fr' } },
  br: { at: [-2.5, 6, -2], box: { x: -1.5, y: -6, z: -1.5, w: 3, h: 6, d: 3, same: 'fr' } },
  bl: { at: [2.5, 6, -2], box: { x: -1.5, y: -6, z: -1.5, w: 3, h: 6, d: 3, same: 'fr' } },
});
const hisserAura = buildModel({
  body: { at: [0, 6, 0], box: { x: -4, y: 0, z: -2.5, w: 8, h: 12, d: 5, inflate: 1 } },
  head: { at: [0, 18, 0], box: { x: -4, y: 0, z: -4, w: 8, h: 7, d: 8, inflate: 1 } },
});

function paintHisser(c: EntityCanvas): void {
  const scale = rgb(0x4e7a3e), dark = rgb(0x24401e), belly = rgb(0xd8d0a4);
  const scales: Fill = (f, x, y, fw, fh, ax, ay) => {
    const base = furFill(c, scale, 10, 0.12, 2)(f, x, y, fw, fh, ax, ay)!;
    // Diamond pattern along the back
    const d = (Math.abs(((x + y) % 6) - 3) + Math.abs(((x - y + 60) % 6) - 3));
    return d <= 1 ? mixRGB(base, dark, 0.7) : base;
  };
  paintModel(c, hisser, (b) => {
    if (b.name === 'sac') return (f, x, y, fw, fh, ax, ay) => furFill(c, [230, 150, 60], 10, 0.1)(f, x, y, fw, fh, ax, ay);
    if (b.part === 'frill') {
      return (f, x, y, fw, fh, ax, ay) => {
        if (f === 'top' || f === 'bottom') return shadeRGB(scale, 0.8);
        // Ragged edge and two eye-spots on the back of the hood
        if (y === 0 && x % 3 === 0) return null;
        const spot = (Math.hypot(x - 3.5, y - 4) < 1.8 || Math.hypot(x - (fw - 4.5), y - 4) < 1.8) && f === 'back';
        if (spot) return Math.hypot(x - 3.5, y - 4) < 0.9 || Math.hypot(x - (fw - 4.5), y - 4) < 0.9 ? [30, 20, 10] : [240, 190, 60];
        return scales(f, x, y, fw, fh, ax, ay);
      };
    }
    if (b.part === 'body') return (f, x, y, fw, fh, ax, ay) => (f === 'front' && x > 1 && x < fw - 2 ? furFill(c, belly, 8, 0.08)(f, x, y, fw, fh, ax, ay) : scales(f, x, y, fw, fh, ax, ay));
    return scales;
  });
  const h = hisser.box('head');
  // Slit eyes and hiss vents
  for (const x of [1, 5]) {
    faceRect(c, h, 'front', x, 2, 2, 1, [230, 220, 90]);
    dot(c, h, 'front', x + (x === 1 ? 1 : 0), 2, [20, 20, 10]);
  }
  for (const x of [2, 3, 4, 5]) dot(c, h, 'front', x, 5, x % 2 === 0 ? [20, 30, 15] : shadeRGB(scale, 0.6));
}

registerEntityTexture('mob/hisser_aura', (c) => {
  paintModel(c, hisserAura, () => (_f, x, y) => ((x + y * 2) % 7 < 2 ? [120, 190, 255] : null));
});

function poseHisser(m: BuiltModel, a: AnimState): void {
  quadrupedPose(m, a, 'head', 1.4);
  const swell = (a.data['swell'] as number | undefined) ?? 0;
  // The hood flares open while swelling
  m.part('frill').xRot = (-12 - (swell / 30) * 38) * DEG;
  m.part('frill').scale = 1 + (swell / 30) * 0.25;
}

registerMobVisual({
  id: 'hisser', model: hisser, texture: () => 'mob/hisser', pose: poseHisser,
  transform(ctx, e) {
    const swell = ((e.data['swell'] as number | undefined) ?? 0) / 30;
    if (swell <= 0) return;
    // Reference swelling: wobble then inflate before the blast
    const f = swell;
    const wobble = 1 + Math.sin(f * 100) * f * 0.01;
    let k = Math.min(1, Math.max(0, f));
    k *= k;
    k *= k;
    const xz = (1 + k * 0.4) * wobble, yy = (1 + k * 0.1) / wobble;
    ctx.mesh.scale(xz, yy, xz);
  },
  extra(ctx, e, a) {
    const mesh = ctx.mesh;
    const swell = ((e.data['swell'] as number | undefined) ?? 0) / 30;
    // White flash every few ticks while swelling
    if (swell > 0 && Math.floor(swell * 10) % 2 === 0) {
      mesh.layer = ctx.textures.layer('white');
      mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
      mesh.setColor(0xffffff, Math.floor(swell * 200));
      hisser.root.render(mesh, ENTITY_TEX);
      mesh.setColor(0xffffff);
    }
    if (e.data['powered'] === true) {
      hisserAura.root.reset();
      const head = hisserAura.part('head');
      head.yRot = -a.headYaw * DEG;
      head.xRot = a.headPitch * DEG;
      const pulse = 0.5 + 0.5 * Math.sin((e.interp.age + a.partial) * 0.3);
      mesh.layer = ctx.textures.layer('mob/hisser_aura');
      mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
      mesh.setColor(0xffffff, Math.floor(120 + pulse * 100));
      hisserAura.root.render(mesh, ENTITY_TEX);
      mesh.setColor(0xffffff);
    }
  },
}, [['mob/hisser', paintHisser]]);

