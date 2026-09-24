/**
 * Section mesher (runs in mesh workers).
 *  - Cube faces: greedy meshing per slice, merging faces with identical texture, tint, AO and light.
 *  - Element models: baked quads with per-vertex smooth light.
 *  - Liquids: corner heights and flow direction.
 *  - Visibility graph for cave culling.
 */
import {
  STATE_COUNT, stateFlags, stateFaceMask, stateWave, F, getRenderShape, blockOf, tryGetValue,
} from '../../../common/block/registry';
import { Tint, RenderShape } from '../../../common/block/model';
import { P } from '../../../common/block/properties';
import { bakeElements, BakedQuad, LayerLookup } from './bake';
import { VertexWriter, MAT_EMISSIVE, MAT_WATER, MAT_LAVA } from './vertex';
import { BIOMES, grassColor, foliageColor, BIRCH_FOLIAGE, SPRUCE_FOLIAGE, MANGROVE_FOLIAGE, LILY_PAD_COLOR } from '../../../common/worldgen/biomes';
import { fmix32 } from '../../../common/math/random';

export const PAD = 18;
const PAD2 = PAD * PAD;

export interface MeshJob {
  id: number;
  cx: number;
  sy: number;
  cz: number;
  blocks: Uint16Array; // 18³
  light: Uint8Array; // 18³ sky<<4|block
  biomes: Uint8Array; // 18×18 columns (x + z*18)
  revision: number;
}

export interface MeshResult {
  id: number;
  cx: number;
  sy: number;
  cz: number;
  revision: number;
  solid: ArrayBuffer;
  solidCount: number;
  cutout: ArrayBuffer;
  cutoutCount: number;
  translucent: ArrayBuffer;
  translucentCount: number;
  /** 15-bit face-to-face visibility (cave culling). */
  visibility: number;
  /** Section contains nothing renderable. */
  empty: boolean;
  timeMs: number;
}

export interface MesherOptions {
  smoothLighting: boolean;
  ao: boolean;
  fancyLeaves: boolean;
  biomeBlend: number;
}

// DIR tables
const DXv = [0, 0, 0, 0, -1, 1];
const DYv = [-1, 1, 0, 0, 0, 0];
const DZv = [0, 0, -1, 1, 0, 0];
const SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

const pidx = (x: number, y: number, z: number) => (y + 1) * PAD2 + (z + 1) * PAD + (x + 1);

/** Per-direction tangent axes (u-axis, v-axis) as unit vectors for AO neighbour lookup. */
const TAN: Array<[[number, number, number], [number, number, number]]> = [
  [[1, 0, 0], [0, 0, 1]], // down
  [[1, 0, 0], [0, 0, 1]], // up
  [[1, 0, 0], [0, 1, 0]], // north
  [[1, 0, 0], [0, 1, 0]], // south
  [[0, 0, 1], [0, 1, 0]], // west
  [[0, 0, 1], [0, 1, 0]], // east
];

export class Mesher {
  private readonly layerOf: LayerLookup;
  private cubeLayer: Int32Array;
  private cubeTint: Uint8Array;
  private cubeRot: Uint8Array;
  private cubeEmit: Uint8Array;
  private readonly baked = new Map<number, BakedQuad[]>();
  private readonly solid = new VertexWriter(8192);
  private readonly cutout = new VertexWriter(4096);
  private readonly translucent = new VertexWriter(4096);
  private blocks!: Uint16Array;
  private light!: Uint8Array;
  private biomes!: Uint8Array;
  private tintCache = new Int32Array(PAD2 * 4);
  opts: MesherOptions = { smoothLighting: true, ao: true, fancyLeaves: true, biomeBlend: 2 };

  constructor(layerOf: LayerLookup) {
    this.layerOf = layerOf;
    this.cubeLayer = new Int32Array(STATE_COUNT * 6).fill(-2);
    this.cubeTint = new Uint8Array(STATE_COUNT * 6);
    this.cubeRot = new Uint8Array(STATE_COUNT * 6);
    this.cubeEmit = new Uint8Array(STATE_COUNT * 6);
  }

  private cubeInfo(state: number): void {
    const r = getRenderShape(state);
    if (r.kind !== 'cube') {
      for (let d = 0; d < 6; d++) this.cubeLayer[state * 6 + d] = -1;
      return;
    }
    for (let d = 0; d < 6; d++) {
      this.cubeLayer[state * 6 + d] = this.layerOf(r.tex[d]!);
      this.cubeTint[state * 6 + d] = r.tint?.[d] ?? 0;
      this.cubeRot[state * 6 + d] = ((r.rot?.[d] ?? 0) / 90) & 3;
      this.cubeEmit[state * 6 + d] = r.emissive?.[d] ? 1 : 0;
    }
  }

