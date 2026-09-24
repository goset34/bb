/**
 * Model builders for non-cubic blocks. Each returns elements authored in 1/16 units; the
 * rotation helpers orient them. Collision shapes default to the union of element boxes and
 * are overridden where the reference behaviour differs (fences are 1.5 tall, etc.).
 */
import {
  Element, Face, Tint, box, crossElements, planeOn, rotateModel, shapeOf, Shape, RenderShape, defaultUV,
} from './model';
import { Direction, DOWN, UP, NORTH, SOUTH, WEST, EAST } from '../world/direction';

export interface Tex3 {
  top: string;
  bottom: string;
  side: string;
}

export function tex3(t: string | Tex3): Tex3 {
  return typeof t === 'string' ? { top: t, bottom: t, side: t } : t;
}

function faceTex(t: Tex3): Partial<Record<Direction, string>> {
  return { [DOWN]: t.bottom, [UP]: t.top, [NORTH]: t.side, [SOUTH]: t.side, [WEST]: t.side, [EAST]: t.side };
}

export function model(elements: Element[], ao = true): RenderShape {
  return { kind: 'model', elements, ao };
}

// ---------------------------------------------------------------------------------------------
// Slabs & stairs
// ---------------------------------------------------------------------------------------------

export function slabElements(type: 'top' | 'bottom' | 'double', t: Tex3): Element[] {
  if (type === 'double') return [box([0, 0, 0], [16, 16, 16], faceTex(t))];
  if (type === 'bottom') return [box([0, 0, 0], [16, 8, 16], faceTex(t))];
  return [box([0, 8, 0], [16, 16, 16], faceTex(t))];
}

export type StairShape = 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right';

export function stairsElements(facing: Direction, half: 'top' | 'bottom', shape: StairShape, t: Tex3): Element[] {
  const ft = faceTex(t);
  const els: Element[] = [box([0, 0, 0], [16, 8, 16], ft)];
  // Authored facing east (step on the east half).
  if (shape === 'straight') els.push(box([8, 8, 0], [16, 16, 16], ft));
  else if (shape === 'inner_left' || shape === 'inner_right') {
    els.push(box([8, 8, 0], [16, 16, 16], ft));
    els.push(box([0, 8, 8], [8, 16, 16], ft));
  } else {
    els.push(box([8, 8, 8], [16, 16, 16], ft));
  }
  const base = facing === EAST ? 0 : facing === SOUTH ? 90 : facing === WEST ? 180 : 270;
  const left = shape === 'inner_left' || shape === 'outer_left';
  const right = shape === 'inner_right' || shape === 'outer_right';
  let y: number;
  let x = 0;
  if (half === 'bottom') y = base + (left ? -90 : 0);
  else {
    x = 180;
    y = base + (right ? 90 : 0);
  }
  return rotateModel(els, x, (y + 360) % 360, true);
}

// ---------------------------------------------------------------------------------------------
// Fences, walls, panes
// ---------------------------------------------------------------------------------------------

export function fenceElements(tex: string, n: boolean, e: boolean, s: boolean, w: boolean): Element[] {
  const els: Element[] = [box([6, 0, 6], [10, 16, 10], tex)];
  const arm = (): Element[] => [box([7, 12, 0], [9, 15, 6], tex, { cullEdges: false }), box([7, 6, 0], [9, 9, 6], tex, { cullEdges: false })];
  const sides: Array<[boolean, number]> = [[n, 0], [e, 90], [s, 180], [w, 270]];
  for (const [on, rot] of sides) if (on) els.push(...rotateModel(arm(), 0, rot, true));
  return els;
}

export function fenceShape(n: boolean, e: boolean, s: boolean, w: boolean, height = 24): Shape {
  const b: number[][] = [[6, 0, 6, 10, height, 10]];
  if (n) b.push([6, 0, 0, 10, height, 6]);
  if (s) b.push([6, 0, 10, 10, height, 16]);
  if (w) b.push([0, 0, 6, 6, height, 10]);
  if (e) b.push([10, 0, 6, 16, height, 10]);
  return shapeOf(...b);
}

