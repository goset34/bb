/**
 * Per-type entity renderers. Each renderer emits geometry into the shared EntityMesh with the
 * entity's origin already translated (camera-relative). Other milestones register mob renderers
 * in ENTITY_RENDERERS.
 */
import type { ClientEntity, ClientEntities } from '../../entities';
import type { ClientLevel } from '../../world';
import type { EntityMesh } from './mesh';
import { TEX_SKIN, TEX_EMISSIVE, TEX_TRANSLUCENT } from './mesh';
import type { EntityTextures } from './textures';
import { ENTITY_TEX, registerEntityTexture } from './textures';
import { ItemModels, emitItem } from './itemmodel';
import { createPlayerModel, posePlayer, PlayerModel } from './player';
import { createArmorModel, ArmorModel } from './armor';
import { ModelPart } from './model';
import { ItemStack } from '../../../common/item/stack';
import { getItem } from '../../../common/item/items';
import { fmix32 } from '../../../common/math/random';

export interface RenderContext {
  mesh: EntityMesh;
  textures: EntityTextures;
  items: ItemModels;
  level: ClientLevel;
  entities: ClientEntities;
  partial: number;
  /** Camera world position. */
  cam: [number, number, number];
  /** Billboard axes (camera right / up in world space). */
  right: [number, number, number];
  up: [number, number, number];
  /** Resolve an entity's (or the local player's) interpolated world position. */
  positionOf(id: number): [number, number, number] | null;
  /** Name tags to draw (world position above the head). */
  labels: Array<{ text: string; x: number; y: number; z: number; sneaking: boolean }>;
}

export type EntityRenderFn = (e: ClientEntity, ctx: RenderContext, x: number, y: number, z: number) => void;

export const ENTITY_RENDERERS = new Map<string, EntityRenderFn>();

/** Sample the light at a block position into the mesh state. */
export function applyLight(ctx: RenderContext, wx: number, wy: number, wz: number): void {
  const l = ctx.level.getLight(Math.floor(wx), Math.floor(wy), Math.floor(wz));
  ctx.mesh.sky = (l >> 4) / 15;
  ctx.mesh.block = (l & 15) / 15;
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

function copiesFor(count: number): number {
  return count > 48 ? 5 : count > 32 ? 4 : count > 16 ? 3 : count > 1 ? 2 : 1;
}

ENTITY_RENDERERS.set('item', (e, ctx, x, y, z) => {
  const stack = e.stack;
  if (!stack || stack.isEmpty()) return;
  const model = ctx.items.get(stack.id);
  if (!model) return;
  const mesh = ctx.mesh;
  const i = e.interp;
  const age = i.age + ctx.partial;
  const bobPhase = ((fmix32(e.id) >>> 0) / 4294967296) * Math.PI * 2;
  // Pickup: fly into the collector
  if (i.pickup) {
    const target = ctx.positionOf(i.pickup.collector);
    if (target) {
      const k = Math.min(1, (i.pickup.t + ctx.partial) / 3);
      const kk = k * k;
      x += (target[0] - ctx.cam[0] - x) * kk;
      y += (target[1] + 0.8 - ctx.cam[1] - y) * kk;
      z += (target[2] - ctx.cam[2] - z) * kk;
    }
  }
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1] + 0.2, z + ctx.cam[2]);
  mesh.hurt = 0;
  const bob = Math.sin(age / 10 + bobPhase) * 0.1 + 0.1;
  const spin = age / 20 + bobPhase;
  const isBlock = model.kind === 'block';
  const scale = isBlock ? (model.cube ? 0.25 : 0.5) : 0.5;
  const n = copiesFor(stack.count);
  mesh.push();
  mesh.translate(x, y + bob + 0.25 * (isBlock ? 0.5 : 1) - 0.05, z);
  mesh.rotate(1, spin);
  let seed = fmix32(e.id * 31 + 7);
  for (let c = 0; c < n; c++) {
    mesh.push();
    if (c > 0) {
      seed = fmix32(seed + c);
      const rx = (((seed >>> 0) & 255) / 255 - 0.5) * 0.3, ry = ((((seed >>> 8) & 255) / 255) - 0.5) * 0.3, rz = ((((seed >>> 16) & 255) / 255) - 0.5) * 0.3;
      if (isBlock) mesh.translate(rx * scale * 2, ry * scale * 2, rz * scale * 2);
      else mesh.translate(rx * 0.15, ry * 0.15, -c * 0.09);
    }
    mesh.scale(scale);
    emitItem(mesh, model, stack);
    mesh.pop();
  }
  mesh.pop();
});

// ---------------------------------------------------------------------------------------------
// Experience orbs
// ---------------------------------------------------------------------------------------------

