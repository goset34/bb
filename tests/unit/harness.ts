/**
 * In-process test server: flat or normal world, in-memory connection, manual ticking.
 * Used by gameplay tests (survival, commands, menus).
 */
import { initRegistries } from '../../src/common/init';
import { Connection, RawTransport } from '../../src/common/net/connection';
import { PROTOCOL_VERSION, Packet } from '../../src/common/net/protocol';
import { StrataServer, newWorldInfo } from '../../src/server/server';
import { InProcessGen } from '../../src/server/gen';
import { createGenerators } from '../../src/common/worldgen/factory';
import { parseSeed } from '../../src/common/math/random';
import { installGameplay } from '../../src/server/gameplay';
import '../../src/server/modules';
import type { ServerPlayer } from '../../src/server/player';
import type { GameMode } from '../../src/common/entity/player';
import type { GeneratorSettings } from '../../src/common/worldgen/generator';

let initialized = false;

function memoryPair(): [RawTransport, RawTransport] {
  const make = (): RawTransport & { peer?: RawTransport & { deliver(d: Uint8Array): void }; deliver(d: Uint8Array): void; closeCb(r: string): void } => {
    let msgCb: (d: Uint8Array) => void = () => {};
    let closeCb: (r: string) => void = () => {};
    const t = {
      peer: undefined as never,
      send(data: Uint8Array) {
        const copy = data.slice();
        queueMicrotask(() => t.peer?.deliver(copy));
      },
      deliver(d: Uint8Array) { msgCb(d); },
      onMessage(cb: (d: Uint8Array) => void) { msgCb = cb; },
      onClose(cb: (r: string) => void) { closeCb = cb; },
      closeCb(r: string) { closeCb(r); },
      close() { queueMicrotask(() => (t.peer as unknown as { closeCb(r: string): void } | undefined)?.closeCb('closed')); },
    };
    return t;
  };
  const a = make(), b = make();
  a.peer = b as never;
  b.peer = a as never;
  return [a, b];
}

export interface TestWorld {
  server: StrataServer;
  conn: Connection;
  packets: Packet[];
  player: ServerPlayer;
  /** Run n server ticks, letting async generation settle between ticks. */
  tick(n?: number): Promise<void>;
  /** Packets of a type received since the last clear. */
  received(type: string): Packet[];
  clear(): void;
  command(cmd: string): Promise<void>;
  send(p: Packet): Promise<void>;
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function startTestWorld(opts: { mode?: GameMode; generator?: GeneratorSettings; difficulty?: number } = {}): Promise<TestWorld> {
  if (!initialized) {
    initRegistries();
    initialized = true;
  }
  const gen: GeneratorSettings = opts.generator ?? { type: 'flat', structures: false, bonusChest: false, flatLayers: [['bedrock', 1], ['stone', 3], ['dirt', 2], ['grass_block', 1]] };
  const info = newWorldInfo('test', '42', gen, opts.mode ?? 'survival', opts.difficulty ?? 2, false, true);
  const generators = createGenerators(parseSeed(info.seed), gen);
  const server = new StrataServer({ info, gen: new InProcessGen(generators), singleplayer: true });
  installGameplay(server);
  const [st, ct] = memoryPair();
  const serverConn = new Connection(st, 'server');
  const conn = new Connection(ct, 'client');
  const packets: Packet[] = [];
  conn.onPacket((p) => {
    packets.push(p);
    if (p.type === 'keepAlive') conn.send({ type: 'keepAlive', id: p['id'] as number });
    if (p.type === 'playerPosition') conn.send({ type: 'teleportConfirm', teleportId: p['teleportId'] as number });
  });
  server.accept(serverConn, 'test:player');
  conn.send({ type: 'hello', name: 'Tester', viewDistance: 2, lang: 'es', protocol: PROTOCOL_VERSION, skin: {} });
  for (let i = 0; i < 50 && !server.players[0]?.joined; i++) await flush();
  const player = server.players[0]!;
  let seq = 0;
  const w: TestWorld = {
    server, conn, packets, player,
    async tick(n = 1) {
      for (let i = 0; i < n; i++) {
        // Simulated idle client input so the authoritative movement (gravity) runs
        const t = player.entity.transform;
        conn.send({ type: 'input', seq: ++seq, forward: 0, strafe: 0, yaw: t.yaw, pitch: t.pitch, flags: 0, clientTick: server.gameTime });
        await flush();
        server.tick();
        await flush();
      }
    },
    received: (type) => packets.filter((p) => p.type === type),
    clear: () => { packets.length = 0; },
    async command(cmd) {
      conn.send({ type: 'command', command: cmd });
      await flush();
      await flush();
    },
    async send(p) {
      conn.send(p);
      await flush();
      await flush();
    },
  };
  // Load spawn chunks
  for (let i = 0; i < 40; i++) {
    await w.tick();
    const t = player.entity.transform;
    if (player.level.isLoaded(Math.floor(t.x), Math.floor(t.z)) && player.level.chunks.getFull(Math.floor(t.x) >> 4, Math.floor(t.z) >> 4)) break;
  }
  return w;
}