export function fenceGateElements(tex: string, facing: Direction, open: boolean, inWall: boolean): Element[] {
  const dy = inWall ? -3 : 0;
  const y = (v: number) => v + dy;
  let els: Element[] = [
    box([0, y(5), 7], [2, y(16), 9], tex, { cullEdges: false }),
    box([14, y(5), 7], [16, y(16), 9], tex, { cullEdges: false }),
  ];
  if (!open) {
    els.push(
      box([6, y(6), 7], [8, y(15), 9], tex, { cullEdges: false }),
      box([8, y(6), 7], [10, y(15), 9], tex, { cullEdges: false }),
      box([2, y(6), 7], [6, y(9), 9], tex, { cullEdges: false }),
      box([2, y(12), 7], [6, y(15), 9], tex, { cullEdges: false }),
      box([10, y(6), 7], [14, y(9), 9], tex, { cullEdges: false }),
      box([10, y(12), 7], [14, y(15), 9], tex, { cullEdges: false }),
    );
  } else {
    els.push(
      box([0, y(6), 13], [2, y(15), 15], tex, { cullEdges: false }),
      box([14, y(6), 13], [16, y(15), 15], tex, { cullEdges: false }),
      box([0, y(6), 9], [2, y(9), 13], tex, { cullEdges: false }),
      box([0, y(12), 9], [2, y(15), 13], tex, { cullEdges: false }),
      box([14, y(6), 9], [16, y(9), 13], tex, { cullEdges: false }),
      box([14, y(12), 9], [16, y(15), 13], tex, { cullEdges: false }),
    );
  }
  // authored facing south
  const rot = facing === SOUTH ? 0 : facing === WEST ? 90 : facing === NORTH ? 180 : 270;
  els = rotateModel(els, 0, rot, true);
  return els;
}

export function fenceGateShape(facing: Direction, open: boolean): Shape {
  if (open) return shapeOf();
  if (facing === NORTH || facing === SOUTH) return shapeOf([0, 0, 6, 16, 24, 10]);
  return shapeOf([6, 0, 0, 10, 24, 16]);
}

export type WallSide = 'none' | 'low' | 'tall';

export function wallElements(tex: string, up: boolean, n: WallSide, e: WallSide, s: WallSide, w: WallSide): Element[] {
  const els: Element[] = [];
  if (up) els.push(box([4, 0, 4], [12, 16, 12], tex));
  const sides: Array<[WallSide, number]> = [[n, 0], [e, 90], [s, 180], [w, 270]];
  for (const [side, rot] of sides) {
    if (side === 'none') continue;
    const h = side === 'tall' ? 16 : 14;
    els.push(...rotateModel([box([5, 0, 0], [11, h, 8], tex)], 0, rot, true));
  }
  return els;
}

export function wallShape(up: boolean, n: WallSide, e: WallSide, s: WallSide, w: WallSide): Shape {
  const b: number[][] = [];
  if (up) b.push([4, 0, 4, 12, 24, 12]);
  if (n !== 'none') b.push([5, 0, 0, 11, 24, 8]);
  if (s !== 'none') b.push([5, 0, 8, 11, 24, 16]);
  if (w !== 'none') b.push([0, 0, 5, 8, 24, 11]);
  if (e !== 'none') b.push([8, 0, 5, 16, 24, 11]);
  if (!b.length) b.push([4, 0, 4, 12, 24, 12]);
  return shapeOf(...b);
}

