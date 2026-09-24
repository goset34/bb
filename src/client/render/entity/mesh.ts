/**
 * CPU-side builder for entity geometry (quads of 4 vertices, indexed with the shared quad index
 * buffer). Positions are camera-relative; a small matrix stack transforms model-space points.
 */
import { ENTITY_VERTEX_SIZE } from '../shaders/entity';

export const TEX_SKIN = 1;
export const TEX_EMISSIVE = 2;
export const TEX_GLINT = 4;
export const TEX_TRANSLUCENT = 8;

/** Column-major 3×4 affine transform (rotation/scale + translation). */
export type Affine = Float64Array;

export function affine(): Affine {
  const m = new Float64Array(12);
  m[0] = 1; m[4] = 1; m[8] = 1;
  return m;
}

export class EntityMesh {
  private buf: ArrayBuffer;
  private f32: Float32Array;
  private u16: Uint16Array;
  private u8: Uint8Array;
  count = 0; // vertices
  /** Current material state. */
  layer = 0;
  flags = 0;
  r = 255; g = 255; b = 255; a = 255;
  sky = 1; block = 0; hurt = 0;
  /** Matrix stack (model → camera-relative). */
  private stack: Affine[] = [affine()];
  private readonly tmp = new Float64Array(3);

  constructor(initialQuads = 4096) {
    this.buf = new ArrayBuffer(initialQuads * 4 * ENTITY_VERTEX_SIZE);
    this.f32 = new Float32Array(this.buf);
    this.u16 = new Uint16Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
  }

  reset(): void {
    this.count = 0;
    this.stack.length = 1;
    const m = this.stack[0]!;
    m.fill(0);
    m[0] = 1; m[4] = 1; m[8] = 1;
  }

  get bytes(): Uint8Array {
    return this.u8.subarray(0, this.count * ENTITY_VERTEX_SIZE);
  }

  get quads(): number {
    return this.count / 4;
  }

  private ensure(vertices: number): void {
    const need = (this.count + vertices) * ENTITY_VERTEX_SIZE;
    if (need <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(need, this.buf.byteLength * 2));
    new Uint8Array(nb).set(this.u8);
    this.buf = nb;
    this.f32 = new Float32Array(nb);
    this.u16 = new Uint16Array(nb);
    this.u8 = new Uint8Array(nb);
  }

  // ---- matrix stack ------------------------------------------------------------------------

  get top(): Affine {
    return this.stack[this.stack.length - 1]!;
  }

