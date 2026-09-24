/** In-memory transport pair (tests, same-thread client/server). */
import { RawTransport } from './connection';

export function localTransportPair(): [RawTransport, RawTransport] {
  const mk = () => {
    let msg: (d: Uint8Array) => void = () => {};
    let close: (r: string) => void = () => {};
    let peer: { deliver(d: Uint8Array): void; closed(r: string): void } | null = null;
    const t: RawTransport & { deliver(d: Uint8Array): void; closed(r: string): void; link(p: typeof peer): void } = {
      send(d) { const p = peer; if (p) queueMicrotask(() => p.deliver(d)); },
      onMessage(cb) { msg = cb; },
      onClose(cb) { close = cb; },
      close() { const p = peer; if (p) queueMicrotask(() => p.closed('closed')); },
      deliver(d) { msg(d); },
      closed(r) { close(r); },
      link(p) { peer = p; },
    };
    return t;
  };
  const a = mk();
  const b = mk();
  a.link(b);
  b.link(a);
  return [a, b];
}
