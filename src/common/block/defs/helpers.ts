/** Helpers to register whole block families with terse definitions. */
import { registerBlock, BlockSettings, StateView, Block } from '../registry';
import { P, Property } from '../properties';
import {
  cubeTex, cubeBottomTop, cubeColumn, cubeOrientable, RenderShape, Tint, crossElements, Wave, shapeOf, EMPTY_SHAPE,
  planeOn, box, rotateModel,
} from '../model';
import {
  model, slabElements, stairsElements, tex3, Tex3, fenceElements, fenceShape, fenceGateElements, fenceGateShape,
  wallElements, wallShape, paneElements, paneShape, doorElements, doorShape, trapdoorElements, trapdoorBox,
  buttonElements, buttonShape, pressurePlateElements, StairShape, WallSide, AttachFace, flowerPotElements, facingRot,
} from '../shapes';
import { Direction, UP, DOWN, NORTH, SOUTH, WEST, EAST } from '../../world/direction';

export const COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
export type DyeColor = (typeof COLORS)[number];

export const reg = registerBlock;

// ---- settings presets ------------------------------------------------------------------------
export function stoneLike(hardness = 1.5, resistance = 6, extra: BlockSettings = {}): BlockSettings {
  return { hardness, resistance, tool: 'pickaxe', requiresTool: true, sound: 'stone', map: 'stone', push: 'normal', ...extra };
}

export function woodLike(hardness = 2, resistance = 3, extra: BlockSettings = {}): BlockSettings {
  return { hardness, resistance, tool: 'axe', sound: 'wood', map: 'wood', flammable: [5, 20], ...extra };
}

export function dirtLike(hardness = 0.5, extra: BlockSettings = {}): BlockSettings {
  return { hardness, resistance: hardness, tool: 'shovel', sound: 'gravel', map: 'dirt', ...extra };
}

export function plantLike(extra: BlockSettings = {}): BlockSettings {
  return {
    hardness: 0, collision: false, replaceable: false, sound: 'grass', map: 'plant', layer: 'cutout',
    push: 'destroy', offset: 'xz', fluidBreaks: true, occludes: false, wave: Wave.PlantBottom, ...extra,
  };
}

export function metalLike(hardness = 5, resistance = 6, extra: BlockSettings = {}): BlockSettings {
  return { hardness, resistance, tool: 'pickaxe', requiresTool: true, tier: 1, sound: 'metal', map: 'metal', ...extra };
}

// ---- basic registrations ---------------------------------------------------------------------

export function cube(name: string, settings: BlockSettings, tex: string = name): Block {
  return reg(name, [], { ...settings, model: settings.model ?? (() => cubeTex(tex)) });
}

export function cubeBT(name: string, settings: BlockSettings, bottom: string, top: string, side: string): Block {
  return reg(name, [], { ...settings, model: () => cubeBottomTop(bottom, top, side) });
}

export function pillar(name: string, settings: BlockSettings, end = `${name}_top`, side = name): Block {
  return reg(name, [P.axis], { ...settings, model: (s) => cubeColumn(end, side, s.get(P.axis)) });
}

export function horizontalFacing(name: string, settings: BlockSettings, front: string, side: string, top: string, bottom = top, extraProps: Property[] = []): Block {
  return reg(name, [P.facing, ...extraProps], { ...settings, model: settings.model ?? ((s) => cubeOrientable(s.get(P.facing), front, side, top, bottom)) });
}

export function slab(name: string, t: string | Tex3, settings: BlockSettings): Block {
  const tx = tex3(t);
  return reg(name, [P.slabType, P.waterlogged], {
    ...settings,
    model: (s) => model(slabElements(s.get(P.slabType), tx)),
    opacity: undefined,
  });
}

export function stairs(name: string, t: string | Tex3, settings: BlockSettings): Block {
  const tx = tex3(t);
  return reg(name, [P.facing, P.half, P.stairShape, P.waterlogged], {
    ...settings,
    model: (s) => model(stairsElements(s.get(P.facing), s.get(P.half), s.get(P.stairShape) as StairShape, tx)),
  });
}

