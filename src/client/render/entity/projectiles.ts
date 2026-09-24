/**
 * Renderers for projectiles and other non-living entities: arrows, thrown tridents, thrown items
 * (snowballs, eggs, pearls, bottles), fireballs, wind charges, llama spit, primed TNT and
 * lightning bolts. Models and textures are original.
 */
import { ENTITY_RENDERERS, RenderContext, applyLight } from './renderers';
import { registerEntityTexture, ENTITY_TEX } from './textures';
import { TEX_SKIN, TEX_EMISSIVE, TEX_TRANSLUCENT } from './mesh';
import { emitItem } from './itemmodel';
import { buildModel, paintModel, furFill, rgb, shadeRGB } from './mobs/kit';
import type { ClientEntity } from '../../entities';
import { ItemStack } from '../../../common/item/stack';
import { fmix32 } from '../../../common/math/random';

const D = Math.PI / 180;

registerEntityTexture('white', (c) => c.fill(0, 0, ENTITY_TEX, ENTITY_TEX, [255, 255, 255], 0));

/** Orient along the flight direction (projectile yaw/pitch convention). */
function alongFlight(ctx: RenderContext, e: ClientEntity): void {
  const t = e.transform, p = ctx.partial;
  let dy = t.yaw - t.pyaw;
  while (dy < -180) dy += 360;
  while (dy >= 180) dy -= 360;
  const yaw = t.pyaw + dy * p, pitch = t.ppitch + (t.pitch - t.ppitch) * p;
  ctx.mesh.rotate(1, yaw * D);
  ctx.mesh.rotate(0, -pitch * D);
}

// ---------------------------------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------------------------------

const arrowModel = buildModel({
  arrow: { box: [
    { x: -0.5, y: -0.5, z: -7, w: 1, h: 1, d: 13, name: 'shaft' },
    { x: -1, y: -1, z: 6, w: 2, h: 2, d: 2, name: 'tip' },
    { x: 0, y: -2, z: -8, w: 0, h: 4, d: 4, name: 'finV' },
    { x: -2, y: 0, z: -8, w: 4, h: 0, d: 4, name: 'finH' },
  ] },
});

function paintArrow(c: import('./textures').EntityCanvas, name: string): void {
  const spectral = name.endsWith('spectral');
  paintModel(c, arrowModel, (b) => {
    if (b.name === 'shaft') return furFill(c, spectral ? rgb(0xc8a040) : rgb(0x7a5a38), 8, 0.05);
    if (b.name === 'tip') return furFill(c, spectral ? rgb(0xf0e060) : rgb(0xb8bcc0), 10, 0.04);
    return (f, x, y, fw, fh, ax, ay) => {
      // Feathers: soft vanes with a dark quill line and a notch
      if (y === 0 && x % 2 === 1) return null;
      const quill = f === 'west' || f === 'east' ? y === Math.floor(fh / 2) : x === Math.floor(fw / 2);
      if (quill) return shadeRGB(rgb(0x5a4a3a), 1);
      return furFill(c, spectral ? rgb(0xf0e8a0) : rgb(0xe8e4dc), 12, 0.1)(f, x, y, fw, fh, ax, ay);
    };
  });
}
registerEntityTexture('proj/arrow', paintArrow);

function renderArrow(e: ClientEntity, ctx: RenderContext, x: number, y: number, z: number): void {
  const mesh = ctx.mesh;
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1], z + ctx.cam[2]);
  mesh.hurt = 0;
  mesh.push();
  mesh.translate(x, y, z);
  alongFlight(ctx, e);
  arrowModel.root.reset();
  mesh.layer = ctx.textures.layer(e.type === 'spectral_arrow' ? 'proj/arrow/spectral' : 'proj/arrow');
  mesh.flags = TEX_SKIN;
  const color = e.data['color'] as number | undefined;
  mesh.setColor(color ?? 0xffffff);
  arrowModel.root.render(mesh, ENTITY_TEX);
  mesh.setColor(0xffffff);
  mesh.pop();
}
ENTITY_RENDERERS.set('arrow', renderArrow);
ENTITY_RENDERERS.set('spectral_arrow', renderArrow);

// ---------------------------------------------------------------------------------------------
// Trident
// ---------------------------------------------------------------------------------------------

const tridentModel = buildModel({
  trident: { box: [
    { x: -0.5, y: -0.5, z: -14, w: 1, h: 1, d: 22, name: 'pole' },
    { x: -3, y: -0.5, z: 8, w: 6, h: 1, d: 1, name: 'guard' },
    { x: -0.5, y: -0.5, z: 8, w: 1, h: 1, d: 6, name: 'prongMid' },
    { x: -3, y: -0.5, z: 9, w: 1, h: 1, d: 4, name: 'prongL' },
    { x: 2, y: -0.5, z: 9, w: 1, h: 1, d: 4, name: 'prongR' },
  ] },
});
registerEntityTexture('proj/trident', (c) => paintModel(c, tridentModel, (b) => {
  if (b.name === 'pole') return (f, x, y, fw, fh, ax, ay) => (ay % 5 === 0 ? rgb(0x2f7f72) : furFill(c, rgb(0x46a898), 10, 0.1)(f, x, y, fw, fh, ax, ay));
  return furFill(c, rgb(0x7ad8c8), 12, 0.06);
}));