  private bakedOf(state: number): BakedQuad[] {
    let q = this.baked.get(state);
    if (!q) {
      const r = getRenderShape(state);
      q = r.kind === 'model' ? bakeElements(r.elements, this.layerOf) : [];
      this.baked.set(state, q);
    }
    return q;
  }

  // ------------------------------------------------------------------------------------------
  // Tints
  // ------------------------------------------------------------------------------------------

  private computeTints(): void {
    // per column: grass, foliage, water (RGB packed), blended over a (2r+1)² window
    const r = this.opts.biomeBlend;
    const grass = new Int32Array(PAD2), fol = new Int32Array(PAD2), water = new Int32Array(PAD2);
    for (let z = 0; z < PAD; z++) {
      for (let x = 0; x < PAD; x++) {
        const b = BIOMES[this.biomes[z * PAD + x]!] ?? BIOMES[1]!;
        grass[z * PAD + x] = grassColor(b, x, z);
        fol[z * PAD + x] = foliageColor(b);
        water[z * PAD + x] = b.water;
      }
    }
    for (let z = 0; z < PAD; z++) {
      for (let x = 0; x < PAD; x++) {
        let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0, n = 0;
        for (let dz = -r; dz <= r; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= PAD) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= PAD) continue;
            const i = zz * PAD + xx;
            const g = grass[i]!, f = fol[i]!, w = water[i]!;
            gr += g >> 16; gg += (g >> 8) & 255; gb += g & 255;
            fr += f >> 16; fg += (f >> 8) & 255; fb += f & 255;
            wr += w >> 16; wg += (w >> 8) & 255; wb += w & 255;
            n++;
          }
        }
        const i = z * PAD + x;
        this.tintCache[i * 4] = ((gr / n) << 16) | ((gg / n) << 8) | (gb / n);
        this.tintCache[i * 4 + 1] = ((fr / n) << 16) | ((fg / n) << 8) | (fb / n);
        this.tintCache[i * 4 + 2] = ((wr / n) << 16) | ((wg / n) << 8) | (wb / n);
      }
    }
  }

  /** Resolve a tint kind to RGB at a block position (local coords -1..16). */
  private tintAt(kind: number, x: number, z: number, state: number): number {
    if (kind === Tint.None) return 0xffffff;
    const col = (Math.min(16, Math.max(-1, z)) + 1) * PAD + (Math.min(16, Math.max(-1, x)) + 1);
    switch (kind) {
      case Tint.Grass: return this.tintCache[col * 4]!;
      case Tint.Foliage: return this.tintCache[col * 4 + 1]!;
      case Tint.Water: return this.tintCache[col * 4 + 2]!;
      case Tint.Birch: return BIRCH_FOLIAGE;
      case Tint.Spruce: return SPRUCE_FOLIAGE;
      case Tint.Mangrove: return MANGROVE_FOLIAGE;
      case Tint.LilyPad: return LILY_PAD_COLOR;
      case Tint.Wire: {
        const pw = tryGetValue(state, P.power) ?? 0;
        const f = pw / 15;
        const r = Math.round((f * 0.6 + (f > 0 ? 0.4 : 0.3)) * 255);
        const g = Math.round(Math.max(0, f * f * 0.7 - 0.5) * 255);
        const b = Math.round(Math.max(0, f * f * 0.6 - 0.7) * 255);
        return (r << 16) | (g << 8) | b;
      }
      case Tint.Stem: {
        const age = tryGetValue(state, P.age7) ?? 0;
        return ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
      }
      case Tint.AttachedStem: return 0xe0c71c;
      default: return 0xffffff;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Occlusion helpers
  // ------------------------------------------------------------------------------------------

  private occludesFace(neighbor: number, self: number, dir: number): boolean {
    // Does `neighbor` fully cover its face opposite to `dir`?
    const nf = stateFlags[neighbor]!;
    if (nf & F.AIR) return false;
    if (stateFaceMask[neighbor]! & (1 << (dir ^ 1))) {
      if (!this.opts.fancyLeaves || !(nf & F.CUTOUT)) return true;
    }
    const sf = stateFlags[self]!;
    // Same-block culling for glass/ice/leaves (fast) / water
    if ((sf & F.CULL_SAME) && blockOf(neighbor) === blockOf(self)) return true;
    if (!this.opts.fancyLeaves && (nf & F.CUTOUT) && (sf & F.CUTOUT) && blockOf(neighbor) === blockOf(self)) return true;
    return false;
  }

  private isOpaqueAt(i: number): boolean {
    return (stateFlags[this.blocks[i]!]! & F.OPAQUE_CUBE) !== 0;
  }

  /** Average light around a vertex: front cell + 2 sides + corner (reference smooth lighting). */
  private vertexLight(fx: number, fy: number, fz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: number[]): void {
    const b = this.blocks, l = this.light;
    const i0 = pidx(fx, fy, fz);
    const i1 = pidx(fx + ax, fy + ay, fz + az);
    const i2 = pidx(fx + bx, fy + by, fz + bz);
    const i3 = pidx(fx + ax + bx, fy + ay + by, fz + az + bz);
    const o1 = (stateFlags[b[i1]!]! & F.OPAQUE_CUBE) !== 0;
    const o2 = (stateFlags[b[i2]!]! & F.OPAQUE_CUBE) !== 0;
    const o3 = (stateFlags[b[i3]!]! & F.OPAQUE_CUBE) !== 0;
    const l0 = l[i0]!;
    const l1 = o1 ? l0 : l[i1]!;
    const l2 = o2 ? l0 : l[i2]!;
    const l3 = o3 || (o1 && o2) ? l0 : l[i3]!;
    out[0] = ((l0 >> 4) + (l1 >> 4) + (l2 >> 4) + (l3 >> 4)) * 4.25; // sky 0..255
    out[1] = ((l0 & 15) + (l1 & 15) + (l2 & 15) + (l3 & 15)) * 4.25; // block 0..255
    const ao = o1 && o2 ? 0 : 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (o3 ? 1 : 0));
    out[2] = ao;
  }

  // ------------------------------------------------------------------------------------------
  // Main entry
  // ------------------------------------------------------------------------------------------

  mesh(job: MeshJob): MeshResult {
    const t0 = performance.now();
    this.blocks = job.blocks;
    this.light = job.light;
    this.biomes = job.biomes;
    this.solid.reset();
    this.cutout.reset();
    this.translucent.reset();
    this.computeTints();
    let anyVisible = false;
    // Quick check: all air?
    let nonAir = 0;
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (!(stateFlags[this.blocks[pidx(x, y, z)]!]! & F.AIR)) nonAir++;
    if (nonAir > 0) {
      this.greedyCubes();
      this.otherBlocks(job);
      anyVisible = this.solid.count + this.cutout.count + this.translucent.count > 0;
    }
    const visibility = this.visibilityGraph();
    return {
      id: job.id, cx: job.cx, sy: job.sy, cz: job.cz, revision: job.revision,
      solid: this.solid.finish(), solidCount: this.solid.count,
      cutout: this.cutout.finish(), cutoutCount: this.cutout.count,
      translucent: this.translucent.finish(), translucentCount: this.translucent.count,
      visibility, empty: !anyVisible, timeMs: performance.now() - t0,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Greedy cubes
  // ------------------------------------------------------------------------------------------

  private readonly maskLayer = new Int32Array(256);
  private readonly maskTint = new Int32Array(256);
  private readonly maskAO = new Int32Array(256);
  private readonly maskSky = new Int32Array(256);
  private readonly maskBlk = new Int32Array(256);
  private readonly maskFlags = new Int32Array(256);
  private readonly maskRot = new Int32Array(256);
  private readonly maskState = new Int32Array(256);
  private readonly tmp = [0, 0, 0];

  private greedyCubes(): void {
    const blocks = this.blocks;
    for (let d = 0; d < 6; d++) {
      const nx = DXv[d]!, ny = DYv[d]!, nz = DZv[d]!;
      const [ta, tb] = TAN[d]!;
      for (let s = 0; s < 16; s++) {
        // Build mask over the slice. Slice axis = direction axis.
        let any = false;
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16; i++) {
            const m = j * 16 + i;
            this.maskLayer[m] = -1;
            // local coords
            const x = ta[0] * i + tb[0] * j + (nx !== 0 ? s : 0);
            const y = ta[1] * i + tb[1] * j + (ny !== 0 ? s : 0);
            const z = ta[2] * i + tb[2] * j + (nz !== 0 ? s : 0);
            const st = blocks[pidx(x, y, z)]!;
            const fl = stateFlags[st]!;
            if (!(fl & F.CUBE_MODEL) || (fl & F.INVISIBLE)) continue;
            if (this.cubeLayer[st * 6] === -2) this.cubeInfo(st);
            const layer = this.cubeLayer[st * 6 + d]!;
            if (layer < 0) continue;
            const nb = blocks[pidx(x + nx, y + ny, z + nz)]!;
            if (this.occludesFace(nb, st, d)) continue;
            // Vertex light/AO for the 4 corners (TL, BL, BR, TR in tangent space: (-,+),(-,-),(+,-),(+,+))
            const fx = x + nx, fy = y + ny, fz = z + nz;
            let aoKey = 0, skyKey = 0, blkKey = 0;
            const corners = CORNER_SIGNS[d]!;
            for (let c = 0; c < 4; c++) {
              const sa = corners[c * 2]!, sb = corners[c * 2 + 1]!;
              if (this.opts.smoothLighting) {
                this.vertexLight(fx, fy, fz, ta[0] * sa, ta[1] * sa, ta[2] * sa, tb[0] * sb, tb[1] * sb, tb[2] * sb, this.tmp);
              } else {
                const l = this.light[pidx(fx, fy, fz)]!;
                this.tmp[0] = (l >> 4) * 17; this.tmp[1] = (l & 15) * 17; this.tmp[2] = 3;
              }
              const ao = this.opts.ao ? this.tmp[2]! : 3;
              aoKey |= ao << (c * 2);
              skyKey |= (Math.round(this.tmp[0]! / 17) & 15) << (c * 4);
              blkKey |= (Math.round(this.tmp[1]! / 17) & 15) << (c * 4);
            }
            const tintKind = this.cubeTint[st * 6 + d]!;
            const tint = tintKind ? this.tintAt(tintKind, x, z, st) : 0xffffff;
            this.maskLayer[m] = layer;
            this.maskTint[m] = tint;
            this.maskAO[m] = aoKey;
            this.maskSky[m] = skyKey;
            this.maskBlk[m] = blkKey;
            this.maskRot[m] = this.cubeRot[st * 6 + d]!;
            this.maskFlags[m] = (this.cubeEmit[st * 6 + d]! ? MAT_EMISSIVE : 0) | (stateWave[st]! << 1) | (fl & F.EMISSIVE ? MAT_EMISSIVE : 0);
            this.maskState[m] = st;
            any = true;
          }
        }
        if (!any) continue;
        // Greedy merge
        for (let j = 0; j < 16; j++) {
          for (let i = 0; i < 16;) {
            const m = j * 16 + i;
            const layer = this.maskLayer[m]!;
            if (layer < 0) { i++; continue; }
            // Only merge faces with uniform per-vertex values (all 4 corners equal)
            const uniform = this.uniformCorners(m);
            let w = 1;
            if (uniform) while (i + w < 16 && this.same(m, j * 16 + i + w)) w++;
            let h = 1;
            if (uniform) {
              outer: while (j + h < 16) {
                for (let k = 0; k < w; k++) if (!this.same(m, (j + h) * 16 + i + k)) break outer;
                h++;
              }
            }
            this.emitCubeQuad(d, s, i, j, w, h, m);
            for (let jj = 0; jj < h; jj++) for (let ii = 0; ii < w; ii++) this.maskLayer[(j + jj) * 16 + i + ii] = -1;
            i += w;
          }
        }
      }
    }
  }

  private uniformCorners(m: number): boolean {
    const ao = this.maskAO[m]!, sky = this.maskSky[m]!, blk = this.maskBlk[m]!;
    const a0 = ao & 3;
    if (((ao >> 2) & 3) !== a0 || ((ao >> 4) & 3) !== a0 || ((ao >> 6) & 3) !== a0) return false;
    const s0 = sky & 15;
    if (((sky >> 4) & 15) !== s0 || ((sky >> 8) & 15) !== s0 || ((sky >> 12) & 15) !== s0) return false;
    const b0 = blk & 15;
    if (((blk >> 4) & 15) !== b0 || ((blk >> 8) & 15) !== b0 || ((blk >> 12) & 15) !== b0) return false;
    return (this.maskFlags[m]! & 0b1110) === 0; // waving faces are not merged
  }

  private same(a: number, b: number): boolean {
    return this.maskLayer[b] === this.maskLayer[a] && this.maskTint[b] === this.maskTint[a] && this.maskAO[b] === this.maskAO[a]
      && this.maskSky[b] === this.maskSky[a] && this.maskBlk[b] === this.maskBlk[a] && this.maskFlags[b] === this.maskFlags[a]
      && this.maskRot[b] === this.maskRot[a];
  }

  private emitCubeQuad(d: number, s: number, i: number, j: number, w: number, h: number, m: number): void {
    const [ta, tb] = TAN[d]!;
    const nx = DXv[d]!, ny = DYv[d]!, nz = DZv[d]!;
    // Face plane offset: positive directions sit at s+1
    const off = nx + ny + nz > 0 ? 1 : 0;
    const base = [nx !== 0 ? s + off : 0, ny !== 0 ? s + off : 0, nz !== 0 ? s + off : 0];
    const st = this.maskState[m]!;
    const fl = stateFlags[st]!;
    const writer = fl & F.TRANSLUCENT ? this.translucent : fl & F.CUTOUT ? this.cutout : this.solid;
    const corners = CORNER_SIGNS[d]!;
    const tint = this.maskTint[m]!;
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tbl = tint & 255;
    const rot = this.maskRot[m]!;
    const layer = this.maskLayer[m]!;
    const flags = this.maskFlags[m]!;
    // corner positions in tangent space
    const ao = this.maskAO[m]!, sky = this.maskSky[m]!, blk = this.maskBlk[m]!;
    const pos: number[] = [];
    for (let c = 0; c < 4; c++) {
      const sa = corners[c * 2]! > 0 ? i + w : i;
      const sb = corners[c * 2 + 1]! > 0 ? j + h : j;
      pos.push(base[0]! + ta[0] * sa + tb[0] * sb, base[1]! + ta[1] * sa + tb[1] * sb, base[2]! + ta[2] * sa + tb[2] * sb);
    }
    // AO-based diagonal flip
    const aoC = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
    const flip = aoC[0]! + aoC[2]! < aoC[1]! + aoC[3]!;
    for (let k = 0; k < 4; k++) {
      const c = flip ? (k + 1) & 3 : k;
      const x = pos[c * 3]!, y = pos[c * 3 + 1]!, z = pos[c * 3 + 2]!;
      const [u, v] = projectUV(d, x, y, z, rot);
      const aoV = AO_CURVE[aoC[c]!]!;
      writer.vertex(x, y, z, layer, u, v, tr, tg, tbl, aoV, d, ((sky >> (c * 4)) & 15) * 17, flags, ((blk >> (c * 4)) & 15) * 17);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Non-cube blocks and liquids
  // ------------------------------------------------------------------------------------------

  private otherBlocks(job: MeshJob): void {
    const blocks = this.blocks;
    const sx = job.cx * 16, sz = job.cz * 16;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const st = blocks[pidx(x, y, z)]!;
          const fl = stateFlags[st]!;
          if (fl & F.AIR) continue;
          if (fl & (F.WATER | F.LAVA)) this.liquid(x, y, z, st, fl);
          if (fl & (F.CUBE_MODEL | F.INVISIBLE)) continue;
          const r: RenderShape = getRenderShape(st);
          if (r.kind !== 'model') continue;
          this.model(x, y, z, st, fl, sx, sz, job.sy);
        }
      }
    }
  }

  private readonly vl = [0, 0, 0];

  private model(x: number, y: number, z: number, st: number, fl: number, sx: number, sz: number, sy: number): void {
    const quads = this.bakedOf(st);
    if (!quads.length) return;
    const writer = fl & F.TRANSLUCENT ? this.translucent : fl & F.CUTOUT ? this.cutout : this.solid;
    const b = blockOf(st);
    let ox = 0, oz = 0, oy = 0;
    const offset = b.settings.offset;
    if (offset && offset !== 'none') {
      const h = fmix32(((sx + x) * 3129871) ^ ((sz + z) * 116129781));
      ox = (((h & 15) / 15) - 0.5) * 0.5;
      oz = ((((h >> 8) & 15) / 15) - 0.5) * 0.5;
      if (offset === 'xyz') oy = ((((h >> 4) & 15) / 15) - 1) * 0.2;
    }
    const wave = stateWave[st]! << 1;
    for (const q of quads) {
      if (q.cull >= 0) {
        const nb = this.blocks[pidx(x + DXv[q.cull]!, y + DYv[q.cull]!, z + DZv[q.cull]!)]!;
        if (this.occludesFace(nb, st, q.cull)) continue;
      }
      const tint = q.tint ? this.tintAt(q.tint, x, z, st) : 0xffffff;
      const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
      const mat = (q.emissive || (fl & F.EMISSIVE) ? MAT_EMISSIVE : 0) | wave;
      const nIdx = q.shade ? q.normal : 6 | 8;
      // Light: sample the cell in front of the face (or own cell for inner faces), smoothed per vertex
      for (let k = 0; k < 4; k++) {
        const px = q.pos[k * 3]!, py = q.pos[k * 3 + 1]!, pz = q.pos[k * 3 + 2]!;
        this.modelVertexLight(x, y, z, px, py, pz, q, this.vl);
        writer.vertex(x + px + ox, y + py + oy, z + pz + oz, q.layer, q.uv[k * 2]!, q.uv[k * 2 + 1]!, tr, tg, tb, 255, nIdx, this.vl[0]!, mat, this.vl[1]!);
      }
    }
    void sy;
  }

  /** Smooth light for arbitrary model vertices: average of 4 cells around the vertex in front of the face. */
  private modelVertexLight(bx: number, by: number, bz: number, px: number, py: number, pz: number, q: BakedQuad, out: number[]): void {
    // Point slightly in front of the face
    const fx = bx + px + q.nx * 0.5, fy = by + py + q.ny * 0.5, fz = bz + pz + q.nz * 0.5;
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let sky = 0, blk = 0, n = 0;
    const clampI = (v: number) => (v < -1 ? -1 : v > 16 ? 16 : v);
    // 2×2×2 neighbourhood weighted towards the containing cell
    for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      const xx = clampI(Math.round(fx - 0.5) + dx), yy = clampI(Math.round(fy - 0.5) + dy), zz = clampI(Math.round(fz - 0.5) + dz);
      const i = pidx(xx, yy, zz);
      if (this.isOpaqueAt(i)) continue;
      const l = this.light[i]!;
      sky += l >> 4;
      blk += l & 15;
      n++;
    }
    if (n === 0) {
      const l = this.light[pidx(clampI(cx), clampI(cy), clampI(cz))]!;
      out[0] = (l >> 4) * 17;
      out[1] = (l & 15) * 17;
      return;
    }
    out[0] = Math.min(255, (sky / n) * 17);
    out[1] = Math.min(255, (blk / n) * 17);
  }

  // ------------------------------------------------------------------------------------------
  // Liquids
  // ------------------------------------------------------------------------------------------

  private fluidKind(st: number): number {
    const f = stateFlags[st]!;
    return f & F.WATER ? 1 : f & F.LAVA ? 2 : 0;
  }

  private fluidAmountAt(x: number, y: number, z: number, kind: number): number {
    const st = this.blocks[pidx(x, y, z)]!;
    if (this.fluidKind(st) !== kind) return -1;
    const above = this.blocks[pidx(x, Math.min(16, y + 1), z)]!;
    if (this.fluidKind(above) === kind) return 9; // full
    if (stateFlags[st]! & F.FLUID_BLOCK) {
      const lv = tryGetValue(st, P.level15) ?? 0;
      return lv === 0 || lv >= 8 ? 8 : 8 - lv;
    }
    return 8;
  }

  /** Corner height (0..1) averaged over the 4 blocks sharing the corner. */
  private cornerHeight(x: number, y: number, z: number, kind: number): number {
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const a = this.fluidAmountAt(x + dx, y, z + dz, kind);
      if (a === 9) return 1;
      if (a >= 0) {
        const h = a / 9;
        if (a === 8) { sum += h * 10; n += 10; } else { sum += h; n++; }
      } else {
        const st = this.blocks[pidx(x + dx, y, z + dz)]!;
        if (!(stateFlags[st]! & F.SOLID)) n++;
      }
    }
    return n ? sum / n : 0;
  }

  private liquid(x: number, y: number, z: number, st: number, fl: number): void {
    const kind = fl & F.WATER ? 1 : 2;
    const isLava = kind === 2;
    const writer = isLava ? this.solid : this.translucent;
    const layerStill = this.layerOf(isLava ? 'lava_still' : 'water_still');
    const layerFlow = this.layerOf(isLava ? 'lava_flow' : 'water_flow');
    const tint = isLava ? 0xffffff : this.tintAt(Tint.Water, x, z, st);
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    const mat = isLava ? MAT_LAVA | MAT_EMISSIVE : MAT_WATER;
    const above = this.blocks[pidx(x, y + 1, z)]!;
    const aboveSame = this.fluidKind(above) === kind;
    let h00 = 1, h10 = 1, h11 = 1, h01 = 1;
    if (!aboveSame) {
      h00 = this.cornerHeight(x, y, z, kind);
      h10 = this.cornerHeight(x + 1, y, z, kind);
      h11 = this.cornerHeight(x + 1, y, z + 1, kind);
      h01 = this.cornerHeight(x, y, z + 1, kind);
    }
    const l = this.light[pidx(x, y, z)]!;
    const la = this.light[pidx(x, y + 1, z)]!;
    const skyL = Math.max(l >> 4, la >> 4) * 17, blkL = Math.max(l & 15, la & 15) * 17;
    // Top surface
    if (!aboveSame) {
      // flow direction from height gradient
      const fx = (h00 + h01) - (h10 + h11);
      const fz = (h00 + h10) - (h01 + h11);
      const flowing = Math.abs(fx) > 1e-3 || Math.abs(fz) > 1e-3;
      const layer = flowing ? layerFlow : layerStill;
      let uvs: number[];
      if (flowing) {
        const ang = Math.atan2(fz, fx) - Math.PI / 2;
        const s = Math.sin(ang) * 0.25, c = Math.cos(ang) * 0.25;
        // rotate around center (0.5,0.5), half-size texture region
        const pt = (u: number, v: number) => [0.5 + (u * c - v * s), 0.5 + (u * s + v * c)];
        uvs = [...pt(-1, -1), ...pt(-1, 1), ...pt(1, 1), ...pt(1, -1)];
      } else uvs = [0, 0, 0, 1, 1, 1, 1, 0];
      const e = 0.001;
      // TL(x0,z0) BL(x0,z1) BR(x1,z1) TR(x1,z0)
      const pts = [x, y + h00 - e, z, x, y + h01 - e, z + 1, x + 1, y + h11 - e, z + 1, x + 1, y + h10 - e, z];
      for (let k = 0; k < 4; k++) writer.vertex(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, layer, uvs[k * 2]!, uvs[k * 2 + 1]!, tr, tg, tb, 255, 1, skyL, mat, blkL);
      // Underside of the surface (visible from below water)
      if (!isLava) for (let k = 3; k >= 0; k--) writer.vertex(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, layer, uvs[k * 2]!, uvs[k * 2 + 1]!, tr, tg, tb, 255, 0, skyL, mat, blkL);
    }
    // Bottom
    const below = this.blocks[pidx(x, y - 1, z)]!;
    if (this.fluidKind(below) !== kind && !(stateFaceMask[below]! & 2)) {
      const lb = this.light[pidx(x, y - 1, z)]!;
      const pts = [x, y, z + 1, x, y, z, x + 1, y, z, x + 1, y, z + 1];
      const uv = [0, 1, 0, 0, 1, 0, 1, 1];
      for (let k = 0; k < 4; k++) writer.vertex(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, layerStill, uv[k * 2]!, uv[k * 2 + 1]!, tr, tg, tb, 255, 0, (lb >> 4) * 17, mat, (lb & 15) * 17);
    }
    // Sides
    const heights: Array<[number, number]> = [[0, 0], [0, 0], [h10, h00], [h01, h11], [h00, h01], [h11, h10]];
    for (let d = 2; d < 6; d++) {
      const nx = x + DXv[d]!, nz = z + DZv[d]!;
      const nst = this.blocks[pidx(nx, y, nz)]!;
      if (this.fluidKind(nst) === kind) continue;
      if (stateFaceMask[nst]! & (1 << (d ^ 1))) continue;
      const [hA, hB] = heights[d]!;
      const ln = this.light[pidx(nx, y, nz)]!;
      // corners TL, BL, BR, TR of the side face (as seen from outside)
      let pts: number[];
      switch (d) {
        case 2: pts = [x + 1, y + hA, z, x + 1, y, z, x, y, z, x, y + hB, z]; break;
        case 3: pts = [x, y + hA, z + 1, x, y, z + 1, x + 1, y, z + 1, x + 1, y + hB, z + 1]; break;
        case 4: pts = [x, y + hA, z, x, y, z, x, y, z + 1, x, y + hB, z + 1]; break;
        default: pts = [x + 1, y + hA, z + 1, x + 1, y, z + 1, x + 1, y, z, x + 1, y + hB, z]; break;
      }
      const uv = [0, 0.5 - hA * 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.5 - hB * 0.5];
      for (let k = 0; k < 4; k++) writer.vertex(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, layerFlow, uv[k * 2]!, uv[k * 2 + 1]!, tr, tg, tb, 255, d, (ln >> 4) * 17, mat, (ln & 15) * 17);
      if (!isLava) for (let k = 3; k >= 0; k--) writer.vertex(pts[k * 3]!, pts[k * 3 + 1]!, pts[k * 3 + 2]!, layerFlow, uv[k * 2]!, uv[k * 2 + 1]!, tr, tg, tb, 255, d ^ 1, (ln >> 4) * 17, mat, (ln & 15) * 17);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Cave culling visibility graph
  // ------------------------------------------------------------------------------------------

  private readonly visited = new Uint8Array(4096);
  private readonly queue = new Int32Array(4096);

  private visibilityGraph(): number {
    const visited = this.visited;
    visited.fill(0);
    let result = 0;
    let opaqueCount = 0;
    for (let i = 0; i < 4096; i++) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      if (this.isOpaqueAt(pidx(x, y, z))) { visited[i] = 1; opaqueCount++; }
    }
    if (opaqueCount === 0) return 0x7fff;
    if (opaqueCount === 4096) return 0;
    for (let start = 0; start < 4096; start++) {
      if (visited[start]) continue;
      let head = 0, tail = 0;
      this.queue[tail++] = start;
      visited[start] = 1;
      let faces = 0;
      while (head < tail) {
        const i = this.queue[head++]!;
        const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
        if (y === 0) faces |= 1; if (y === 15) faces |= 2;
        if (z === 0) faces |= 4; if (z === 15) faces |= 8;
        if (x === 0) faces |= 16; if (x === 15) faces |= 32;
        const nbs = [
          y > 0 ? i - 256 : -1, y < 15 ? i + 256 : -1, z > 0 ? i - 16 : -1, z < 15 ? i + 16 : -1, x > 0 ? i - 1 : -1, x < 15 ? i + 1 : -1,
        ];
        for (const n of nbs) {
          if (n < 0 || visited[n]) continue;
          visited[n] = 1;
          this.queue[tail++] = n;
        }
      }
      // set pair bits
      for (let a = 0; a < 6; a++) {
        if (!(faces & (1 << a))) continue;
        for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) result |= 1 << pairIndex(a, b);
      }
    }
    return result;
  }
}

