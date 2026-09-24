/**
 * Terrain generation service: runs the "noise" stage either in a pool of workers (browser /
 * worker_threads) or in-process (tests, fallback).
 */
import { Chunk } from '../common/world/chunk';
import { DIMENSIONS, DimensionId } from '../common/world/dimension';
import { ChunkGenerator } from '../common/worldgen/generator';
import { ByteReader, ByteWriter } from '../common/util/bytes';

export interface GenService {
  generate(dim: DimensionId, cx: number, cz: number): Promise<Chunk>;
  readonly parallelism: number;
  dispose(): void;
}

export class InProcessGen implements GenService {
  readonly parallelism = 1;
  constructor(private readonly generators: Map<DimensionId, ChunkGenerator>) {}

  generate(dim: DimensionId, cx: number, cz: number): Promise<Chunk> {
    const g = this.generators.get(dim)!;
    const c = new Chunk(cx, cz, DIMENSIONS[dim]);
    g.generateTerrain(c);
    return Promise.resolve(c);
  }

  dispose(): void {}
}

/** Minimal port interface (MessagePort in browsers, worker_threads MessagePort in Node). */
export interface PortLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

interface Job {
  id: number;
  dim: DimensionId;
  cx: number;
  cz: number;
  resolve: (c: Chunk) => void;
  reject: (e: unknown) => void;
}

/** Pool of generation workers reached through ports. */
export class PortGenPool implements GenService {
  private nextId = 1;
  private readonly pending = new Map<number, Job>();
  private readonly busy: number[];
  readonly parallelism: number;

  constructor(private readonly ports: PortLike[]) {
    this.parallelism = ports.length * 2;
    this.busy = ports.map(() => 0);
    ports.forEach((p) => {
      p.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { type: string; id: number; data?: Uint8Array; error?: string };
        const job = this.pending.get(msg.id);
        if (!job) return;
        this.pending.delete(msg.id);
        const i = ports.indexOf(p);
        this.busy[i] = Math.max(0, this.busy[i]! - 1);
        if (msg.type === 'error' || !msg.data) {
          job.reject(new Error(msg.error ?? 'generation failed'));
          return;
        }
        try {
          const chunk = Chunk.read(new ByteReader(msg.data), DIMENSIONS[job.dim], false);
          job.resolve(chunk);
        } catch (e) {
          job.reject(e);
        }
      };
    });
  }

  generate(dim: DimensionId, cx: number, cz: number): Promise<Chunk> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { id, dim, cx, cz, resolve, reject });
      let best = 0;
      for (let i = 1; i < this.busy.length; i++) if (this.busy[i]! < this.busy[best]!) best = i;
      this.busy[best]!++;
      this.ports[best]!.postMessage({ type: 'gen', id, dim, cx, cz });
    });
  }

  dispose(): void {
    for (const p of this.ports) p.postMessage({ type: 'close' });
  }
}

/** Worker-side handler shared by the browser gen worker and Node worker_threads. */
export function handleGenRequest(generators: Map<DimensionId, ChunkGenerator>, msg: { id: number; dim: DimensionId; cx: number; cz: number }): { type: string; id: number; data?: Uint8Array; error?: string } {
  try {
    const g = generators.get(msg.dim);
    if (!g) throw new Error('No generator for ' + msg.dim);
    const c = new Chunk(msg.cx, msg.cz, DIMENSIONS[msg.dim]);
    g.generateTerrain(c);
    const w = new ByteWriter(64 * 1024);
    c.write(w, false);
    return { type: 'done', id: msg.id, data: w.finish() };
  } catch (e) {
    return { type: 'error', id: msg.id, error: String((e as Error)?.stack ?? e) };
  }
}