export function paneElements(tex: string, edge: string, n: boolean, e: boolean, s: boolean, w: boolean): Element[] {
  const els: Element[] = [];
  const post: Element = {
    from: [7, 0, 7], to: [9, 16, 9],
    faces: {
      [DOWN]: { tex: edge, cull: DOWN }, [UP]: { tex: edge, cull: UP },
    },
  };
  if (!n && !e && !s && !w) {
    // Lone pane: full cross
    els.push(box([7, 0, 0], [9, 16, 16], { [NORTH]: tex, [SOUTH]: tex, [WEST]: tex, [EAST]: tex, [UP]: edge, [DOWN]: edge }));
    els.push(box([0, 0, 7], [16, 16, 9], { [NORTH]: tex, [SOUTH]: tex, [WEST]: tex, [EAST]: tex, [UP]: edge, [DOWN]: edge }));
    return els;
  }
  els.push(post);
  const side = (): Element => box([7, 0, 0], [9, 16, 7], { [WEST]: tex, [EAST]: tex, [NORTH]: edge, [UP]: edge, [DOWN]: edge });
  const sides: Array<[boolean, number]> = [[n, 0], [e, 90], [s, 180], [w, 270]];
  for (const [on, rot] of sides) if (on) els.push(...rotateModel([side()], 0, rot, false));
  // Faces of the post not covered by arms
  const pf = post.faces;
  if (!n) pf[NORTH] = { tex, uv: [7, 0, 9, 16] };
  if (!s) pf[SOUTH] = { tex, uv: [7, 0, 9, 16] };
  if (!w) pf[WEST] = { tex, uv: [7, 0, 9, 16] };
  if (!e) pf[EAST] = { tex, uv: [7, 0, 9, 16] };
  return els;
}

export function paneShape(n: boolean, e: boolean, s: boolean, w: boolean): Shape {
  const b: number[][] = [[7, 0, 7, 9, 16, 9]];
  if (!n && !e && !s && !w) return shapeOf([7, 0, 0, 9, 16, 16], [0, 0, 7, 16, 16, 9]);
  if (n) b.push([7, 0, 0, 9, 16, 7]);
  if (s) b.push([7, 0, 9, 9, 16, 16]);
  if (w) b.push([0, 0, 7, 7, 16, 9]);
  if (e) b.push([9, 0, 7, 16, 16, 9]);
  return shapeOf(...b);
}

// ---------------------------------------------------------------------------------------------
// Doors & trapdoors
// ---------------------------------------------------------------------------------------------

const DOOR_BOX: Record<number, number[]> = {
  [SOUTH]: [0, 0, 0, 16, 16, 3],
  [NORTH]: [0, 0, 13, 16, 16, 16],
  [WEST]: [13, 0, 0, 16, 16, 16],
  [EAST]: [0, 0, 0, 3, 16, 16],
};

export function doorBoxDir(facing: Direction, open: boolean, hingeRight: boolean): Direction {
  if (!open) return facing;
  switch (facing) {
    case EAST: return hingeRight ? NORTH : SOUTH;
    case SOUTH: return hingeRight ? EAST : WEST;
    case WEST: return hingeRight ? SOUTH : NORTH;
    default: return hingeRight ? WEST : EAST;
  }
}

export function doorElements(texTop: string, texBottom: string, upper: boolean, facing: Direction, open: boolean, hingeRight: boolean): Element[] {
  const d = doorBoxDir(facing, open, hingeRight);
  const b = DOOR_BOX[d]!;
  const tex = upper ? texTop : texBottom;
  const el = box([b[0]!, b[1]!, b[2]!], [b[3]!, b[4]!, b[5]!], tex, { cullEdges: true });
  // Large faces show the full texture; mirror depending on hinge so the handle is correct.
  const mirror = hingeRight !== open;
  for (const k of Object.keys(el.faces)) {
    const dir = Number(k) as Direction;
    const f = el.faces[dir]!;
    const big = (d === NORTH || d === SOUTH) ? (dir === NORTH || dir === SOUTH) : (dir === WEST || dir === EAST);
    if (big) f.uv = mirror ? [16, 0, 0, 16] : [0, 0, 16, 16];
    else if (dir === UP || dir === DOWN) f.uv = [0, 0, 16, 3];
    else f.uv = [0, 0, 3, 16];
    if (upper && dir === DOWN) delete el.faces[dir];
    if (!upper && dir === UP) delete el.faces[dir];
  }
  return [el];
}

export function doorShape(facing: Direction, open: boolean, hingeRight: boolean): Shape {
  const b = DOOR_BOX[doorBoxDir(facing, open, hingeRight)]!;
  return shapeOf(b);
}

export function trapdoorBox(facing: Direction, half: 'top' | 'bottom', open: boolean): number[] {
  if (!open) return half === 'top' ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16];
  switch (facing) {
    case NORTH: return [0, 0, 13, 16, 16, 16];
    case SOUTH: return [0, 0, 0, 16, 16, 3];
    case WEST: return [13, 0, 0, 16, 16, 16];
    default: return [0, 0, 0, 3, 16, 16];
  }
}