/** Index 0..14 for an unordered face pair. */
export function pairIndex(a: number, b: number): number {
  if (a > b) { const t = a; a = b; b = t; }
  // a in 0..4, b in a+1..5
  return a * 5 - (a * (a - 1)) / 2 + (b - a - 1);
}

/** Tangent signs per corner (TL, BL, BR, TR) for each direction, matching bake.ts corner order. */
const CORNER_SIGNS: number[][] = [
  // DOWN: TL(x0,z1) BL(x0,z0) BR(x1,z0) TR(x1,z1) ; ta=x, tb=z
  [-1, 1, -1, -1, 1, -1, 1, 1],
  // UP: TL(x0,z0) BL(x0,z1) BR(x1,z1) TR(x1,z0)
  [-1, -1, -1, 1, 1, 1, 1, -1],
  // NORTH: TL(x1,y1) BL(x1,y0) BR(x0,y0) TR(x0,y1) ; ta=x, tb=y
  [1, 1, 1, -1, -1, -1, -1, 1],
  // SOUTH: TL(x0,y1) BL(x0,y0) BR(x1,y0) TR(x1,y1)
  [-1, 1, -1, -1, 1, -1, 1, 1],
  // WEST: TL(z0,y1) BL(z0,y0) BR(z1,y0) TR(z1,y1) ; ta=z, tb=y
  [-1, 1, -1, -1, 1, -1, 1, 1],
  // EAST: TL(z1,y1) BL(z1,y0) BR(z0,y0) TR(z0,y1)
  [1, 1, 1, -1, -1, -1, -1, 1],
];

/** AO brightness curve (0 = darkest). */
const AO_CURVE = [110, 160, 205, 255];

/** Project a section-local vertex position to tiling UVs (block units) for a face direction. */
function projectUV(d: number, x: number, y: number, z: number, rot: number): [number, number] {
  let u: number, v: number;
  switch (d) {
    case 0: u = x; v = 16 - z; break;
    case 1: u = x; v = z; break;
    case 2: u = 16 - x; v = 16 - y; break;
    case 3: u = x; v = 16 - y; break;
    case 4: u = z; v = 16 - y; break;
    default: u = 16 - z; v = 16 - y; break;
  }
  switch (rot) {
    case 1: return [v, 16 - u];
    case 2: return [16 - u, 16 - v];
    case 3: return [16 - v, u];
    default: return [u, v];
  }
}

export { SHADE };
