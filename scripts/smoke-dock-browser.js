import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const output = process.env.DINDBOS_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto(process.env.DINDBOS_QA_URL || "http://127.0.0.1:5174/");
  const files = page.locator('.dos-dock-item[data-dock-app-id="files"]');
  await files.waitFor();
  await page.locator('.dos-boot-screen').waitFor({ state: "detached" });
  const box = await files.boundingBox();
  await page.evaluate(() => {
    const events = [];
    const read = Element.prototype.getBoundingClientRect, write = CSSStyleDeclaration.prototype.setProperty;
    Element.prototype.getBoundingClientRect = function (...args) { if (this.matches('.dos-dock-item')) events.push('read'); return read.apply(this, args); };
    CSSStyleDeclaration.prototype.setProperty = function (name, ...args) { if (name === '--dock-proximity') events.push('write'); return write.call(this, name, ...args); };
    window.__dockReadWrite = () => {
      Element.prototype.getBoundingClientRect = read; CSSStyleDeclaration.prototype.setProperty = write;
      return events;
    };
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => files.evaluate((el) => Number(el.style.getPropertyValue("--dock-proximity")))).toBeGreaterThan(.7);
  const operations = await page.evaluate(() => window.__dockReadWrite());
  assert(operations.includes('read') && operations.includes('write'));
  assert(operations.lastIndexOf('read') < operations.indexOf('write'), 'Dock frame reads all bounds before writing any proximity');
  await expect.poll(() => files.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(box.width + 1);
  const values = await page.locator('.dos-dock-item').evaluateAll((items) => items.map((el) => Number(el.style.getPropertyValue("--dock-proximity"))));
  assert(values[1] > values[2] && values[2] > values[3], "Dock enlargement tapers with pointer distance");
  await page.mouse.move(1400, 40);
  await expect.poll(() => files.evaluate((el) => el.style.getPropertyValue("--dock-proximity"))).toBe("");
  await files.click();
  await expect(files).toHaveAttribute("aria-label", "Focus Files");
  const fileWindow = page.locator('.dos-window[data-app-id="files"]');
  await expect.poll(() => fileWindow.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  if (output) await page.screenshot({ path: join(output, "dock-desktop.png") });
  await fileWindow.getByRole("button", { name: "Minimize", exact: true }).click();
  await expect(files).toHaveAttribute("aria-label", "Restore Files");
  await files.click();
  await expect(files).toHaveAttribute("aria-label", "Focus Files");
  await fileWindow.getByRole("button", { name: "Close", exact: true }).click();
  const readme = page.locator('.dos-icon[aria-label="Open README.md"]');
  await readme.focus();
  await readme.press("Enter");
  await expect(page.locator('.dos-window')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.locator('.dos-dock').evaluate((el) => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: document.documentElement.clientWidth }));
  assert(narrow.left >= 0 && narrow.right <= narrow.width + 1, "Dock remains inside narrow host");
  if (output) await page.screenshot({ path: join(output, "dock-mobile.png") });
  await context.close();
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(process.env.DINDBOS_QA_URL || "http://127.0.0.1:5174/");
  const reducedFiles = reducedPage.locator('.dos-dock-item[data-dock-app-id="files"]');
  await reducedFiles.waitFor();
  await reducedPage.locator('.dos-boot-screen').waitFor({ state: "detached" });
  const reducedBox = await reducedFiles.boundingBox();
  await reducedPage.mouse.move(reducedBox.x + reducedBox.width / 2, reducedBox.y + reducedBox.height / 2);
  assert.equal(await reducedFiles.evaluate((el) => el.style.getPropertyValue("--dock-proximity")), "");
  await reduced.close();
  console.log("Dock browser smoke passed: batched layout reads/writes, pointer falloff/reset, running/restore labels, keyboard open, narrow host, reduced motion");
} finally {
  await browser.close();
}
