/** Column-major 4×4 matrices stored in Float32Array(16) (or Float64Array for CPU precision). */
export type Mat4 = Float32Array;

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function copy(out: Mat4, a: ArrayLike<number>): Mat4 {
  for (let i = 0; i < 16; i++) out[i] = a[i]!;
  return out;
}

export function multiply(out: Mat4, a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4]!, b1 = b[i * 4 + 1]!, b2 = b[i * 4 + 2]!, b3 = b[i * 4 + 3]!;
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function invert(out: Mat4, a: ArrayLike<number>): Mat4 | null {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/**
 * Perspective projection. `zeroToOne` selects clip-space depth range [0,1] (WebGPU)
 * instead of [-1,1] (WebGL).
 */
export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number, zeroToOne: boolean): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  if (zeroToOne) {
    const nf = 1 / (near - far);
    out[10] = far * nf;
    out[14] = far * near * nf;
  } else {
    const nf = 1 / (near - far);
    out[10] = (far + near) * nf;
    out[14] = 2 * far * near * nf;
  }
  return out;
}

export function ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number, zeroToOne: boolean): Mat4 {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  if (zeroToOne) {
    out[10] = nf;
    out[14] = near * nf;
  } else {
    out[10] = 2 * nf;
    out[14] = (far + near) * nf;
  }
  out[15] = 1;
  return out;
}

export function lookAt(out: Mat4, ex: number, ey: number, ez: number, cx: number, cy: number, cz: number, ux: number, uy: number, uz: number): Mat4 {
  let z0 = ex - cx, z1 = ey - cy, z2 = ez - cz;
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;
  let x0 = uy * z2 - uz * z1;
  let x1 = uz * z0 - ux * z2;
  let x2 = ux * z1 - uy * z0;
  len = Math.hypot(x0, x1, x2);
  if (!len) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * ex + x1 * ey + x2 * ez);
  out[13] = -(y0 * ex + y1 * ey + y2 * ez);
  out[14] = -(z0 * ex + z1 * ey + z2 * ez);
  out[15] = 1;
  return out;
}

export function translate(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  if (out !== a) copy(out, a);
  out[12] = a[0]! * x + a[4]! * y + a[8]! * z + a[12]!;
  out[13] = a[1]! * x + a[5]! * y + a[9]! * z + a[13]!;
  out[14] = a[2]! * x + a[6]! * y + a[10]! * z + a[14]!;
  out[15] = a[3]! * x + a[7]! * y + a[11]! * z + a[15]!;
  return out;
}

export function scale(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  for (let i = 0; i < 4; i++) {
    out[i] = a[i]! * x;
    out[4 + i] = a[4 + i]! * y;
    out[8 + i] = a[8 + i]! * z;
    out[12 + i] = a[12 + i]!;
  }
  return out;
}

export function rotateX(out: Mat4, a: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  if (out !== a) { for (let i = 0; i < 4; i++) { out[i] = a[i]!; out[12 + i] = a[12 + i]!; } }
  out[4] = a10 * c + a20 * s; out[5] = a11 * c + a21 * s; out[6] = a12 * c + a22 * s; out[7] = a13 * c + a23 * s;
  out[8] = a20 * c - a10 * s; out[9] = a21 * c - a11 * s; out[10] = a22 * c - a12 * s; out[11] = a23 * c - a13 * s;
  return out;
}

export function rotateY(out: Mat4, a: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  if (out !== a) { for (let i = 0; i < 4; i++) { out[4 + i] = a[4 + i]!; out[12 + i] = a[12 + i]!; } }
  out[0] = a00 * c - a20 * s; out[1] = a01 * c - a21 * s; out[2] = a02 * c - a22 * s; out[3] = a03 * c - a23 * s;
  out[8] = a00 * s + a20 * c; out[9] = a01 * s + a21 * c; out[10] = a02 * s + a22 * c; out[11] = a03 * s + a23 * c;
  return out;
}

export function rotateZ(out: Mat4, a: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  if (out !== a) { for (let i = 8; i < 16; i++) out[i] = a[i]!; }
  out[0] = a00 * c + a10 * s; out[1] = a01 * c + a11 * s; out[2] = a02 * c + a12 * s; out[3] = a03 * c + a13 * s;
  out[4] = a10 * c - a00 * s; out[5] = a11 * c - a01 * s; out[6] = a12 * c - a02 * s; out[7] = a13 * c - a03 * s;
  return out;
}

/** Transform a point (w=1) and return the homogeneous result. */
export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array | number[] = [0, 0, 0, 0]): Float64Array | number[] {
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  out[3] = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return out;
}
