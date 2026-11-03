import assert from "node:assert/strict";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createServer } from "vite";

const output = new URL("../docs/assets/", import.meta.url).pathname;
const temporary = new URL("../internal/docs/qa/showcase-video/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let context;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference", recordVideo: { dir: temporary, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".dos-menubar").waitFor();
  await page.locator(".dos-boot-screen").waitFor({ state: "detached" });
  await page.screenshot({ path: `${output}desktop-empty.png` });
  await page.locator('[data-dock-app-id="files"]').click();
  const files = page.locator('.dos-window[data-app-id="files"]');
  await files.waitFor();
  await moveWindow(page, files, 65, 115);
  await page.locator('[data-dock-app-id="counter"]').click();
  const counter = page.locator('.dos-window[data-app-id="counter"]');
  await counter.waitFor();
  await moveWindow(page, counter, 830, 250);
  await page.getByRole("button", { name: "Increase count", exact: true }).click();
  await page.getByRole("button", { name: "Increase count", exact: true }).click();
  await page.mouse.move(1420, 100);
  await page.screenshot({ path: `${output}desktop.png` });
  await counter.getByRole("button", { name: "Minimize", exact: true }).first().click();
  await page.locator('[data-dock-app-id="counter"]').click();
  assert.equal(await page.locator('.demo-counter output').textContent(), "2");
  await page.locator('.dos-system-menu').click();
  await page.getByRole('menuitem', { name: 'System Settings…', exact: true }).click();
  const settings = page.locator('.dos-window[data-app-id="settings"]');
  await settings.locator('[data-settings-section-button="wallpaper"]').click();
  await settle(settings);
  await page.screenshot({ path: `${output}settings-wallpaper.png` });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await settings.waitFor({ state: 'detached' });
  await page.locator('[data-shell-panel="controls"]').click();
  await page.getByRole('dialog', { name: 'Control Center', exact: true }).waitFor();
  await settle(page.getByRole('dialog', { name: 'Control Center', exact: true }));
  await page.screenshot({ path: `${output}control-center.png` });
  const panel = page.getByRole("dialog", { name: "Control Center", exact: true });
  await panel.waitFor();
  await panel.locator('[data-shell-action="mode"][data-value="dark"]').click();
  await page.keyboard.press("Escape");
  await expect.poll(() => counter.evaluate((element) => !element.classList.contains("is-restoring") && element.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true);
  await page.screenshot({ path: `${output}desktop-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-dock-app-id="counter"]').click();
  await page.mouse.move(380, 150);
  await page.screenshot({ path: `${output}mobile.png` });
  assert.deepEqual(errors, [], "showcase flows must not produce runtime errors");
  const video = page.video();
  await context.close();
  context = null;
  await copyFile(await video.path(), `${output}demo.webm`);
  await rm(temporary, { recursive: true, force: true });
  console.log("Showcase captured: actual desktop, dark, mobile and real-motion video; React state survives minimize/restore");
} finally {
  await context?.close();
  await browser.close();
  await server.close();
}

async function moveWindow(page, target, left, top) {
  const rect = await target.boundingBox();
  const title = target.locator(".dos-window-titlebar");
  const box = await title.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(left + rect.width / 2, top + 20, { steps: 20 });
  await page.mouse.up();
}

async function settle(target) {
  await expect.poll(() => target.evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState !== "running"))).toBe(true);
}