/** Orb sprite sheet: 11 sizes in 16 px cells on one layer. */
registerEntityTexture('xp_orb', (c) => {
  c.clear(0, 0, ENTITY_TEX, ENTITY_TEX);
  for (let i = 0; i < 11; i++) {
    const cx = (i % 8) * 16 + 8, cy = Math.floor(i / 8) * 16 + 8;
    const r = 2.2 + i * 0.45;
    for (let y = -8; y < 8; y++) {
      for (let x = -8; x < 8; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5);
        if (d > r) continue;
        const k = 1 - d / r;
        const hl = x < 0 && y < 0 ? 40 : 0;
        const edge = d > r - 1;
        const v: [number, number, number] = edge ? [60, 120, 20] : [150 + k * 100 + hl, 230 + hl * 0.5, 60 + k * 80];
        c.px(cx + x, cy + y, v, 255);
      }
    }
  }
});

const ORB_TIERS = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];

ENTITY_RENDERERS.set('xp_orb', (e, ctx, x, y, z) => {
  const mesh = ctx.mesh;
  const value = (e.data['value'] as number | undefined) ?? 1;
  let tier = ORB_TIERS.findIndex((t) => value >= t);
  if (tier < 0) tier = 10;
  const cell = 10 - tier;
  const t = (e.interp.age + ctx.partial) / 2;
  const rr = ((Math.sin(t) + 1) * 0.5 * 255) | 0;
  const bb = ((Math.sin(t + 4.1887903) + 1) * 0.1 * 255) | 0;
  if (e.interp.pickup) {
    const target = ctx.positionOf(e.interp.pickup.collector);
    if (target) {
      const k = Math.min(1, (e.interp.pickup.t + ctx.partial) / 3);
      x += (target[0] - ctx.cam[0] - x) * k;
      y += (target[1] + 0.8 - ctx.cam[1] - y) * k;
      z += (target[2] - ctx.cam[2] - z) * k;
    }
  }
  mesh.layer = ctx.textures.layer('xp_orb');
  mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
  mesh.r = Math.max(120, rr); mesh.g = 255; mesh.b = bb; mesh.a = 255;
  mesh.hurt = 0;
  mesh.push();
  mesh.translate(x, y + 0.15, z);
  const u0 = ((cell % 8) * 16) / ENTITY_TEX, v0 = (Math.floor(cell / 8) * 16) / ENTITY_TEX;
  mesh.billboard(0.35, ctx.right, ctx.up, u0, v0, u0 + 16 / ENTITY_TEX, v0 + 16 / ENTITY_TEX, 1);
  mesh.pop();
});

// ---------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------

const playerModel: PlayerModel = createPlayerModel();
const armorModel: ArmorModel = createArmorModel();

/** Copy the pose of the skeleton onto an armor part. */
function follow(dst: ModelPart, src: ModelPart): void {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.xRot = src.xRot; dst.yRot = src.yRot; dst.zRot = src.zRot;
}

function armorTexture(ctx: RenderContext, stack: ItemStack, legs: boolean): number {
  const mat = getItem(stack.id)?.armor?.material ?? 'iron';
  return ctx.textures.layer(`armor/${mat}${legs ? '/legs' : ''}`);
}

