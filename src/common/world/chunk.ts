/** Chunk column: sections, heightmaps, block entities and generation status. */
import { Section, sidx } from './section';
import { stateFlags, stateOpacity, F } from '../block/registry';
import { DimensionType } from './dimension';
import { ByteReader, ByteWriter } from '../util/bytes';

export const ChunkStatus = {
  EMPTY: 0,
  STRUCTURE_STARTS: 1,
  NOISE: 2,
  FEATURES: 3,
  LIGHT: 4,
  FULL: 5,
} as const;
export type ChunkStatus = (typeof ChunkStatus)[keyof typeof ChunkStatus];

export interface BlockEntityData {
  /** Block entity type id. */
  type: string;
  x: number;
  y: number;
  z: number;
  /** Arbitrary JSON-serialisable fields. */
  data: Record<string, unknown>;
}

/** Heightmap: y of the first air block above the highest matching block (minY if none). */
export class Heightmap {
  readonly h = new Int16Array(256);
  constructor(readonly minY: number) {
    this.h.fill(minY);
  }
  get(x: number, z: number): number {
    return this.h[(z << 4) | x]!;
  }
  set(x: number, z: number, v: number): void {
    this.h[(z << 4) | x] = v;
  }
}

export class Chunk {
  readonly sections: Section[];
  readonly minY: number;
  readonly maxY: number;
  readonly minSection: number;
  /** Highest non-air block. */
  readonly surface: Heightmap;
  /** Highest block that blocks motion or contains fluid. */
  readonly motion: Heightmap;
  /** Highest opaque (light blocking) block — used for skylight. */
  readonly opaque: Heightmap;
  readonly blockEntities = new Map<number, BlockEntityData>();
  status: ChunkStatus = ChunkStatus.EMPTY;
  /** Needs saving. */
  dirty = false;
  /** Game ticks players spent in this chunk (regional difficulty). */
  inhabitedTime = 0;
  /** Scheduled ticks & entity data persisted with the chunk (server-owned). */
  extra: Record<string, unknown> = {};

  constructor(readonly x: number, readonly z: number, readonly dim: DimensionType) {
    this.minY = dim.minY;
    this.maxY = dim.minY + dim.height;
    this.minSection = dim.minY >> 4;
    const n = dim.height >> 4;
    this.sections = [];
    for (let i = 0; i < n; i++) this.sections.push(new Section(0));
    this.surface = new Heightmap(this.minY);
    this.motion = new Heightmap(this.minY);
    this.opaque = new Heightmap(this.minY);
  }

  sectionAt(y: number): Section | undefined {
    return this.sections[(y >> 4) - this.minSection];
  }

  getBlock(lx: number, y: number, lz: number): number {
    if (y < this.minY || y >= this.maxY) return 0;
    const s = this.sections[(y >> 4) - this.minSection]!;
    return s.get(((y & 15) << 8) | (lz << 4) | lx);
  }

  /** Set without any side effects except heightmaps. Returns old state. */
  setBlock(lx: number, y: number, lz: number, state: number): number {
    if (y < this.minY || y >= this.maxY) return 0;
    const s = this.sections[(y >> 4) - this.minSection]!;
    const old = s.set(((y & 15) << 8) | (lz << 4) | lx, state);
    if (old !== state) {
      this.updateHeightmaps(lx, y, lz, state);
      this.dirty = true;
    }
    return old;
  }

  private updateHeightmaps(lx: number, y: number, lz: number, state: number): void {
    this.updateOne(this.surface, lx, y, lz, surfaceTest(state), surfaceTest);
    this.updateOne(this.motion, lx, y, lz, motionTest(state), motionTest);
    this.updateOne(this.opaque, lx, y, lz, opaqueTest(state), opaqueTest);
  }

  private updateOne(hm: Heightmap, lx: number, y: number, lz: number, matches: boolean, test: (s: number) => boolean): void {
    const cur = hm.get(lx, lz);
    if (matches) {
      if (y + 1 > cur) hm.set(lx, lz, y + 1);
    } else if (y + 1 === cur) {
      // scan down
      let yy = y - 1;
      while (yy >= this.minY && !test(this.getBlock(lx, yy, lz))) yy--;
      hm.set(lx, lz, yy + 1);
    }
  }