export function wall(name: string, tex: string, settings: BlockSettings): Block {
  return reg(name, [P.up, P.wallNorth, P.wallEast, P.wallSouth, P.wallWest, P.waterlogged], {
    ...settings, defaults: { up: true },
    tags: [...(settings.tags ?? []), 'walls'],
    model: (s) => model(wallElements(tex, s.get(P.up), s.get(P.wallNorth) as WallSide, s.get(P.wallEast) as WallSide, s.get(P.wallSouth) as WallSide, s.get(P.wallWest) as WallSide)),
    shape: (s) => wallShape(s.get(P.up), s.get(P.wallNorth) as WallSide, s.get(P.wallEast) as WallSide, s.get(P.wallSouth) as WallSide, s.get(P.wallWest) as WallSide),
    outline: (s) => {
      const b: number[][] = [];
      if (s.get(P.up)) b.push([4, 0, 4, 12, 16, 12]);
      const h = (v: string) => (v === 'tall' ? 16 : 14);
      if (s.get(P.wallNorth) !== 'none') b.push([5, 0, 0, 11, h(s.get(P.wallNorth)), 8]);
      if (s.get(P.wallSouth) !== 'none') b.push([5, 0, 8, 11, h(s.get(P.wallSouth)), 16]);
      if (s.get(P.wallWest) !== 'none') b.push([0, 0, 5, 8, h(s.get(P.wallWest)), 11]);
      if (s.get(P.wallEast) !== 'none') b.push([8, 0, 5, 16, h(s.get(P.wallEast)), 11]);
      if (!b.length) b.push([4, 0, 4, 12, 16, 12]);
      return shapeOf(...b);
    },
    occludes: false,
    dynamicShape: true,
  });
}

export function fence(name: string, tex: string, settings: BlockSettings): Block {
  return reg(name, [P.north, P.east, P.south, P.west, P.waterlogged], {
    ...settings,
    tags: [...(settings.tags ?? []), 'fences'],
    model: (s) => model(fenceElements(tex, s.get(P.north), s.get(P.east), s.get(P.south), s.get(P.west))),
    shape: (s) => fenceShape(s.get(P.north), s.get(P.east), s.get(P.south), s.get(P.west)),
    outline: (s) => fenceShape(s.get(P.north), s.get(P.east), s.get(P.south), s.get(P.west), 16),
    occludes: false,
    dynamicShape: true,
  });
}

export function fenceGate(name: string, tex: string, settings: BlockSettings): Block {
  return reg(name, [P.facing, P.open, P.powered, P.inWall], {
    ...settings,
    tags: [...(settings.tags ?? []), 'fence_gates'],
    model: (s) => model(fenceGateElements(tex, s.get(P.facing), s.get(P.open), s.get(P.inWall))),
    shape: (s) => fenceGateShape(s.get(P.facing), s.get(P.open)),
    outline: (s) => {
      const f = s.get(P.facing);
      const top = s.get(P.inWall) ? 13 : 16;
      return f === NORTH || f === SOUTH ? shapeOf([0, 0, 6, 16, top, 10]) : shapeOf([6, 0, 0, 10, top, 16]);
    },
    occludes: false,
  });
}

export function door(name: string, settings: BlockSettings, tex = name.replace(/^waxed_/, '')): Block {
  return reg(name, [P.facing, P.doubleHalf, P.hinge, P.open, P.powered], {
    ...settings,
    layer: 'cutout',
    tags: [...(settings.tags ?? []), 'doors'],
    push: 'destroy',
    model: (s) => model(doorElements(`${tex}_top`, `${tex}_bottom`, s.get(P.doubleHalf) === 'upper', s.get(P.facing), s.get(P.open), s.get(P.hinge) === 'right')),
    shape: (s) => doorShape(s.get(P.facing), s.get(P.open), s.get(P.hinge) === 'right'),
    occludes: false,
  });
}

