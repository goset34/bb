//! Improved Perlin noise octave stacks (mirror of `src/common/math/noise.ts`, `NoiseStack`).
//!
//! Table layout (little endian, 8-byte aligned):
//! ```text
//! f64 count
//! count × [xo, yo, zo, freq, amp]   (f64)
//! count × 512 permutation bytes
//! ```

use std::arch::wasm32::*;

const GX: [f64; 16] = [1., -1., 1., -1., 1., -1., 1., -1., 0., 0., 0., 0., 1., 0., -1., 0.];
const GY: [f64; 16] = [1., 1., -1., -1., 0., 0., 0., 0., 1., -1., 1., -1., 1., -1., 1., -1.];
const GZ: [f64; 16] = [0., 0., 0., 0., 1., 1., -1., -1., 1., 1., -1., -1., 0., 1., 0., -1.];

const WRAP: f64 = 33554432.0;

#[inline(always)]
fn wrap(v: f64) -> f64 {
    v - (v / WRAP + 0.5).floor() * WRAP
}

#[inline(always)]
fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

#[inline(always)]
fn lerp(t: f64, a: f64, b: f64) -> f64 {
    a + t * (b - a)
}

#[inline(always)]
fn grad(hash: u8, x: f64, y: f64, z: f64) -> f64 {
    let h = (hash & 15) as usize;
    GX[h] * x + GY[h] * y + GZ[h] * z
}

/// Hashes of the 8 cube corners for lattice cell (X, Y, Z).
#[inline(always)]
fn corners(p: &[u8], xi: usize, yi: usize, zi: usize) -> [u8; 8] {
    let a = p[xi] as usize + yi;
    let aa = p[a] as usize + zi;
    let ab = p[a + 1] as usize + zi;
    let b = p[xi + 1] as usize + yi;
    let ba = p[b] as usize + zi;
    let bb = p[b + 1] as usize + zi;
    [p[aa], p[ba], p[ab], p[bb], p[aa + 1], p[ba + 1], p[ab + 1], p[bb + 1]]
}

#[inline(always)]
fn lattice(v: f64) -> usize {
    ((v as i64) & 255) as usize
}

/// Scalar single-octave noise (used for the odd tail element of a batch).
#[inline(always)]
fn noise1(p: &[u8], o: &[f64], x: f64, y: f64, z: f64) -> f64 {
    let dx = x + o[0];
    let dy = y + o[1];
    let dz = z + o[2];
    let fx = dx.floor();
    let fy = dy.floor();
    let fz = dz.floor();
    let rx = dx - fx;
    let ry = dy - fy;
    let rz = dz - fz;
    let h = corners(p, lattice(fx), lattice(fy), lattice(fz));
    let u = fade(rx);
    let v = fade(ry);
    let w = fade(rz);
    let g000 = grad(h[0], rx, ry, rz);
    let g100 = grad(h[1], rx - 1.0, ry, rz);
    let g010 = grad(h[2], rx, ry - 1.0, rz);
    let g110 = grad(h[3], rx - 1.0, ry - 1.0, rz);
    let g001 = grad(h[4], rx, ry, rz - 1.0);
    let g101 = grad(h[5], rx - 1.0, ry, rz - 1.0);
    let g011 = grad(h[6], rx, ry - 1.0, rz - 1.0);
    let g111 = grad(h[7], rx - 1.0, ry - 1.0, rz - 1.0);
    lerp(w, lerp(v, lerp(u, g000, g100), lerp(u, g010, g110)), lerp(v, lerp(u, g001, g101), lerp(u, g011, g111)))
}

#[inline(always)]
fn vfade(t: v128) -> v128 {
    let t3 = f64x2_mul(f64x2_mul(t, t), t);
    let inner = f64x2_add(f64x2_mul(t, f64x2_sub(f64x2_mul(t, f64x2_splat(6.0)), f64x2_splat(15.0))), f64x2_splat(10.0));
    f64x2_mul(t3, inner)
}

#[inline(always)]
fn vlerp(t: v128, a: v128, b: v128) -> v128 {
    f64x2_add(a, f64x2_mul(t, f64x2_sub(b, a)))
}

#[inline(always)]
fn vgrad(h0: u8, h1: u8, x: v128, y: v128, z: v128) -> v128 {
    let i0 = (h0 & 15) as usize;
    let i1 = (h1 & 15) as usize;
    let gx = f64x2(GX[i0], GX[i1]);
    let gy = f64x2(GY[i0], GY[i1]);
    let gz = f64x2(GZ[i0], GZ[i1]);
    f64x2_add(f64x2_add(f64x2_mul(gx, x), f64x2_mul(gy, y)), f64x2_mul(gz, z))
}

