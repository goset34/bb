/// <reference lib="webworker" />
/**
 * Integrated server worker. Receives the world info, generation worker ports and the client port;
 * runs StrataServer at 20 TPS.
 */
import { initRegistries } from '../common/init';
import { installNativeKernels } from '../common/native/native';
import { StrataServer, WorldInfo } from '../server/server';
import { PortGenPool } from '../server/gen';
import { Connection, portTransport } from '../common/net/connection';
import type { StateTables } from '../common/block/registry';
import { installGameplay } from '../server/gameplay';
import { createWorldStorage } from '../server/storage/browser';

declare const self: DedicatedWorkerGlobalScope;

let server: StrataServer | null = null;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; info: WorldInfo; tables: StateTables; genPorts: MessagePort[]; clientPort: MessagePort; worldId: string; persist: boolean };
  if (msg.type === 'init') {
    initRegistries(msg.tables);
    await installNativeKernels();
    const storage = msg.persist ? await createWorldStorage(msg.worldId) : null;
    server = new StrataServer({
      info: msg.info,
      gen: new PortGenPool(msg.genPorts),
      store: storage?.chunks,
      singleplayer: true,
      persistence: storage?.persistence,
    });
    installGameplay(server);
    const conn = new Connection(portTransport(msg.clientPort as unknown as Parameters<typeof portTransport>[0]), 'server');
    server.accept(conn, 'local:player');
    server.start();
    self.postMessage({ type: 'started' });
    return;
  }
  if (msg.type === 'save' && server) {
    await server.saveAll();
    self.postMessage({ type: 'saved' });
    return;
  }
  if (msg.type === 'stop' && server) {
    server.stop();
    await server.saveAll();
    self.postMessage({ type: 'stopped' });
    return;
  }
  if (msg.type === 'pause' && server) {
    server.paused = !!(msg as unknown as { paused: boolean }).paused;
  }
};