export function trapdoor(name: string, settings: BlockSettings, tex = name.replace(/^waxed_/, '')): Block {
  return reg(name, [P.facing, P.half, P.open, P.powered, P.waterlogged], {
    ...settings,
    layer: 'cutout',
    tags: [...(settings.tags ?? []), 'trapdoors'],
    model: (s) => model(trapdoorElements(tex, s.get(P.facing), s.get(P.half), s.get(P.open))),
    shape: (s) => shapeOf(trapdoorBox(s.get(P.facing), s.get(P.half), s.get(P.open))),
    occludes: false,
  });
}

export function button(name: string, tex: string, settings: BlockSettings): Block {
  return reg(name, [P.attachFace, P.facing, P.powered], {
    hardness: 0.5, collision: false, push: 'destroy', ...settings,
    tags: [...(settings.tags ?? []), 'buttons'],
    model: (s) => model(buttonElements(tex, s.get(P.attachFace) as AttachFace, s.get(P.facing), s.get(P.powered))),
    outline: (s) => buttonShape(s.get(P.attachFace) as AttachFace, s.get(P.facing), s.get(P.powered)),
    occludes: false,
    fluidBreaks: false,
  });
}

export function pressurePlate(name: string, tex: string, settings: BlockSettings, weighted = false): Block {
  const prop = weighted ? P.power : P.powered;
  return reg(name, [prop], {
    hardness: 0.5, collision: false, push: 'destroy', ...settings,
    tags: [...(settings.tags ?? []), 'pressure_plates'],
    model: (s) => model(pressurePlateElements(tex, weighted ? (s.get(P.power) as number) > 0 : (s.get(P.powered) as boolean))),
    outline: () => shapeOf([1, 0, 1, 15, 1, 15]),
    occludes: false,
  });
}

export function cross(name: string, settings: BlockSettings = {}, tex = name, tint: Tint = Tint.None): Block {
  return reg(name, [], {
    ...plantLike(settings),
    model: () => model(crossElements(tex, tint), false),
    outline: settings.outline ?? (() => shapeOf([2, 0, 2, 14, 13, 14])),
  });
}

/** Two-block-tall plant with an upper and a lower half. */
export function tallPlant(name: string, settings: BlockSettings = {}, tint: Tint = Tint.None): Block {
  return reg(name, [P.doubleHalf], {
    ...plantLike({ replaceable: true, ...settings }),
    wave: (s) => (s.get(P.doubleHalf) === 'upper' ? Wave.PlantTop : Wave.PlantBottom),
    model: (s) => model(crossElements(s.get(P.doubleHalf) === 'upper' ? `${name}_top` : `${name}_bottom`, tint), false),
    outline: () => shapeOf([2, 0, 2, 14, 16, 14]),
  });
}

export function pottedPlant(potName: string, plantTex: string, tint: Tint = Tint.None): Block {
  return reg(potName, [], {
    hardness: 0, sound: 'stone', map: 'none', layer: 'cutout', push: 'destroy', occludes: false,
    model: () => model(flowerPotElements(plantTex, tint)),
    shape: () => shapeOf([5, 0, 5, 11, 6, 11]),
    drops: 'flower_pot', itemId: 'flower_pot',
    tags: ['flower_pots'],
  });
}

export function leaves(name: string, tint: Tint, extra: BlockSettings = {}): Block {
  return reg(name, [P.distance7, P.persistent, P.waterlogged], {
    hardness: 0.2, tool: 'hoe', sound: 'grass', map: 'plant', layer: 'cutout', randomTicks: true,
    flammable: [30, 60], opacity: 1, push: 'destroy', occludes: false, wave: Wave.Leaves,
    spawnable: false, solid: true,
    tags: ['leaves', 'mineable/hoe'],
    ...extra,
    model: () => ({ kind: 'cube', tex: [name, name, name, name, name, name], tint: tint ? [tint, tint, tint, tint, tint, tint] : undefined }),
  });
}

export function sapling(name: string, extra: BlockSettings = {}): Block {
  return reg(name, [P.stage], {
    ...plantLike({ randomTicks: true, tags: ['saplings'], ...extra }),
    offset: 'none',
    model: () => model(crossElements(name), false),
    outline: () => shapeOf([2, 0, 2, 14, 12, 14]),
  });
}

