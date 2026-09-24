/**
 * Item models for 3D rendering (dropped items, held items, item frames): block items reuse the
 * baked block model, flat items are sprites extruded one pixel thick from their alpha mask.
 * Also shared with the inventory icon renderer (flat-vs-3D decision and tint colours).
 */
import type { AtlasData } from '../textures/atlas';
import { getRenderShape, BLOCK_BY_NAME, Block } from '../../../common/block/registry';
import { bakeElements, BakedQuad } from '../mesh/bake';
import { Tint, Element, box } from '../../../common/block/model';
import { biome, grassColor, foliageColor, BIRCH_FOLIAGE, SPRUCE_FOLIAGE, LILY_PAD_COLOR } from '../../../common/worldgen/biomes';
import { getItem } from '../../../common/item/items';
import type { ItemStack } from '../../../common/item/stack';
import type { EntityMesh } from './mesh';
import { TEX_GLINT } from './mesh';

export interface SpriteModel {
  kind: 'sprite';
  layer: number;
  /** Tint mask colour (0xffffff = none). */
  tint: number;
  /** Extruded side quads: per quad 12 floats of corners (unit square, z in [-0.5,0.5]/16) + 8 uv. */
  edges: Float32Array;
}

export interface BlockModel {
  kind: 'block';
  quads: BakedQuad[];
  tints: number[];
  /** Is this a full-cube style model (rendered smaller on the ground). */
  cube: boolean;
}

export type ItemModel = SpriteModel | BlockModel;

/** Default colour for a block tint kind in item form (plains colours). */
export function itemTintColor(kind: number): number {
  const plains = biome('plains');
  switch (kind) {
    case Tint.Grass: return grassColor(plains);
    case Tint.Foliage: case Tint.Mangrove: return foliageColor(plains);
    case Tint.Water: return 0x3f76e4;
    case Tint.Birch: return BIRCH_FOLIAGE;
    case Tint.Spruce: return SPRUCE_FOLIAGE;
    case Tint.LilyPad: return LILY_PAD_COLOR;
    case Tint.Wire: return 0xd01010;
    case Tint.Stem: case Tint.AttachedStem: return 0x60c020;
    default: return 0xffffff;
  }
}

/** Stack-dependent sprite tints (dyed leather, potions…); other systems can add resolvers. */
export const stackTintResolvers: Array<(stack: ItemStack) => number | undefined> = [
  (s) => (s.data.color !== undefined && /^leather_|wolf_armor|horse_armor/.test(s.id) ? s.data.color : s.id.startsWith('leather_') ? 0xa06540 : undefined),
  (s) => (/potion|tipped_arrow/.test(s.id) && (!s.data.potion || s.data.potion === 'water') && !s.data.customEffects ? 0x385dc6 : undefined),
];

export function stackTint(stack: ItemStack): number {
  for (const r of stackTintResolvers) {
    const v = r(stack);
    if (v !== undefined) return v;
  }
  return 0xffffff;
}

/** Does the stack render with the enchantment glint? */
export function hasGlint(stack: ItemStack): boolean {
  return stack.hasEnchants() || !!stack.data.stored && Object.keys(stack.data.stored).length > 0 || !!getItem(stack.id)?.glint;
}

/** Flat items for plants (cross models) and thin blocks use a texture as their sprite. */
export function flatItemTexture(b: Block): string | null {
  const r = getRenderShape(b.defaultState);
  if (r.kind !== 'model') return null;
  const els = r.elements;
  const allRotated = els.length > 0 && els.every((e) => e.rot && e.rot.angle % 90 !== 0);
  const thin = els.length > 0 && els.every((e) => Math.abs(e.to[0] - e.from[0]) < 0.5 || Math.abs(e.to[1] - e.from[1]) < 0.5 || Math.abs(e.to[2] - e.from[2]) < 0.5);
  if (allRotated || thin || /torch|lantern|rail|ladder|vine|lichen|door|sign|banner|candle|dust|wire|pane|bars|chain|lever|tripwire|hook|pot|campfire|kelp|sugar_cane|bamboo|dripleaf|sapling|propagule|flower|petals|litter|mushroom|fungus|roots|sprouts|seagrass|coral|pickle|egg|spore|azalea$|cocoa|frogspawn|lily_pad|brewing_stand|bell|repeater|comparator|hopper|cauldron|shelf/.test(b.name)) {
    const face = els[0]?.faces[Object.keys(els[0].faces)[0] as unknown as 2];
    if (/door/.test(b.name)) return `${b.name.replace(/^waxed_/, '')}_top`;
    return face?.tex ?? null;
  }
  return null;
}

