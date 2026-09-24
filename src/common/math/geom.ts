/** Axis-aligned bounding boxes, frustum culling and small vector helpers. */

export class AABB {
  constructor(
    public minX: number, public minY: number, public minZ: number,
    public maxX: number, public maxY: number, public maxZ: number,
  ) {}

  static of(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
    return new AABB(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
  }

  clone(): AABB {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  set(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    this.minX = x0; this.minY = y0; this.minZ = z0; this.maxX = x1; this.maxY = y1; this.maxZ = z1;
    return this;
  }

  move(dx: number, dy: number, dz: number): AABB {
    return new AABB(this.minX + dx, this.minY + dy, this.minZ + dz, this.maxX + dx, this.maxY + dy, this.maxZ + dz);
  }

  inflate(x: number, y = x, z = x): AABB {
    return new AABB(this.minX - x, this.minY - y, this.minZ - z, this.maxX + x, this.maxY + y, this.maxZ + z);
  }

  /** Expand towards a movement vector (swept volume). */
  expandTowards(dx: number, dy: number, dz: number): AABB {
    return new AABB(
      dx < 0 ? this.minX + dx : this.minX, dy < 0 ? this.minY + dy : this.minY, dz < 0 ? this.minZ + dz : this.minZ,
      dx > 0 ? this.maxX + dx : this.maxX, dy > 0 ? this.maxY + dy : this.maxY, dz > 0 ? this.maxZ + dz : this.maxZ,
    );
  }

  intersects(o: AABB): boolean {
    return this.minX < o.maxX && this.maxX > o.minX && this.minY < o.maxY && this.maxY > o.minY && this.minZ < o.maxZ && this.maxZ > o.minZ;
  }

  intersectsRaw(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return this.minX < x1 && this.maxX > x0 && this.minY < y1 && this.maxY > y0 && this.minZ < z1 && this.maxZ > z0;
  }

  contains(x: number, y: number, z: number): boolean {
    return x >= this.minX && x < this.maxX && y >= this.minY && y < this.maxY && z >= this.minZ && z < this.maxZ;
  }

  get sizeX(): number { return this.maxX - this.minX; }
  get sizeY(): number { return this.maxY - this.minY; }
  get sizeZ(): number { return this.maxZ - this.minZ; }
  get centerX(): number { return (this.minX + this.maxX) / 2; }
  get centerY(): number { return (this.minY + this.maxY) / 2; }
  get centerZ(): number { return (this.minZ + this.maxZ) / 2; }

  /** Clip movement along X against another box (returns the allowed offset). */
  clipX(o: AABB, dx: number): number {
    if (o.maxY <= this.minY || o.minY >= this.maxY || o.maxZ <= this.minZ || o.minZ >= this.maxZ) return dx;
    if (dx > 0 && o.maxX <= this.minX) {
      const d = this.minX - o.maxX;
      if (d < dx) dx = d;
    } else if (dx < 0 && o.minX >= this.maxX) {
      const d = this.maxX - o.minX;
      if (d > dx) dx = d;
    }
    return dx;
  }

  clipY(o: AABB, dy: number): number {
    if (o.maxX <= this.minX || o.minX >= this.maxX || o.maxZ <= this.minZ || o.minZ >= this.maxZ) return dy;
    if (dy > 0 && o.maxY <= this.minY) {
      const d = this.minY - o.maxY;
      if (d < dy) dy = d;
    } else if (dy < 0 && o.minY >= this.maxY) {
      const d = this.maxY - o.minY;
      if (d > dy) dy = d;
    }
    return dy;
  }

  clipZ(o: AABB, dz: number): number {
    if (o.maxX <= this.minX || o.minX >= this.maxX || o.maxY <= this.minY || o.minY >= this.maxY) return dz;
    if (dz > 0 && o.maxZ <= this.minZ) {
      const d = this.minZ - o.maxZ;
      if (d < dz) dz = d;
    } else if (dz < 0 && o.minZ >= this.maxZ) {
      const d = this.maxZ - o.minZ;
      if (d > dz) dz = d;
    }
    return dz;
  }

  /**
   * Ray/box intersection (slab method). Returns entry distance t in [0, maxT] or -1.
   * Also writes the hit face (0..5: -y,+y,-z,+z,-x,+x) to out.face.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, out?: { face: number }): number {
    let tmin = 0;
    let tmax = maxT;
    let face = -1;
    const check = (o: number, d: number, mn: number, mx: number, negFace: number, posFace: number): boolean => {
      if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      let f1 = negFace;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; f1 = posFace; }
      if (t1 > tmin) { tmin = t1; face = f1; }
      if (t2 < tmax) tmax = t2;
      return tmin <= tmax;
    };
    if (!check(ox, dx, this.minX, this.maxX, 4, 5)) return -1;
    if (!check(oy, dy, this.minY, this.maxY, 0, 1)) return -1;
    if (!check(oz, dz, this.minZ, this.maxZ, 2, 3)) return -1;
    if (out) out.face = face;
    return tmin;
  }
}

/** View frustum with 6 planes (a,b,c,d) extracted from a view-projection matrix. */
export class Frustum {
  readonly planes = new Float64Array(24);

  /** zeroToOne: whether clip-space Z range is [0,1] (WebGPU) or [-1,1] (WebGL). */
  setFromMatrix(m: ArrayLike<number>, zeroToOne: boolean): void {
    const p = this.planes;
    const set = (i: number, a: number, b: number, c: number, d: number) => {
      const l = Math.hypot(a, b, c) || 1;
      p[i * 4] = a / l; p[i * 4 + 1] = b / l; p[i * 4 + 2] = c / l; p[i * 4 + 3] = d / l;
    };
    // left, right, bottom, top, near, far
    set(0, m[3]! + m[0]!, m[7]! + m[4]!, m[11]! + m[8]!, m[15]! + m[12]!);
    set(1, m[3]! - m[0]!, m[7]! - m[4]!, m[11]! - m[8]!, m[15]! - m[12]!);
    set(2, m[3]! + m[1]!, m[7]! + m[5]!, m[11]! + m[9]!, m[15]! + m[13]!);
    set(3, m[3]! - m[1]!, m[7]! - m[5]!, m[11]! - m[9]!, m[15]! - m[13]!);
    if (zeroToOne) set(4, m[2]!, m[6]!, m[10]!, m[14]!);
    else set(4, m[3]! + m[2]!, m[7]! + m[6]!, m[11]! + m[10]!, m[15]! + m[14]!);
    set(5, m[3]! - m[2]!, m[7]! - m[6]!, m[11]! - m[10]!, m[15]! - m[14]!);
  }

  /** True if the AABB is at least partially inside. */
  testBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const a = p[i * 4]!, b = p[i * 4 + 1]!, c = p[i * 4 + 2]!, d = p[i * 4 + 3]!;
      const x = a >= 0 ? x1 : x0;
      const y = b >= 0 ? y1 : y0;
      const z = c >= 0 ? z1 : z0;
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }

  testSphere(x: number, y: number, z: number, r: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      if (p[i * 4]! * x + p[i * 4 + 1]! * y + p[i * 4 + 2]! * z + p[i * 4 + 3]! < -r) return false;
    }
    return true;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Map `v` from [a0,a1] to [b0,b1] and clamp. */
export function clampedMap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, clamp((v - a0) / (a1 - a0), 0, 1));
}

export function wrapDegrees(deg: number): number {
  let d = deg % 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function rotLerp(t: number, a: number, b: number): number {
  return a + t * wrapDegrees(b - a);
}

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export const DEG = Math.PI / 180;

/** Squared distance. */
export function dist2(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

/** Direction vector from yaw/pitch in degrees (reference convention: yaw 0 = +Z, 90 = -X). */
export function lookVector(yawDeg: number, pitchDeg: number): [number, number, number] {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
}