export function trapdoorElements(tex: string, facing: Direction, half: 'top' | 'bottom', open: boolean): Element[] {
  const b = trapdoorBox(facing, half, open);
  const el = box([b[0]!, b[1]!, b[2]!], [b[3]!, b[4]!, b[5]!], tex);
  for (const k of Object.keys(el.faces)) {
    const dir = Number(k) as Direction;
    const f = el.faces[dir]!;
    const sx = b[3]! - b[0]!, sy = b[4]! - b[1]!, sz = b[5]! - b[2]!;
    const thinAxis = sx < 16 ? 'x' : sy < 16 ? 'y' : 'z';
    const bigFace = (thinAxis === 'y' && (dir === UP || dir === DOWN)) || (thinAxis === 'z' && (dir === NORTH || dir === SOUTH)) || (thinAxis === 'x' && (dir === WEST || dir === EAST));
    f.uv = bigFace ? [0, 0, 16, 16] : [0, 0, 16, 3];
    if (!bigFace && thinAxis !== 'y' && (dir === UP || dir === DOWN)) f.uv = [0, 0, 16, 3];
    void sz;
  }
  return [el];
}

// ---------------------------------------------------------------------------------------------
// Torches, lanterns, buttons, plates, levers
// ---------------------------------------------------------------------------------------------

export function torchElements(tex: string): Element[] {
  return [{
    from: [7, 0, 7], to: [9, 10, 9], shade: false,
    faces: {
      [DOWN]: { tex, uv: [7, 13, 9, 15] },
      [UP]: { tex, uv: [7, 6, 9, 8], emissive: true },
      [NORTH]: { tex, uv: [7, 6, 9, 16] },
      [SOUTH]: { tex, uv: [7, 6, 9, 16] },
      [WEST]: { tex, uv: [7, 6, 9, 16] },
      [EAST]: { tex, uv: [7, 6, 9, 16] },
    },
  }];
}

/** Wall torch: tilted away from the wall it is attached to. `facing` points away from the wall. */
export function wallTorchElements(tex: string, facing: Direction): Element[] {
  const el: Element = {
    from: [-1, 3.5, 7], to: [1, 13.5, 9], shade: false,
    rot: { axis: 2, angle: -22.5, origin: [0, 3.5, 8] },
    faces: {
      [DOWN]: { tex, uv: [7, 13, 9, 15] },
      [UP]: { tex, uv: [7, 6, 9, 8], emissive: true },
      [NORTH]: { tex, uv: [7, 6, 9, 16] },
      [SOUTH]: { tex, uv: [7, 6, 9, 16] },
      [WEST]: { tex, uv: [7, 6, 9, 16] },
      [EAST]: { tex, uv: [7, 6, 9, 16] },
    },
  };
  // authored facing east (wall on the west side)
  const y = facing === EAST ? 0 : facing === SOUTH ? 90 : facing === WEST ? 180 : 270;
  return rotateModel([el], 0, y, false);
}

export function lanternElements(tex: string, hanging: boolean): Element[] {
  const oy = hanging ? 1 : 0;
  return [
    box([5, oy, 5], [11, 7 + oy, 11], tex, { cullEdges: false }),
    box([6, 7 + oy, 6], [10, 9 + oy, 10], tex, { cullEdges: false }),
    { from: [6.5, 9 + oy, 8], to: [9.5, hanging ? 15 + oy : 11, 8], shade: false, rot: { axis: 1, angle: 45, origin: [8, 8, 8] }, faces: { [NORTH]: { tex, uv: [14, 1, 11, 3] }, [SOUTH]: { tex, uv: [11, 1, 14, 3] } } },
  ];
}

export function lanternShape(hanging: boolean): Shape {
  return hanging ? shapeOf([5, 1, 5, 11, 8, 11], [6, 8, 6, 10, 10, 10]) : shapeOf([5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]);
}

export type AttachFace = 'floor' | 'wall' | 'ceiling';

