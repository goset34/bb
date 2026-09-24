/**
 * Transport-agnostic connection. Implementations: worker MessagePort (singleplayer),
 * WebSocket (dedicated server), RTCDataChannel (P2P).
 */
import { C2S, S2C, Packet } from './protocol';
import { ByteWriter } from '../util/bytes';

export interface RawTransport {
  send(data: Uint8Array): void;
  onMessage(cb: (data: Uint8Array) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

/** Wraps a raw transport and encodes/decodes packets for one side. */
export class Connection {
  private readonly writer = new ByteWriter(1024);
  private handlers: Array<(p: Packet) => void> = [];
  private closeHandlers: Array<(reason: string) => void> = [];
  bytesIn = 0;
  bytesOut = 0;
  packetsIn = 0;
  packetsOut = 0;
  closed = false;

  constructor(private readonly transport: RawTransport, private readonly side: 'client' | 'server') {
    const inbound = side === 'client' ? S2C : C2S;
    transport.onMessage((data) => {
      this.bytesIn += data.length;
      this.packetsIn++;
      let p: Packet;
      try {
        p = inbound.decode(data);
      } catch (e) {
        console.error('[net] bad packet', e);
        return;
      }
      for (const h of this.handlers) h(p);
    });
    transport.onClose((r) => {
      this.closed = true;
      for (const h of this.closeHandlers) h(r);
    });
  }

  send(p: Packet): void {
    if (this.closed) return;
    const outbound = this.side === 'client' ? C2S : S2C;
    const data = outbound.encode(p, this.writer);
    this.bytesOut += data.length;
    this.packetsOut++;
    this.transport.send(data);
  }

  onPacket(cb: (p: Packet) => void): void {
    this.handlers.push(cb);
  }

  onClose(cb: (reason: string) => void): void {
    this.closeHandlers.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
  }
}

/** MessagePort-based transport (browser workers / worker_threads). */
export function portTransport(port: { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((ev: MessageEvent) => void) | null; close?: () => void }): RawTransport {
  let msgCb: (d: Uint8Array) => void = () => {};
  let closeCb: (r: string) => void = () => {};
  port.onmessage = (ev: MessageEvent) => {
    const d = ev.data as { kind?: string; data?: Uint8Array; reason?: string };
    if (d && d.kind === 'close') closeCb(d.reason ?? 'closed');
    else if (d && d.kind === 'pkt' && d.data) msgCb(d.data);
  };
  return {
    send(data) {
      port.postMessage({ kind: 'pkt', data }, [data.buffer]);
    },
    onMessage(cb) { msgCb = cb; },
    onClose(cb) { closeCb = cb; },
    close() {
      port.postMessage({ kind: 'close', reason: 'closed' });
      port.close?.();
    },
  };
}