/** Bark texture of a wood type (logs, stems, bamboo). */
export function logTexOf(wood: string): string {
  if (wood === 'crimson' || wood === 'warped') return `${wood}_stem`;
  if (wood === 'bamboo') return 'bamboo_block';
  return `${wood}_log`;
}

export function strippedTexOf(wood: string): string {
  if (wood === 'crimson' || wood === 'warped') return `stripped_${wood}_stem`;
  if (wood === 'bamboo') return 'stripped_bamboo_block';
  return `stripped_${wood}_log`;
}

/** Standing sign (16 rotations) + wall sign + hanging signs for a wood type. */
export function signs(wood: string, planksTex: string, settings: BlockSettings): void {
  const signModel = (rot: number): RenderShape => {
    const board = box([0, 7, 7.25], [16, 15, 8.75], planksTex, { cullEdges: false });
    const post = box([7.25, 0, 7.25], [8.75, 7, 8.75], logTexOf(wood), { cullEdges: false });
    // arbitrary rotation in 22.5° steps: rotate element around Y
    const angle = -(rot * 22.5) % 360;
    const snapped = Math.round(angle / 90) * 90;
    const rest = angle - snapped;
    let els = rotateModel([board, post], 0, ((-snapped % 360) + 360) % 360, false);
    if (rest !== 0) els = els.map((e) => ({ ...e, rot: { axis: 1 as const, angle: -rest, origin: [8, 8, 8] as [number, number, number] } }));
    return model(els);
  };
  reg(`${wood}_sign`, [P.rotation16, P.waterlogged], {
    ...settings, collision: false, hardness: 1, push: 'destroy', occludes: false, blockEntity: 'sign', tags: ['signs', 'standing_signs'],
    model: (s) => signModel(s.get(P.rotation16)),
    outline: () => shapeOf([4, 0, 4, 12, 16, 12]),
  });
  reg(`${wood}_wall_sign`, [P.facing, P.waterlogged], {
    ...settings, collision: false, hardness: 1, push: 'destroy', occludes: false, blockEntity: 'sign', tags: ['signs', 'wall_signs'],
    itemId: `${wood}_sign`, drops: `${wood}_sign`, noItem: true,
    model: (s) => model(facingRot([box([0, 4.5, 14], [16, 12.5, 16], planksTex, { cullEdges: false })], s.get(P.facing))),
    outline: (s) => {
      const f = s.get(P.facing);
      if (f === NORTH) return shapeOf([0, 4.5, 14, 16, 12.5, 16]);
      if (f === SOUTH) return shapeOf([0, 4.5, 0, 16, 12.5, 2]);
      if (f === WEST) return shapeOf([14, 4.5, 0, 16, 12.5, 16]);
      return shapeOf([0, 4.5, 0, 2, 12.5, 16]);
    },
  });
  reg(`${wood}_hanging_sign`, [P.rotation16, P.attached, P.waterlogged], {
    ...settings, collision: false, hardness: 1, push: 'destroy', occludes: false, blockEntity: 'hanging_sign', sound: 'hanging_sign', tags: ['signs', 'hanging_signs'],
    model: (s) => {
      const rot = s.get(P.rotation16);
      const snapped = (Math.round(rot / 4) * 90) % 360;
      return model(rotateModel([
        box([1, 0, 7], [15, 10, 9], strippedTexOf(wood), { cullEdges: false }),
        box([2, 10, 8], [3, 16, 8], 'chain', { cullEdges: false }),
        box([13, 10, 8], [14, 16, 8], 'chain', { cullEdges: false }),
      ], 0, snapped, false));
    },
    outline: () => shapeOf([3, 0, 3, 13, 16, 13]),
  });
  reg(`${wood}_wall_hanging_sign`, [P.facing, P.waterlogged], {
    ...settings, collision: false, hardness: 1, push: 'destroy', occludes: false, blockEntity: 'hanging_sign', sound: 'hanging_sign', tags: ['signs', 'hanging_signs'],
    itemId: `${wood}_hanging_sign`, drops: `${wood}_hanging_sign`, noItem: true,
    model: (s) => model(facingRot([
      box([1, 0, 7], [15, 10, 9], strippedTexOf(wood), { cullEdges: false }),
      box([0, 14, 6], [16, 16, 10], strippedTexOf(wood), { cullEdges: false }),
    ], s.get(P.facing))),
    shape: (s) => (s.get(P.facing) === NORTH || s.get(P.facing) === SOUTH ? shapeOf([0, 14, 6, 16, 16, 10]) : shapeOf([6, 14, 0, 10, 16, 16])),
    outline: (s) => (s.get(P.facing) === NORTH || s.get(P.facing) === SOUTH ? shapeOf([0, 0, 6, 16, 16, 10]) : shapeOf([6, 0, 0, 10, 16, 16])),
  });
}