/** Render a humanoid (player) with equipment. Shared with humanoid mobs in later milestones. */
export function renderHumanoid(ctx: RenderContext, e: ClientEntity, x: number, y: number, z: number, skin: string, model: PlayerModel = playerModel, adjust?: (m: PlayerModel, e: ClientEntity, partial: number) => void): void {
  const mesh = ctx.mesh;
  const t = e.transform, i = e.interp;
  const p = ctx.partial;
  const bodyYaw = lerpAngle(t.pBodyYaw, t.bodyYaw, p);
  const headYaw = lerpAngle(t.pHeadYaw, t.headYaw, p);
  const pitch = t.ppitch + (t.pitch - t.ppitch) * p;
  const eq = i.equipment;
  const main = eq[0] ?? ItemStack.empty(), off = eq[1] ?? ItemStack.empty();
  const sneaking = e.data['sneaking'] === true;
  const swimming = e.data['swimming'] === true;
  posePlayer(model, {
    limbSwing: i.limbSwing - i.limbSwingAmount * (1 - p),
    limbAmount: Math.min(1, i.prevLimbSwingAmount + (i.limbSwingAmount - i.prevLimbSwingAmount) * p),
    headYaw: wrap(headYaw - bodyYaw), headPitch: pitch,
    swing: i.swinging ? Math.max(0, (i.swingTime + p) / 6) : 0, swingOffhand: i.swingOffhand,
    sneaking, holdingMain: !main.isEmpty(), holdingOff: !off.isEmpty(), using: e.data['using'] === true,
    age: i.age + p, swimming, flying: false,
  });
  adjust?.(model, e, p);
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1] + 1, z + ctx.cam[2]);
  mesh.hurt = i.hurtTime > 0 || i.deathTime > 0 ? 1 : 0;
  mesh.push();
  mesh.translate(x, y, z);
  const sleeping = e.data['sleeping'] === true;
  if (sleeping) {
    // Lie on the back with the head on the pillow (facing = bed head direction)
    const f = (e.data['bedFacing'] as number | undefined) ?? 3;
    const fx = [0, 0, 0, 0, -1, 1][f]!, fz = [0, 0, -1, 1, 0, 0][f]!;
    const yaw = [0, 0, 180, 0, 90, 270][f]!;
    mesh.translate(-fx * 1.3, -0.15, -fz * 1.3);
    mesh.rotate(1, (-(yaw + 180) * Math.PI) / 180);
    mesh.rotate(0, -Math.PI / 2);
  } else mesh.rotate(1, (-bodyYaw * Math.PI) / 180);
  if (i.deathTime > 0) {
    const d = Math.min(1, Math.sqrt((i.deathTime + p - 1) / 20 * 1.6));
    mesh.rotate(2, (d * Math.PI) / 2);
  }
  if (swimming) {
    mesh.translate(0, 0.3, 0);
    mesh.rotate(0, (-(90 + pitch) * Math.PI) / 180);
    mesh.translate(0, -1.2, 0);
  }
  if (e.data['baby'] === true) {
    mesh.scale(0.5);
    model.head.scale = 1.5;
  }
  // Body
  mesh.layer = ctx.textures.layer(skin);
  mesh.flags = TEX_SKIN;
  mesh.setColor(0xffffff);
  model.root.render(mesh, ENTITY_TEX);
  // Armor (feet, legs, chest, head at equipment[2..5])
  const [feet, legs, chest, head] = [eq[2], eq[3], eq[4], eq[5]];
  const layerFor = (s: ItemStack | undefined, isLegs: boolean): boolean => {
    if (!s || s.isEmpty() || !getItem(s.id)?.armor) return false;
    mesh.layer = armorTexture(ctx, s, isLegs);
    mesh.flags = TEX_SKIN | (s.hasEnchants() ? 4 : 0);
    mesh.setColor(s.id.startsWith('leather_') ? (s.data.color ?? 0xa06540) : 0xffffff);
    return true;
  };
  if (layerFor(head, false)) { follow(armorModel.head, model.head); armorModel.head.render(mesh, ENTITY_TEX); }
  if (layerFor(chest, false)) {
    follow(armorModel.body, model.body); follow(armorModel.rightArm, model.rightArm); follow(armorModel.leftArm, model.leftArm);
    armorModel.body.render(mesh, ENTITY_TEX); armorModel.rightArm.render(mesh, ENTITY_TEX); armorModel.leftArm.render(mesh, ENTITY_TEX);
  }
  if (layerFor(legs, true)) {
    follow(armorModel.waist, model.body); follow(armorModel.rightThigh, model.rightLeg); follow(armorModel.leftThigh, model.leftLeg);
    armorModel.waist.render(mesh, ENTITY_TEX); armorModel.rightThigh.render(mesh, ENTITY_TEX); armorModel.leftThigh.render(mesh, ENTITY_TEX);
  }
  if (layerFor(feet, false)) {
    follow(armorModel.rightBoot, model.rightLeg); follow(armorModel.leftBoot, model.leftLeg);
    armorModel.rightBoot.render(mesh, ENTITY_TEX); armorModel.leftBoot.render(mesh, ENTITY_TEX);
  }
  // Held items
  if (!main.isEmpty()) renderHeld(ctx, model.rightArm, main, false);
  if (!off.isEmpty()) renderHeld(ctx, model.leftArm, off, true);
  // Non-armor head items (carved pumpkin, heads) sit on the head as blocks
  if (head && !head.isEmpty() && !getItem(head.id)?.armor) {
    const m = ctx.items.get(head.id);
    if (m) {
      mesh.push();
      model.head.applyTransform(mesh);
      mesh.translate(0, 0.25, 0);
      mesh.scale(0.625);
      emitItem(mesh, m, head);
      mesh.pop();
    }
  }
  mesh.pop();
}

function renderHeld(ctx: RenderContext, arm: ModelPart, stack: ItemStack, left: boolean): void {
  const mesh = ctx.mesh;
  const m = ctx.items.get(stack.id);
  if (!m) return;
  mesh.push();
  arm.applyTransform(mesh);
  mesh.translate((left ? 1 : -1) / 16, -9 / 16, 0);
  mesh.rotate(0, -Math.PI / 2);
  if (m.kind === 'block' && m.cube) {
    mesh.translate(0, 0.1, -0.12);
    mesh.scale(0.375);
  } else {
    const tool = getItem(stack.id)?.tool;
    mesh.translate(0, tool ? 0.22 : 0.18, -0.06);
    mesh.rotate(1, left ? Math.PI / 2 : -Math.PI / 2);
    mesh.rotate(2, tool ? Math.PI / 4 : 0);
    mesh.scale(tool ? 0.85 : 0.55);
  }
  mesh.hurt = 0;
  emitItem(mesh, m, stack);
  mesh.pop();
}

function wrap(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * t;
}

ENTITY_RENDERERS.set('player', (e, ctx, x, y, z) => {
  const name = (e.data['name'] as string | undefined) ?? '';
  renderHumanoid(ctx, e, x, y, z, `player/${name}`);
  if (name && e.interp.deathTime === 0) ctx.labels.push({ text: name, x: x + ctx.cam[0], y: y + ctx.cam[1] + (e.data['sneaking'] ? 1.7 : 2.05), z: z + ctx.cam[2], sneaking: e.data['sneaking'] === true });
});
