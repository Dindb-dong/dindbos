import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const repository = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(), '..');
const output = resolve(repository, 'internal/docs/platform-apps/auto-selection');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const visitors = [
  { os: 'macos', platform: 'MacIntel', agent: 'Macintosh', touch: 0, desktop: 'windows', mobile: 'android' },
  { os: 'windows', platform: 'Win32', agent: 'Windows NT 10.0', touch: 0, desktop: 'macos', mobile: 'ios' },
  { os: 'android', platform: 'Linux armv8l', agent: 'Android 16', touch: 5, desktop: 'macos', mobile: 'ios' },
  { os: 'ios', platform: 'iPhone', agent: 'iPhone', touch: 5, desktop: 'windows', mobile: 'android' },
  { os: 'ipad', platform: 'MacIntel', agent: 'Macintosh', touch: 5, desktop: 'windows', mobile: 'android' },
];
try {
  for (const visitor of visitors) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: `Mozilla/5.0 (${visitor.agent}) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36`, reducedMotion: 'reduce' });
    await context.addInitScript(({ platform, touch }) => {
      Object.defineProperties(navigator, { platform: { value: platform }, maxTouchPoints: { value: touch }, userAgentData: { value: undefined } });
    }, visitor);
    const page = await context.newPage();
    await page.goto(new URL('scripts/fixtures/platform-apps.html?style=auto&width=1280', process.env.DINDBOS_QA_URL || 'http://127.0.0.1:5186/').href);
    await page.waitForFunction(() => window.platformAppsQA);
    const root = page.locator('#platform-apps-host');
    await expect(root).toHaveAttribute('data-ui-style', visitor.desktop);
    await page.evaluate(() => window.platformAppsQA.show('text'));
    const editor = root.getByRole('textbox', { name: 'Document text', exact: true });
    await editor.fill(`${visitor.os} unsaved draft`);
    for (const [width, height, style] of [[390, 844, visitor.mobile], [740, 390, ['macos', 'windows'].includes(visitor.os) ? visitor.mobile : visitor.desktop], [390, 844, visitor.mobile], [1280, 900, visitor.desktop]]) {
      await page.setViewportSize({ width, height });
      await root.evaluate((element, size) => { element.style.width = `${size.width}px`; element.style.height = `${size.height}px`; }, { width, height });
      await expect(root).toHaveAttribute('data-ui-style', style);
      await expect(editor).toHaveValue(`${visitor.os} unsaved draft`);
      await expect(root.locator('.dos-window[data-app-id=text]')).toHaveCount(1);
      await expect(root.locator('.dos-dock .dos-app-icon').first()).toHaveAttribute('data-icon-style', style);
      await root.screenshot({ path: resolve(output, `${visitor.os}-${width}x${height}-${style}.png`), animations: 'disabled' });
    }
    await page.evaluate(async () => {
      const root = window.platformAppsQA.os.root;
      await window.platformAppsQA.os.destroy();
      const { mountDindbOSDesktop } = await import('/src/sdk/desktop.js');
      window.customOS = await mountDindbOSDesktop({ root, ui: { autoStyles: { macos: { desktop: 'macos', mobile: 'ios' }, windows: { desktop: 'windows', mobile: 'android' }, ios: { desktop: 'ios', mobile: 'windows' }, android: { desktop: 'android', mobile: 'windows' } } }, storage: { backend: 'memory' }, bootScreen: false, bootstrapPackages: false });
    });
    await expect(root).toHaveAttribute('data-ui-style', visitor.os === 'ipad' ? 'ios' : visitor.os);
    await page.evaluate(() => window.customOS.destroy());
    assert.equal(await root.locator('[data-mobile-app-back]').count(), 0);
    console.log(`${visitor.os}: default desktop/compact/rotation, draft and icon preservation, consumer rule override passed`);
    await context.close();
  }
} finally { await browser.close(); }
