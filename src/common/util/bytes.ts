/** Growable binary writer / reader with varints, used by the network protocol and storage. */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): this { this.ensure(1); this.buf[this.pos++] = v & 255; return this; }
  bool(v: boolean): this { return this.u8(v ? 1 : 0); }
  i8(v: number): this { return this.u8(v); }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v: number): this { this.ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  i32(v: number): this { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; return this; }
  f32(v: number): this { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  f64(v: number): this { this.ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; return this; }

  /** Unsigned LEB128 varint (up to 2^53). */
  varUint(v: number): this {
    v = Math.floor(v);
    while (v >= 0x80) {
      this.u8((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    return this.u8(v);
  }

  /** Zig-zag signed varint. */
  varInt(v: number): this {
    v = Math.floor(v);
    return this.varUint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  string(s: string): this {
    const b = textEncoder.encode(s);
    this.varUint(b.length);
    return this.bytes(b);
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }

  /** Length-prefixed byte array. */
  blob(b: Uint8Array): this {
    this.varUint(b.length);
    return this.bytes(b);
  }

  u16array(a: Uint16Array): this {
    this.varUint(a.length);
    this.ensure(a.length * 2);
    for (let i = 0; i < a.length; i++) { this.view.setUint16(this.pos, a[i]!, true); this.pos += 2; }
    return this;
  }

  /** JSON-encodable value (used for rarely-sent structured data). */
  json(v: unknown): this {
    return this.string(JSON.stringify(v));
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  /** View without copying (valid until next write). */
  view8(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  reset(): void {
    this.pos = 0;
  }
}

export class ByteReader {
  private view: DataView;
  pos = 0;

  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number { return this.buf.length - this.pos; }

  u8(): number { if (this.pos >= this.buf.length) throw new RangeError('ByteReader overflow'); return this.buf[this.pos++]!; }
  bool(): boolean { return this.u8() !== 0; }
  i8(): number { const v = this.u8(); return v > 127 ? v - 256 : v; }
  u16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }

  varUint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) break;
      mul *= 128;
      if (mul > 2 ** 56) throw new RangeError('varint too long');
    }
    return result;
  }

  varInt(): number {
    const v = this.varUint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  string(): string {
    const n = this.varUint();
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }

  bytes(n: number): Uint8Array {
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  blob(): Uint8Array {
    const n = this.varUint();
    return this.bytes(n).slice();
  }

  u16array(): Uint16Array {
    const n = this.varUint();
    const a = new Uint16Array(n);
    for (let i = 0; i < n; i++) { a[i] = this.view.getUint16(this.pos, true); this.pos += 2; }
    return a;
  }

  json<T = unknown>(): T {
    return JSON.parse(this.string()) as T;
  }
}

/** Pack integer indices using `bits` bits per entry (little-endian bit order). */
export function packBits(values: ArrayLike<number>, bits: number): Uint8Array {
  const out = new Uint8Array(Math.ceil((values.length * bits) / 8));
  let bitPos = 0;
  for (let i = 0; i < values.length; i++) {
    let v = values[i]!;
    let remaining = bits;
    while (remaining > 0) {
      const byte = bitPos >> 3;
      const off = bitPos & 7;
      const take = Math.min(remaining, 8 - off);
      out[byte] |= (v & ((1 << take) - 1)) << off;
      v >>>= take;
      remaining -= take;
      bitPos += take;
    }
  }
  return out;
}

export function unpackBits(data: Uint8Array, bits: number, count: number, out: Uint8Array | Uint16Array): void {
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    let v = 0;
    let got = 0;
    while (got < bits) {
      const byte = bitPos >> 3;
      const off = bitPos & 7;
      const take = Math.min(bits - got, 8 - off);
      v |= ((data[byte]! >> off) & ((1 << take) - 1)) << got;
      got += take;
      bitPos += take;
    }
    out[i] = v;
  }
}

/** CRC32 (IEEE) used by the ZIP exporter. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Deflate / inflate using the platform CompressionStream (browser, worker, Node ≥ 18). */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function toBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