#[inline(always)]
fn vwrap(v: v128) -> v128 {
    let w = f64x2_splat(WRAP);
    f64x2_sub(v, f64x2_mul(f64x2_floor(f64x2_add(f64x2_div(v, w), f64x2_splat(0.5))), w))
}

/// Two points at once: SIMD for all arithmetic, scalar lookups for the permutation hashes.
#[inline(always)]
fn noise2(p: &[u8], o: &[f64], x: v128, y: v128, z: v128) -> v128 {
    let dx = f64x2_add(x, f64x2_splat(o[0]));
    let dy = f64x2_add(y, f64x2_splat(o[1]));
    let dz = f64x2_add(z, f64x2_splat(o[2]));
    let fx = f64x2_floor(dx);
    let fy = f64x2_floor(dy);
    let fz = f64x2_floor(dz);
    let rx = f64x2_sub(dx, fx);
    let ry = f64x2_sub(dy, fy);
    let rz = f64x2_sub(dz, fz);
    let ha = corners(
        p,
        lattice(f64x2_extract_lane::<0>(fx)),
        lattice(f64x2_extract_lane::<0>(fy)),
        lattice(f64x2_extract_lane::<0>(fz)),
    );
    let hb = corners(
        p,
        lattice(f64x2_extract_lane::<1>(fx)),
        lattice(f64x2_extract_lane::<1>(fy)),
        lattice(f64x2_extract_lane::<1>(fz)),
    );
    let one = f64x2_splat(1.0);
    let rx1 = f64x2_sub(rx, one);
    let ry1 = f64x2_sub(ry, one);
    let rz1 = f64x2_sub(rz, one);
    let u = vfade(rx);
    let v = vfade(ry);
    let w = vfade(rz);
    let g000 = vgrad(ha[0], hb[0], rx, ry, rz);
    let g100 = vgrad(ha[1], hb[1], rx1, ry, rz);
    let g010 = vgrad(ha[2], hb[2], rx, ry1, rz);
    let g110 = vgrad(ha[3], hb[3], rx1, ry1, rz);
    let g001 = vgrad(ha[4], hb[4], rx, ry, rz1);
    let g101 = vgrad(ha[5], hb[5], rx1, ry, rz1);
    let g011 = vgrad(ha[6], hb[6], rx, ry1, rz1);
    let g111 = vgrad(ha[7], hb[7], rx1, ry1, rz1);
    vlerp(w, vlerp(v, vlerp(u, g000, g100), vlerp(u, g010, g110)), vlerp(v, vlerp(u, g001, g101), vlerp(u, g011, g111)))
}

/// Evaluate a registered octave stack at `n` points.
///
/// # Safety
/// `table` must point to a stack laid out as documented above; `xs`, `ys`, `zs` and `out`
/// must each hold `n` doubles.
#[no_mangle]
pub unsafe extern "C" fn noise_batch(table: *const f64, xs: *const f64, ys: *const f64, zs: *const f64, n: usize, out: *mut f64) {
    let count = *table as usize;
    let params = core::slice::from_raw_parts(table.add(1), count * 5);
    let perms = core::slice::from_raw_parts(table.add(1 + count * 5) as *const u8, count * 512);
    let xs = core::slice::from_raw_parts(xs, n);
    let ys = core::slice::from_raw_parts(ys, n);
    let zs = core::slice::from_raw_parts(zs, n);
    let out = core::slice::from_raw_parts_mut(out, n);
    for v in out.iter_mut() {
        *v = 0.0;
    }
    let pairs = n & !1;
    for k in 0..count {
        let o = &params[k * 5..k * 5 + 5];
        let p = &perms[k * 512..k * 512 + 512];
        let freq = f64x2_splat(o[3]);
        let amp = f64x2_splat(o[4]);
        let mut i = 0;
        while i < pairs {
            let x = vwrap(f64x2_mul(v128_load(xs.as_ptr().add(i) as *const v128), freq));
            let y = vwrap(f64x2_mul(v128_load(ys.as_ptr().add(i) as *const v128), freq));
            let z = vwrap(f64x2_mul(v128_load(zs.as_ptr().add(i) as *const v128), freq));
            let v = noise2(p, o, x, y, z);
            let acc = v128_load(out.as_ptr().add(i) as *const v128);
            v128_store(out.as_mut_ptr().add(i) as *mut v128, f64x2_add(acc, f64x2_mul(amp, v)));
            i += 2;
        }
        if pairs < n {
            let f = o[3];
            let v = noise1(p, o, wrap(xs[pairs] * f), wrap(ys[pairs] * f), wrap(zs[pairs] * f));
            out[pairs] = out[pairs] + o[4] * v;
        }
    }
}