ENTITY_RENDERERS.set('trident', (e, ctx, x, y, z) => {
  const mesh = ctx.mesh;
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1], z + ctx.cam[2]);
  mesh.hurt = 0;
  mesh.push();
  mesh.translate(x, y, z);
  alongFlight(ctx, e);
  tridentModel.root.reset();
  mesh.layer = ctx.textures.layer('proj/trident');
  mesh.flags = TEX_SKIN | (e.stack?.hasEnchants() ? 4 : 0);
  mesh.setColor(0xffffff);
  tridentModel.root.render(mesh, ENTITY_TEX);
  mesh.pop();
});

// ---------------------------------------------------------------------------------------------
// Thrown items and fireballs (camera-facing sprites)
// ---------------------------------------------------------------------------------------------

function renderSprite(ctx: RenderContext, x: number, y: number, z: number, itemId: string, scale: number, bright: boolean, stack?: ItemStack): void {
  const model = ctx.items.get(itemId);
  if (!model) return;
  const mesh = ctx.mesh;
  if (bright) { mesh.sky = 1; mesh.block = 1; } else applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1], z + ctx.cam[2]);
  mesh.hurt = 0;
  mesh.push();
  mesh.translate(x, y, z);
  const h = Math.sqrt(x * x + z * z);
  mesh.rotate(1, Math.atan2(-x, -z));
  mesh.rotate(0, -Math.atan2(-y, h) * 1);
  mesh.scale(scale);
  emitItem(mesh, model, stack ?? null, true);
  mesh.pop();
}

const THROWN_ITEMS: Record<string, [string, number]> = {
  snowball: ['snowball', 0.5], egg: ['egg', 0.5], void_pearl: ['void_pearl', 0.5], experience_bottle: ['experience_bottle', 0.5],
};
for (const [type, [item, scale]] of Object.entries(THROWN_ITEMS)) {
  ENTITY_RENDERERS.set(type, (e, ctx, x, y, z) => renderSprite(ctx, x, y + 0.125, z, e.stack?.id ?? item, scale, false, e.stack));
}
ENTITY_RENDERERS.set('small_fireball', (_e, ctx, x, y, z) => renderSprite(ctx, x, y + 0.15, z, 'fire_charge', 0.75, true));
ENTITY_RENDERERS.set('fireball', (_e, ctx, x, y, z) => renderSprite(ctx, x, y + 0.5, z, 'fire_charge', 2.5, true));

// ---------------------------------------------------------------------------------------------
// Wind charges and llama spit
// ---------------------------------------------------------------------------------------------

const windModel = buildModel({
  core: { box: { x: -2, y: -2, z: -2, w: 4, h: 4, d: 4 }, parts: {
    ring: { box: { x: -4, y: -1, z: -4, w: 8, h: 2, d: 8, inflate: 0.2 } },
  } },
});
registerEntityTexture('proj/wind', (c) => paintModel(c, windModel, () => (_f, x, y, fw, _fh, ax, ay) => {
  const swirl = Math.sin((x + y * 0.7) * 1.3 + c.noise(ax, ay) * 2) * 0.5 + 0.5;
  return [200 + swirl * 50, 220 + swirl * 35, 255];
}));

function renderWind(e: ClientEntity, ctx: RenderContext, x: number, y: number, z: number, scale: number): void {
  const mesh = ctx.mesh;
  mesh.sky = 1; mesh.block = 1;
  mesh.hurt = 0;
  const t = e.interp.age + ctx.partial;
  mesh.push();
  mesh.translate(x, y + 0.15 * scale, z);
  windModel.root.reset();
  windModel.part('core').yRot = t * 0.4;
  windModel.part('core').xRot = t * 0.15;
  windModel.part('ring').yRot = -t * 0.8;
  mesh.scale(scale);
  mesh.layer = ctx.textures.layer('proj/wind');
  mesh.flags = TEX_SKIN | TEX_TRANSLUCENT | TEX_EMISSIVE;
  mesh.setColor(0xffffff, 190);
  windModel.root.render(mesh, ENTITY_TEX);
  mesh.setColor(0xffffff);
  mesh.pop();
}
ENTITY_RENDERERS.set('wind_charge', (e, ctx, x, y, z) => renderWind(e, ctx, x, y, z, 1));
ENTITY_RENDERERS.set('gust_charge', (e, ctx, x, y, z) => renderWind(e, ctx, x, y, z, 1));