  /** Recompute all heightmaps from scratch. */
  recomputeHeightmaps(): void {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        let surf = this.minY, mot = this.minY, opq = this.minY;
        let foundS = false, foundM = false, foundO = false;
        for (let si = this.sections.length - 1; si >= 0 && !(foundS && foundM && foundO); si--) {
          const sec = this.sections[si]!;
          if (sec.isEmpty) continue;
          const baseY = (si + this.minSection) << 4;
          for (let ly = 15; ly >= 0; ly--) {
            const st = sec.get((ly << 8) | (lz << 4) | lx);
            const f = stateFlags[st]!;
            if (f & F.AIR) continue;
            const y = baseY + ly;
            if (!foundS) { surf = y + 1; foundS = true; }
            if (!foundM && (!(f & F.NO_COLLISION) || (f & (F.WATER | F.LAVA)))) { mot = y + 1; foundM = true; }
            if (!foundO && opacityOf(st) > 0) { opq = y + 1; foundO = true; }
            if (foundS && foundM && foundO) break;
          }
        }
        this.surface.set(lx, lz, surf);
        this.motion.set(lx, lz, mot);
        this.opaque.set(lx, lz, opq);
      }
    }
  }

  getLight(lx: number, y: number, lz: number): number {
    if (y >= this.maxY) return 0xf0;
    if (y < this.minY) return 0;
    const s = this.sections[(y >> 4) - this.minSection]!;
    return s.getLight(((y & 15) << 8) | (lz << 4) | lx);
  }

  getBiome(lx: number, y: number, lz: number): number {
    const yy = Math.max(this.minY, Math.min(this.maxY - 1, y));
    const s = this.sections[(yy >> 4) - this.minSection]!;
    return s.biomes[(((yy & 15) >> 2) << 4) | ((lz >> 2) << 2) | (lx >> 2)]!;
  }

  setBiome(qx: number, qy: number, qz: number, biome: number): void {
    // quart coords inside chunk: qx,qz 0..3; qy absolute quart y
    const y = qy << 2;
    const s = this.sections[(y >> 4) - this.minSection];
    if (!s) return;
    s.biomes[((qy & 3) << 4) | (qz << 2) | qx] = biome;
  }

  static beKey(lx: number, y: number, lz: number): number {
    return ((y + 2048) << 8) | (lz << 4) | lx;
  }

  getBlockEntity(lx: number, y: number, lz: number): BlockEntityData | undefined {
    return this.blockEntities.get(Chunk.beKey(lx, y, lz));
  }

  setBlockEntity(be: BlockEntityData): void {
    this.blockEntities.set(Chunk.beKey(be.x & 15, be.y, be.z & 15), be);
    this.dirty = true;
  }

  removeBlockEntity(lx: number, y: number, lz: number): void {
    if (this.blockEntities.delete(Chunk.beKey(lx, y, lz))) this.dirty = true;
  }

  /** Serialise block data, light (optional), heightmaps and block entities. */
  write(w: ByteWriter, withLight: boolean, beFilter?: (be: BlockEntityData) => Record<string, unknown> | null): void {
    w.i32(this.x);
    w.i32(this.z);
    w.u8(this.sections.length);
    let mask = 0;
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i]!;
      const trivial = s.isUniform && s.uniformState === 0 && (!withLight || (!s.light && s.uniformLight === 0xf0));
      if (!trivial) mask |= 1 << i;
    }
    w.u32(mask);
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i]!;
      if (mask & (1 << i)) s.write(w, withLight);
      else w.bytes(s.biomes);
    }
    const bes = [...this.blockEntities.values()];
    const out: Array<{ type: string; x: number; y: number; z: number; data: Record<string, unknown> }> = [];
    for (const be of bes) {
      const d = beFilter ? beFilter(be) : be.data;
      if (d) out.push({ type: be.type, x: be.x, y: be.y, z: be.z, data: d });
    }
    w.json(out);
  }

  static read(r: ByteReader, dim: DimensionType, withLight: boolean, remap?: (s: number) => number): Chunk {
    const x = r.i32();
    const z = r.i32();
    const c = new Chunk(x, z, dim);
    const n = r.u8();
    const mask = r.u32();
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) c.sections[i] = Section.read(r, withLight, remap);
      else c.sections[i]!.biomes.set(r.bytes(64));
    }
    const bes = r.json<BlockEntityData[]>();
    for (const be of bes) c.blockEntities.set(Chunk.beKey(be.x & 15, be.y, be.z & 15), be);
    c.recomputeHeightmaps();
    return c;
  }

  /** Approximate memory usage. */
  memoryBytes(): number {
    let b = 256 * 6 + 128;
    for (const s of this.sections) b += s.memoryBytes();
    return b;
  }

  sectionIndexOf(y: number): number {
    return (y >> 4) - this.minSection;
  }
}

function surfaceTest(st: number): boolean {
  return (stateFlags[st]! & F.AIR) === 0;
}

function motionTest(st: number): boolean {
  const f = stateFlags[st]!;
  return (f & F.NO_COLLISION) === 0 || (f & (F.WATER | F.LAVA)) !== 0;
}

function opaqueTest(st: number): boolean {
  return opacityOf(st) > 0;
}

function opacityOf(s: number): number {
  return stateOpacity[s]!;
}

export { sidx };
