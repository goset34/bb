/**
 * 16×16×16 block section with an adaptive paletted container and packed light.
 * Index layout: i = (y << 8) | (z << 4) | x.
 */
import { stateFlags, F } from '../block/registry';
import { ByteReader, ByteWriter, packBits, unpackBits } from '../util/bytes';

export const SECTION_VOLUME = 4096;

export function sidx(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** Scratch tables for {@link Section.load} (palette building without hashing). */
const loadSeen = new Uint32Array(65536);
const loadIndex = new Uint16Array(65536);
let loadStamp = 0;
const recountScratch = new Uint16Array(256);

export class Section {
  /** Value when the section is uniform (no arrays). */
  private single = 0;
  private palette: number[] | null = null;
  private paletteIndex: Map<number, number> | null = null;
  private data8: Uint8Array | null = null;
  private data16: Uint16Array | null = null;

  nonAir = 0;
  tickables = 0;
  fluids = 0;

  /** Combined light (sky << 4 | block) or null when uniform. */
  light: Uint8Array | null = null;
  uniformLight = 0xf0;

  /** Biome ids at 4×4×4 resolution (index (y<<4)|(z<<2)|x). */
  readonly biomes = new Uint8Array(64);

  /** Revision counter incremented on every change (meshing/light invalidation). */
  revision = 0;

  constructor(fill = 0) {
    this.single = fill;
    this.recount();
  }

  get isUniform(): boolean {
    return this.data8 === null && this.data16 === null;
  }

  get uniformState(): number {
    return this.single;
  }

  get isEmpty(): boolean {
    return this.nonAir === 0;
  }

  get(i: number): number {
    const d8 = this.data8;
    if (d8 !== null) return this.palette![d8[i]!]!;
    const d16 = this.data16;
    if (d16 !== null) return d16[i]!;
    return this.single;
  }

  getXYZ(x: number, y: number, z: number): number {
    return this.get((y << 8) | (z << 4) | x);
  }

  /** Set a state; returns the previous state. */
  set(i: number, state: number): number {
    const old = this.get(i);
    if (old === state) return old;
    if (this.data8 === null && this.data16 === null) this.expand();
    if (this.data8 !== null) {
      let idx = this.paletteIndex!.get(state);
      if (idx === undefined) {
        if (this.palette!.length >= 256) {
          this.toDirect();
          this.data16![i] = state;
          this.account(old, state);
          return old;
        }
        idx = this.palette!.length;
        this.palette!.push(state);
        this.paletteIndex!.set(state, idx);
      }
      this.data8[i] = idx;
    } else {
      this.data16![i] = state;
    }
    this.account(old, state);
    return old;
  }

  setXYZ(x: number, y: number, z: number, state: number): number {
    return this.set((y << 8) | (z << 4) | x, state);
  }

  private account(old: number, state: number): void {
    const fo = stateFlags[old]!, fn = stateFlags[state]!;
    if (!(fo & F.AIR)) this.nonAir--;
    if (!(fn & F.AIR)) this.nonAir++;
    if (fo & F.RANDOM_TICKS) this.tickables--;
    if (fn & F.RANDOM_TICKS) this.tickables++;
    if (fo & (F.WATER | F.LAVA)) this.fluids--;
    if (fn & (F.WATER | F.LAVA)) this.fluids++;
    this.revision++;
  }

  private expand(): void {
    this.palette = [this.single];
    this.paletteIndex = new Map([[this.single, 0]]);
    this.data8 = new Uint8Array(SECTION_VOLUME);
  }

  private toDirect(): void {
    const d16 = new Uint16Array(SECTION_VOLUME);
    const p = this.palette!;
    const d8 = this.data8!;
    for (let i = 0; i < SECTION_VOLUME; i++) d16[i] = p[d8[i]!]!;
    this.data16 = d16;
    this.data8 = null;
    this.palette = null;
    this.paletteIndex = null;
  }

  /** Bulk-load 4096 states (y<<8 | z<<4 | x order) from `src` starting at `offset`. */
  load(src: Uint16Array, offset = 0): void {
    const first = src[offset]!;
    let uniform = true;
    for (let i = 1; i < SECTION_VOLUME; i++) {
      if (src[offset + i] !== first) { uniform = false; break; }
    }
    if (uniform) {
      this.fill(first);
      return;
    }
    const stamp = ++loadStamp;
    const palette: number[] = [];
    const d8 = new Uint8Array(SECTION_VOLUME);
    let direct = false;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const st = src[offset + i]!;
      if (loadSeen[st] !== stamp) {
        if (palette.length >= 256) { direct = true; break; }
        loadSeen[st] = stamp;
        loadIndex[st] = palette.length;
        palette.push(st);
      }
      d8[i] = loadIndex[st]!;
    }
    if (direct) {
      this.data16 = src.slice(offset, offset + SECTION_VOLUME);
      this.data8 = null;
      this.palette = null;
      this.paletteIndex = null;
    } else {
      this.data8 = d8;
      this.data16 = null;
      this.palette = palette;
      this.paletteIndex = new Map(palette.map((st, k) => [st, k]));
    }
    this.recount();
    this.revision++;
  }

  /** Fill the whole section with one state. */
  fill(state: number): void {
    this.single = state;
    this.data8 = null;
    this.data16 = null;
    this.palette = null;
    this.paletteIndex = null;
    this.recount();
    this.revision++;
  }

  /** Recompute counters (after bulk load). */
  recount(): void {
    let nonAir = 0, tick = 0, fluids = 0;
    if (this.isUniform) {
      const f = stateFlags[this.single] ?? F.AIR;
      if (!(f & F.AIR)) nonAir = SECTION_VOLUME;
      if (f & F.RANDOM_TICKS) tick = SECTION_VOLUME;
      if (f & (F.WATER | F.LAVA)) fluids = SECTION_VOLUME;
    } else if (this.data8) {
      const counts = recountScratch;
      counts.fill(0);
      const d8 = this.data8;
      for (let i = 0; i < SECTION_VOLUME; i++) counts[d8[i]!]++;
      const p = this.palette!;
      for (let k = 0; k < p.length; k++) {
        const n = counts[k]!;
        if (!n) continue;
        const f = stateFlags[p[k]!]!;
        if (!(f & F.AIR)) nonAir += n;
        if (f & F.RANDOM_TICKS) tick += n;
        if (f & (F.WATER | F.LAVA)) fluids += n;
      }
    } else {
      const d16 = this.data16!;
      for (let i = 0; i < SECTION_VOLUME; i++) {
        const f = stateFlags[d16[i]!]!;
        if (!(f & F.AIR)) nonAir++;
        if (f & F.RANDOM_TICKS) tick++;
        if (f & (F.WATER | F.LAVA)) fluids++;
      }
    }
    this.nonAir = nonAir;
    this.tickables = tick;
    this.fluids = fluids;
  }

  /** Try to shrink storage (called before saving / sending). */
  compact(): void {
    if (this.isUniform) return;
    const first = this.get(0);
    let uniform = true;
    const used = new Map<number, number>();
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const s = this.get(i);
      if (s !== first) uniform = false;
      if (!used.has(s)) used.set(s, used.size);
    }
    if (uniform) {
      this.fill(first);
      return;
    }
    if (used.size <= 256) {
      const pal = [...used.keys()];
      const d8 = new Uint8Array(SECTION_VOLUME);
      for (let i = 0; i < SECTION_VOLUME; i++) d8[i] = used.get(this.get(i))!;
      this.palette = pal;
      this.paletteIndex = used;
      this.data8 = d8;
      this.data16 = null;
    }
  }

  /** Copy block states into a flat array. */
  copyTo(out: Uint16Array, offset = 0): void {
    if (this.isUniform) {
      out.fill(this.single, offset, offset + SECTION_VOLUME);
      return;
    }
    if (this.data16) {
      out.set(this.data16, offset);
      return;
    }
    const p = this.palette!;
    const d8 = this.data8!;
    for (let i = 0; i < SECTION_VOLUME; i++) out[offset + i] = p[d8[i]!]!;
  }

  // ---- light --------------------------------------------------------------------------------

  getLight(i: number): number {
    return this.light ? this.light[i]! : this.uniformLight;
  }

  getSky(i: number): number {
    return (this.light ? this.light[i]! : this.uniformLight) >> 4;
  }

  getBlockLight(i: number): number {
    return (this.light ? this.light[i]! : this.uniformLight) & 15;
  }

  setLightRaw(i: number, v: number): void {
    if (!this.light) {
      if (v === this.uniformLight) return;
      this.light = new Uint8Array(SECTION_VOLUME).fill(this.uniformLight);
    }
    this.light[i] = v;
  }

  setSky(i: number, v: number): void {
    const cur = this.getLight(i);
    this.setLightRaw(i, (v << 4) | (cur & 15));
  }

  setBlockLight(i: number, v: number): void {
    const cur = this.getLight(i);
    this.setLightRaw(i, (cur & 0xf0) | v);
  }

  fillLight(v: number): void {
    this.light = null;
    this.uniformLight = v;
  }

  compactLight(): void {
    if (!this.light) return;
    const v = this.light[0]!;
    for (let i = 1; i < SECTION_VOLUME; i++) if (this.light[i] !== v) return;
    this.light = null;
    this.uniformLight = v;
  }

  // ---- serialisation ----------------------------------------------------------------------

  /** Write blocks (palette + packed indices), light and biomes. */
  write(w: ByteWriter, withLight = true): void {
    if (this.isUniform) {
      w.u8(0);
      w.varUint(this.single);
    } else {
      // Build a compact palette
      const used = new Map<number, number>();
      const idx = new Uint16Array(SECTION_VOLUME);
      for (let i = 0; i < SECTION_VOLUME; i++) {
        const s = this.get(i);
        let k = used.get(s);
        if (k === undefined) {
          k = used.size;
          used.set(s, k);
        }
        idx[i] = k;
      }
      if (used.size === 1) {
        w.u8(0);
        w.varUint(this.get(0));
      } else if (used.size <= 256) {
        const bits = Math.max(1, Math.ceil(Math.log2(used.size)));
        w.u8(bits);
        w.varUint(used.size);
        for (const s of used.keys()) w.varUint(s);
        w.bytes(packBits(idx, bits));
      } else {
        w.u8(16);
        const d = new Uint16Array(SECTION_VOLUME);
        this.copyTo(d);
        w.bytes(new Uint8Array(d.buffer));
      }
    }
    if (withLight) {
      if (this.light) {
        w.u8(1);
        w.bytes(this.light);
      } else {
        w.u8(0);
        w.u8(this.uniformLight);
      }
    }
    w.bytes(this.biomes);
  }

  static read(r: ByteReader, withLight = true, remap?: (s: number) => number): Section {
    const s = new Section(0);
    const bits = r.u8();
    if (bits === 0) {
      const v = r.varUint();
      s.single = remap ? remap(v) : v;
    } else if (bits === 16) {
      const raw = r.bytes(SECTION_VOLUME * 2);
      const d16 = new Uint16Array(SECTION_VOLUME);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let i = 0; i < SECTION_VOLUME; i++) {
        const v = dv.getUint16(i * 2, true);
        d16[i] = remap ? remap(v) : v;
      }
      s.data16 = d16;
    } else {
      const n = r.varUint();
      const pal: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = r.varUint();
        pal.push(remap ? remap(v) : v);
      }
      const packed = r.bytes(Math.ceil((SECTION_VOLUME * bits) / 8));
      const d8 = new Uint8Array(SECTION_VOLUME);
      unpackBits(packed, bits, SECTION_VOLUME, d8);
      s.palette = pal;
      s.paletteIndex = new Map(pal.map((v, i) => [v, i]));
      s.data8 = d8;
      // Remapping may create duplicate palette entries; that is harmless for reads.
    }
    if (withLight) {
      const has = r.u8();
      if (has) s.light = r.bytes(SECTION_VOLUME).slice();
      else s.uniformLight = r.u8();
    }
    s.biomes.set(r.bytes(64));
    s.recount();
    return s;
  }

  /** Approximate memory usage in bytes. */
  memoryBytes(): number {
    let b = 64 + 64;
    if (this.data8) b += SECTION_VOLUME + (this.palette!.length * 16);
    if (this.data16) b += SECTION_VOLUME * 2;
    if (this.light) b += SECTION_VOLUME;
    return b;
  }
}
