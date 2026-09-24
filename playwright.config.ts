import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Chromium flags so WebGL2/WebGPU work on machines without a GPU (SwiftShader). */
const SOFTWARE_GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'];
const localChromium = process.env.STRATA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173/',
    viewport: { width: 960, height: 540 },
    launchOptions: {
      args: SOFTWARE_GPU,
      ...(existsSync(localChromium) ? { executablePath: localChromium } : {}),
    },
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
