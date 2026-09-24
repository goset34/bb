/// <reference lib="webworker" />
/** Mesh worker: converts padded section volumes into vertex buffers. */
import { initRegistries } from '../common/init';
import { Mesher, MeshJob, MesherOptions } from '../client/render/mesh/mesher';
import type { StateTables } from '../common/block/registry';

declare const self: DedicatedWorkerGlobalScope;

let mesher: Mesher | null = null;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { type: string; tables?: StateTables; layers?: Record<string, number>; job?: MeshJob & { worker?: number }; opts?: Partial<MesherOptions> };
  if (msg.type === 'init') {
    initRegistries(msg.tables);
    const layers = msg.layers ?? {};
    mesher = new Mesher((name) => layers[name] ?? layers['missing'] ?? 0);
    if (msg.opts) Object.assign(mesher.opts, msg.opts);
    return;
  }
  if (msg.type === 'options' && mesher && msg.opts) {
    Object.assign(mesher.opts, msg.opts);
    return;
  }
  if (msg.type === 'mesh' && mesher && msg.job) {
    const r = mesher.mesh(msg.job);
    self.postMessage({ ...r, worker: msg.job.worker }, [r.solid, r.cutout, r.translucent]);
  }
};
