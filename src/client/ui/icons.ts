/**
 * Item icon renderer: draws block items as isometric 3D icons (software projection of the baked
 * block model with affine-textured quads) and flat items as sprites. Results are cached data URLs.
 */
import type { AtlasData } from '../render/textures/atlas';
import { getRenderShape, BLOCK_BY_NAME, Block } from '../../common/block/registry';
import { bakeElements, BakedQuad } from '../render/mesh/bake';
import { Tint, Element } from '../../common/block/model';
import { box } from '../../common/block/model';
import { biome, grassColor, foliageColor, BIRCH_FOLIAGE, SPRUCE_FOLIAGE, LILY_PAD_COLOR } from '../../common/worldgen/biomes';

const SIZE = 64;

export class IconRenderer {
  private readonly cache = new Map<string, string>();
  private readonly texCache = new Map<string, HTMLCanvasElement>();

  constructor(private readonly atlas: AtlasData) {}

  private layerOf(name: string): number {
    return (this.atlas.index[name] ?? 0) & 0xfff;
  }

  private textureCanvas(layer: number, tint: number): HTMLCanvasElement {
    const key = `${layer}:${tint}`;
    let c = this.texCache.get(key);
    if (c) return c;
    const s = this.atlas.size;
    c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(s, s);
    const off = layer * s * s * 4;
    const alb = this.atlas.albedo[0]!, mat = this.atlas.material[0]!;
    const tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
    for (let i = 0; i < s * s; i++) {
      const m = tint === 0xffffff ? 0 : mat[off + i * 4 + 3]! / 255;
      img.data[i * 4] = alb[off + i * 4]! * (1 - m + m * tr);
      img.data[i * 4 + 1] = alb[off + i * 4 + 1]! * (1 - m + m * tg);
      img.data[i * 4 + 2] = alb[off + i * 4 + 2]! * (1 - m + m * tb);
      img.data[i * 4 + 3] = alb[off + i * 4 + 3]!;
    }
    ctx.putImageData(img, 0, 0);
    this.texCache.set(key, c);
    return c;
  }

  private tintColor(kind: number): number {
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

  /** Icon for an item id (block model or flat sprite). */
  icon(itemId: string, blockName?: string): string {
    const key = itemId;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let url: string;
    const spriteLayer = this.atlas.index[`item/${itemId}`];
    if (spriteLayer !== undefined) url = this.renderSprite(spriteLayer & 0xfff);
    else {
      const b = blockName ? BLOCK_BY_NAME.get(blockName) : BLOCK_BY_NAME.get(itemId);
      url = b ? this.renderBlock(b) : this.renderMissing();
    }
    this.cache.set(key, url);
    return url;
  }

  private renderSprite(layer: number): string {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.textureCanvas(layer, 0xffffff), 0, 0, SIZE, SIZE);
    return c.toDataURL();
  }

  private renderMissing(): string {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, SIZE / 2, SIZE / 2);
    ctx.fillRect(SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(SIZE / 2, 0, SIZE / 2, SIZE / 2);
    ctx.fillRect(0, SIZE / 2, SIZE / 2, SIZE / 2);
    return c.toDataURL();
  }

