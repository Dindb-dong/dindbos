import assert from "node:assert/strict";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const output = new URL("../docs/assets/", import.meta.url).pathname;
const temporary = new URL("../internal/docs/qa/showcase-video/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let context;
try {
  // A fresh browser context owns its storage; no user profile or saved documents are opened.
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", recordVideo: { dir: temporary, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator(".dos-menubar").waitFor();
  await page.locator(".dos-boot-screen").waitFor({ state: "detached" });
  await expect(page.locator('.dos-window')).toHaveCount(0);
  await capture(page, "desktop-empty.png");

  await page.locator('[data-dock-app-id="files"]').click();
  const files = page.locator('.dos-window[data-app-id="files"]').first();
  await files.locator('[data-nav="/usr/share/applications"]').click();
  await resizeWindow(page, files, 740, 550);
  await moveWindow(page, files, 54, 95);

  await launch(page, "notes", "Notes");
  const notes = page.locator('.dos-window[data-app-id="notes"]');
  await notes.getByRole("button", { name: "New Note", exact: true }).click();
  await notes.getByLabel("Note title", { exact: true }).fill("Your corner of the web");
  await notes.getByLabel("Note text", { exact: true }).fill("Bring your own components.\nOpen them as apps.\n\nFiles. Notes. A familiar Dock.\nInside one part of your website.\n\nYour apps. Your theme. Your rules.");
  await resizeWindow(page, notes, 700, 480);
  await moveWindow(page, notes, 650, 210);
  await page.locator('[data-dock-app-id="calculator"]').click();
  const calculator = page.locator('.dos-window[data-app-id="calculator"]');
  await moveWindow(page, calculator, 1138, 397);
  await calculator.locator('[data-key="7"]').click();
  await calculator.getByRole('button', { name: 'Multiply', exact: true }).click();
  await calculator.locator('[data-key="8"]').click();
  await calculator.getByRole('button', { name: 'Equals', exact: true }).click();
  await capture(page, "desktop.png");
  await calculator.getByRole("button", { name: "Close", exact: true }).click();
  await expect(calculator).toHaveCount(0);

  await page.locator('.dos-system-menu').click();
  await page.getByRole('menuitem', { name: 'System Settings…', exact: true }).click();
  const settings = page.locator('.dos-window[data-app-id="settings"]');
  await settings.locator('[data-settings-section-button="wallpaper"]').click();
  await moveWindow(page, settings, 220, 78);
  await capture(page, "settings-wallpaper.png");
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toHaveCount(0);

  await page.locator('[data-shell-panel="controls"]').click();
  const panel = page.getByRole("dialog", { name: "Control Center", exact: true });
  await expect(panel).toBeVisible();
  await capture(page, "control-center.png");
  await panel.locator('[data-shell-action="mode"][data-value="dark"]').click();
  await page.keyboard.press("Escape");
  await capture(page, "desktop-dark.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-dock-app-id="notes"]').click();
  assert.match(await notes.getByLabel('Note text', { exact: true }).inputValue(), /Your apps/);
  await capture(page, "mobile.png");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-shell-panel="controls"]').click();
  await panel.locator('[data-shell-action="mode"][data-value="light"]').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-app-id="notes"]').click();
  await notes.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.locator('[data-dock-app-id="files"]').click();
  await resizeWindow(page, files, 840, 620);
  await moveWindow(page, files, 170, 95);
  await files.locator('[data-nav="/home/guest/Documents"]').click();
  const document = files.locator('.files-row').filter({ hasText: 'todo.md' }).first();
  await document.click({ button: 'right' });
  const menu = files.locator('..').getByRole('menu', { name: 'File actions', exact: true });
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-action="open-with"]').hover();
  await page.getByRole('menu', { name: 'Open With submenu', exact: true }).waitFor();
  await capture(page, "files-context-menu.png", false);
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-app-id="applications"]').click();
  await capture(page, "applications.png");
  const applications = page.locator('.dos-window[data-app-id="applications"]');
  await applications.getByRole('button', { name: 'Close', exact: true }).click();

  await page.locator('[data-dock-app-id="counter"]').click();
  const counter = page.locator('.dos-window[data-app-id="counter"]');
  await moveWindow(page, counter, 820, 210);
  await counter.getByRole('button', { name: 'Increase count', exact: true }).click();
  await counter.getByRole('button', { name: 'Increase count', exact: true }).click();
  await capture(page, "react-app.png");
  await counter.getByRole('button', { name: 'Minimize', exact: true }).first().click();
  await page.locator('[data-dock-app-id="counter"]').click();
  await expect(counter.locator('output')).toHaveText('2');
  await settle(page);
  assert.deepEqual(errors, [], "showcase flows must not produce runtime errors");
  const video = page.video();
  await context.close(); context = null;
  await copyFile(await video.path(), `${output}demo.webm`);
  console.log("Showcase captured: actual latest built-in apps, empty desktop, dark/mobile, wallpaper, Control Center, Applications, file menu and React state restoration");
} catch (error) {
  const page = context?.pages()[0];
  if (page) await page.screenshot({ path: new URL("../internal/docs/qa/showcase-failure.png", import.meta.url).pathname }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await browser.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}

async function capture(page, name, movePointer = true) {
  if (movePointer) {
    const viewport = page.viewportSize();
    await page.mouse.move(viewport.width - 8, 36);
  }
  await settle(page);
  await page.screenshot({ path: `${output}${name}` });
}

async function launch(page, id, query) {
  await page.getByRole('button', { name: 'Search applications', exact: true }).click();
  await page.locator('[data-shell-search]').fill(query);
  await page.locator(`[data-launch-result][data-app="${id}"]`).click();
  await page.locator(`.dos-window[data-app-id="${id}"]`).waitFor();
}

async function dragPoint(frame) {
  return frame.evaluate(element => {
    const regions = [...element.querySelectorAll('[data-window-drag], .dos-window-titlebar')];
    for (const region of regions) {
      const bounds = region.getBoundingClientRect();
      if (bounds.height < 5 || bounds.width < 5) continue;
      for (let x = bounds.left + 8; x < bounds.right - 8; x += 12) {
        const y = bounds.top + Math.min(22, bounds.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (region.contains(hit) && !hit.closest('button, input, textarea, a, select, summary, label, [data-no-drag]')) return { x, y };
      }
    }
    throw new Error('No exposed window drag surface');
  });
}

async function moveWindow(page, frame, left, top) {
  const rect = await frame.boundingBox();
  const point = await dragPoint(frame);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + left - rect.x, point.y + top - rect.y, { steps: 16 });
  await page.mouse.up(); await settle(page);
}

async function resizeWindow(page, frame, width, height) {
  const before = await frame.boundingBox();
  const grip = await frame.locator('[data-resize="bottom-right"]').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + width - before.width, grip.y + grip.height / 2 + height - before.height, { steps: 12 });
  await page.mouse.up(); await settle(page);
}

async function settle(page) {
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.dos-window, .dos-shell-panel')].every(element => element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
}