/** Multiface flat block with 6 boolean face props + waterlogged. */
export function multiface(name: string, settings: BlockSettings, tint: Tint = Tint.None): Block {
  return reg(name, [P.down, P.up, P.north, P.south, P.west, P.east, P.waterlogged], {
    hardness: 0.2, collision: false, replaceable: true, layer: 'cutout', push: 'destroy', occludes: false, fluidBreaks: false,
    ...settings,
    model: (s) => {
      const faces = [s.get(P.down), s.get(P.up), s.get(P.north), s.get(P.south), s.get(P.west), s.get(P.east)];
      const els = [];
      for (let d = 0; d < 6; d++) if (faces[d]) els.push(planeOn(d as Direction, name, 0.8, tint));
      return model(els, false);
    },
    outline: (s) => {
      const b: number[][] = [];
      if (s.get(P.down)) b.push([0, 0, 0, 16, 1, 16]);
      if (s.get(P.up)) b.push([0, 15, 0, 16, 16, 16]);
      if (s.get(P.north)) b.push([0, 0, 0, 16, 16, 1]);
      if (s.get(P.south)) b.push([0, 0, 15, 16, 16, 16]);
      if (s.get(P.west)) b.push([0, 0, 0, 1, 16, 16]);
      if (s.get(P.east)) b.push([15, 0, 0, 16, 16, 16]);
      return b.length ? shapeOf(...b) : EMPTY_SHAPE;
    },
  });
}

/** Six-faced block with per-face boolean props (mushroom blocks). */
export function mushroomBlock(name: string, settings: BlockSettings, outside: string, inside: string): Block {
  return reg(name, [P.down, P.up, P.north, P.south, P.west, P.east], {
    ...settings,
    model: (s) => {
      const f = [s.get(P.down), s.get(P.up), s.get(P.north), s.get(P.south), s.get(P.west), s.get(P.east)];
      return { kind: 'cube', tex: f.map((v) => (v ? outside : inside)) as [string, string, string, string, string, string] };
    },
  });
}

export function directional6(name: string, settings: BlockSettings, front: string, back: string, side: string, extra: Property[] = []): Block {
  return reg(name, [P.facing6, ...extra], {
    ...settings,
    model: settings.model ?? ((s) => cubeDir6(s.get(P.facing6), front, back, side)),
  });
}

export function cubeDir6(facing: Direction, front: string, back: string, side: string): RenderShape {
  const t: [string, string, string, string, string, string] = [side, side, side, side, side, side];
  t[facing] = front;
  t[facing ^ 1] = back;
  const rot = [0, 0, 0, 0, 0, 0];
  if (facing === UP || facing === DOWN) {
    // side textures keep orientation
  } else {
    const r = facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270;
    rot[UP] = r;
    rot[DOWN] = (360 - r) % 360;
  }
  return { kind: 'cube', tex: t, rot };
}

export function stateTex(s: StateView, base: string, prop: Property, map?: Record<string, string>): string {
  const v = String(s.get(prop));
  return map?.[v] ?? `${base}_${v}`;
}

export { P, Tint, Wave, shapeOf, EMPTY_SHAPE, model, box, crossElements, rotateModel, facingRot, UP, DOWN, NORTH, SOUTH, WEST, EAST };
export type { BlockSettings, StateView, Block, Direction };
