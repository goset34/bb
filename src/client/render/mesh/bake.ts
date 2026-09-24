/**
 * Bakes element models into quads (block-local positions, UVs in texture units, texture layer).
 * Face corner order is TL, BL, BR, TR as seen from outside (counter-clockwise).
 */
import { Element, Face, Tint, RenderShape } from '../../../common/block/model';
import { Direction, DOWN, UP, NORTH, SOUTH, WEST, EAST } from '../../../common/world/direction';

export interface BakedQuad {
  /** 4 corners × xyz (block units, 0..1 typical). */
  pos: Float32Array;
  /** 4 corners × uv (texture units 0..1). */
  uv: Float32Array;
  layer: number;
  cull: number; // -1 = never culled
  normal: number; // 0..5 or 6 for non-axis
  /** Face normal vector (for shading of rotated faces). */
  nx: number;
  ny: number;
  nz: number;
  tint: number;
  emissive: boolean;
  shade: boolean;
}

export type LayerLookup = (tex: string) => number;

/** Corner positions of a face of the box [f,t] (in 16ths), order TL, BL, BR, TR. */
function faceCorners(d: Direction, f: readonly number[], t: readonly number[]): number[] {
  const [x0, y0, z0] = f as [number, number, number];
  const [x1, y1, z1] = t as [number, number, number];
  switch (d) {
    case DOWN: return [x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1];
    case UP: return [x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0];
    case NORTH: return [x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0];
    case SOUTH: return [x0, y1, z1, x0, y0, z1, x1, y0, z1, x1, y1, z1];
    case WEST: return [x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1];
    default: return [x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0];
  }
}

const DEFAULT_UV = (d: Direction, f: readonly number[], t: readonly number[]): [number, number, number, number] => {
  switch (d) {
    case DOWN: return [f[0]!, 16 - t[2]!, t[0]!, 16 - f[2]!];
    case UP: return [f[0]!, f[2]!, t[0]!, t[2]!];
    case NORTH: return [16 - t[0]!, 16 - t[1]!, 16 - f[0]!, 16 - f[1]!];
    case SOUTH: return [f[0]!, 16 - t[1]!, t[0]!, 16 - f[1]!];
    case WEST: return [f[2]!, 16 - t[1]!, t[2]!, 16 - f[1]!];
    default: return [16 - t[2]!, 16 - t[1]!, 16 - f[2]!, 16 - f[1]!];
  }
};

const NORMALS: Array<[number, number, number]> = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

function rotatePoint(p: [number, number, number], axis: number, angle: number, origin: readonly number[], rescale: boolean): [number, number, number] {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let x = p[0] - origin[0]!, y = p[1] - origin[1]!, z = p[2] - origin[2]!;
  let nx = x, ny = y, nz = z;
  if (axis === 0) { ny = y * c - z * s; nz = y * s + z * c; }
  else if (axis === 1) { nx = x * c + z * s; nz = -x * s + z * c; }
  else { nx = x * c - y * s; ny = x * s + y * c; }
  if (rescale) {
    const k = 1 / Math.max(Math.abs(c), 1e-6);
    // Reference rescale stretches the two axes perpendicular to the rotation axis
    if (Math.abs(angle) % 90 !== 0) {
      const f = Math.abs(angle) === 45 ? Math.SQRT2 : k;
      if (axis === 0) { ny *= f; nz *= f; }
      else if (axis === 1) { nx *= f; nz *= f; }
      else { nx *= f; ny *= f; }
    }
  }
  x = nx + origin[0]!; y = ny + origin[1]!; z = nz + origin[2]!;
  return [x, y, z];
}

function rotateNormal(n: [number, number, number], axis: number, angle: number): [number, number, number] {
  const r = rotatePoint(n, axis, angle, [0, 0, 0], false);
  const l = Math.hypot(r[0], r[1], r[2]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l];
}

export function bakeElements(elements: Element[], layerOf: LayerLookup): BakedQuad[] {
  const out: BakedQuad[] = [];
  for (const e of elements) {
    for (const key of Object.keys(e.faces)) {
      const d = Number(key) as Direction;
      const face = e.faces[d] as Face;
      const corners = faceCorners(d, e.from, e.to);
      const uvRect = face.uv ?? DEFAULT_UV(d, e.from, e.to);
      // uv per corner: TL(u0,v0) BL(u0,v1) BR(u1,v1) TR(u1,v0)
      let uvs = [uvRect[0], uvRect[1], uvRect[0], uvRect[3], uvRect[2], uvRect[3], uvRect[2], uvRect[1]];
      const rot = ((face.rot ?? 0) / 90) & 3;
      if (rot) {
        const shifted = new Array<number>(8);
        for (let i = 0; i < 4; i++) {
          const j = (i + rot) % 4;
          shifted[i * 2] = uvs[j * 2]!;
          shifted[i * 2 + 1] = uvs[j * 2 + 1]!;
        }
        uvs = shifted;
      }
      const pos = new Float32Array(12);
      let n: [number, number, number] = NORMALS[d]!;
      for (let i = 0; i < 4; i++) {
        let p: [number, number, number] = [corners[i * 3]!, corners[i * 3 + 1]!, corners[i * 3 + 2]!];
        if (e.rot && e.rot.angle !== 0) p = rotatePoint(p, e.rot.axis, e.rot.angle, e.rot.origin, !!e.rot.rescale);
        pos[i * 3] = p[0] / 16;
        pos[i * 3 + 1] = p[1] / 16;
        pos[i * 3 + 2] = p[2] / 16;
      }
      if (e.rot && e.rot.angle !== 0) n = rotateNormal(n, e.rot.axis, e.rot.angle);
      const axisAligned = Math.abs(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) - 1) < 1e-4 && (Math.abs(n[0]) > 0.999 || Math.abs(n[1]) > 0.999 || Math.abs(n[2]) > 0.999);
      let nIdx = 6;
      if (axisAligned) nIdx = n[1] < -0.5 ? 0 : n[1] > 0.5 ? 1 : n[2] < -0.5 ? 2 : n[2] > 0.5 ? 3 : n[0] < -0.5 ? 4 : 5;
      const uv = new Float32Array(8);
      for (let i = 0; i < 8; i++) uv[i] = uvs[i]! / 16;
      out.push({
        pos, uv, layer: layerOf(face.tex), cull: face.cull ?? -1, normal: nIdx,
        nx: n[0], ny: n[1], nz: n[2], tint: face.tint ?? Tint.None, emissive: !!face.emissive, shade: e.shade !== false,
      });
    }
  }
  return out;
}

/** Collect every texture name used by a render shape. */
export function texturesOf(r: RenderShape, out: Set<string>): void {
  if (r.kind === 'cube') for (const t of r.tex) out.add(t);
  else if (r.kind === 'model') for (const e of r.elements) for (const f of Object.values(e.faces)) { if (f) out.add(f.tex); }
  else if (r.kind === 'liquid') { out.add(r.still); out.add(r.flow); }
}

export { NORMALS, WEST, EAST, NORTH, SOUTH, UP, DOWN };
