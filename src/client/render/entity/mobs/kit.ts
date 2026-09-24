/**
 * Mob model kit: declarative box models (pixels, Y up, facing +Z) whose texture regions are
 * packed automatically on a 128×128 layer, face-based procedural painting helpers and the
 * generic mob renderer (body rotation, death roll, babies, hurt flash, name tags).
 */
import { ModelPart } from '../model';
import { ENTITY_TEX, EntityCanvas, registerEntityTexture } from '../textures';
import { TEX_SKIN, TEX_EMISSIVE, TEX_TRANSLUCENT } from '../mesh';
import { ENTITY_RENDERERS, RenderContext, applyLight } from '../renderers';
import type { ClientEntity } from '../../../entities';
import { ENTITY_SIZES } from '../../../entities';
import { MOBS } from '../../../../common/entity/mobs';
import type { RGB } from '../../textures/painter';

// ---------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------

export interface BoxDef {
  /** Min corner relative to the part pivot (pixels) and size. */
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  inflate?: number;
  mirror?: boolean;
  /** Name used by painters (defaults to the part name, then `<part>#<index>`). */
  name?: string;
  /** Share the texture region of another named box (same size). */
  same?: string;
}

export interface PartDef {
  /** Pivot relative to the parent (pixels). */
  at?: [number, number, number];
  /** Default rotation (degrees). */
  rot?: [number, number, number];
  box?: BoxDef | BoxDef[];
  parts?: Record<string, PartDef>;
}

export interface PlacedBox {
  part: string;
  name: string;
  u: number; v: number;
  w: number; h: number; d: number;
}

export interface BuiltModel {
  root: ModelPart;
  parts: Map<string, ModelPart>;
  boxes: PlacedBox[];
  part(name: string): ModelPart;
  box(name: string): PlacedBox;
}

const D = Math.PI / 180;

