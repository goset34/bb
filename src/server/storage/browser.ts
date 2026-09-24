/**
 * IndexedDB world storage: world metadata, players and Anvil-like region files.
 * Usable from the main thread and workers.
 */
import { ChunkStore } from '../chunkmanager';
import { RegionFile, regionKey } from './region';
import type { WorldInfo } from '../server';

const DB_NAME = 'strata';
const DB_VERSION = 1;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds');
      if (!db.objectStoreNames.contains('regions')) db.createObjectStore('regions');
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return reqP(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
}

export async function idbKeys(db: IDBDatabase, store: string, prefix: string): Promise<string[]> {
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  return (await reqP(db.transaction(store, 'readonly').objectStore(store).getAllKeys(range))) as string[];
}

export class IdbRegionStore implements ChunkStore {
  private readonly cache = new Map<string, RegionFile>();
  private readonly loading = new Map<string, Promise<RegionFile>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: IDBDatabase, private readonly worldId: string) {}

  private async region(key: string): Promise<RegionFile> {
    const c = this.cache.get(key);
    if (c) return c;
    let p = this.loading.get(key);
    if (!p) {
      p = (async () => {
        const data = await idbGet<ArrayBuffer>(this.db, 'regions', `${this.worldId}/${key}`);
        const r = new RegionFile(data ? new Uint8Array(data) : undefined);
        this.cache.set(key, r);
        this.loading.delete(key);
        return r;
      })();
      this.loading.set(key, p);
    }
    return p;
  }

  async load(dim: string, cx: number, cz: number): Promise<Uint8Array | null> {
    const r = await this.region(regionKey(dim, cx, cz));
    return r.read(cx, cz);
  }

  save(dim: string, cx: number, cz: number, data: Uint8Array): Promise<void> {
    // Serialise writes per store to keep region buffers consistent
    this.queue = this.queue.then(async () => {
      const r = await this.region(regionKey(dim, cx, cz));
      await r.write(cx, cz, data);
    }).catch((e) => console.error('[storage] save failed', e));
    return this.queue;
  }

  async flush(): Promise<void> {
    await this.queue;
    const tx = this.db.transaction('regions', 'readwrite');
    const st = tx.objectStore('regions');
    let n = 0;
    for (const [key, r] of this.cache) {
      if (!r.dirty) continue;
      const bytes = r.bytes();
      st.put(bytes.buffer, `${this.worldId}/${key}`);
      r.dirty = false;
      n++;
    }
    if (n) await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    // Drop clean regions from memory to bound usage
    if (this.cache.size > 24) for (const [k, r] of this.cache) if (!r.dirty) this.cache.delete(k);
  }
}

export async function createWorldStorage(worldId: string): Promise<{ chunks: ChunkStore; persistence: { saveInfo(info: WorldInfo): Promise<void>; savePlayer(uuid: string, data: Record<string, unknown>): Promise<void>; loadPlayer(uuid: string): Promise<Record<string, unknown> | null> } }> {
  const db = await openDB();
  return {
    chunks: new IdbRegionStore(db, worldId),
    persistence: {
      async saveInfo(info) { await idbPut(db, 'worlds', worldId, info); },
      async savePlayer(uuid, data) { await idbPut(db, 'players', `${worldId}/${uuid}`, data); },
      async loadPlayer(uuid) { return (await idbGet<Record<string, unknown>>(db, 'players', `${worldId}/${uuid}`)) ?? null; },
    },
  };
}

/** World list / management helpers used by the title screen. */
export async function listWorlds(): Promise<Array<{ id: string; info: WorldInfo }>> {
  const db = await openDB();
  const tx = db.transaction('worlds', 'readonly');
  const st = tx.objectStore('worlds');
  const keys = (await reqP(st.getAllKeys())) as string[];
  const vals = (await reqP(st.getAll())) as WorldInfo[];
  return keys.map((k, i) => ({ id: k, info: vals[i]! })).sort((a, b) => (b.info.lastPlayed ?? 0) - (a.info.lastPlayed ?? 0));
}

export async function saveWorldInfo(id: string, info: WorldInfo): Promise<void> {
  const db = await openDB();
  await idbPut(db, 'worlds', id, info);
}

export async function deleteWorld(id: string): Promise<void> {
  const db = await openDB();
  await idbDelete(db, 'worlds', id);
  for (const store of ['regions', 'players']) for (const k of await idbKeys(db, store, id + '/')) await idbDelete(db, store, k);
}

export async function exportWorldFiles(id: string): Promise<Array<{ name: string; data: Uint8Array }>> {
  const db = await openDB();
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const info = await idbGet<WorldInfo>(db, 'worlds', id);
  files.push({ name: 'level.json', data: new TextEncoder().encode(JSON.stringify(info, null, 2)) });
  for (const k of await idbKeys(db, 'regions', id + '/')) {
    const buf = await idbGet<ArrayBuffer>(db, 'regions', k);
    if (buf) files.push({ name: 'region/' + k.slice(id.length + 1), data: new Uint8Array(buf) });
  }
  for (const k of await idbKeys(db, 'players', id + '/')) {
    const p = await idbGet<Record<string, unknown>>(db, 'players', k);
    if (p) files.push({ name: 'players/' + encodeURIComponent(k.slice(id.length + 1)) + '.json', data: new TextEncoder().encode(JSON.stringify(p)) });
  }
  return files;
}

export async function importWorldFiles(files: Array<{ name: string; data: Uint8Array }>): Promise<string> {
  const db = await openDB();
  const level = files.find((f) => f.name === 'level.json' || f.name.endsWith('/level.json'));
  if (!level) throw new Error('level.json not found');
  const info = JSON.parse(new TextDecoder().decode(level.data)) as WorldInfo;
  const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const base = level.name.slice(0, level.name.length - 'level.json'.length);
  for (const f of files) {
    const rel = f.name.slice(base.length);
    if (rel.startsWith('region/')) await idbPut(db, 'regions', `${id}/${rel.slice(7)}`, f.data.slice().buffer);
    else if (rel.startsWith('players/')) await idbPut(db, 'players', `${id}/${decodeURIComponent(rel.slice(8, -5))}`, JSON.parse(new TextDecoder().decode(f.data)));
  }
  info.name = info.name + ' (importado)';
  await idbPut(db, 'worlds', id, info);
  return id;
}

export async function loadSetting<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return await idbGet<T>(db, 'settings', key);
  } catch {
    return undefined;
  }
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, 'settings', key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
}
