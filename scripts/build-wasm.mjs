// Builds native/ (Rust) to src/native/strata.wasm with WebAssembly SIMD enabled.
// Requires: rustup target add wasm32-unknown-unknown
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'native');
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C target-feature=+simd128' },
});
const built = join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'strata_native.wasm');
const out = join(root, 'src', 'native', 'strata.wasm');
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
console.log(`native kernels → ${out} (${(statSync(out).size / 1024).toFixed(1)} KiB)`);