const spitModel = buildModel({
  blob: { box: [
    { x: -1, y: -1, z: -1, w: 2, h: 2, d: 2 }, { x: 1, y: 0, z: -1, w: 1, h: 1, d: 1, name: 'b1' }, { x: -2, y: -1, z: 0, w: 1, h: 1, d: 1, name: 'b2' },
    { x: 0, y: 1, z: 1, w: 1, h: 1, d: 1, name: 'b3' }, { x: 0, y: -2, z: 0, w: 1, h: 1, d: 1, name: 'b4' },
  ] },
});
registerEntityTexture('proj/spit', (c) => paintModel(c, spitModel, () => furFill(c, rgb(0xe8e4d8), 14, 0.1)));
ENTITY_RENDERERS.set('llama_spit', (_e, ctx, x, y, z) => {
  const mesh = ctx.mesh;
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1], z + ctx.cam[2]);
  mesh.hurt = 0;
  mesh.push();
  mesh.translate(x, y + 0.1, z);
  spitModel.root.reset();
  mesh.layer = ctx.textures.layer('proj/spit');
  mesh.flags = TEX_SKIN;
  mesh.setColor(0xffffff);
  spitModel.root.render(mesh, ENTITY_TEX);
  mesh.pop();
});

// ---------------------------------------------------------------------------------------------
// Primed TNT
// ---------------------------------------------------------------------------------------------

const flashModel = buildModel({ cube: { box: { x: -8, y: 0, z: -8, w: 16, h: 16, d: 16, inflate: 0.05 } } });
const TNT = new ItemStack('tnt', 1);

ENTITY_RENDERERS.set('tnt', (e, ctx, x, y, z) => {
  const model = ctx.items.get('tnt');
  if (!model) return;
  const mesh = ctx.mesh;
  applyLight(ctx, x + ctx.cam[0], y + ctx.cam[1] + 0.5, z + ctx.cam[2]);
  mesh.hurt = 0;
  const fuse = ((e.data['fuse'] as number | undefined) ?? 80) - e.interp.age - ctx.partial + 1;
  mesh.push();
  mesh.translate(x, y, z);
  // Swell in the last 10 ticks
  if (fuse < 10) {
    let f = 1 - fuse / 10;
    f = Math.max(0, Math.min(1, f));
    f *= f;
    f *= f;
    mesh.scale(1 + f * 0.3);
  }
  mesh.push();
  mesh.translate(0, 0.5, 0);
  emitItem(mesh, model, TNT);
  mesh.pop();
  // White flash every other 5 ticks
  if (Math.floor(fuse / 5) % 2 === 0) {
    flashModel.root.reset();
    mesh.layer = ctx.textures.layer('white');
    mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
    mesh.setColor(0xffffff, Math.floor(255 * 0.8));
    flashModel.root.render(mesh, ENTITY_TEX);
    mesh.setColor(0xffffff);
  }
  mesh.pop();
});

// ---------------------------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------------------------

const QP = new Float32Array(12);
const QUV = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]);

/** Emit a vertical glowing box between two points (half width w at the bottom, w2 at the top). */
function boltSegment(ctx: RenderContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number): void {
  const mesh = ctx.mesh;
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i]!, [bx, bz] = corners[(i + 1) % 4]!;
    QP.set([
      x1 + ax * w1, y1, z1 + az * w1,
      x0 + ax * w0, y0, z0 + az * w0,
      x0 + bx * w0, y0, z0 + bz * w0,
      x1 + bx * w1, y1, z1 + bz * w1,
    ]);
    mesh.quad(QP, QUV, 0, 1, 0, 1);
  }
}

ENTITY_RENDERERS.set('lightning_bolt', (e, ctx, x, y, z) => {
  const mesh = ctx.mesh;
  mesh.sky = 1; mesh.block = 1; mesh.hurt = 0;
  mesh.layer = ctx.textures.layer('white');
  mesh.flags = TEX_SKIN | TEX_EMISSIVE | TEX_TRANSLUCENT;
  const seed = (e.data['seed'] as number | undefined) ?? e.id;
  mesh.push();
  mesh.translate(x, y, z);
  // Jagged path from the sky to the ground, drawn in widening translucent layers
  const pts: Array<[number, number]> = [];
  let s = fmix32(seed);
  let ox = 0, oz = 0;
  for (let i = 7; i >= 0; i--) {
    pts[i] = [ox, oz];
    s = fmix32(s + i);
    ox += ((s & 255) / 255 - 0.5) * 10 / 16 * 4;
    oz += (((s >>> 8) & 255) / 255 - 0.5) * 10 / 16 * 4;
  }
  for (let layer = 0; layer < 4; layer++) {
    mesh.setColor(0x7272a0, 70);
    const w = 0.1 + layer * 0.1;
    for (let i = 0; i < 8; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = i + 1 < 8 ? pts[i + 1]! : [pts[i]![0] * 1.5, pts[i]![1] * 1.5];
      boltSegment(ctx, ax, i * 16, az, bx, (i + 1) * 16, bz, w, w);
    }
    // A short branch
    const b = fmix32(seed + 99);
    const bi = 2 + (b % 4);
    const [sx, sz] = pts[bi]!;
    boltSegment(ctx, sx, bi * 16, sz, sx + ((b >>> 8) % 7 - 3), bi * 16 + 10, sz + ((b >>> 12) % 7 - 3), w * 0.7, w * 0.4);
  }
  mesh.setColor(0xffffff);
  mesh.pop();
});