/** Rotation for face-attached blocks (buttons, levers, grindstones) authored on the floor facing north. */
export function attachRotation(face: AttachFace, facing: Direction): [number, number] {
  const yr = facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270;
  if (face === 'floor') return [0, yr];
  if (face === 'ceiling') return [180, (yr + 180) % 360];
  return [90, yr];
}

export function buttonElements(tex: string, face: AttachFace, facing: Direction, powered: boolean): Element[] {
  const h = powered ? 1 : 2;
  const el = box([5, 0, 6], [11, h, 10], tex, { cullEdges: false });
  const [x, y] = attachRotation(face, facing);
  return rotateModel([el], x, y, false);
}

export function buttonShape(face: AttachFace, facing: Direction, powered: boolean): Shape {
  const h = powered ? 1 : 2;
  const els = buttonElements('x', face, facing, powered);
  void h;
  const e = els[0]!;
  return shapeOf([e.from[0], e.from[1], e.from[2], e.to[0], e.to[1], e.to[2]]);
}

export function pressurePlateElements(tex: string, pressed: boolean): Element[] {
  return [box([1, 0, 1], [15, pressed ? 0.5 : 1, 15], tex)];
}

export function leverElements(baseTex: string, handleTex: string, face: AttachFace, facing: Direction, powered: boolean): Element[] {
  const base = box([5, 0, 4], [11, 3, 12], baseTex, { cullEdges: false });
  const handle: Element = {
    from: [7, 1, 7], to: [9, 11, 9],
    rot: { axis: 0, angle: powered ? 45 : -45, origin: [8, 1, 8] },
    faces: {
      [UP]: { tex: handleTex, uv: [7, 6, 9, 8] },
      [NORTH]: { tex: handleTex, uv: [7, 6, 9, 16] },
      [SOUTH]: { tex: handleTex, uv: [7, 6, 9, 16] },
      [WEST]: { tex: handleTex, uv: [7, 6, 9, 16] },
      [EAST]: { tex: handleTex, uv: [7, 6, 9, 16] },
    },
  };
  const [x, y] = attachRotation(face, facing);
  return rotateModel([base, handle], x, y, false);
}

// ---------------------------------------------------------------------------------------------
// Misc shapes
// ---------------------------------------------------------------------------------------------

export function carpetElements(tex: string, h = 1): Element[] {
  return [box([0, 0, 0], [16, h, 16], tex)];
}

export function snowLayerElements(tex: string, layers: number): Element[] {
  if (layers >= 8) return [box([0, 0, 0], [16, 16, 16], tex)];
  return [box([0, 0, 0], [16, layers * 2, 16], tex)];
}

export function ladderElements(tex: string, facing: Direction): Element[] {
  // facing north → ladder on the south side of its block
  const opposite: Record<number, Direction> = { [NORTH]: SOUTH, [SOUTH]: NORTH, [WEST]: EAST, [EAST]: WEST };
  const el = planeOn(opposite[facing]!, tex, 0.8);
  return [el];
}

export function ladderShape(facing: Direction): Shape {
  switch (facing) {
    case NORTH: return shapeOf([0, 0, 13, 16, 16, 16]);
    case SOUTH: return shapeOf([0, 0, 0, 16, 16, 3]);
    case WEST: return shapeOf([13, 0, 0, 16, 16, 16]);
    default: return shapeOf([0, 0, 0, 3, 16, 16]);
  }
}

/** Multi-face flat block (vine, glow lichen, echo vein). faces = [down, up, north, south, west, east]. */
export function multifaceElements(tex: string, faces: readonly boolean[], tint: Tint = Tint.None): Element[] {
  const els: Element[] = [];
  for (let d = 0; d < 6; d++) if (faces[d]) els.push(planeOn(d as Direction, tex, 0.8, tint));
  return els;
}

export function cactusElements(side: string, top: string, bottom: string): Element[] {
  return [
    { from: [0, 0, 0], to: [16, 16, 16], faces: { [DOWN]: { tex: bottom, cull: DOWN }, [UP]: { tex: top, cull: UP } } },
    { from: [0, 0, 1], to: [16, 16, 15], faces: { [NORTH]: { tex: side }, [SOUTH]: { tex: side } } },
    { from: [1, 0, 0], to: [15, 16, 16], faces: { [WEST]: { tex: side }, [EAST]: { tex: side } } },
  ];
}

