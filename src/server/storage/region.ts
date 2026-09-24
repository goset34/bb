/**
 * Anvil-like region file: 32×32 chunks, 4 KiB sectors.
 *   [0, 4096)      location table: 1024 × (offset:u24 | sectors:u8), big-endian
 *   [4096, 8192)   timestamps: 1024 × u32
 *   [8192, …)      sectors: [length:u32][compression:u8][payload]
 * Compression 2 = deflate (zlib-wrapped, via CompressionStream('deflate')), 3 = none.
 */
import { deflate, inflate } from '../../common/util/bytes';

export const SECTOR = 4096;
export const REGION_CHUNKS = 32;

export class RegionFile {
  data: Uint8Array;
  private used: boolean[];
  dirty = false;

  constructor(existing?: Uint8Array) {
    this.data = existing && existing.length >= SECTOR * 2 ? existing : new Uint8Array(SECTOR * 2);
    this.used = [];
    this.rebuildUsage();
  }

  private view(): DataView {
    return new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }

  private rebuildUsage(): void {
    const sectors = Math.ceil(this.data.length / SECTOR);
    this.used = new Array(sectors).fill(false);
    this.used[0] = this.used[1] = true;
    const v = this.view();
    for (let i = 0; i < 1024; i++) {
      const loc = v.getUint32(i * 4);
      const off = loc >>> 8, cnt = loc & 255;
      for (let s = off; s < off + cnt && s < sectors; s++) this.used[s] = true;
    }
  }

  private index(cx: number, cz: number): number {
    return ((cx & 31) + (cz & 31) * 32);
  }

  has(cx: number, cz: number): boolean {
    return this.view().getUint32(this.index(cx, cz) * 4) !== 0;
  }

  async read(cx: number, cz: number): Promise<Uint8Array | null> {
    const v = this.view();
    const loc = v.getUint32(this.index(cx, cz) * 4);
    if (!loc) return null;
    const off = (loc >>> 8) * SECTOR;
    if (off + 5 > this.data.length) return null;
    const len = v.getUint32(off);
    const comp = this.data[off + 4]!;
    const payload = this.data.subarray(off + 5, off + 4 + len);
    if (comp === 3) return payload.slice();
    return inflate(payload);
  }

  async write(cx: number, cz: number, raw: Uint8Array, compress = true): Promise<void> {
    const payload = compress ? await deflate(raw) : raw;
    const total = payload.length + 5;
    const sectorsNeeded = Math.ceil(total / SECTOR);
    if (sectorsNeeded > 255) throw new Error('Chunk too large for region format');
    const i = this.index(cx, cz);
    const v = this.view();
    const loc = v.getUint32(i * 4);
    let off = loc >>> 8, cnt = loc & 255;
    if (!loc || cnt < sectorsNeeded) {
      // free old sectors
      for (let s = off; s < off + cnt; s++) if (loc) this.used[s] = false;
      off = this.allocate(sectorsNeeded);
      cnt = sectorsNeeded;
    } else if (cnt > sectorsNeeded) {
      for (let s = off + sectorsNeeded; s < off + cnt; s++) this.used[s] = false;
      cnt = sectorsNeeded;
    }
    this.ensure((off + cnt) * SECTOR);
    const dv = this.view();
    dv.setUint32(off * SECTOR, payload.length + 1);
    this.data[off * SECTOR + 4] = compress ? 2 : 3;
    this.data.set(payload, off * SECTOR + 5);
    dv.setUint32(i * 4, (off << 8) | cnt);
    dv.setUint32(SECTOR + i * 4, Math.floor(Date.now() / 1000));
    this.dirty = true;
  }

  private allocate(n: number): number {
    let run = 0;
    for (let s = 2; s < this.used.length; s++) {
      if (!this.used[s]) {
        run++;
        if (run === n) {
          const start = s - n + 1;
          for (let k = start; k <= s; k++) this.used[k] = true;
          return start;
        }
      } else run = 0;
    }
    const start = Math.max(2, this.used.length - run);
    for (let k = start; k < start + n; k++) this.used[k] = true;
    return start;
  }

  private ensure(bytes: number): void {
    if (bytes <= this.data.length) return;
    let cap = this.data.length;
    while (cap < bytes) cap += SECTOR * 64;
    const nd = new Uint8Array(cap);
    nd.set(this.data);
    this.data = nd;
    while (this.used.length < cap / SECTOR) this.used.push(false);
  }

  /** Trimmed bytes (up to the last used sector). */
  bytes(): Uint8Array {
    let last = 1;
    for (let s = this.used.length - 1; s >= 2; s--) if (this.used[s]) { last = s; break; }
    return this.data.slice(0, (last + 1) * SECTOR);
  }

  chunkCount(): number {
    const v = this.view();
    let n = 0;
    for (let i = 0; i < 1024; i++) if (v.getUint32(i * 4)) n++;
    return n;
  }
}

export function regionKey(dim: string, cx: number, cz: number): string {
  return `${dim}/r.${cx >> 5}.${cz >> 5}.mca`;
}
