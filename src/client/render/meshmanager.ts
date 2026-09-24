/**
 * Mesh manager: tracks dirty sections, builds padded mesh jobs, dispatches them to mesh workers
 * (nearest first) and keeps the resulting GPU buffers.
 */
import type { ClientLevel } from '../world';
import type { Device, GpuBuffer } from './rhi/rhi';
import type { MeshJob, MeshResult } from './mesh/mesher';
import { PAD } from './mesh/mesher';
import { chunkKey } from '../../common/world/direction';

export interface SectionMesh {
  cx: number;
  sy: number;
  cz: number;
  solid: GpuBuffer | null;
  solidCount: number;
  cutout: GpuBuffer | null;
  cutoutCount: number;
  translucent: GpuBuffer | null;
  translucentCount: number;
  visibility: number;
  revision: number;
  /** Time the mesh was first shown (fade-in). */
  shownAt: number;
  empty: boolean;
}

interface WorkerSlot {
  worker: Worker;
  busy: number;
}

export function sectionKey(cx: number, sy: number, cz: number): number {
  return chunkKey(cx, cz) * 64 + (sy + 8);
}

export class MeshManager {
  readonly meshes = new Map<number, SectionMesh>();
  private readonly dirty = new Map<number, { cx: number; sy: number; cz: number; revision: number }>();
  private readonly inFlight = new Map<number, number>();
  private readonly workers: WorkerSlot[] = [];
  private nextJob = 1;
  private revisionCounter = 1;
  stats = { jobs: 0, avgMs: 0, pending: 0, uploadsLastFrame: 0 };
  maxUploadsPerFrame = 12;
  private readonly results: MeshResult[] = [];

  constructor(private readonly device: Device, private readonly level: ClientLevel, workerFactory: () => Worker, count: number, init: unknown) {
    for (let i = 0; i < count; i++) {
      const worker = workerFactory();
      worker.postMessage({ type: 'init', ...(init as object) });
      worker.onmessage = (ev: MessageEvent) => this.onResult(ev.data as MeshResult);
      this.workers.push({ worker, busy: 0 });
    }
    level.onSectionDirty((cx, sy, cz) => this.markDirty(cx, sy, cz));
    level.onChunk((cx, cz, loaded) => {
      if (!loaded) this.dropChunk(cx, cz);
    });
  }

  setOptions(opts: Record<string, unknown>): void {
    for (const w of this.workers) w.worker.postMessage({ type: 'options', opts });
    // remesh everything
    for (const m of this.meshes.values()) this.markDirty(m.cx, m.sy, m.cz);
  }

  markDirty(cx: number, sy: number, cz: number): void {
    const minS = this.level.dim.minY >> 4, maxS = (this.level.dim.minY + this.level.dim.height) >> 4;
    if (sy < minS || sy >= maxS) return;
    const k = sectionKey(cx, sy, cz);
    this.dirty.set(k, { cx, sy, cz, revision: this.revisionCounter++ });
  }

  private dropChunk(cx: number, cz: number): void {
    const minS = this.level.dim.minY >> 4, maxS = (this.level.dim.minY + this.level.dim.height) >> 4;
    for (let sy = minS; sy < maxS; sy++) {
      const k = sectionKey(cx, sy, cz);
      this.dirty.delete(k);
      const m = this.meshes.get(k);
      if (m) {
        this.freeMesh(m);
        this.meshes.delete(k);
      }
    }
  }

  private freeMesh(m: SectionMesh): void {
    m.solid?.destroy();
    m.cutout?.destroy();
    m.translucent?.destroy();
    m.solid = m.cutout = m.translucent = null;
  }

  clear(): void {
    for (const m of this.meshes.values()) this.freeMesh(m);
    this.meshes.clear();
    this.dirty.clear();
    this.inFlight.clear();
  }