  /** Flat items for plants (cross models) and thin blocks use their texture as a sprite. */
  private flatTexture(b: Block): string | null {
    const r = getRenderShape(b.item ? BLOCK_BY_NAME.get(b.name)!.defaultState : b.defaultState);
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

  private renderBlock(b: Block): string {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const flat = this.flatTexture(b);
    const state = b.defaultState;
    const r = getRenderShape(state);
    if (flat && r.kind === 'model') {
      const layer = this.layerOf(flat);
      const quadTint = r.elements[0]?.faces[Object.keys(r.elements[0].faces)[0] as unknown as 2]?.tint ?? 0;
      ctx.drawImage(this.textureCanvas(layer, this.tintColor(quadTint)), 4, 4, SIZE - 8, SIZE - 8);
      return c.toDataURL();
    }
    let els: Element[];
    if (r.kind === 'cube') {
      els = [box([0, 0, 0], [16, 16, 16], { 0: r.tex[0], 1: r.tex[1], 2: r.tex[2], 3: r.tex[3], 4: r.tex[4], 5: r.tex[5] })];
      if (r.tint) for (const k of Object.keys(els[0]!.faces)) { const d = Number(k) as 0; els[0]!.faces[d]!.tint = r.tint[d] as Tint; }
      if (r.rot) for (const k of Object.keys(els[0]!.faces)) { const d = Number(k) as 0; els[0]!.faces[d]!.rot = r.rot[d] as 0; }
    } else if (r.kind === 'model') els = r.elements;
    else if (r.kind === 'liquid') els = [box([0, 0, 0], [16, 16, 16], r.still)];
    else return this.renderMissing();
    const quads = bakeElements(els, (t) => this.layerOf(t));
    this.drawQuads(ctx, quads);
    return c.toDataURL();
  }

  /** Isometric projection: x right-down, z left-down, y up. */
  private project(x: number, y: number, z: number): [number, number, number] {
    const s = SIZE * 0.36;
    const cx = x - 0.5, cy = y - 0.5, cz = z - 0.5;
    const sx = SIZE / 2 + (cx - cz) * s * 0.866;
    const sy = SIZE / 2 + (cx + cz) * s * 0.5 - cy * s;
    const depth = cx + cz + cy; // larger = closer to viewer
    return [sx, sy, depth];
  }

  private drawQuads(ctx: CanvasRenderingContext2D, quads: BakedQuad[]): void {
    // View direction: looking from (+x, +y, +z) → faces with normals towards viewer are visible
    const visible = quads.filter((q) => q.nx + q.ny + q.nz > -0.01 || q.normal === 6);
    const items = visible.map((q) => {
      const pts = [0, 1, 2, 3].map((i) => this.project(q.pos[i * 3]!, q.pos[i * 3 + 1]!, q.pos[i * 3 + 2]!));
      const depth = pts.reduce((a, p) => a + p[2], 0) / 4;
      return { q, pts, depth };
    });
    items.sort((a, b) => a.depth - b.depth);
    for (const { q, pts } of items) {
      const tex = this.textureCanvas(q.layer & 0xfff, this.tintColor(q.tint));
      const s = this.atlas.size;
      // uv (texture units 0..1) of corners TL(0), BL(1), TR(3)
      const u0 = q.uv[0]! * s, v0 = q.uv[1]! * s;
      const u1 = q.uv[2]! * s, v1 = q.uv[3]! * s;
      const u3 = q.uv[6]! * s, v3 = q.uv[7]! * s;
      const [p0, p1, , p3] = pts as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
      // Solve affine: screen = M * [u, v, 1]
      const du1 = u3 - u0, dv1 = v3 - v0, du2 = u1 - u0, dv2 = v1 - v0;
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-9) continue;
      const ax = p3[0] - p0[0], ay = p3[1] - p0[1], bx = p1[0] - p0[0], by = p1[1] - p0[1];
      // M * (du1,dv1) = (ax,ay); M * (du2,dv2) = (bx,by)
      const m00 = (ax * dv2 - bx * dv1) / det, m01 = (bx * du1 - ax * du2) / det;
      const m10 = (ay * dv2 - by * dv1) / det, m11 = (by * du1 - ay * du2) / det;
      const tx = p0[0] - (m00 * u0 + m01 * v0), ty = p0[1] - (m10 * u0 + m11 * v0);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(m00, m10, m01, m11, tx, ty);
      ctx.drawImage(tex, 0, 0);
      // Face shading
      const shade = q.normal === 1 ? 0 : q.normal === 3 || q.normal === 2 ? 0.2 : q.normal === 5 || q.normal === 4 ? 0.38 : 0.1;
      if (shade > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(-64, -64, 256, 256);
      }
      ctx.restore();
    }
  }
}
