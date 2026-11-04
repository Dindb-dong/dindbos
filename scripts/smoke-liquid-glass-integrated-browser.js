import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Exercises the real running showcase, without starting/stopping its server.
const base = (process.env.DINDBOS_BASE_URL || process.env.DINDBOS_QA_URL || 'http://127.0.0.1:5174').replace(/\/$/, '');
const output = process.env.DINDBOS_QA_OUTPUT || 'internal/docs/qa/liquid-glass-integrated';
const require = createRequire(import.meta.url);
const { PNG } = require(join(process.cwd(), 'node_modules/playwright-core/lib/utilsBundle.js'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let page;
try {
  await mkdir(output, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?qa=fresh`);
  await page.locator('.dos-boot-screen').waitFor({ state: 'detached' });
  await page.locator('[data-dock-app-id="applications"]').click();
  const header = page.locator('.applications-header');
  await expect(header).toBeVisible();
  // Integrated app chrome keeps its content material; refraction is opt-in.
  assert.equal(await header.getAttribute('data-glass-surface'), null);
  assert.equal(await header.getAttribute('data-liquid-glass-mode'), null);
  const title = header;
  const bounds = await title.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + 20); await page.mouse.down();
  await page.mouse.move(1110, 60, { steps: 15 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Control Center', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Control Center', exact: true });
  await expect(panel).toHaveAttribute('data-liquid-glass-mode', 'refraction');
  await page.evaluate(() => Promise.all([...document.querySelectorAll('feImage')].map(element => {
    const image = new Image(); image.src = element.getAttribute('href'); return image.decode();
  })));
  // SVG decoding and Chrome's backdrop compositor settle independently.
  await page.waitForTimeout(900);
  function rimDifference(first, second) {
    const a = PNG.sync.read(first), b = PNG.sync.read(second);
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    let changed = 0, maximum = 0;
    for (let y = 4; y < a.height - 4; y++) for (let x = 4; x < a.width - 4; x++) {
      if (x > 35 && x < a.width - 35 && y > 35 && y < a.height - 35) continue;
      const i = (y * a.width + x) * 4;
      const delta = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]);
      maximum = Math.max(maximum, delta); if (delta > 6) changed++;
    }
    return { changed, maximum };
  }
  async function compare(surface, name) {
    const optical = await surface.evaluate(element => element.style.backdropFilter);
    assert.match(optical, /url\(/);
    const baseline = optical.replace(/url\([^)]*\)\s*/, '');
    const override = await page.addStyleTag({ content: `[data-glass-test-baseline] {backdrop-filter:${baseline} !important;-webkit-backdrop-filter:${baseline} !important;}` });
    async function capture(value, suffix) {
      await surface.evaluate((element, isBaseline) => { element.toggleAttribute('data-glass-test-baseline', isBaseline); }, value === baseline);
      await expect.poll(() => surface.evaluate(element => getComputedStyle(element).backdropFilter)).toBe(value);
      await page.waitForTimeout(220);
      return surface.screenshot({ path: join(output, `${name}-${suffix}.png`) });
    }
    const a = await capture(optical, 'optical');
    const b = await capture(baseline, 'baseline');
    const b2 = await capture(baseline, 'baseline-repeat');
    const a2 = await capture(optical, 'optical-restored');
    const difference = rimDifference(a, b);
    assert(difference.changed > 5, `${name}: real backdrop refraction must change rim pixels beyond identical blur/tint: ${JSON.stringify(difference)}`);
    assert(rimDifference(b, b2).changed <= 5, `${name}: baseline must be stable`);
    assert(rimDifference(a, a2).changed <= 5, `${name}: restored optical output must be stable`);
    await override.evaluate(element => element.remove()); return difference;
  }
  const panelPixels = await compare(panel, 'control-center');
  const dockPixels = await compare(page.locator('.dos-dock'), 'dock');
  const surfaces = await page.locator('[data-liquid-glass-mode]').evaluateAll(elements => elements.map(element => ({ class: element.className, mode: element.dataset.liquidGlassMode, background: getComputedStyle(element).backgroundColor, filter: getComputedStyle(element).backdropFilter })));
  await page.screenshot({ path: join(output, 'desktop-light.png') });
  await panel.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(250); await page.screenshot({ path: join(output, 'desktop-dark.png') });
  await panel.getByRole('button', { name: 'Light', exact: true }).click();
  await panel.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(panel).toHaveAttribute('data-liquid-glass-mode', 'reduced');
  await expect(panel).toHaveCSS('backdrop-filter', 'none');
  const dock = page.locator('.dos-dock');
  await expect(dock).toHaveAttribute('data-liquid-glass-mode', 'reduced');
  await expect(dock).toHaveCSS('background-image', 'none');
  await expect(dock).toHaveCSS('backdrop-filter', 'none');
  assert.equal(await dock.evaluate(element => getComputedStyle(element).backgroundColor), await page.evaluate(() => { const test=document.createElement('div');test.style.background='Canvas';document.body.append(test);const color=getComputedStyle(test).backgroundColor;test.remove();return color; }));
  await page.emulateMedia({ forcedColors: 'none' });
  await expect.poll(() => panel.evaluate(element => {
    const quality = element.closest('.dindbos-host').dataset.glassQuality;
    return element.dataset.liquidGlassMode === (quality === 'frosted' ? 'frosted' : 'refraction');
  })).toBe(true);
  await expect(panel).toHaveCSS('backdrop-filter', /url\(|blur\(/);
  await panel.getByRole('button', { name: /System Settings/ }).click();
  await expect(page.locator('.dos-window[data-app-id="settings"]')).toBeVisible();
  assert.deepEqual(errors, []);
  const result = { url: base, panelPixels, dockPixels, surfaces, errors, checks: ['ABBA pixel stability', 'live real desktop', 'Applications integrated chrome without glass opt-in', 'Dock', 'light/dark', 'forced colors', 'foreground Settings action'] };
  await writeFile(join(output, 'evidence.json'), JSON.stringify(result, null, 2));
  console.log('integrated liquid glass smoke ok', JSON.stringify({ panelPixels, dockPixels }));
} catch (error) {
  console.error('Integrated glass state at failure', await page?.locator('[data-liquid-glass-mode]').evaluateAll(elements => elements.map(element => ({
    class: element.className, mode: element.dataset.liquidGlassMode,
    inline: element.style.backdropFilter, computed: getComputedStyle(element).backdropFilter,
    forced: matchMedia('(forced-colors: active)').matches,
    quality: element.closest('.dindbos-host')?.dataset.glassQuality,
  }))).catch(() => []));
  throw error;
} finally { await browser.close(); }