export function railElements(tex: string, shape: string): Element[] {
  const flat = (rot: 0 | 90 | 180 | 270): Element => ({
    from: [0, 1, 0], to: [16, 1, 16], shade: false,
    faces: { [UP]: { tex, rot }, [DOWN]: { tex, rot, uv: [0, 16, 16, 0] } },
  });
  const ascending = (dir: Direction): Element[] => {
    const el: Element = {
      from: [0, 9, 0], to: [16, 9, 16], shade: false,
      rot: { axis: 0, angle: 45, origin: [8, 9, 8], rescale: true },
      faces: { [UP]: { tex }, [DOWN]: { tex, uv: [0, 16, 16, 0] } },
    };
    // authored ascending north
    const y = dir === NORTH ? 0 : dir === EAST ? 90 : dir === SOUTH ? 180 : 270;
    return rotateModel([el], 0, y, false);
  };
  switch (shape) {
    case 'north_south': return [flat(0)];
    case 'east_west': return [flat(90)];
    case 'ascending_north': return ascending(NORTH);
    case 'ascending_south': return ascending(SOUTH);
    case 'ascending_east': return ascending(EAST);
    case 'ascending_west': return ascending(WEST);
    case 'south_east': return [flat(0)];
    case 'south_west': return [flat(90)];
    case 'north_west': return [flat(180)];
    case 'north_east': return [flat(270)];
  }
  return [flat(0)];
}

/** Flux dust (redstone-like wire). sides: 'none'|'side'|'up' for n,e,s,w. */
export function wireElements(sides: readonly string[]): Element[] {
  const els: Element[] = [];
  const [n, e, s, w] = sides as [string, string, string, string];
  const conn = [n !== 'none', e !== 'none', s !== 'none', w !== 'none'];
  const count = conn.filter(Boolean).length;
  const face = (tex: string, rot: 0 | 90 | 180 | 270 = 0): Face => ({ tex, tint: Tint.Wire, rot });
  const y = 0.25;
  if (count === 0) {
    // Isolated dot + cross ("plus") look
    els.push({ from: [0, y, 0], to: [16, y, 16], shade: false, faces: { [UP]: face('flux_dust_dot') } });
    return els;
  }
  // Centre dot always
  els.push({ from: [0, y, 0], to: [16, y, 16], shade: false, faces: { [UP]: face('flux_dust_dot') } });
  const ns = conn[0] || conn[2];
  const ew = conn[1] || conn[3];
  // A lone direction extends through the whole block (straight line), as in the reference
  const fullNS = ns && !ew;
  const fullEW = ew && !ns;
  const seg = (dir: number) => {
    const rot: 0 | 90 = dir === 0 || dir === 2 ? 0 : 90;
    const el: Element = { from: [0, y + 0.01, 0], to: [16, y + 0.01, 16], shade: false, faces: { [UP]: { ...face('flux_dust_line', rot) } } };
    // Crop to half
    const f = el.faces[UP]!;
    if (dir === 0) { el.from = [0, y + 0.01, 0]; el.to = [16, y + 0.01, 8]; f.uv = [0, 0, 16, 8]; }
    if (dir === 2) { el.from = [0, y + 0.01, 8]; el.to = [16, y + 0.01, 16]; f.uv = [0, 8, 16, 16]; }
    if (dir === 3) { el.from = [0, y + 0.01, 0]; el.to = [8, y + 0.01, 16]; f.uv = [0, 0, 16, 8]; }
    if (dir === 1) { el.from = [8, y + 0.01, 0]; el.to = [16, y + 0.01, 16]; f.uv = [0, 8, 16, 16]; }
    return el;
  };
  if (fullNS) { els.push(seg(0), seg(2)); }
  else if (fullEW) { els.push(seg(1), seg(3)); }
  else for (let i = 0; i < 4; i++) if (conn[i]) els.push(seg(i));
  // Vertical 'up' segments climbing the neighbouring wall
  const upDirs: Array<[string, Direction]> = [[n, NORTH], [e, EAST], [s, SOUTH], [w, WEST]];
  for (const [v, d] of upDirs) {
    if (v !== 'up') continue;
    const el = planeOn(d, 'flux_dust_line', 0.25, Tint.Wire);
    for (const k of Object.keys(el.faces)) (el.faces[Number(k) as Direction] as Face).rot = 90;
    els.push(el);
  }
  return els;
}

