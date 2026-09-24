/**
 * Entity Component System.
 *
 * Entities are records whose optional fields are components (plain data). Systems run over
 * live queries (sets of entities having a given set of components) that are maintained
 * incrementally when components are added or removed. This keeps data and logic separate
 * while remaining ergonomic in TypeScript.
 */
import type { Components } from './components';

export type ComponentName = keyof Components;

export type Entity = { id: number; type: string; removed: boolean } & Partial<Components>;

export type With<C extends ComponentName> = Entity & Required<Pick<Components, C>>;

export class Query<C extends ComponentName = ComponentName> {
  readonly entities = new Set<With<C>>();
  constructor(readonly components: readonly C[]) {}

  matches(e: Entity): boolean {
    for (const c of this.components) if (e[c] === undefined) return false;
    return true;
  }

  [Symbol.iterator](): IterableIterator<With<C>> {
    return this.entities.values();
  }

  get size(): number {
    return this.entities.size;
  }

  /** Snapshot (safe against modification during iteration). */
  toArray(): With<C>[] {
    return [...this.entities];
  }
}

export interface System {
  readonly name: string;
  update(dt: number): void;
}

export class EntityWorld {
  private nextId = 1;
  readonly byId = new Map<number, Entity>();
  private readonly queries: Query<ComponentName>[] = [];
  private readonly queryIndex = new Map<string, Query<ComponentName>>();
  private readonly listeners: Array<(e: Entity, added: boolean) => void> = [];

  allocateId(): number {
    return this.nextId++;
  }

  /** Ensure future ids do not collide with a restored id. */
  reserveId(id: number): void {
    if (id >= this.nextId) this.nextId = id + 1;
  }

  add<E extends Entity>(e: E): E {
    if (!e.id) e.id = this.allocateId();
    else this.reserveId(e.id);
    e.removed = false;
    this.byId.set(e.id, e);
    for (const q of this.queries) if (q.matches(e)) q.entities.add(e as never);
    for (const l of this.listeners) l(e, true);
    return e;
  }

  remove(e: Entity): void {
    if (!this.byId.has(e.id)) return;
    this.byId.delete(e.id);
    e.removed = true;
    for (const q of this.queries) q.entities.delete(e as never);
    for (const l of this.listeners) l(e, false);
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  addComponent<C extends ComponentName>(e: Entity, name: C, data: Components[C]): void {
    (e as Partial<Components>)[name] = data;
    if (!this.byId.has(e.id)) return;
    for (const q of this.queries) {
      if (q.components.includes(name) && q.matches(e)) q.entities.add(e as never);
    }
  }

  removeComponent<C extends ComponentName>(e: Entity, name: C): void {
    if (e[name] === undefined) return;
    for (const q of this.queries) if (q.components.includes(name)) q.entities.delete(e as never);
    delete (e as Partial<Components>)[name];
  }

  query<C extends ComponentName>(...components: C[]): Query<C> {
    const key = [...components].sort().join(',');
    let q = this.queryIndex.get(key) as Query<C> | undefined;
    if (q) return q;
    q = new Query<C>(components);
    for (const e of this.byId.values()) if (q.matches(e)) q.entities.add(e as never);
    this.queries.push(q as unknown as Query<ComponentName>);
    this.queryIndex.set(key, q as unknown as Query<ComponentName>);
    return q;
  }

  onChange(l: (e: Entity, added: boolean) => void): void {
    this.listeners.push(l);
  }

  get count(): number {
    return this.byId.size;
  }

  all(): IterableIterator<Entity> {
    return this.byId.values();
  }

  clear(): void {
    for (const e of [...this.byId.values()]) this.remove(e);
  }
}
