/**
 * Loader for the Rust/WebAssembly kernels in /native (built into src/native/strata.wasm).
 * Kernels are optional: every one mirrors a TypeScript implementation bit for bit, which stays
 * in use when WebAssembly SIMD is unavailable.
 */
import { NoiseKernel, NoiseStack, setNoiseKernel } from '../math/noise';

interface NativeExports {
  memory: WebAssembly.Memory;
  st_alloc(size: number): number;
  st_free(ptr: number, size: number): void;
  st_version(): number;
  noise_batch(table: number, xs: number, ys: number, zs: number, n: number, out: number): void;
}

export const NATIVE_ABI_VERSION = 1;

export class NativeKernels implements NoiseKernel {
  readonly name = 'wasm-simd';
  private f64 = new Float64Array(0);
  private u8 = new Uint8Array(0);
  private scratch = 0;
  private scratchCap = 0;

  constructor(private readonly ex: NativeExports) {
    this.refreshViews();
  }

  private refreshViews(): void {
    if (this.f64.buffer !== this.ex.memory.buffer) {
      this.f64 = new Float64Array(this.ex.memory.buffer);
      this.u8 = new Uint8Array(this.ex.memory.buffer);
    }
  }

  private alloc(bytes: number): number {
    const p = this.ex.st_alloc(bytes);
    if (!p) throw new Error('native: out of memory');
    this.refreshViews();
    return p;
  }

  register(stack: NoiseStack): number {
    const n = stack.octaves.length;
    const bytes = 8 + n * 40 + n * 512;
    const ptr = this.alloc(bytes);
    const f = this.f64, base = ptr >> 3;
    f[base] = n;
    for (let i = 0; i < n; i++) {
      const o = stack.octaves[i]!;
      const k = base + 1 + i * 5;
      f[k] = o.noise.xo; f[k + 1] = o.noise.yo; f[k + 2] = o.noise.zo; f[k + 3] = o.freq; f[k + 4] = o.amp;
    }
    const permBase = ptr + 8 + n * 40;
    for (let i = 0; i < n; i++) this.u8.set(stack.octaves[i]!.noise.p, permBase + i * 512);
    return ptr;
  }

  private ensureScratch(n: number): void {
    if (n <= this.scratchCap) return;
    if (this.scratch) this.ex.st_free(this.scratch, this.scratchCap * 32);
    const cap = Math.max(1024, 1 << Math.ceil(Math.log2(n)));
    this.scratch = this.alloc(cap * 32);
    this.scratchCap = cap;
  }

  batch(handle: number, xs: Float64Array, ys: Float64Array, zs: Float64Array, n: number, out: Float64Array): void {
    this.ensureScratch(n);
    this.refreshViews();
    const cap = this.scratchCap;
    const px = this.scratch, py = px + cap * 8, pz = py + cap * 8, po = pz + cap * 8;
    const f = this.f64;
    f.set(n === xs.length ? xs : xs.subarray(0, n), px >> 3);
    f.set(n === ys.length ? ys : ys.subarray(0, n), py >> 3);
    f.set(n === zs.length ? zs : zs.subarray(0, n), pz >> 3);
    this.ex.noise_batch(handle, px, py, pz, n, po);
    out.set(this.f64.subarray(po >> 3, (po >> 3) + n));
  }
}

let loaded: Promise<NativeKernels | null> | null = null;

async function readBytes(url: URL): Promise<ArrayBuffer> {
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const b = await fs.readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`native: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Load and instantiate the native kernels once per thread (null when unsupported). */
export function loadNative(): Promise<NativeKernels | null> {
  if (!loaded) {
    loaded = (async () => {
      try {
        if (typeof WebAssembly === 'undefined') return null;
        const bytes = await readBytes(new URL('../../native/strata.wasm', import.meta.url));
        const { instance } = await WebAssembly.instantiate(bytes, {});
        const ex = instance.exports as unknown as NativeExports;
        if (ex.st_version() !== NATIVE_ABI_VERSION) return null;
        return new NativeKernels(ex);
      } catch (e) {
        console.warn('[native] WebAssembly kernels unavailable, using TypeScript fallback:', (e as Error).message);
        return null;
      }
    })();
  }
  return loaded;
}

/** Load the kernels and install them as the noise backend for this thread. */
export async function installNativeKernels(enabled = true): Promise<string> {
  if (!enabled) {
    setNoiseKernel(null);
    return 'js';
  }
  const k = await loadNative();
  setNoiseKernel(k);
  return k ? k.name : 'js';
}