/** Elements of a block's default state in item form (cube shapes expanded into one box). */
export function blockItemElements(b: Block): Element[] | null {
  const r = getRenderShape(b.defaultState);
  if (r.kind === 'cube') {
    const el = box([0, 0, 0], [16, 16, 16], { 0: r.tex[0], 1: r.tex[1], 2: r.tex[2], 3: r.tex[3], 4: r.tex[4], 5: r.tex[5] });
    for (const k of Object.keys(el.faces)) {
      const d = Number(k) as 0;
      if (r.tint) el.faces[d]!.tint = r.tint[d] as Tint;
      if (r.rot) el.faces[d]!.rot = r.rot[d] as 0;
      if (r.emissive?.[d]) el.faces[d]!.emissive = true;
    }
    return [el];
  }
  if (r.kind === 'model') return r.elements;
  if (r.kind === 'liquid') return [box([0, 0, 0], [16, 16, 16], r.still)];
  return null;
}

export class ItemModels {
  private readonly cache = new Map<string, ItemModel | null>();

  constructor(private readonly atlas: AtlasData) {}

  private layerOf(name: string): number {
    return (this.atlas.index[name] ?? 0) & 0xfff;
  }

  get(itemId: string): ItemModel | null {
    let m = this.cache.get(itemId);
    if (m !== undefined) return m;
    m = this.build(itemId);
    this.cache.set(itemId, m);
    return m;
  }

  private build(itemId: string): ItemModel | null {
    const sprite = this.atlas.index[`item/${itemId}`];
    if (sprite !== undefined) return this.sprite(sprite & 0xfff, 0xffffff);
    const def = getItem(itemId);
    const b = BLOCK_BY_NAME.get(def?.block ?? itemId);
    if (!b) return null;
    const flat = flatItemTexture(b);
    if (flat) {
      const r = getRenderShape(b.defaultState);
      const t = r.kind === 'model' ? r.elements[0]?.faces[Object.keys(r.elements[0].faces)[0] as unknown as 2]?.tint ?? 0 : 0;
      return this.sprite(this.layerOf(flat), itemTintColor(t));
    }
    const els = blockItemElements(b);
    if (!els) return null;
    const quads = bakeElements(els, (t) => this.layerOf(t));
    const r = getRenderShape(b.defaultState);
    return { kind: 'block', quads, tints: quads.map((q) => itemTintColor(q.tint)), cube: r.kind === 'cube' };
  }

  /** Build extrusion edges for a sprite from its 16×16 alpha mask. */
  private sprite(layer: number, tint: number): SpriteModel {
    const size = this.atlas.size;
    let mip = 0;
    while ((size >> mip) > 16 && mip < this.atlas.mips - 1) mip++;
    const ms = size >> mip;
    const data = this.atlas.albedo[mip]!;
    const step = ms / 16;
    const off = layer * ms * ms * 4;
    const alpha = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= 16 || y >= 16) return false;
      return data[off + ((y * step) * ms + x * step) * 4 + 3]! > 24;
    };
    const quads: number[] = [];
    const t = 0.5 / 16; // half thickness
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!alpha(x, y)) continue;
        // sprite space: x right, y up (row 0 is the top), centre at (0.5, 0.5)
        const x0 = x / 16, x1 = (x + 1) / 16, y1 = 1 - y / 16, y0 = 1 - (y + 1) / 16;
        const u0 = x / 16 + 0.001, u1 = (x + 1) / 16 - 0.001, v0 = y / 16 + 0.001, v1 = (y + 1) / 16 - 0.001;
        if (!alpha(x - 1, y)) quads.push(x0, y1, -t, x0, y0, -t, x0, y0, t, x0, y1, t, u0, v0, u0, v1, u1, v1, u1, v0, -1, 0, 0);
        if (!alpha(x + 1, y)) quads.push(x1, y1, t, x1, y0, t, x1, y0, -t, x1, y1, -t, u0, v0, u0, v1, u1, v1, u1, v0, 1, 0, 0);
        if (!alpha(x, y - 1)) quads.push(x0, y1, -t, x0, y1, t, x1, y1, t, x1, y1, -t, u0, v0, u0, v1, u1, v1, u1, v0, 0, 1, 0);
        if (!alpha(x, y + 1)) quads.push(x0, y0, t, x0, y0, -t, x1, y0, -t, x1, y0, t, u0, v0, u0, v1, u1, v1, u1, v0, 0, -1, 0);
      }
    }
    return { kind: 'sprite', layer, tint, edges: new Float32Array(quads) };
  }
}