/** Build a model and pack every box's unwrapped region onto the texture (shelf packing). */
export function buildModel(def: Record<string, PartDef>): BuiltModel {
  const root = new ModelPart();
  const parts = new Map<string, ModelPart>();
  const pending: Array<{ part: ModelPart; partName: string; b: BoxDef; name: string }> = [];
  const walk = (parent: ModelPart, defs: Record<string, PartDef>) => {
    for (const [name, pd] of Object.entries(defs)) {
      const [x, y, z] = pd.at ?? [0, 0, 0];
      const p = parent.add(name, new ModelPart(x, y, z));
      if (pd.rot) p.setRot(pd.rot[0] * D, pd.rot[1] * D, pd.rot[2] * D);
      parts.set(name, p);
      const boxes = pd.box ? (Array.isArray(pd.box) ? pd.box : [pd.box]) : [];
      boxes.forEach((b, i) => pending.push({ part: p, partName: name, b, name: b.name ?? (i === 0 ? name : `${name}#${i}`) }));
      if (pd.parts) walk(p, pd.parts);
    }
  };
  walk(root, def);
  // Pack regions: width 2(w+d), height d+h; tallest first
  const regions = pending.filter((p) => !p.b.same).map((p) => ({
    p, rw: 2 * (Math.ceil(p.b.w) + Math.ceil(p.b.d)), rh: Math.ceil(p.b.d) + Math.ceil(p.b.h),
  })).sort((a, b) => b.rh - a.rh || b.rw - a.rw);
  const placed = new Map<string, PlacedBox>();
  let x = 0, y = 0, shelf = 0;
  for (const r of regions) {
    if (x + r.rw > ENTITY_TEX) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + r.rh > ENTITY_TEX || r.rw > ENTITY_TEX) throw new Error(`Mob model texture overflow at box ${r.p.name}`);
    const b = r.p.b;
    placed.set(r.p.name, { part: r.p.partName, name: r.p.name, u: x, v: y, w: Math.ceil(b.w), h: Math.ceil(b.h), d: Math.ceil(b.d) });
    x += r.rw;
    shelf = Math.max(shelf, r.rh);
  }
  const boxes: PlacedBox[] = [];
  for (const p of pending) {
    const src = placed.get(p.b.same ?? p.name);
    if (!src) throw new Error(`Unknown shared box ${p.b.same}`);
    const pb = p.b.same ? { ...src, part: p.partName, name: p.name } : src;
    if (!p.b.same) boxes.push(pb);
    p.part.box(pb.u, pb.v, p.b.x, p.b.y, p.b.z, p.b.w, p.b.h, p.b.d, p.b.inflate ?? 0, p.b.mirror ?? false);
  }
  return {
    root, parts, boxes,
    part(name) {
      const p = parts.get(name);
      if (!p) throw new Error(`No model part ${name}`);
      return p;
    },
    box(name) {
      const b = placed.get(name);
      if (!b) throw new Error(`No model box ${name}`);
      return b;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

export type Face = 'top' | 'bottom' | 'front' | 'back' | 'west' | 'east';

/** Face painter: local texel (x across, y down) on a face of size fw×fh. */
export type FaceFn = (f: Face, x: number, y: number, fw: number, fh: number) => RGB | null;

export const rgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export function shadeRGB(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Smooth value noise over texel coordinates (0..1). */
export function valueNoise(c: EntityCanvas, x: number, y: number, scale: number, salt = 0): number {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n00 = c.noise(x0, y0, salt), n10 = c.noise(x0 + 1, y0, salt), n01 = c.noise(x0, y0 + 1, salt), n11 = c.noise(x0 + 1, y0 + 1, salt);
  return (n00 + (n10 - n00) * sx) + ((n01 + (n11 - n01) * sx) - (n00 + (n10 - n00) * sx)) * sy;
}

/** Face shading so boxes read in 3D even under flat light (top lighter, bottom darker). */
const FACE_SHADE: Record<Face, number> = { top: 1.08, bottom: 0.78, front: 1, back: 0.94, west: 0.9, east: 0.9 };

/** Paint every region of a placed box. Absolute texel positions are passed for noise. */
export function paintBox(c: EntityCanvas, b: PlacedBox, fn: (f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB | null): void {
  const { u, v, w, h, d } = b;
  const regions: Array<[Face, number, number, number, number]> = [
    ['top', u + d, v, w, d], ['bottom', u + d + w, v, w, d],
    ['west', u, v + d, d, h], ['front', u + d, v + d, w, h], ['east', u + d + w, v + d, d, h], ['back', u + d + w + d, v + d, w, h],
  ];
  for (const [f, rx, ry, fw, fh] of regions) {
    for (let j = 0; j < fh; j++) {
      for (let i = 0; i < fw; i++) {
        const col = fn(f, i, j, fw, fh, rx + i, ry + j);
        if (col) c.px(rx + i, ry + j, col);
      }
    }
  }
}

/** Texel position of a face-local coordinate. */
export function faceTexel(b: PlacedBox, f: Face, x: number, y: number): [number, number] {
  const { u, v, w, d } = b;
  switch (f) {
    case 'top': return [u + d + x, v + y];
    case 'bottom': return [u + d + w + x, v + y];
    case 'west': return [u + x, v + d + y];
    case 'front': return [u + d + x, v + d + y];
    case 'east': return [u + d + w + x, v + d + y];
    case 'back': return [u + d + w + d + x, v + d + y];
  }
}

export function faceSize(b: PlacedBox, f: Face): [number, number] {
  switch (f) {
    case 'top': case 'bottom': return [b.w, b.d];
    case 'west': case 'east': return [b.d, b.h];
    default: return [b.w, b.h];
  }
}

/** Draw a pixel on a face (negative coordinates count from the far edge). */
export function dot(c: EntityCanvas, b: PlacedBox, f: Face, x: number, y: number, col: RGB, a = 255): void {
  const [fw, fh] = faceSize(b, f);
  const lx = x < 0 ? fw + x : x, ly = y < 0 ? fh + y : y;
  if (lx < 0 || ly < 0 || lx >= fw || ly >= fh) return;
  const [tx, ty] = faceTexel(b, f, lx, ly);
  c.px(tx, ty, col, a);
}

export function faceRect(c: EntityCanvas, b: PlacedBox, f: Face, x: number, y: number, w: number, h: number, col: RGB | ((i: number, j: number) => RGB | null), a = 255): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const cc = typeof col === 'function' ? col(i, j) : col;
    if (cc) dot(c, b, f, x + i, y + j, cc, a);
  }
}

/** Two eyes on a head front: white sclera and a dark pupil, symmetric around the centre. */
export function eyes(c: EntityCanvas, head: PlacedBox, y: number, gap: number, pupil: RGB, sclera: RGB | null = [235, 235, 230], size = 1, pupilInner = true): void {
  const [fw] = faceSize(head, 'front');
  const cx = fw / 2;
  for (const side of [-1, 1]) {
    const px = Math.round(cx + side * (gap / 2) - (side < 0 ? size : 0));
    for (let j = 0; j < size; j++) {
      if (sclera) {
        faceRect(c, head, 'front', side < 0 ? px - 1 : px + size, y + j, 1, 1, sclera);
      }
      faceRect(c, head, 'front', px, y + j, size, 1, pupilInner ? pupil : pupil);
    }
  }
}

/** Standard fur/skin fill: base colour, per-texel noise, soft value-noise mottling, face shading. */
export function furFill(c: EntityCanvas, base: RGB, amp = 12, mottle = 0.12, scale = 3, salt = 0): (f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB {
  return (f, _x, _y, _fw, _fh, ax, ay) => {
    const n = (c.noise(ax, ay, salt) - 0.5) * 2 * amp;
    const m = 1 + (valueNoise(c, ax, ay, scale, salt + 7) - 0.5) * 2 * mottle;
    const k = FACE_SHADE[f] * m;
    return [base[0] * k + n, base[1] * k + n, base[2] * k + n];
  };
}

/** Face fill combining a base painter with overrides by part name. */
export function paintModel(c: EntityCanvas, model: BuiltModel, byBox: (b: PlacedBox) => ((f: Face, x: number, y: number, fw: number, fh: number, ax: number, ay: number) => RGB | null) | null): void {
  c.clear(0, 0, ENTITY_TEX, ENTITY_TEX);
  for (const b of model.boxes) {
    const fn = byBox(b);
    if (fn) paintBox(c, b, fn);
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export interface AnimState {
  limbSwing: number;
  limbAmount: number;
  /** Head yaw relative to the body and pitch (degrees). */
  headYaw: number;
  headPitch: number;
  /** Ticks alive plus the partial tick. */
  age: number;
  /** Arm swing progress 0..1 (0 = none). */
  attack: number;
  partial: number;
  data: Record<string, unknown>;
  onGround: boolean;
  inWater: boolean;
  baby: boolean;
}

export interface MobVisual {
  id: string;
  model: BuiltModel;
  /** Texture layer name for this entity (variants). */
  texture(e: ClientEntity): string;
  pose(m: BuiltModel, a: AnimState, e: ClientEntity): void;
  /** Overall scale (1 = pixels as modelled). */
  scale?: number;
  /** Baby rendering: whole-model scale and extra head scale for the parts listed. */
  babyScale?: number;
  babyHeadScale?: number;
  babyHead?: string[];
  /** Degrees the corpse rolls over when dying (default 90). */
  deathFlip?: number;
  /** Extra layers after the body (armor, saddles, wool, glowing eyes). */
  extra?(ctx: RenderContext, e: ClientEntity, a: AnimState): void;
  /** Name tag height above the feet. */
  nameHeight?: number;
  /** Rendered with blending (slimes, translucent parts). */
  translucent?: boolean;
  /** Custom transform before the model (bobbing, swimming roll). */
  transform?(ctx: RenderContext, e: ClientEntity, a: AnimState): void;
}

export const MOB_VISUALS = new Map<string, MobVisual>();

function wrap(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * t;
}

/** Animation inputs for an entity at the current frame. */
export function animState(e: ClientEntity, partial: number): AnimState {
  const t = e.transform, i = e.interp;
  const bodyYaw = lerpAngle(t.pBodyYaw, t.bodyYaw, partial);
  const headYaw = lerpAngle(t.pHeadYaw, t.headYaw, partial);
  return {
    limbSwing: i.limbSwing - i.limbSwingAmount * (1 - partial),
    limbAmount: Math.min(1, i.prevLimbSwingAmount + (i.limbSwingAmount - i.prevLimbSwingAmount) * partial),
    headYaw: wrap(headYaw - bodyYaw),
    headPitch: t.ppitch + (t.pitch - t.ppitch) * partial,
    age: i.age + partial,
    attack: i.swinging ? Math.max(0, (i.swingTime + partial) / 6) : 0,
    partial,
    data: e.data,
    onGround: e.physics.onGround,
    inWater: e.data['inWater'] === true,
    baby: e.data['baby'] === true,
  };
}

/** Draw a visual's model for an entity (camera-relative origin x,y,z). */
export function renderMob(ctx: RenderContext, e: ClientEntity, x: number, y: number, z: number, v: MobVisual): void {
  const mesh = ctx.mesh;
  const t = e.transform, i = e.interp;
  const p = ctx.partial;
  const a = animState(e, p);
  const m = v.model;
  m.root.reset();
  v.pose(m, a, e);
  const info = MOBS.get(v.id);
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1] + (info?.height ?? 1) * 0.5, z + ctx.cam[2]);
  mesh.hurt = i.hurtTime > 0 || i.deathTime > 0 ? 1 : 0;
  mesh.push();
  mesh.translate(x, y, z);
  mesh.rotate(1, (-lerpAngle(t.pBodyYaw, t.bodyYaw, p) * Math.PI) / 180);
  if (i.deathTime > 0) {
    const d = Math.min(1, Math.sqrt(((i.deathTime + p - 1) / 20) * 1.6));
    mesh.rotate(2, ((v.deathFlip ?? 90) * d * Math.PI) / 180);
  }
  v.transform?.(ctx, e, a);
  const s = (v.scale ?? 1) * (a.baby ? v.babyScale ?? 0.5 : 1);
  if (s !== 1) mesh.scale(s);
  if (a.baby && v.babyHead) for (const h of v.babyHead) m.part(h).scale = v.babyHeadScale ?? 1.5;
  mesh.layer = ctx.textures.layer(v.texture(e));
  mesh.flags = TEX_SKIN | (v.translucent ? TEX_TRANSLUCENT : 0);
  mesh.setColor(0xffffff);
  m.root.render(mesh, ENTITY_TEX);
  v.extra?.(ctx, e, a);
  mesh.pop();
  const name = e.data['customName'];
  if (typeof name === 'string' && name && i.deathTime === 0) {
    const h = (v.nameHeight ?? (info?.height ?? 1)) * (a.baby ? 0.6 : 1) + 0.35;
    ctx.labels.push({ text: name, x: x + ctx.cam[0], y: y + ctx.cam[1] + h, z: z + ctx.cam[2], sneaking: false });
  }
}

/** Emissive overlay pass (glowing eyes) re-using the current transform. */
export function emissivePass(ctx: RenderContext, model: BuiltModel, texture: string): void {
  const mesh = ctx.mesh;
  mesh.layer = ctx.textures.layer(texture);
  mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
  mesh.setColor(0xffffff);
  const hurt = mesh.hurt;
  mesh.hurt = 0;
  model.root.render(mesh, ENTITY_TEX);
  mesh.hurt = hurt;
}

/** Register a mob visual: renderer, client hitbox and texture painters. */
export function registerMobVisual(v: MobVisual, painters: Array<[string, (c: EntityCanvas, name: string) => void]>): void {
  MOB_VISUALS.set(v.id, v);
  const info = MOBS.get(v.id);
  if (info) ENTITY_SIZES[v.id] = [info.width, info.height];
  for (const [prefix, paint] of painters) registerEntityTexture(prefix, paint);
  ENTITY_RENDERERS.set(v.id, (e, ctx, x, y, z) => renderMob(ctx, e, x, y, z, v));
}

// ---------------------------------------------------------------------------------------------
// Common poses
// ---------------------------------------------------------------------------------------------

export const DEG = D;

/** Four-legged walk (legs named fr, fl, br, bl) and head look. */
export function quadrupedPose(m: BuiltModel, a: AnimState, head = 'head', stride = 1.4): void {
  const h = m.parts.get(head);
  if (h) {
    h.yRot = -a.headYaw * D;
    h.xRot += a.headPitch * D;
  }
  const w = a.limbSwing * 0.6662;
  const amt = a.limbAmount * stride;
  const legs: Array<[string, number]> = [['fr', 0], ['bl', 0], ['fl', Math.PI], ['br', Math.PI]];
  for (const [name, ph] of legs) {
    const p = m.parts.get(name);
    if (p) p.xRot = Math.cos(w + ph) * amt;
  }
}

/** Arms-forward biped pose (zombie-like) with walk cycle. */
export function bipedWalk(m: BuiltModel, a: AnimState): void {
  const w = a.limbSwing * 0.6662;
  const amt = a.limbAmount;
  const set = (n: string, v: number) => { const p = m.parts.get(n); if (p) p.xRot = v; };
  set('rightLeg', Math.cos(w) * 1.4 * amt);
  set('leftLeg', Math.cos(w + Math.PI) * 1.4 * amt);
  set('rightArm', Math.cos(w + Math.PI) * amt);
  set('leftArm', Math.cos(w) * amt);
  const h = m.parts.get('head');
  if (h) {
    h.yRot = -a.headYaw * D;
    h.xRot = a.headPitch * D;
  }
}

export { TEX_EMISSIVE, TEX_TRANSLUCENT };
