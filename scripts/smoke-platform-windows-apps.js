import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";

const primary = dirname(resolve(execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
const output = process.env.DINDBOS_QA_OUTPUT || resolve(primary, "internal/docs/platform-apps/windows/runtime");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  // Keep this evidence run stable while other platform lanes edit Vite modules.
  await page.routeWebSocket("**", socket => socket.close());
  page.on("pageerror", error => errors.push(error.message));
  const base = process.env.DINDBOS_QA_URL || "http://127.0.0.1:5186/";
  await page.goto(new URL("scripts/fixtures/platform-apps.html?style=windows&width=1280", base).href);
  await page.locator('[data-qa-ready="true"]').waitFor();
  await expect.poll(() => page.locator('.dindbos-host').evaluate(element => getComputedStyle(element).getPropertyValue('--win-text').trim())).toBe('#1b1b1b');
  const ids = await page.evaluate(() => window.platformAppsQA.appIds);
  assert.equal(ids.length, 16);
  const show = async id => {
    await page.evaluate(id => window.platformAppsQA.show(id), id);
    const frame = page.locator(`.dos-window[data-app-id="${id}"]:not([hidden])`);
    await expect(frame).toBeVisible();
    await expect(frame.locator('.dos-window-content > *').first()).toBeVisible();
    return frame;
  };
  for (const id of ids) {
    const frame = await show(id);
    await frame.screenshot({ path: resolve(output, `${id}.png`) });
    const controlGeometry = await frame.locator('.dos-window-content button:visible').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      const pane = element.closest('.dos-window-content').getBoundingClientRect();
      return { name: element.getAttribute('aria-label') || element.textContent, right: box.right, bottom: box.bottom, paneRight: pane.right, paneBottom: pane.bottom };
    }));
    if (id === 'calculator') for (const control of controlGeometry) assert(control.bottom <= control.paneBottom + 2, `calculator control clipped: ${control.name}`);
  }
  let frame = await show('calculator');
  await frame.getByRole('button', { name: '7', exact: true }).click();
  await frame.getByRole('button', { name: 'Add', exact: true }).click();
  await frame.getByRole('button', { name: '2', exact: true }).click();
  await frame.getByRole('button', { name: 'Equals', exact: true }).click();
  await expect(frame.getByLabel('Result', { exact: true })).toHaveText('9');
  await frame.getByRole('button', { name: 'Calculation history', exact: true }).click();
  await expect(frame.locator('.calculator-history')).toBeVisible();
  frame = await show('notes');
  await frame.getByRole('textbox', { name: 'Note title', exact: true }).fill('Windows preserved draft');
  await frame.getByRole('textbox', { name: 'Note text', exact: true }).fill('The original note editor still saves.');
  await show('calendar');
  frame = await show('notes');
  await expect(frame.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('Windows preserved draft');
  frame = await show('reminders');
  await frame.getByRole('textbox', { name: 'New reminder', exact: true }).fill('Check Windows task flow');
  await frame.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await expect(frame.getByRole('checkbox', { name: 'Complete Check Windows task flow', exact: true })).toBeVisible();
  await frame.getByRole('checkbox', { name: 'Complete Check Windows task flow', exact: true }).click();
  frame = await show('settings');
  await frame.getByRole('tab', { name: /Privacy & Security/ }).click();
  await expect(frame.locator('[data-settings-section="security"]')).toBeVisible();
  await page.evaluate(() => window.platformAppsQA.os.setAppearance({ mode: 'dark' }));
  for (const id of ['settings', 'calculator', 'clock', 'notes', 'files']) {
    frame = await show(id);
    await frame.screenshot({ path: resolve(output, `${id}-dark.png`) });
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('#platform-apps-host').evaluate(element => { element.style.width = '600px'; });
  for (const id of ['files', 'settings', 'notes', 'music', 'browser']) {
    frame = await show(id);
    await frame.screenshot({ path: resolve(output, `${id}-narrow.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`Windows app interiors passed: ${ids.length} apps, calculator/history, note state, reminders, settings navigation, dark and narrow captures`);
} finally {
  await browser.close();
}