export function wireShape(): Shape {
  return shapeOf([3, 0, 3, 13, 1, 13]);
}

export function repeaterElements(facing: Direction, delay: number, powered: boolean, locked: boolean): Element[] {
  const tex = powered ? 'repeater_on' : 'repeater';
  const torch = powered ? 'flux_torch' : 'flux_torch_off';
  const base: Element = { from: [0, 0, 0], to: [16, 2, 16], faces: { [DOWN]: { tex: 'smooth_stone', cull: DOWN }, [UP]: { tex }, [NORTH]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: NORTH }, [SOUTH]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: SOUTH }, [WEST]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: WEST }, [EAST]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: EAST } } };
  const t = (z: number, emissive: boolean): Element => ({
    from: [7, 2, z], to: [9, 7, z + 2],
    faces: {
      [UP]: { tex: torch, uv: [7, 6, 9, 8], emissive },
      [NORTH]: { tex: torch, uv: [7, 6, 9, 11], emissive }, [SOUTH]: { tex: torch, uv: [7, 6, 9, 11], emissive },
      [WEST]: { tex: torch, uv: [7, 6, 9, 11], emissive }, [EAST]: { tex: torch, uv: [7, 6, 9, 11], emissive },
    },
  });
  const els: Element[] = [base, t(2, powered)];
  const dz = 6 + (delay - 1) * 2;
  if (locked) els.push(box([2, 2, dz], [14, 4, dz + 2], 'bedrock', { cullEdges: false }));
  else els.push(t(dz, powered));
  // authored facing north (output north? the reference outputs toward facing opposite). We treat facing = direction of input side.
  return rotateModel(els, 0, (180 + (facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270)) % 360, false);
}

export function comparatorElements(facing: Direction, subtract: boolean, powered: boolean): Element[] {
  const tex = powered ? 'comparator_on' : 'comparator';
  const base: Element = { from: [0, 0, 0], to: [16, 2, 16], faces: { [DOWN]: { tex: 'smooth_stone', cull: DOWN }, [UP]: { tex }, [NORTH]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: NORTH }, [SOUTH]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: SOUTH }, [WEST]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: WEST }, [EAST]: { tex: 'smooth_stone', uv: [0, 14, 16, 16], cull: EAST } } };
  const t = (x: number, z: number, lit: boolean, h: number): Element => {
    const tt = lit ? 'flux_torch' : 'flux_torch_off';
    return {
      from: [x, 2, z], to: [x + 2, 2 + h, z + 2],
      faces: {
        [UP]: { tex: tt, uv: [7, 6, 9, 8], emissive: lit },
        [NORTH]: { tex: tt, uv: [7, 6, 9, 6 + h], emissive: lit }, [SOUTH]: { tex: tt, uv: [7, 6, 9, 6 + h], emissive: lit },
        [WEST]: { tex: tt, uv: [7, 6, 9, 6 + h], emissive: lit }, [EAST]: { tex: tt, uv: [7, 6, 9, 6 + h], emissive: lit },
      },
    };
  };
  const els: Element[] = [base, t(4, 11, powered, 5), t(10, 11, powered, 5), t(7, 2, subtract, subtract ? 4 : 3)];
  return rotateModel(els, 0, (180 + (facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270)) % 360, false);
}

