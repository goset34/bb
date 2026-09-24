import { describe, it, expect } from 'vitest';
import { S2C, C2S } from '../../src/common/net/protocol';

describe('Protocol', () => {
  it('encodes and decodes server packets', () => {
    const p = { type: 'blockUpdate', x: -123456, y: -64, z: 987654, state: 31000 };
    expect(S2C.decode(S2C.encode(p))).toEqual(p);
    const m = { type: 'multiBlockUpdate', cx: -3, sy: 4, cz: 7, entries: new Int32Array([1, 65537, 4095 * 65536 + 12]) };
    expect(S2C.decode(S2C.encode(m))).toEqual(m);
  });
  it('encodes and decodes client packets', () => {
    const chat = { type: 'chat', message: '¡Hola, mundo! /tp @s ~ ~1 ~' };
    expect(C2S.decode(C2S.encode(chat))).toEqual(chat);
  });
  it('rejects unknown packets', () => {
    expect(() => S2C.encode({ type: 'nope' })).toThrow();
  });
});
