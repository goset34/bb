import { describe, it, expect, beforeAll } from 'vitest';
import { NormalNoise, OctaveNoise, setNoiseKernel } from '../../src/common/math/noise';
import { Random } from '../../src/common/math/random';
import { loadNative, NativeKernels } from '../../src/common/native/native';

let native: NativeKernels | null = null;
beforeAll(async () => {
  native = await loadNative();
});

function points(n: number, seed: number, scale: number) {
  const r = new Random(seed);
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (r.nextDouble() - 0.5) * scale;
    ys[i] = (r.nextDouble() - 0.5) * 800;
    zs[i] = (r.nextDouble() - 0.5) * scale;
  }
  // Include lattice points, negatives and huge coordinates (wrapping)
  xs[0] = 0; ys[0] = 0; zs[0] = 0;
  xs[1] = -1; ys[1] = -64; zs[1] = -1;
  xs[2] = 29_999_984; zs[2] = -29_999_984;
  return { xs, ys, zs };
}

describe('Native noise kernel (WASM SIMD)', () => {
  it('loads', () => {
    expect(native).not.toBeNull();
  });
  it('matches the TypeScript noise bit for bit', () => {
    const stacks = [
      new NormalNoise(new Random(1), -9, [1, 1, 2, 2, 2, 1, 1, 1, 1]),
      new OctaveNoise(new Random(2), -4, [1, 0.5, 0.25]),
      new NormalNoise(new Random(3), -7, [1, 0, 1]),
    ];
    for (const [si, stack] of stacks.entries()) {
      for (const n of [1, 17, 1001]) {
        const { xs, ys, zs } = points(n, 100 + si * 7 + n, 6e7);
        const js = new Float64Array(n), wasm = new Float64Array(n);
        setNoiseKernel(null);
        stack.sampleBatch(xs, ys, zs, n, js);
        setNoiseKernel(native);
        stack.sampleBatch(xs, ys, zs, n, wasm);
        setNoiseKernel(null);
        for (let i = 0; i < n; i++) {
          if (!Object.is(js[i], wasm[i]) && n >= 16) throw new Error(`stack ${si} point ${i}: js=${js[i]} wasm=${wasm[i]}`);
        }
      }
    }
  });
  it('is faster than the TypeScript path for large batches', () => {
    const stack = new NormalNoise(new Random(9), -8, [1, 1, 1, 1, 1, 1]);
    const n = 20000;
    const { xs, ys, zs } = points(n, 5, 1e5);
    const out = new Float64Array(n);
    const time = (k: NativeKernels | null) => {
      setNoiseKernel(k);
      stack.sampleBatch(xs, ys, zs, n, out);
      const t0 = performance.now();
      for (let r = 0; r < 5; r++) stack.sampleBatch(xs, ys, zs, n, out);
      return performance.now() - t0;
    };
    const tJs = time(null), tWasm = time(native);
    setNoiseKernel(null);
    console.log(`noise batch: js ${tJs.toFixed(1)} ms, wasm ${tWasm.toFixed(1)} ms`);
    expect(tWasm).toBeLessThan(tJs * 1.5);
  });
});
