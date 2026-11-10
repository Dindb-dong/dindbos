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
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => window.platformAppsQA.os.setAppearance({ mode }), mode);
    await expect(page.locator('.dindbos-host')).toHaveAttribute('data-appearance', mode);
    await page.mouse.move(0, 0);
    await expect(frame.locator('.calculator-toolbar > button').first()).toHaveCSS('background-color', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(43, 43, 43)');
    await expect(frame.locator('.calculator-mode > summary')).toHaveCSS('background-color', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(43, 43, 43)');
    for (const control of await frame.locator('.calculator-toolbar > button, .calculator-mode > summary').all()) await expect(control).toHaveCSS('color', mode === 'light' ? 'rgb(27, 27, 27)' : 'rgb(243, 243, 243)');
    const colors = await frame.locator('.calculator-toolbar > button, .calculator-mode > summary').evaluateAll(elements => elements.map(element => ({
      background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color,
    })));
    assert.equal(colors.length, 2);
    for (const color of colors) {
      assert.equal(color.background, mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(43, 43, 43)');
      assert.equal(color.foreground, mode === 'light' ? 'rgb(27, 27, 27)' : 'rgb(243, 243, 243)');
    }
    await expect(frame.locator('.calculator-history button strong').first()).toHaveCSS('color', mode === 'light' ? 'rgb(27, 27, 27)' : 'rgb(243, 243, 243)');
    await expect(frame.locator('.calculator-history button span').first()).toHaveCSS('color', mode === 'light' ? 'rgb(98, 98, 98)' : 'rgb(185, 185, 185)');
    await frame.screenshot({ path: resolve(output, `calculator-toolbar-${mode}.png`) });
    await frame.locator('.calculator-mode > summary').click();
    const basicMode = frame.getByRole('menuitemradio', { name: /Basic/ });
    await expect(basicMode).toHaveCSS('color', mode === 'light' ? 'rgb(27, 27, 27)' : 'rgb(243, 243, 243)');
    await frame.screenshot({ path: resolve(output, `calculator-mode-${mode}.png`) });
    await basicMode.click();
  }
  await page.evaluate(() => window.platformAppsQA.os.setAppearance({ mode: 'light' }));
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
  await page.evaluate(() => window.platformAppsQA.os.setAppearance({ mode: 'light' }));
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#platform-apps-host').evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    for (const id of ['files', 'notes']) {
      frame = await show(id);
      const geometry = await frame.evaluate(element => ({
        window: element.getBoundingClientRect().toJSON(),
        title: element.querySelector('.dos-window-titlebar').getBoundingClientRect().toJSON(),
        captions: [...element.querySelectorAll('.dos-window-controls button')].map(button => button.getBoundingClientRect().toJSON()),
      }));
      assert(Math.abs(geometry.title.width - (geometry.window.width - 2)) < 2, `${id} title bar truncated at ${width}px`);
      for (const caption of geometry.captions) assert(caption.left >= geometry.window.left && caption.right <= geometry.window.right, `${id} caption outside ${width}px window`);
      if (id === 'notes') {
        await expect(frame.locator('.notes-sidebar header strong')).toBeVisible();
        await frame.getByRole('textbox', { name: 'Note title', exact: true }).fill(`Narrow draft ${width}`);
        await frame.getByRole('textbox', { name: 'Note text', exact: true }).fill(`Edited at ${width} pixels.`);
        await expect(frame.getByRole('textbox', { name: 'Note text', exact: true })).toHaveValue(`Edited at ${width} pixels.`);
      } else {
        await frame.getByRole('button', { name: 'Locations', exact: true }).click();
        await frame.locator('.files-locations-sheet [data-location="/home/guest"]').first().click();
      }
      await frame.screenshot({ path: resolve(output, `${id}-${width}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Windows app interiors passed: ${ids.length} apps, calculator/history and theme contrast, note state, reminders, settings navigation, dark, 600px and 320/390px narrow captures`);
} finally {
  await browser.close();
}
