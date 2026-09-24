/**
 * Block light and sky light propagation (0..15) using BFS with separate increase and
 * decrease queues. Works across chunk borders for chunks whose light is initialised.
 */
import { Chunk } from './chunk';
import { stateLight, stateOpacity } from '../block/registry';

export interface LightAccess {
  getChunk(cx: number, cz: number): Chunk | undefined;
  /** Whether the chunk's light has been initialised (can receive/propagate). */
  isLightReady(cx: number, cz: number): boolean;
  readonly hasSkylight: boolean;
  /** Called when light of a section changed (for client sync / remesh). */
  markLightChanged(cx: number, sy: number, cz: number): void;
}

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];

class Queue {
  x = new Int32Array(4096);
  y = new Int32Array(4096);
  z = new Int32Array(4096);
  v = new Int32Array(4096);
  head = 0;
  tail = 0;

  push(x: number, y: number, z: number, v: number): void {
    if (this.tail >= this.x.length) this.grow();
    this.x[this.tail] = x;
    this.y[this.tail] = y;
    this.z[this.tail] = z;
    this.v[this.tail] = v;
    this.tail++;
  }

  private grow(): void {
    if (this.head > 0 && this.head > this.x.length / 2) {
      // compact
      const n = this.tail - this.head;
      this.x.copyWithin(0, this.head, this.tail);
      this.y.copyWithin(0, this.head, this.tail);
      this.z.copyWithin(0, this.head, this.tail);
      this.v.copyWithin(0, this.head, this.tail);
      this.head = 0;
      this.tail = n;
      return;
    }
    const cap = this.x.length * 2;
    const g = (a: Int32Array) => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    this.x = g(this.x);
    this.y = g(this.y);
    this.z = g(this.z);
    this.v = g(this.v);
  }

  get empty(): boolean {
    return this.head >= this.tail;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }
}

export class LightEngine {
  private readonly incBlock = new Queue();
  private readonly decBlock = new Queue();
  private readonly incSky = new Queue();
  private readonly decSky = new Queue();
  // Small chunk cache
  private cacheKeyX = 0x7fffffff;
  private cacheKeyZ = 0x7fffffff;
  private cacheChunk: Chunk | undefined;
  private cacheReady = false;
  private readonly changed = new Set<number>();
  private minY = 0;
  private maxY = 0;

  constructor(private readonly access: LightAccess, minY: number, height: number) {
    this.minY = minY;
    this.maxY = minY + height;
  }

  private chunk(x: number, z: number): Chunk | undefined {
    const cx = x >> 4, cz = z >> 4;
    if (cx === this.cacheKeyX && cz === this.cacheKeyZ) return this.cacheReady ? this.cacheChunk : undefined;
    this.cacheKeyX = cx;
    this.cacheKeyZ = cz;
    this.cacheChunk = this.access.getChunk(cx, cz);
    this.cacheReady = !!this.cacheChunk && this.access.isLightReady(cx, cz);
    return this.cacheReady ? this.cacheChunk : undefined;
  }

  invalidateCache(): void {
    this.cacheKeyX = 0x7fffffff;
    this.cacheChunk = undefined;
  }

  private markChanged(x: number, y: number, z: number): void {
    const key = ((x >> 4) + 32768) * 65536 * 64 + ((z >> 4) + 32768) * 64 + ((y >> 4) + 8);
    this.changed.add(key);
  }

  /** Drain and report changed sections. */
  flushChanged(): void {
    for (const key of this.changed) {
      const sy = (key % 64) - 8;
      const r = Math.floor(key / 64);
      const cz = (r % 65536) - 32768;
      const cx = Math.floor(r / 65536) - 32768;
      this.access.markLightChanged(cx, sy, cz);
    }
    this.changed.clear();
  }

  private getRaw(c: Chunk, x: number, y: number, z: number): number {
    const s = c.sections[(y >> 4) - c.minSection]!;
    return s.getLight(((y & 15) << 8) | ((z & 15) << 4) | (x & 15));
  }

  // ---------------------------------------------------------------------------------------
  // Initial lighting of a whole chunk
  // ---------------------------------------------------------------------------------------

