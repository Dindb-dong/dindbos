import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const repository = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(), '..');
const output = resolve(process.env.DINDBOS_QA_OUTPUT || resolve(repository, 'internal/docs/platform-apps/android/runtime'));
const server = process.env.DINDBOS_QA_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: true, hmr: false, watch: null } });
await server?.listen();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [], coverage = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL('/scripts/fixtures/platform-apps.html?style=android&width=390', process.env.DINDBOS_QA_URL || 'http://127.0.0.1:5191');
  await page.goto(url.href);
  await page.locator('[data-qa-ready=true]').waitFor();
  const ids = await page.evaluate(() => window.platformAppsQA.appIds);
  assert.equal(ids.length, 16);
  for (const id of ids) {
    await page.evaluate(id => window.platformAppsQA.show(id), id);
    const app = page.locator(`.dos-window[data-app-id="${id}"]`).last();
    await expect(app).toBeVisible();
    await app.screenshot({ path: resolve(output, `${id}.png`) });
    const bounds = await app.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, `${id}: contained window`);
    const size = await app.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert(size.scroll <= size.width + 1, `${id}: window horizontal overflow ${JSON.stringify(size)}`);
    coverage.push({ id, screenshot: `${id}.png`, width: bounds.width });
  }
  await page.evaluate(() => window.platformAppsQA.show('calculator'));
  const calc = page.locator('.calculator-app');
  await calc.getByRole('button', { name: 'Clear', exact: true }).click();
  for (const name of ['7','Add','8','Equals']) await calc.getByRole('button', { name, exact: true }).click();
  await expect(calc.getByLabel('Result', { exact: true })).toHaveText('15');
  await page.evaluate(() => window.platformAppsQA.show('notes'));
  const notes = page.locator('.dos-window[data-app-id="notes"]');
  const newNote = notes.locator('[data-mobile-note-new]');
  if (await newNote.count()) await newNote.click();
  else await notes.getByRole('button', { name: 'New note', exact: true }).click();
  await notes.getByRole('textbox', { name: 'Note title', exact: true }).fill('Samsung design check');
  await notes.getByRole('textbox', { name: 'Note text', exact: true }).fill('Draft remains after Home and restore.');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(() => window.platformAppsQA.show('notes'));
  await expect(notes.getByRole('textbox', { name: 'Note text', exact: true })).toHaveValue('Draft remains after Home and restore.');
  if (await notes.locator('[data-mobile-app-back]').count()) {
    await notes.locator('[data-mobile-app-back]').click();
    await expect(notes).toHaveAttribute('data-mobile-pane', 'list');
    await notes.locator('[data-note-id]').filter({ hasText: 'Samsung design check' }).click();
    await expect(notes).toHaveAttribute('data-mobile-pane', 'detail');
  }
  await notes.screenshot({ path: resolve(output, 'notes-edited.png') });
  await page.evaluate(() => window.platformAppsQA.show('settings'));
  const settings = page.locator('.dos-window[data-app-id="settings"]');
  await settings.locator('[data-settings-section-button="wallpaper"]').click();
  await expect(settings.locator('[data-settings-section="wallpaper"]')).toBeVisible();
  if (await settings.locator('[data-mobile-app-back]').count()) {
    await settings.locator('[data-mobile-app-back]').click();
    await expect(settings).toHaveAttribute('data-mobile-pane', 'list');
  }
  await page.evaluate(() => window.platformAppsQA.os.setAppearance({ mode: 'dark' }));
  await settings.screenshot({ path: resolve(output, 'settings-dark.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('#platform-apps-host').evaluate(element => { element.style.width = '320px'; element.style.height = '740px'; });
  for (const id of ['files','browser','notes','reminders','calendar','clock','photos','music','calculator']) {
    await page.evaluate(id => window.platformAppsQA.show(id), id);
    const app = page.locator(`.dos-window[data-app-id="${id}"]`).last();
    const size = await app.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert(size.scroll <= size.width + 1, `${id}: 320px window horizontal overflow ${JSON.stringify(size)}`);
    await app.screenshot({ path: resolve(output, `${id}-320-dark.png`) });
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  await writeFile(resolve(output, 'coverage.json'), JSON.stringify(coverage, null, 2));
  console.log('Samsung app smoke passed: all16 screenshots, calculator, notes draft/Home/Back, Settings, 320px dark layouts');
} finally { await browser.close(); await server?.close(); }
