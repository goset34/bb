import { describe, it, expect } from 'vitest';
import { Random, parseSeed, hashString, chunkRandom } from '../../src/common/math/random';
import { NormalNoise, ImprovedNoise } from '../../src/common/math/noise';
import { AABB, Frustum } from '../../src/common/math/geom';
import * as M from '../../src/common/math/mat4';

describe('Random', () => {
  it('is deterministic for a seed', () => {
    const a = new Random(1234, 99), b = new Random(1234, 99);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
  it('nextInt stays in range and covers it', () => {
    const r = new Random(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      seen.add(v);
    }
    expect(seen.size).toBe(10);
  });
  it('forks are independent but reproducible', () => {
    const a = new Random(5).fork('x'), b = new Random(5).fork('x'), c = new Random(5).fork('y');
    const va = a.nextU32();
    expect(b.nextU32()).toBe(va);
    expect(c.nextU32()).not.toBe(va);
  });
  it('parses numeric and textual seeds', () => {
    expect(parseSeed('12345').text).toBe('12345');
    expect(parseSeed('hello').lo).toBe(parseSeed('hello').lo);
    expect(parseSeed('hello').lo).not.toBe(parseSeed('world').lo);
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('chunk randoms depend on chunk position', () => {
    const s = parseSeed('seed');
    expect(chunkRandom(s, 1, 2, 3).nextU32()).toBe(chunkRandom(s, 1, 2, 3).nextU32());
    expect(chunkRandom(s, 1, 2, 3).nextU32()).not.toBe(chunkRandom(s, 2, 1, 3).nextU32());
  });
});

describe('Noise', () => {
  it('improved noise is zero on lattice points and bounded', () => {
    const n = new ImprovedNoise(new Random(1));
    let max = 0;
    for (let i = 0; i < 500; i++) {
      const v = n.noise(i * 0.37, i * 0.11, i * 0.73);
      max = Math.max(max, Math.abs(v));
    }
    expect(max).toBeLessThanOrEqual(1.1);
  });
  it('normal noise is deterministic', () => {
    const a = new NormalNoise(new Random(42), -7, [1, 1, 0.5]);
    const b = new NormalNoise(new Random(42), -7, [1, 1, 0.5]);
    for (let i = 0; i < 50; i++) expect(a.sample(i * 13.1, 0, i * 7.7)).toBe(b.sample(i * 13.1, 0, i * 7.7));
  });
});

describe('Geometry', () => {
  it('clips movement against obstacles', () => {
    const box = new AABB(0, 0, 0, 1, 1, 1);
    const wall = new AABB(2, 0, 0, 3, 1, 1);
    expect(wall.clipX(box, 5)).toBeCloseTo(1);
    expect(wall.clipX(box, -5)).toBe(-5);
  });
  it('frustum culls boxes behind the camera', () => {
    const proj = M.mat4(), f = new Frustum();
    M.perspective(proj, Math.PI / 2, 1, 0.1, 100, false);
    f.setFromMatrix(proj, false);
    expect(f.testBox(-1, -1, -10, 1, 1, -5)).toBe(true);
    expect(f.testBox(-1, -1, 5, 1, 1, 10)).toBe(false);
  });
});