  private neighboursLoaded(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.level.hasChunk(cx + dx, cz + dz)) return false;
    return true;
  }

  /** Dispatch jobs (nearest dirty sections first) and upload finished meshes. */
  update(camX: number, camY: number, camZ: number, now: number): void {
    // Upload results
    this.stats.uploadsLastFrame = 0;
    while (this.results.length && this.stats.uploadsLastFrame < this.maxUploadsPerFrame) {
      this.upload(this.results.shift()!, now);
      this.stats.uploadsLastFrame++;
    }
    // Dispatch
    const capacity = this.workers.length * 3;
    let busy = 0;
    for (const w of this.workers) busy += w.busy;
    if (busy >= capacity || this.dirty.size === 0) {
      this.stats.pending = this.dirty.size;
      return;
    }
    const pcx = Math.floor(camX) >> 4, pcy = Math.floor(camY) >> 4, pcz = Math.floor(camZ) >> 4;
    const candidates: Array<{ k: number; d: number }> = [];
    for (const [k, s] of this.dirty) {
      if (this.inFlight.has(k)) continue;
      const dx = s.cx - pcx, dy = s.sy - pcy, dz = s.cz - pcz;
      candidates.push({ k, d: dx * dx + dy * dy * 0.5 + dz * dz });
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (busy >= capacity) break;
      const s = this.dirty.get(c.k)!;
      if (!this.level.hasChunk(s.cx, s.cz)) {
        this.dirty.delete(c.k);
        continue;
      }
      if (!this.neighboursLoaded(s.cx, s.cz)) continue;
      const job = this.buildJob(s.cx, s.sy, s.cz, s.revision);
      if (!job) {
        this.dirty.delete(c.k);
        continue;
      }
      this.dirty.delete(c.k);
      this.inFlight.set(c.k, s.revision);
      let best = this.workers[0]!;
      for (const w of this.workers) if (w.busy < best.busy) best = w;
      best.busy++;
      (job as MeshJob & { worker?: number }).worker = this.workers.indexOf(best);
      best.worker.postMessage({ type: 'mesh', job }, [job.blocks.buffer, job.light.buffer, job.biomes.buffer]);
      busy++;
      this.stats.jobs++;
    }
    this.stats.pending = this.dirty.size;
  }

  private readonly padBlocks = PAD * PAD * PAD;

  /** Build the padded 18³ block/light volume for a section. Returns null for empty+fully lit sections. */
  private buildJob(cx: number, sy: number, cz: number, revision: number): MeshJob | null {
    const level = this.level;
    const center = level.getChunk(cx, cz)!;
    const sec = center.sections[sy - center.minSection];
    if (!sec) return null;
    if (sec.isEmpty) {
      // Nothing to mesh: register an empty mesh so cave culling knows the section is open
      const k = sectionKey(cx, sy, cz);
      const old = this.meshes.get(k);
      if (old) this.freeMesh(old);
      this.meshes.set(k, { cx, sy, cz, solid: null, solidCount: 0, cutout: null, cutoutCount: 0, translucent: null, translucentCount: 0, visibility: 0x7fff, revision, shownAt: 0, empty: true });
      return null;
    }
    const blocks = new Uint16Array(this.padBlocks);
    const light = new Uint8Array(this.padBlocks);
    const biomes = new Uint8Array(PAD * PAD);
    const minY = level.dim.minY, maxY = level.dim.minY + level.dim.height;
    const by = sy << 4;
    for (let dcz = -1; dcz <= 1; dcz++) {
      for (let dcx = -1; dcx <= 1; dcx++) {
        const ch = level.getChunk(cx + dcx, cz + dcz);
        if (!ch) continue;
        const x0 = dcx < 0 ? 15 : 0, x1 = dcx > 0 ? 0 : 15;
        const z0 = dcz < 0 ? 15 : 0, z1 = dcz > 0 ? 0 : 15;
        for (let ly = -1; ly <= 16; ly++) {
          const y = by + ly;
          if (y < minY || y >= maxY) {
            // outside world: air, full skylight above
            if (y >= maxY) {
              for (let lz = z0; lz <= z1; lz++) for (let lx = x0; lx <= x1; lx++) {
                const px = lx + dcx * 16, pz = lz + dcz * 16;
                light[(ly + 1) * PAD * PAD + (pz + 1) * PAD + (px + 1)] = 0xf0;
              }
            }
            continue;
          }
          const s = ch.sections[(y >> 4) - ch.minSection]!;
          if (s.isEmpty && s.uniformLight === 0xf0 && !s.light && !(dcx === 0 && dcz === 0 && ly >= 0 && ly <= 15)) {
            for (let lz = z0; lz <= z1; lz++) for (let lx = x0; lx <= x1; lx++) {
              const px = lx + dcx * 16, pz = lz + dcz * 16;
              light[(ly + 1) * PAD * PAD + (pz + 1) * PAD + (px + 1)] = 0xf0;
            }
            continue;
          }
          const yl = y & 15;
          for (let lz = z0; lz <= z1; lz++) {
            for (let lx = x0; lx <= x1; lx++) {
              const px = lx + dcx * 16, pz = lz + dcz * 16;
              const i = (ly + 1) * PAD * PAD + (pz + 1) * PAD + (px + 1);
              const si = (yl << 8) | (lz << 4) | lx;
              blocks[i] = s.get(si);
              light[i] = s.getLight(si);
            }
          }
        }
        // biomes for columns (at section middle height)
        for (let lz = z0; lz <= z1; lz++) for (let lx = x0; lx <= x1; lx++) {
          const px = lx + dcx * 16, pz = lz + dcz * 16;
          biomes[(pz + 1) * PAD + (px + 1)] = ch.getBiome(lx, by + 8, lz);
        }
      }
    }
    return { id: this.nextJob++, cx, sy, cz, blocks, light, biomes, revision };
  }

  private onResult(r: MeshResult & { worker?: number }): void {
    const w = this.workers[(r as { worker?: number }).worker ?? 0];
    if (w) w.busy = Math.max(0, w.busy - 1);
    else for (const ww of this.workers) if (ww.busy > 0) { ww.busy--; break; }
    this.results.push(r);
  }

  private upload(r: MeshResult, now: number): void {
    const k = sectionKey(r.cx, r.sy, r.cz);
    const want = this.inFlight.get(k);
    if (want !== undefined && want === r.revision) this.inFlight.delete(k);
    if (!this.level.hasChunk(r.cx, r.cz)) return;
    const old = this.meshes.get(k);
    if (old && old.revision > r.revision) return;
    const mk = (buf: ArrayBuffer, count: number): GpuBuffer | null => (count > 0 ? this.device.createBuffer('vertex', buf.byteLength, new Uint8Array(buf), 'section') : null);
    const mesh: SectionMesh = {
      cx: r.cx, sy: r.sy, cz: r.cz,
      solid: mk(r.solid, r.solidCount), solidCount: r.solidCount,
      cutout: mk(r.cutout, r.cutoutCount), cutoutCount: r.cutoutCount,
      translucent: mk(r.translucent, r.translucentCount), translucentCount: r.translucentCount,
      visibility: r.visibility, revision: r.revision, shownAt: old && !old.empty ? old.shownAt : now, empty: r.empty,
    };
    if (old) this.freeMesh(old);
    this.meshes.set(k, mesh);
    this.stats.avgMs = this.stats.avgMs * 0.95 + r.timeMs * 0.05;
  }

  get(cx: number, sy: number, cz: number): SectionMesh | undefined {
    return this.meshes.get(sectionKey(cx, sy, cz));
  }

  dispose(): void {
    this.clear();
    for (const w of this.workers) w.worker.terminate();
  }
}