  /** Compute initial light for a chunk (its light must not be marked ready yet). */
  initChunk(c: Chunk, markReady: () => void): void {
    const sky = this.access.hasSkylight;
    // 1. Reset + sky column fill
    for (let si = 0; si < c.sections.length; si++) c.sections[si]!.fillLight(0);
    if (sky) {
      for (let si = 0; si < c.sections.length; si++) {
        const baseY = (si + c.minSection) << 4;
        const sec = c.sections[si]!;
        // Is the whole section above every column's opaque height?
        let allAbove = true;
        for (let i = 0; i < 256 && allAbove; i++) if (c.opaque.h[i]! > baseY) allAbove = false;
        if (allAbove) {
          sec.fillLight(0xf0);
          continue;
        }
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            const h = c.opaque.get(lx, lz);
            const from = Math.max(h, baseY);
            for (let y = from; y < baseY + 16; y++) sec.setSky(((y & 15) << 8) | (lz << 4) | lx, 15);
          }
        }
      }
    }
    markReady();
    this.invalidateCache();
    const bx = c.x << 4, bz = c.z << 4;
    // 2. Sky seeds: lit cells adjacent (horizontally/below) to darker cells
    if (sky) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const h = c.opaque.get(lx, lz);
          let maxN = h;
          for (let d = 2; d < 6; d++) {
            const nx = lx + DX[d]!, nz = lz + DZ[d]!;
            let nh: number;
            if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) nh = c.opaque.get(nx, nz);
            else {
              const nc = this.access.getChunk((bx + nx) >> 4, (bz + nz) >> 4);
              nh = nc ? nc.opaque.get((nx + 16) & 15, (nz + 16) & 15) : h;
            }
            if (nh > maxN) maxN = nh;
          }
          const top = Math.min(maxN, this.maxY - 1);
          for (let y = Math.max(h, this.minY); y <= top; y++) this.incSky.push(bx + lx, y, bz + lz, 15);
        }
      }
    }
    // 3. Block light emitters
    for (let si = 0; si < c.sections.length; si++) {
      const sec = c.sections[si]!;
      if (sec.isEmpty) continue;
      const baseY = (si + c.minSection) << 4;
      if (sec.isUniform) {
        const e = stateLight[sec.uniformState]!;
        if (e > 0) {
          for (let i = 0; i < 4096; i++) {
            sec.setBlockLight(i, e);
            this.incBlock.push(bx + (i & 15), baseY + (i >> 8), bz + ((i >> 4) & 15), e);
          }
        }
        continue;
      }
      for (let i = 0; i < 4096; i++) {
        const e = stateLight[sec.get(i)]!;
        if (e > 0) {
          sec.setBlockLight(i, e);
          this.incBlock.push(bx + (i & 15), baseY + (i >> 8), bz + ((i >> 4) & 15), e);
        }
      }
    }
    // 4. Pull light from already-lit neighbour chunk borders
    for (let d = 2; d < 6; d++) {
      const ncx = c.x + DX[d]!, ncz = c.z + DZ[d]!;
      const nc = this.access.getChunk(ncx, ncz);
      if (!nc || !this.access.isLightReady(ncx, ncz)) continue;
      for (let y = this.minY; y < this.maxY; y++) {
        for (let k = 0; k < 16; k++) {
          let wx: number, wz: number;
          if (d === 4) { wx = bx - 1; wz = bz + k; }
          else if (d === 5) { wx = bx + 16; wz = bz + k; }
          else if (d === 2) { wx = bx + k; wz = bz - 1; }
          else { wx = bx + k; wz = bz + 16; }
          const l = this.getRaw(nc, wx, y, wz);
          if (sky && (l >> 4) > 1) this.incSky.push(wx, y, wz, l >> 4);
          if ((l & 15) > 1) this.incBlock.push(wx, y, wz, l & 15);
        }
      }
    }
    this.propagateIncrease(this.incBlock, false);
    if (sky) this.propagateIncrease(this.incSky, true);
    for (let si = 0; si < c.sections.length; si++) {
      c.sections[si]!.compactLight();
      this.markChanged(bx, (si + c.minSection) << 4, bz);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Incremental updates
  // ---------------------------------------------------------------------------------------

  /** Must be called after a block changed (chunk heightmaps already updated). */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    const c = this.chunk(x, z);
    if (!c || y < this.minY || y >= this.maxY) return;
    const oldE = stateLight[oldState]!, newE = stateLight[newState]!;
    const oldO = stateOpacity[oldState]!, newO = stateOpacity[newState]!;
    const cur = this.getRaw(c, x, y, z);
    const curBlock = cur & 15;
    const curSky = cur >> 4;
    // ---- block light
    if (newE < curBlock || newO > oldO) {
      this.setBlock(c, x, y, z, 0);
      this.decBlock.push(x, y, z, curBlock);
    }
    if (newE > 0) {
      const now = this.getRaw(c, x, y, z) & 15;
      if (newE > now) {
        this.setBlock(c, x, y, z, newE);
        this.incBlock.push(x, y, z, newE);
      }
    }
    if (newO < oldO || (oldE > 0 && newE < oldE)) {
      // light may now flow into this cell from neighbours
      this.seedFromNeighbours(x, y, z, false);
    }
    // ---- sky light
    if (this.access.hasSkylight) {
      if (newO > oldO && curSky > 0) {
        this.setSky(c, x, y, z, 0);
        this.decSky.push(x, y, z, curSky);
      }
      if (newO < oldO) {
        this.seedFromNeighbours(x, y, z, true);
        // a newly opened column: if nothing opaque above, it is directly lit
        const h = c.opaque.get(x & 15, z & 15);
        if (y >= h) {
          this.setSky(c, x, y, z, 15);
          this.incSky.push(x, y, z, 15);
        }
      }
    }
  }

  private seedFromNeighbours(x: number, y: number, z: number, sky: boolean): void {
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d]!, ny = y + DY[d]!, nz = z + DZ[d]!;
      if (ny < this.minY || ny >= this.maxY) continue;
      const nc = this.chunk(nx, nz);
      if (!nc) continue;
      const l = this.getRaw(nc, nx, ny, nz);
      const v = sky ? l >> 4 : l & 15;
      if (v > 0) (sky ? this.incSky : this.incBlock).push(nx, ny, nz, v);
    }
  }

  /** Process all pending updates. */
  run(): void {
    this.propagateDecrease(this.decBlock, this.incBlock, false);
    this.propagateIncrease(this.incBlock, false);
    if (this.access.hasSkylight) {
      this.propagateDecrease(this.decSky, this.incSky, true);
      this.propagateIncrease(this.incSky, true);
    }
  }

  get hasPending(): boolean {
    return !this.incBlock.empty || !this.decBlock.empty || !this.incSky.empty || !this.decSky.empty;
  }

  private setBlock(c: Chunk, x: number, y: number, z: number, v: number): void {
    const s = c.sections[(y >> 4) - c.minSection]!;
    s.setBlockLight(((y & 15) << 8) | ((z & 15) << 4) | (x & 15), v);
    this.markChanged(x, y, z);
  }

  private setSky(c: Chunk, x: number, y: number, z: number, v: number): void {
    const s = c.sections[(y >> 4) - c.minSection]!;
    s.setSky(((y & 15) << 8) | ((z & 15) << 4) | (x & 15), v);
    this.markChanged(x, y, z);
  }

  private propagateIncrease(q: Queue, sky: boolean): void {
    while (q.head < q.tail) {
      const i = q.head++;
      const x = q.x[i]!, y = q.y[i]!, z = q.z[i]!;
      const c0 = this.chunk(x, z);
      if (!c0) continue;
      const raw = this.getRaw(c0, x, y, z);
      const level = sky ? raw >> 4 : raw & 15;
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d]!;
        if (ny < this.minY || ny >= this.maxY) continue;
        const nx = x + DX[d]!, nz = z + DZ[d]!;
        const c = this.chunk(nx, nz);
        if (!c) continue;
        const sec = c.sections[(ny >> 4) - c.minSection]!;
        const idx = ((ny & 15) << 8) | ((nz & 15) << 4) | (nx & 15);
        const st = sec.get(idx);
        const op = stateOpacity[st]!;
        if (op >= 15) continue;
        let nl: number;
        if (sky && d === 0 && level === 15 && op === 0) nl = 15;
        else nl = level - (op > 1 ? op : 1);
        if (nl <= 0) continue;
        const cur = sec.getLight(idx);
        const cv = sky ? cur >> 4 : cur & 15;
        if (nl > cv) {
          if (sky) sec.setLightRaw(idx, (nl << 4) | (cur & 15));
          else sec.setLightRaw(idx, (cur & 0xf0) | nl);
          this.markChanged(nx, ny, nz);
          q.push(nx, ny, nz, nl);
        }
      }
    }
    q.reset();
  }

  private propagateDecrease(q: Queue, inc: Queue, sky: boolean): void {
    while (q.head < q.tail) {
      const i = q.head++;
      const x = q.x[i]!, y = q.y[i]!, z = q.z[i]!, oldLevel = q.v[i]!;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d]!;
        if (ny < this.minY || ny >= this.maxY) continue;
        const nx = x + DX[d]!, nz = z + DZ[d]!;
        const c = this.chunk(nx, nz);
        if (!c) continue;
        const sec = c.sections[(ny >> 4) - c.minSection]!;
        const idx = ((ny & 15) << 8) | ((nz & 15) << 4) | (nx & 15);
        const cur = sec.getLight(idx);
        const nl = sky ? cur >> 4 : cur & 15;
        if (nl === 0) continue;
        const dependent = nl < oldLevel || (sky && d === 0 && oldLevel === 15 && nl === 15);
        if (dependent) {
          // Keep own emission for block light
          const emit = sky ? 0 : stateLight[sec.get(idx)]!;
          if (sky) sec.setLightRaw(idx, cur & 15);
          else sec.setLightRaw(idx, (cur & 0xf0) | emit);
          this.markChanged(nx, ny, nz);
          q.push(nx, ny, nz, nl);
          if (emit > 0) inc.push(nx, ny, nz, emit);
        } else {
          inc.push(nx, ny, nz, nl);
        }
      }
    }
    q.reset();
  }
}
