/** Scheduled tick queue (binary heap ordered by time, priority, insertion order). */

export interface ScheduledTick {
  x: number;
  y: number;
  z: number;
  /** Block id (or -1 water, -2 lava for fluid ticks). */
  id: number;
  time: number;
  priority: number;
  order: number;
}

export class TickQueue {
  private heap: ScheduledTick[] = [];
  private readonly keys = new Set<string>();
  private order = 0;

  private static key(x: number, y: number, z: number, id: number): string {
    return `${x},${y},${z},${id}`;
  }

  has(x: number, y: number, z: number, id: number): boolean {
    return this.keys.has(TickQueue.key(x, y, z, id));
  }

  schedule(x: number, y: number, z: number, id: number, time: number, priority = 0): void {
    const k = TickQueue.key(x, y, z, id);
    if (this.keys.has(k)) return;
    this.keys.add(k);
    this.push({ x, y, z, id, time, priority, order: this.order++ });
  }

  get size(): number {
    return this.heap.length;
  }

  private less(a: ScheduledTick, b: ScheduledTick): boolean {
    if (a.time !== b.time) return a.time < b.time;
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.order < b.order;
  }

  private push(t: ScheduledTick): void {
    const h = this.heap;
    h.push(t);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop(): ScheduledTick | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }

  /** Pop all ticks due at or before `time` (max `limit`), in order. */
  drainDue(time: number, limit: number, canRun: (t: ScheduledTick) => boolean): ScheduledTick[] {
    const out: ScheduledTick[] = [];
    const deferred: ScheduledTick[] = [];
    while (this.heap.length && this.heap[0]!.time <= time && out.length < limit) {
      const t = this.pop()!;
      if (!canRun(t)) {
        deferred.push(t);
        continue;
      }
      this.keys.delete(TickQueue.key(t.x, t.y, t.z, t.id));
      out.push(t);
    }
    for (const d of deferred) {
      d.time = time + 1;
      this.push(d);
    }
    return out;
  }

  /** Remove & return ticks inside a chunk (for saving). */
  extractChunk(cx: number, cz: number): ScheduledTick[] {
    const keep: ScheduledTick[] = [];
    const out: ScheduledTick[] = [];
    for (const t of this.heap) {
      if (t.x >> 4 === cx && t.z >> 4 === cz) {
        out.push(t);
        this.keys.delete(TickQueue.key(t.x, t.y, t.z, t.id));
      } else keep.push(t);
    }
    this.heap = [];
    for (const t of keep) this.push(t);
    return out;
  }
}
