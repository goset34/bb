/**
 * Entity texture array: 128×128 RGBA layers painted procedurally on demand (player skins, mob
 * textures, particle sheets, orbs). Layers are allocated by name; the GPU array grows by
 * doubling and is re-uploaded from the CPU copies.
 */
import type { Device, Texture } from '../rhi/rhi';
import { hashString, fmix32 } from '../../../common/math/random';
import type { RGB } from '../textures/painter';

export const ENTITY_TEX = 128;

/** Paints one 128×128 layer. */
export type EntityPainter = (c: EntityCanvas, name: string) => void;

const PAINTERS: Array<{ test: (name: string) => boolean; paint: EntityPainter }> = [];

/** Register a painter for texture names matching a prefix or predicate. */
export function registerEntityTexture(match: string | ((name: string) => boolean), paint: EntityPainter): void {
  const test = typeof match === 'string' ? (n: string) => n === match || n.startsWith(match + '/') : match;
  PAINTERS.push({ test, paint });
}

export class EntityCanvas {
  readonly data = new Uint8ClampedArray(ENTITY_TEX * ENTITY_TEX * 4);
  private seed: number;

  constructor(name: string) {
    this.seed = hashString(name);
  }

  /** Deterministic hash noise in [0,1) for a texel. */
  noise(x: number, y: number, salt = 0): number {
    return (fmix32((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791) ^ this.seed) >>> 0) / 4294967296;
  }

  px(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= ENTITY_TEX || y >= ENTITY_TEX) return;
    const o = ((y | 0) * ENTITY_TEX + (x | 0)) * 4;
    this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2]; this.data[o + 3] = a;
  }

  get(x: number, y: number): [number, number, number, number] {
    const o = (y * ENTITY_TEX + x) * 4;
    return [this.data[o]!, this.data[o + 1]!, this.data[o + 2]!, this.data[o + 3]!];
  }

  /** Fill a rectangle with a per-texel colour function (local coordinates). */
  rect(x: number, y: number, w: number, h: number, fn: (lx: number, ly: number) => RGB | null, a = 255): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = fn(i, j);
        if (c) this.px(x + i, y + j, c, a);
      }
    }
  }

  /** Fill a rectangle with a colour plus hash noise of amplitude `amp`. */
  fill(x: number, y: number, w: number, h: number, c: RGB, amp = 10, a = 255): void {
    this.rect(x, y, w, h, (i, j) => {
      const n = (this.noise(x + i, y + j) - 0.5) * 2 * amp;
      return [c[0] + n, c[1] + n, c[2] + n];
    }, a);
  }

  /**
   * Paint the six regions of a box-unwrapped cube at (u,v) with size (w,h,d). `face` receives the
   * face name and local texel coordinates (x across, y down) plus the face size.
   */
  box(u: number, v: number, w: number, h: number, d: number, face: (f: 'top' | 'bottom' | 'front' | 'back' | 'west' | 'east', x: number, y: number, fw: number, fh: number) => RGB | null): void {
    const regions: Array<[typeof FACES[number], number, number, number, number]> = [
      ['top', u + d, v, w, d], ['bottom', u + d + w, v, w, d],
      ['west', u, v + d, d, h], ['front', u + d, v + d, w, h], ['east', u + d + w, v + d, d, h], ['back', u + d + w + d, v + d, w, h],
    ];
    for (const [f, x, y, fw, fh] of regions) this.rect(x, y, fw, fh, (i, j) => face(f, i, j, fw, fh));
  }

  /** Clear a region to transparent. */
  clear(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const o = ((y + j) * ENTITY_TEX + x + i) * 4;
      this.data[o + 3] = 0;
    }
  }
}

const FACES = ['top', 'bottom', 'front', 'back', 'west', 'east'] as const;

export class EntityTextures {
  private readonly layers = new Map<string, number>();
  private readonly cpu: Uint8ClampedArray[] = [];
  private capacity = 16;
  texture: Texture;
  /** Incremented when the GPU texture object was recreated (bind groups must be rebuilt). */
  generation = 0;

  constructor(private readonly device: Device) {
    this.texture = this.create(this.capacity);
  }

  private create(layers: number): Texture {
    return this.device.createTexture({ kind: '2d-array', format: 'rgba8', width: ENTITY_TEX, height: ENTITY_TEX, depth: layers, mips: 1, label: 'entity-textures' });
  }

  /** Layer index of a named texture, painting and uploading it on first use. */
  layer(name: string): number {
    const cur = this.layers.get(name);
    if (cur !== undefined) return cur;
    const canvas = new EntityCanvas(name);
    const painter = PAINTERS.find((p) => p.test(name));
    if (painter) painter.paint(canvas, name);
    else canvas.fill(0, 0, ENTITY_TEX, ENTITY_TEX, [255, 0, 255], 0);
    const idx = this.cpu.length;
    this.cpu.push(canvas.data);
    this.layers.set(name, idx);
    if (idx >= this.capacity) {
      const cap = Math.min(this.device.info.maxTextureLayers, this.capacity * 2);
      if (idx >= cap) throw new Error('Entity texture array full');
      this.texture.destroy();
      this.capacity = cap;
      this.texture = this.create(cap);
      for (let i = 0; i < this.cpu.length; i++) this.device.writeTexture(this.texture, this.cpu[i]!, { z: i, depth: 1 });
      this.generation++;
    } else {
      this.device.writeTexture(this.texture, canvas.data, { z: idx, depth: 1 });
    }
    return idx;
  }

  has(name: string): boolean {
    return this.layers.has(name);
  }

  /** CPU copy of a texture layer (painting it if needed). */
  pixels(name: string): Uint8ClampedArray {
    return this.cpu[this.layer(name)]!;
  }

  destroy(): void {
    this.texture.destroy();
  }
}
