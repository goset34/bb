/**
 * Hierarchical box models for entities. Units are pixels (1/16 block); Y points up, the model
 * faces +Z and its origin is at the entity's feet. Each cube unwraps onto the texture with the
 * usual box layout (top / bottom strip above the four sides) starting at (u, v).
 */
import type { EntityMesh } from './mesh';

export interface Cube {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  u: number; v: number;
  inflate: number;
  mirror: boolean;
}

export class ModelPart {
  /** Pivot relative to the parent (pixels). */
  x = 0; y = 0; z = 0;
  xRot = 0; yRot = 0; zRot = 0;
  /** Uniform scale around the pivot (baby heads, breathing). */
  scale = 1;
  visible = true;
  readonly cubes: Cube[] = [];
  readonly children = new Map<string, ModelPart>();
  /** Default pose (restored by reset()). */
  private base = [0, 0, 0, 0, 0, 0];

  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
    this.base = [x, y, z, 0, 0, 0];
  }

  /** Add a cube with its min corner at (x,y,z) relative to the pivot. */
  box(u: number, v: number, x: number, y: number, z: number, w: number, h: number, d: number, inflate = 0, mirror = false): this {
    this.cubes.push({ x, y, z, w, h, d, u, v, inflate, mirror });
    return this;
  }

  add(name: string, part: ModelPart): ModelPart {
    this.children.set(name, part);
    return part;
  }

  child(name: string): ModelPart {
    const c = this.children.get(name);
    if (!c) throw new Error('No model part ' + name);
    return c;
  }

  setRot(x: number, y: number, z: number): this {
    this.xRot = x; this.yRot = y; this.zRot = z;
    this.base[3] = x; this.base[4] = y; this.base[5] = z;
    return this;
  }

  reset(): void {
    [this.x, this.y, this.z, this.xRot, this.yRot, this.zRot] = this.base as [number, number, number, number, number, number];
    this.visible = true;
    this.scale = 1;
    for (const c of this.children.values()) c.reset();
  }

  /** Emit geometry; UVs are pixel coordinates on a `texSize`² entity texture layer. */
  render(mesh: EntityMesh, texSize: number): void {
    if (!this.visible) return;
    mesh.push();
    mesh.translate(this.x / 16, this.y / 16, this.z / 16);
    if (this.zRot) mesh.rotate(2, this.zRot);
    if (this.yRot) mesh.rotate(1, this.yRot);
    if (this.xRot) mesh.rotate(0, this.xRot);
    if (this.scale !== 1) mesh.scale(this.scale);
    for (const c of this.cubes) emitCube(mesh, c, texSize);
    for (const ch of this.children.values()) ch.render(mesh, texSize);
    mesh.pop();
  }

  /** Apply this part's transform chain to the mesh (for attaching held items to a hand). */
  applyTransform(mesh: EntityMesh): void {
    mesh.translate(this.x / 16, this.y / 16, this.z / 16);
    if (this.zRot) mesh.rotate(2, this.zRot);
    if (this.yRot) mesh.rotate(1, this.yRot);
    if (this.xRot) mesh.rotate(0, this.xRot);
    if (this.scale !== 1) mesh.scale(this.scale);
  }
}

const P = new Float32Array(12);
const UV = new Float32Array(8);

/** Emit the six faces of a cube with box UV unwrapping. */
function emitCube(mesh: EntityMesh, c: Cube, texSize: number): void {
  const i = c.inflate;
  const x0 = (c.x - i) / 16, y0 = (c.y - i) / 16, z0 = (c.z - i) / 16;
  const x1 = (c.x + c.w + i) / 16, y1 = (c.y + c.h + i) / 16, z1 = (c.z + c.d + i) / 16;
  const { u, v, w, h, d } = c;
  const s = 1 / texSize;
  // Faces: [corners TL, BL, BR, TR as seen from outside], uv rect [u0, v0, u1, v1], normal
  const face = (pts: number[], ru0: number, rv0: number, ru1: number, rv1: number, nx: number, ny: number, nz: number) => {
    P.set(pts);
    let a0 = ru0, a1 = ru1;
    if (c.mirror) { a0 = ru1; a1 = ru0; }
    UV[0] = a0 * s; UV[1] = rv0 * s;
    UV[2] = a0 * s; UV[3] = rv1 * s;
    UV[4] = a1 * s; UV[5] = rv1 * s;
    UV[6] = a1 * s; UV[7] = rv0 * s;
    mesh.quad(P, UV, nx, ny, nz);
  };
  // In the mirrored layout the east and west faces swap texture regions
  const west = c.mirror ? [u + d + w, v + d, u + d + w + d, v + d + h] : [u, v + d, u + d, v + d + h];
  const east = c.mirror ? [u, v + d, u + d, v + d + h] : [u + d + w, v + d, u + d + w + d, v + d + h];
  // top (+y): looking down, front edge (+z) at the bottom of the texture region
  face([x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], u + d, v, u + d + w, v + d, 0, 1, 0);
  // bottom (-y)
  face([x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1], u + d + w, v, u + d + w + w, v + d, 0, -1, 0);
  // front (+z)
  face([x0, y1, z1, x0, y0, z1, x1, y0, z1, x1, y1, z1], u + d, v + d, u + d + w, v + d + h, 0, 0, 1);
  // back (-z)
  face([x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0], u + d + w + d, v + d, u + d + w + d + w, v + d + h, 0, 0, -1);
  // west (-x): seen from -x, left edge is -z
  face([x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1], west[0]!, west[1]!, west[2]!, west[3]!, -1, 0, 0);
  // east (+x)
  face([x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0], east[0]!, east[1]!, east[2]!, east[3]!, 1, 0, 0);
}
