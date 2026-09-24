// Usage: node scripts/shot.mjs <gfx:webgl2|webgpu> <out.png> [worldType] [waitMs] [js-to-run-after-load]
import { chromium } from 'playwright';
const [gfx = 'webgl2', out = '/tmp/claude-0/shot.png', worldType = 'debug_simple', waitMs = '4000', extra = ''] = process.argv.slice(2);
const url = process.env.URL ?? 'http://localhost:5173/';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'];
const b = await chromium.launch({ executablePath: exe, args, headless: true });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || /gfx|error/i.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + e.stack));
await p.goto(url + '?gfx=' + gfx);
await p.waitForFunction(() => window.__strata && window.__strata.device, null, { timeout: 60000 });
const t0 = Date.now();
await p.evaluate(async (wt) => {
  const app = window.__strata;
  const info = {
    name: 'Test', seed: '12345', generator: { type: wt, structures: true, bonusChest: false }, gameMode: 'creative', difficulty: 2, hardcore: false, allowCommands: true,
    spawn: { x: 0, y: 80, z: 0 }, gameTime: 0, dayTime: 3000, weather: { raining: false, thundering: false, rainTime: 0, thunderTime: 0, clearTime: 0, rainLevel: 0, thunderLevel: 0 },
    rules: {}, version: 1, created: Date.now(), lastPlayed: Date.now(), data: {},
  };
  app.settings.renderDistance = 6;
  await app.startWorld('test', info, false);
}, worldType);
await p.waitForFunction(() => window.__strata.game && window.__strata.game.loaded, null, { timeout: 120000 });
console.log('loaded in', Date.now() - t0, 'ms');
if (extra) await p.evaluate(extra);
await p.waitForTimeout(Number(waitMs));
const dbg = await p.evaluate(() => { const g = window.__strata.game; g.hud.showDebug = true; return { fps: g.fps, chunks: g.level.chunks.size, meshes: g.meshes.meshes.size, vis: g.renderer.stats.visibleSections, draws: g.renderer.stats.drawCalls, pos: [g.player.entity.transform.x, g.player.entity.transform.y, g.player.entity.transform.z], backend: window.__strata.device.info.backend }; });
console.log(JSON.stringify(dbg));
await p.waitForTimeout(300);
await p.screenshot({ path: out });
console.log(logs.slice(0, 30).join('\n'));
await b.close();