export function flowerPotElements(plantTex: string | null, tint: Tint = Tint.None): Element[] {
  const pot = 'flower_pot';
  const els: Element[] = [
    box([5, 0, 5], [6, 6, 11], pot, { cullEdges: false }),
    box([10, 0, 5], [11, 6, 11], pot, { cullEdges: false }),
    box([6, 0, 5], [10, 6, 6], pot, { cullEdges: false }),
    box([6, 0, 10], [10, 6, 11], pot, { cullEdges: false }),
    box([6, 0, 6], [10, 4, 10], { [UP]: 'dirt' }, { cullEdges: false }),
  ];
  if (plantTex) {
    const cross = crossElements(plantTex, tint, 16);
    for (const c of cross) {
      c.from = [c.from[0] === 8 ? 8 : 2.6, 4, c.from[2] === 8 ? 8 : 2.6];
      c.to = [c.to[0] === 8 ? 8 : 13.4, 16, c.to[2] === 8 ? 8 : 13.4];
    }
    els.push(...cross);
  }
  return els;
}

export function bedElements(tex: string, part: 'head' | 'foot', facing: Direction): Element[] {
  // Mattress 9/16 tall with small legs; texture regions: top, sides.
  const top = `${tex}_top`;
  const side = `${tex}_side`;
  const els: Element[] = [
    { from: [0, 3, 0], to: [16, 9, 16], faces: {
      [UP]: { tex: top, uv: part === 'head' ? [0, 0, 16, 16] : [0, 0, 16, 16] },
      [DOWN]: { tex: 'bed_bottom' },
      [NORTH]: { tex: side, uv: [0, 7, 16, 13] }, [SOUTH]: { tex: side, uv: [0, 7, 16, 13] },
      [WEST]: { tex: side, uv: [0, 7, 16, 13] }, [EAST]: { tex: side, uv: [0, 7, 16, 13] },
    } },
  ];
  const leg = (x: number, z: number) => box([x, 0, z], [x + 3, 3, z + 3], 'bed_leg', { cullEdges: false });
  if (part === 'head') els.push(leg(0, 0), leg(13, 0));
  else els.push(leg(0, 13), leg(13, 13));
  if (part === 'head') els.push(box([1, 9, 1], [15, 11, 6], 'white_wool', { cullEdges: false }));
  // authored facing north (head towards north)
  return rotateModel(els, 0, facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270, false);
}

export function chestElements(tex: string, type: 'single' | 'left' | 'right', facing: Direction): Element[] {
  let x0 = 1, x1 = 15;
  if (type === 'left') x1 = 16;
  if (type === 'right') x0 = 0;
  const els: Element[] = [
    box([x0, 0, 1], [x1, 10, 15], { [DOWN]: `${tex}_top`, [UP]: `${tex}_top`, [NORTH]: `${tex}_front`, [SOUTH]: `${tex}_side`, [WEST]: `${tex}_side`, [EAST]: `${tex}_side` }, { cullEdges: false }),
    box([x0, 10, 1], [x1, 14, 15], { [DOWN]: `${tex}_top`, [UP]: `${tex}_top`, [NORTH]: `${tex}_front`, [SOUTH]: `${tex}_side`, [WEST]: `${tex}_side`, [EAST]: `${tex}_side` }, { cullEdges: false }),
  ];
  if (type === 'single') els.push(box([7, 7, 0], [9, 11, 1], 'chest_lock', { cullEdges: false }));
  else if (type === 'left') els.push(box([15, 7, 0], [16, 11, 1], 'chest_lock', { cullEdges: false }));
  else els.push(box([0, 7, 0], [1, 11, 1], 'chest_lock', { cullEdges: false }));
  return rotateModel(els, 0, facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270, false);
}

export function chestShape(type: 'single' | 'left' | 'right', facing: Direction): Shape {
  if (type === 'single') return shapeOf([1, 0, 1, 15, 14, 15]);
  const els = chestElements('x', type, facing);
  const e = els[0]!;
  return shapeOf([e.from[0], 0, e.from[2], e.to[0], 14, e.to[2]]);
}

/** Generic helper: element list rotated for a horizontal facing (authored facing north). */
export function facingRot(els: Element[], facing: Direction): Element[] {
  return rotateModel(els, 0, facing === NORTH ? 0 : facing === EAST ? 90 : facing === SOUTH ? 180 : 270, false);
}

export function uvOf(d: Direction, from: [number, number, number], to: [number, number, number]) {
  return defaultUV(d, from, to);
}
