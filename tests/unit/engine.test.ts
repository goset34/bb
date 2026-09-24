import { describe, it, expect, beforeAll } from 'vitest';
import { initRegistries } from '../../src/common/init';
import { S } from '../../src/common/block/registry';
import { Mesher, MeshJob } from '../../src/client/render/mesh/mesher';
import { packAtlas, AtlasData } from '../../src/client/render/textures/atlas';
import { tickLivingMovement, PhysicsWorld } from '../../src/common/entity/physics';
import { makeInput, makePhysics, makeTransform } from '../../src/common/entity/components';
import type { Entity } from '../../src/common/entity/ecs';

beforeAll(() => initRegistries());

const PAD = 18;
function job(fill: (x: number, y: number, z: number) => number): MeshJob {
  const blocks = new Uint16Array(PAD * PAD * PAD);
  for (let y = 0; y < PAD; y++) for (let z = 0; z < PAD; z++) for (let x = 0; x < PAD; x++) {
    blocks[x + z * PAD + y * PAD * PAD] = fill(x - 1, y - 1, z - 1);
  }
  return { id: 1, cx: 0, sy: 4, cz: 0, blocks, light: new Uint8Array(PAD * PAD * PAD).fill(0xf0), biomes: new Uint8Array(PAD * PAD).fill(1), revision: 0 };
}

describe('Mesher', () => {
  const mesher = () => new Mesher(() => 1);
  it('emits nothing for an empty section', () => {
    const r = mesher().mesh(job(() => 0));
    expect(r.empty).toBe(true);
    expect(r.visibility).toBe(0x7fff);
  });
  it('greedy-merges coplanar faces of identical blocks', () => {
    const stone = S('stone');
    const one = mesher().mesh(job((x, y, z) => (x === 4 && y === 4 && z === 4 ? stone : 0)));
    const two = mesher().mesh(job((x, y, z) => ((x === 4 || x === 5) && y === 4 && z === 4 ? stone : 0)));
    expect(one.solidCount).toBeGreaterThan(0);
    expect(two.solidCount).toBe(one.solidCount);
  });
  it('culls hidden faces inside a solid section and blocks visibility through it', () => {
    const r = mesher().mesh(job(() => S('stone')));
    expect(r.solidCount).toBe(0);
    expect(r.visibility).toBe(0);
  });
});

describe('Atlas packing', () => {
  it('packs layers into grid pages when the layer limit is small', () => {
    const size = 2, layers = 5;
    const mip0 = new Uint8Array(size * size * 4 * layers);
    for (let l = 0; l < layers; l++) mip0.fill(l + 1, l * 16, l * 16 + 16);
    const mip1 = new Uint8Array(4 * layers);
    for (let l = 0; l < layers; l++) mip1.fill(l + 1, l * 4, l * 4 + 4);
    const a: AtlasData = { size, layers, mips: 2, albedo: [mip0, mip1], normal: [mip0, mip1], material: [mip0, mip1], index: {}, missing: [] };
    const p = packAtlas(a, 2, 1024);
    expect(p.grid).toBe(2);
    expect(p.pages).toBe(2);
    expect(p.pageSize).toBe(4);
    // Tile 3 is the bottom-right tile of page 0; tile 4 is the top-left of page 1.
    expect(p.albedo[0]![(3 * 4 + 3) * 4]).toBe(4);
    expect(p.albedo[0]![(4 * 4 * 1) * 4 * 1 + 0]).toBe(5);
    expect(p.albedo[1]![(1 * 2 + 1) * 4]).toBe(4);
  });
  it('keeps one tile per layer when the device allows it', () => {
    const a: AtlasData = { size: 16, layers: 3, mips: 1, albedo: [new Uint8Array(3072)], normal: [new Uint8Array(3072)], material: [new Uint8Array(3072)], index: {}, missing: [] };
    expect(packAtlas(a, 256, 8192).grid).toBe(1);
  });
});

describe('Physics', () => {
  const world: PhysicsWorld = { getBlockState: (_x, y) => (y < 64 ? S('stone') : 0) };
  it('falls under gravity and lands on the ground', () => {
    const e = { id: 1, type: 'player', removed: false, transform: makeTransform(0.5, 70, 0.5), physics: makePhysics(0.6, 1.8, 1.62), input: makeInput(0.1) } as Entity & Required<Pick<Entity, 'transform' | 'physics' | 'input'>>;
    let ticks = 0;
    while (!e.physics.onGround && ticks < 100) { tickLivingMovement(world, e); ticks++; }
    expect(e.physics.onGround).toBe(true);
    expect(e.transform.y).toBeCloseTo(64, 5);
    // Falling 6 blocks takes ~ 12 ticks with reference gravity/drag.
    expect(ticks).toBeGreaterThan(8);
    expect(ticks).toBeLessThan(16);
  });
  it('walks forward and is stopped by a wall', () => {
    const wall: PhysicsWorld = { getBlockState: (x, y) => (y < 64 || (x >= 3 && y < 66) ? S('stone') : 0) };
    const e = { id: 2, type: 'player', removed: false, transform: makeTransform(0.5, 64, 0.5, -90), physics: makePhysics(0.6, 1.8, 1.62), input: makeInput(0.1) } as Entity & Required<Pick<Entity, 'transform' | 'physics' | 'input'>>;
    e.physics.onGround = true;
    e.input.forward = 1;
    for (let i = 0; i < 60; i++) tickLivingMovement(wall, e);
    expect(e.transform.x).toBeCloseTo(3 - 0.3, 5);
    expect(e.physics.horizontalCollision).toBe(true);
  });
});
