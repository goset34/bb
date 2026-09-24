/**
 * Chunk vertex format (20 bytes):
 *   0  u16×3  position: (p + 16) * 1024, section-local block units
 *   6  u16    texture layer (bits 0-11) | (frames-1) << 12
 *   8  u16×2  uv in block units × 256 (texture repeats every 256)
 *  12  u8×4   tint r, g, b, ambient occlusion (0..255 = dark..bright)
 *  16  u8     normal index (0..5 axis, 6 = none) | flags << 3 (bit3: no-shade)
 *  17  u8     sky light × 17 (0..255)
 *  18  u8     material flags: bit0 emissive, bits1-3 wave kind, bit4 water, bit5 lava
 *  19  u8     block light × 17 (0..255)
 */
export const VERTEX_SIZE = 20;
export const POS_SCALE = 1024;
export const POS_OFFSET = 16;
export const UV_SCALE = 256;

export const MAT_EMISSIVE = 1;
export const MAT_WATER = 16;
export const MAT_LAVA = 32;

export class VertexWriter {
  buf: ArrayBuffer;
  u8: Uint8Array;
  u16: Uint16Array;
  count = 0;

  constructor(initialVerts = 4096) {
    this.buf = new ArrayBuffer(initialVerts * VERTEX_SIZE);
    this.u8 = new Uint8Array(this.buf);
    this.u16 = new Uint16Array(this.buf);
  }

  private grow(): void {
    const nb = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(nb).set(this.u8);
    this.buf = nb;
    this.u8 = new Uint8Array(nb);
    this.u16 = new Uint16Array(nb);
  }

  vertex(x: number, y: number, z: number, layer: number, u: number, v: number, r: number, g: number, b: number, ao: number, normal: number, sky: number, mat: number, block: number): void {
    if ((this.count + 1) * VERTEX_SIZE > this.buf.byteLength) this.grow();
    const o16 = (this.count * VERTEX_SIZE) >> 1;
    const o8 = this.count * VERTEX_SIZE;
    const u16 = this.u16;
    u16[o16] = Math.max(0, Math.min(65535, Math.round((x + POS_OFFSET) * POS_SCALE)));
    u16[o16 + 1] = Math.max(0, Math.min(65535, Math.round((y + POS_OFFSET) * POS_SCALE)));
    u16[o16 + 2] = Math.max(0, Math.min(65535, Math.round((z + POS_OFFSET) * POS_SCALE)));
    u16[o16 + 3] = layer;
    u16[o16 + 4] = Math.max(0, Math.min(65535, Math.round(u * UV_SCALE)));
    u16[o16 + 5] = Math.max(0, Math.min(65535, Math.round(v * UV_SCALE)));
    const u8 = this.u8;
    u8[o8 + 12] = r;
    u8[o8 + 13] = g;
    u8[o8 + 14] = b;
    u8[o8 + 15] = ao;
    u8[o8 + 16] = normal;
    u8[o8 + 17] = sky;
    u8[o8 + 18] = mat;
    u8[o8 + 19] = block;
    this.count++;
  }

  /** Copy out exactly the used bytes (transferable). */
  finish(): ArrayBuffer {
    return this.buf.slice(0, this.count * VERTEX_SIZE);
  }

  reset(): void {
    this.count = 0;
  }
}

/** Build the shared quad index pattern (0,1,2, 0,2,3 per quad). */
export function quadIndices(quads: number): Uint32Array {
  const idx = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4, i = q * 6;
    idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
    idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  return idx;
}
