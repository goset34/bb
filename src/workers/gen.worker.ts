/// <reference lib="webworker" />
/** Terrain generation worker: builds generators from the world seed and serves chunk requests. */
import { initRegistries } from '../common/init';
import { installNativeKernels } from '../common/native/native';
import { parseSeed } from '../common/math/random';
import { createGenerators } from '../common/worldgen/factory';
import { handleGenRequest } from '../server/gen';
import type { StateTables } from '../common/block/registry';
import type { GeneratorSettings } from '../common/worldgen/generator';
import type { ChunkGenerator } from '../common/worldgen/generator';
import type { DimensionId } from '../common/world/dimension';

declare const self: DedicatedWorkerGlobalScope;

let generators: Map<DimensionId, ChunkGenerator> | null = null;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; seed: string; settings: GeneratorSettings; tables: StateTables; port: MessagePort };
  if (msg.type !== 'init') return;
  initRegistries(msg.tables);
  await installNativeKernels();
  generators = createGenerators(parseSeed(msg.seed), msg.settings);
  const port = msg.port;
  port.onmessage = (e: MessageEvent) => {
    const req = e.data as { type: string; id: number; dim: DimensionId; cx: number; cz: number };
    if (req.type === 'close') {
      self.close();
      return;
    }
    if (req.type !== 'gen' || !generators) return;
    const res = handleGenRequest(generators, req);
    if (res.data) port.postMessage(res, [res.data.buffer]);
    else port.postMessage(res);
  };
  self.postMessage({ type: 'ready' });
};