  push(): void {
    this.stack.push(new Float64Array(this.top));
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  translate(x: number, y: number, z: number): void {
    const m = this.top;
    m[9] += m[0]! * x + m[3]! * y + m[6]! * z;
    m[10] += m[1]! * x + m[4]! * y + m[7]! * z;
    m[11] += m[2]! * x + m[5]! * y + m[8]! * z;
  }

  scale(x: number, y = x, z = x): void {
    const m = this.top;
    m[0] *= x; m[1] *= x; m[2] *= x;
    m[3] *= y; m[4] *= y; m[5] *= y;
    m[6] *= z; m[7] *= z; m[8] *= z;
  }

  /** Rotate around an axis (0 = x, 1 = y, 2 = z) by `a` radians. */
  rotate(axis: 0 | 1 | 2, a: number): void {
    if (a === 0) return;
    const m = this.top;
    const c = Math.cos(a), s = Math.sin(a);
    // columns: c0 = m[0..2], c1 = m[3..5], c2 = m[6..8]
    if (axis === 0) {
      for (let i = 0; i < 3; i++) {
        const c1 = m[3 + i]!, c2 = m[6 + i]!;
        m[3 + i] = c1 * c + c2 * s;
        m[6 + i] = -c1 * s + c2 * c;
      }
    } else if (axis === 1) {
      for (let i = 0; i < 3; i++) {
        const c0 = m[i]!, c2 = m[6 + i]!;
        m[i] = c0 * c - c2 * s;
        m[6 + i] = c0 * s + c2 * c;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const c0 = m[i]!, c1 = m[3 + i]!;
        m[i] = c0 * c + c1 * s;
        m[3 + i] = -c0 * s + c1 * c;
      }
    }
  }

  /** Transform a point by the top matrix into `tmp`. */
  private xf(x: number, y: number, z: number): Float64Array {
    const m = this.top, o = this.tmp;
    o[0] = m[0]! * x + m[3]! * y + m[6]! * z + m[9]!;
    o[1] = m[1]! * x + m[4]! * y + m[7]! * z + m[10]!;
    o[2] = m[2]! * x + m[5]! * y + m[8]! * z + m[11]!;
    return o;
  }

  /** Shade factor for a model-space normal (two directional lights, like classic entity lighting). */
  private shadeOf(nx: number, ny: number, nz: number): number {
    const m = this.top;
    let wx = m[0]! * nx + m[3]! * ny + m[6]! * nz;
    let wy = m[1]! * nx + m[4]! * ny + m[7]! * nz;
    let wz = m[2]! * nx + m[5]! * ny + m[8]! * nz;
    const l = Math.hypot(wx, wy, wz) || 1;
    wx /= l; wy /= l; wz /= l;
    const d1 = Math.max(0, wx * 0.16 + wy * 0.94 + wz * -0.3);
    const d2 = Math.max(0, wx * -0.16 + wy * 0.94 + wz * 0.3);
    return Math.min(1, 0.4 + 0.6 * Math.max(d1, d2) + 0.15 * Math.max(0, wy));
  }

  private vertex(px: number, py: number, pz: number, u: number, v: number, shade: number): void {
    const p = this.xf(px, py, pz);
    const o = this.count * (ENTITY_VERTEX_SIZE / 4);
    const f = this.f32, s = this.u16, b = this.u8;
    f[o] = p[0]!; f[o + 1] = p[1]!; f[o + 2] = p[2]!;
    f[o + 3] = u; f[o + 4] = v;
    s[(o + 5) * 2] = this.layer;
    s[(o + 5) * 2 + 1] = this.flags;
    const bo = (o + 6) * 4;
    b[bo] = this.r; b[bo + 1] = this.g; b[bo + 2] = this.b; b[bo + 3] = this.a;
    b[bo + 4] = Math.round(this.sky * 255); b[bo + 5] = Math.round(this.block * 255);
    b[bo + 6] = Math.round(shade * 255); b[bo + 7] = Math.round(this.hurt * 255);
    this.count++;
  }

  /**
   * Emit a quad (model space corners in TL, BL, BR, TR order with matching UVs) and its normal.
   * `shadeOverride` ≥ 0 disables directional shading (flat sprites, emissive parts).
   */
  quad(p: ArrayLike<number>, uv: ArrayLike<number>, nx: number, ny: number, nz: number, shadeOverride = -1): void {
    this.ensure(4);
    const sh = shadeOverride >= 0 ? shadeOverride : this.shadeOf(nx, ny, nz);
    for (let i = 0; i < 4; i++) this.vertex(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!, uv[i * 2]!, uv[i * 2 + 1]!, sh);
  }

  setColor(rgb: number, alpha = 255): void {
    this.r = (rgb >> 16) & 255;
    this.g = (rgb >> 8) & 255;
    this.b = rgb & 255;
    this.a = alpha;
  }

  /** Camera-facing billboard of `size` centred at the current origin (rotation from `right`/`up`). */
  billboard(size: number, right: [number, number, number], up: [number, number, number], u0: number, v0: number, u1: number, v1: number, shade = 1): void {
    const h = size / 2;
    const p = [
      -right[0] * h + up[0] * h, -right[1] * h + up[1] * h, -right[2] * h + up[2] * h,
      -right[0] * h - up[0] * h, -right[1] * h - up[1] * h, -right[2] * h - up[2] * h,
      right[0] * h - up[0] * h, right[1] * h - up[1] * h, right[2] * h - up[2] * h,
      right[0] * h + up[0] * h, right[1] * h + up[1] * h, right[2] * h + up[2] * h,
    ];
    this.quad(p, [u0, v0, u0, v1, u1, v1, u1, v0], 0, 0, 1, shade);
  }
}