const QP = new Float32Array(12);
const QUV = new Float32Array(8);

/**
 * Emit an item model centred at the current origin: sprites span [-0.5, 0.5] in x/y facing +z,
 * blocks span [-0.5, 0.5]³. The caller sets light/hurt state on the mesh.
 */
export function emitItem(mesh: EntityMesh, model: ItemModel, stack: ItemStack | null, flat = false): void {
  const glint = stack ? hasGlint(stack) : false;
  const baseFlags = glint ? TEX_GLINT : 0;
  if (model.kind === 'sprite') {
    const tint = stack && model.tint === 0xffffff ? stackTint(stack) : model.tint;
    mesh.layer = model.layer;
    mesh.flags = baseFlags;
    mesh.setColor(tint);
    const t = flat ? 0 : 0.5 / 16;
    // front (+z) and back (-z)
    QP.set([-0.5, 0.5, t, -0.5, -0.5, t, 0.5, -0.5, t, 0.5, 0.5, t]);
    QUV.set([0, 0, 0, 1, 1, 1, 1, 0]);
    mesh.quad(QP, QUV, 0, 0, 1);
    QP.set([0.5, 0.5, -t, 0.5, -0.5, -t, -0.5, -0.5, -t, -0.5, 0.5, -t]);
    QUV.set([1, 0, 1, 1, 0, 1, 0, 0]);
    mesh.quad(QP, QUV, 0, 0, -1);
    if (!flat) {
      const e = model.edges;
      for (let i = 0; i < e.length; i += 23) {
        for (let k = 0; k < 4; k++) {
          QP[k * 3] = e[i + k * 3]! - 0.5;
          QP[k * 3 + 1] = e[i + k * 3 + 1]! - 0.5;
          QP[k * 3 + 2] = e[i + k * 3 + 2]!;
        }
        for (let k = 0; k < 8; k++) QUV[k] = e[i + 12 + k]!;
        mesh.quad(QP, QUV, e[i + 20]!, e[i + 21]!, e[i + 22]!);
      }
    }
    return;
  }
  for (let qi = 0; qi < model.quads.length; qi++) {
    const q = model.quads[qi]!;
    mesh.layer = q.layer;
    mesh.flags = baseFlags | (q.emissive ? 2 : 0);
    mesh.setColor(model.tints[qi]!);
    for (let k = 0; k < 4; k++) {
      QP[k * 3] = q.pos[k * 3]! - 0.5;
      QP[k * 3 + 1] = q.pos[k * 3 + 1]! - 0.5;
      QP[k * 3 + 2] = q.pos[k * 3 + 2]! - 0.5;
    }
    mesh.quad(QP, q.uv, q.nx, q.ny, q.nz, q.shade ? -1 : 1);
  }
}

/**
 * Sprite id for a held weapon in its current state: bows being drawn, crossbows loading or
 * loaded. `usingTicks` is null when the item is not being used.
 */
export function heldSprite(stack: ItemStack, usingTicks: number | null): string {
  if (stack.id === 'bow' && usingTicks !== null) return usingTicks >= 18 ? 'bow_pulling_2' : usingTicks >= 13 ? 'bow_pulling_1' : 'bow_pulling_0';
  if (stack.id === 'crossbow') {
    const charged = stack.data.charged;
    if (charged?.length) return charged.some((s) => s.id === 'firework_rocket') ? 'crossbow_firework' : 'crossbow_arrow';
    if (usingTicks !== null) {
      const q = stack.getEnchant('quick_charge');
      const f = usingTicks / (q === 0 ? 25 : 25 - 5 * q);
      return f >= 1 ? 'crossbow_pulling_2' : f > 0.58 ? 'crossbow_pulling_1' : 'crossbow_pulling_0';
    }
  }
  return stack.id;
}
