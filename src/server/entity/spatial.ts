/**
 * Spatial hash of entities by 16³ cells, rebuilt once per tick (cheap: one insert per entity)
 * and used for neighbour queries (targets, pushing, pickup, AI sensing).
 */
import type { Entity } from '../../common/entity/ecs';
import type { AABB } from '../../common/math/geom';

const key = (cx: number, cy: number, cz: number): number => ((cx + 2048) * 4096 + (cz + 2048)) * 64 + (cy + 32);

export class EntityGrid {
  private readonly cells = new Map<number, Entity[]>();
  /** Game tick of the last rebuild (-1 = never). */
  builtAt = -1;

  rebuild(entities: Iterable<Entity>, tick: number): void {
    for (const arr of this.cells.values()) arr.length = 0;
    for (const e of entities) this.insert(e);
    this.builtAt = tick;
  }

  insert(e: Entity): void {
    const t = e.transform;
    if (!t || e.removed) return;
    const k = key(Math.floor(t.x) >> 4, Math.floor(t.y) >> 4, Math.floor(t.z) >> 4);
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(e);
  }

  /** Entities whose hitbox intersects `box` (cells overlapping the box, padded by 2 blocks). */
  query(box: AABB, filter?: (e: Entity) => boolean, except?: Entity, out: Entity[] = []): Entity[] {
    const x0 = Math.floor(box.minX - 2) >> 4, x1 = Math.floor(box.maxX + 2) >> 4;
    const y0 = Math.floor(box.minY - 3) >> 4, y1 = Math.floor(box.maxY + 2) >> 4;
    const z0 = Math.floor(box.minZ - 2) >> 4, z1 = Math.floor(box.maxZ + 2) >> 4;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const arr = this.cells.get(key(cx, cy, cz));
          if (!arr) continue;
          for (const e of arr) {
            if (e === except || e.removed) continue;
            const t = e.transform!, p = e.physics;
            const hw = (p?.width ?? 0.5) / 2, h = p?.height ?? 0.5;
            if (t.x + hw <= box.minX || t.x - hw >= box.maxX || t.y + h <= box.minY || t.y >= box.maxY || t.z + hw <= box.minZ || t.z - hw >= box.maxZ) continue;
            if (filter && !filter(e)) continue;
            out.push(e);
          }
        }
      }
    }
    return out;
  }
}
