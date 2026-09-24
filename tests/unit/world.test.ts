import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries, registryChecksum } from '../../src/common/init';
import { S, getBlock, getValue, setValue, stateToString, parseState, STATE_COUNT, stateFlags, F } from '../../src/common/block/registry';
import { P } from '../../src/common/block/properties';
import { Section } from '../../src/common/world/section';
import { Chunk } from '../../src/common/world/chunk';
import { DIMENSIONS } from '../../src/common/world/dimension';
import { serializeChunk, deserializeChunk } from '../../src/common/world/chunkio';
import { ByteReader, ByteWriter, crc32 } from '../../src/common/util/bytes';
import { RegionFile } from '../../src/server/storage/region';
import { writeZip, readZip } from '../../src/common/util/zip';

beforeAll(() => initRegistries());

describe('Block registry', () => {
  it('registers a large, stable state space', () => {
    expect(STATE_COUNT).toBeGreaterThan(20000);
    expect(registryChecksum()).toBe(registryChecksum());
    expect(S('air')).toBe(0);
  });
  it('round-trips state strings', () => {
    const stairs = setValue(S('oak_stairs'), P.facing, 4);
    const str = stateToString(stairs);
    expect(parseState(str)).toBe(stairs);
    expect(getValue(stairs, P.facing)).toBe(4);
  });
  it('uses sensible defaults', () => {
    expect(getValue(S('oak_log'), P.axis)).toBe('y');
    expect(getValue(S('oak_slab'), P.slabType)).toBe('bottom');
    expect(stateFlags[S('stone')]! & F.OPAQUE_CUBE).toBeTruthy();
    expect(stateFlags[S('glass')]! & F.OPAQUE_CUBE).toBeFalsy();
    expect(getBlock('water')).toBeDefined();
  });
});

describe('Section', () => {
  it('grows its palette and reads back values', () => {
    const s = new Section();
    const states = [S('stone'), S('dirt'), S('oak_planks'), S('glass')];
    for (let i = 0; i < 4096; i++) s.set(i, states[i % 4]!);
    for (let i = 0; i < 4096; i++) expect(s.get(i)).toBe(states[i % 4]);
    s.fill(S('stone'));
    expect(s.isUniform).toBe(true);
  });
  it('serializes with light', () => {
    const s = new Section();
    s.setXYZ(1, 2, 3, S('glowstone'));
    s.setBlockLight(5, 12);
    s.setSky(6, 9);
    const w = new ByteWriter(1024);
    s.write(w, true);
    const r = Section.read(new ByteReader(w.finish()), true);
    expect(r.getXYZ(1, 2, 3)).toBe(S('glowstone'));
    expect(r.getBlockLight(5)).toBe(12);
    expect(r.getSky(6)).toBe(9);
  });
});

describe('Chunk storage', () => {
  it('round-trips a chunk through the named-palette format', () => {
    const c = new Chunk(3, -2, DIMENSIONS.overworld!);
    c.setBlock(0, -64, 0, S('bedrock'));
    c.setBlock(5, 70, 9, S('oak_log'));
    c.setBlock(15, 319, 15, S('stone'));
    c.extra.test = 42;
    const back = deserializeChunk(serializeChunk(c), DIMENSIONS.overworld!);
    expect(back.getBlock(0, -64, 0)).toBe(S('bedrock'));
    expect(back.getBlock(5, 70, 9)).toBe(S('oak_log'));
    expect(back.getBlock(15, 319, 15)).toBe(S('stone'));
    expect(back.extra.test).toBe(42);
  });
  it('stores chunks in region files with compression', async () => {
    const rf = new RegionFile();
    const payload = new Uint8Array(20000).map((_, i) => i % 7);
    await rf.write(1, 2, payload);
    await rf.write(31, 31, new Uint8Array([1, 2, 3]));
    const reopened = new RegionFile(rf.bytes());
    expect(reopened.chunkCount()).toBe(2);
    expect(await reopened.read(1, 2)).toEqual(payload);
    expect(await reopened.read(31, 31)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await reopened.read(0, 0)).toBeNull();
  });
  it('writes and reads zip archives', async () => {
    const zip = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hola') }, { name: 'dir/b.bin', data: new Uint8Array([9, 8, 7]) }]);
    const back = await readZip(zip);
    expect(new TextDecoder().decode(back.find((f) => f.name === 'a.txt')!.data)).toBe('hola');
    expect(back.find((f) => f.name === 'dir/b.bin')!.data).toEqual(new Uint8Array([9, 8, 7]));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
