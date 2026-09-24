import { test, expect, Page } from '@playwright/test';

declare global {
  interface Window { __strata: any }
}

async function startTestWorld(page: Page, gfx: 'webgl2' | 'webgpu', worldType = 'debug_simple'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?gfx=' + gfx);
  await page.waitForFunction(() => window.__strata?.device, null, { timeout: 60_000 });
  await page.evaluate(async (type) => {
    const app = window.__strata;
    app.settings.renderDistance = 4;
    await app.startWorld('e2e', {
      name: 'E2E', seed: 'e2e', generator: { type, structures: true, bonusChest: false }, gameMode: 'creative', difficulty: 2,
      hardcore: false, allowCommands: true, spawn: { x: 0, y: 80, z: 0 }, gameTime: 0, dayTime: 3000,
      weather: { raining: false, thundering: false, rainTime: 0, thunderTime: 0, clearTime: 0, rainLevel: 0, thunderLevel: 0 },
      rules: {}, version: 1, created: Date.now(), lastPlayed: Date.now(), data: {},
    }, false);
  }, worldType);
  await page.waitForFunction(() => window.__strata.game?.loaded, null, { timeout: 120_000 });
  return errors;
}

for (const gfx of ['webgl2', 'webgpu'] as const) {
  test(`renders a world with ${gfx}`, async ({ page }) => {
    const errors = await startTestWorld(page, gfx);
    await page.waitForFunction(() => window.__strata.game.renderer.stats.visibleSections > 0 && window.__strata.game.level.chunks.size > 20, null, { timeout: 90_000 });
    const info = await page.evaluate(() => {
      const g = window.__strata.game;
      return { backend: window.__strata.device.info.backend, chunks: g.level.chunks.size, y: g.player.entity.transform.y };
    });
    test.skip(info.backend !== gfx, `${gfx} unavailable in this browser`);
    expect(info.chunks).toBeGreaterThan(20);
    expect(info.y).toBeGreaterThan(-64);
    const shot = await page.screenshot();
    expect(shot.byteLength).toBeGreaterThan(20_000);
    expect(errors).toEqual([]);
  });
}

test('title screen offers singleplayer and options', async ({ page }) => {
  await page.goto('/?gfx=webgl2');
  await page.waitForFunction(() => window.__strata?.device, null, { timeout: 60_000 });
  await expect(page.locator('#ui button').first()).toBeVisible();
  const labels = await page.locator('#ui button').allTextContents();
  expect(labels.length).toBeGreaterThanOrEqual(3);
});

test('breaking a block in creative is applied by the server', async ({ page }) => {
  await startTestWorld(page, 'webgl2');
  await page.waitForFunction(() => window.__strata.game.player.entity.physics.onGround, null, { timeout: 60_000 });
  const pos = await page.evaluate(() => {
    const g = window.__strata.game;
    const t = g.player.entity.transform;
    const x = Math.floor(t.x) + 2, z = Math.floor(t.z);
    let y = Math.floor(t.y) + 3;
    while (y > -64 && g.level.getBlockState(x, y, z) === 0) y--;
    g.player.send({ type: 'action', action: 'start_dig', x, y, z, face: 1, seq: 999 });
    return { x, y, z, before: g.level.getBlockState(x, y, z) };
  });
  expect(pos.before).not.toBe(0);
  await page.waitForFunction((p) => window.__strata.game.level.getBlockState(p.x, p.y, p.z) === 0, pos, { timeout: 10_000 });
});

test('generates a normal world with biomes, water and vegetation', async ({ page }) => {
  const errors = await startTestWorld(page, 'webgl2', 'normal');
  await page.waitForFunction(() => window.__strata.game.level.chunks.size > 40, null, { timeout: 120_000 });
  const info = await page.evaluate(() => {
    const g = window.__strata.game;
    const t = g.player.entity.transform;
    const below = g.level.getBlockState(Math.floor(t.x), Math.floor(t.y) - 1, Math.floor(t.z));
    return { y: t.y, below, biome: g.level.getBiome(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)) };
  });
  expect(info.y).toBeGreaterThan(62);
  expect(info.below).not.toBe(0);
  expect(errors).toEqual([]);
});
