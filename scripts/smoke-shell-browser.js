import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const output = process.env.DINDBOS_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(process.env.DINDBOS_QA_URL || "http://127.0.0.1:5174/");
  await page.locator(".dos-menubar").waitFor();
  await page.locator(".dos-boot-screen").waitFor({ state: "detached" });
  const checkCompact = async () => {
    await expect(page.locator(".dos-menu-label").first()).toBeHidden();
    await expect(page.locator(".dos-clock-date")).toBeHidden();
    await expect(page.locator(".dos-clock-time")).toBeVisible();
    const [apps, status, host] = await Promise.all([".dos-app-menus", ".dos-menu-status", ".dindbos-host"].map((selector) => page.locator(selector).boundingBox()));
    assert(apps.x + apps.width <= status.x, "application and status groups must not overlap");
    assert(status.x + status.width <= host.x + host.width, "status controls must fit the host");
  };
  await checkCompact();
  await page.locator(".dos-active-app").click();
  await expect(page.getByRole("menuitem", { name: "File…", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "File…", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "New Files Window", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".dos-active-app")).toBeFocused();
  await page.getByRole("button", { name: "Control Center", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Control Center", exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".dos-control-center").evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1);
  const panelGeometry = await page.locator(".dos-menubar").evaluate((element) => ({ rect: element.getBoundingClientRect().toJSON(), parentScroll: element.parentElement.scrollLeft, rootScroll: element.closest(".dindbos-host").scrollLeft, first: element.querySelector("button").getBoundingClientRect().toJSON() }));
  assert.equal(panelGeometry.parentScroll, 0, "opening a panel must not scroll the shell sideways");
  assert.equal(panelGeometry.rootScroll, 0);
  assert(panelGeometry.first.x >= 0 && panelGeometry.rect.right <= 390, "compact menu controls stay within the viewport");
  if (output) await page.screenshot({ path: join(output, "shell-mobile.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 844 });
  await checkCompact();
  await page.setViewportSize({ width: 700, height: 844 });
  await checkCompact();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".dindbos-host").evaluate((element) => { element.style.width = "390px"; });
  await checkCompact();
  if (output) await page.screenshot({ path: join(output, "shell-narrow-host.png") });
  await page.locator(".dindbos-host").evaluate((element) => { element.style.width = "100%"; });
  await expect(page.locator(".dos-menu-label").first()).toBeVisible();
  await expect(page.locator(".dos-clock-date")).toBeVisible();
  await page.locator('.dos-window[data-app-id="welcome"] button[aria-label="Close"]').click();
  // The wallpaper includes shell gutters outside the icon grid.
  for (const point of [{ x: 5, y: 400 }, { x: 600, y: 400 }, { x: 1436, y: 892 }]) {
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(page.getByRole("menu", { name: "desktop menu", exact: true })).toBeVisible();
    const box = await page.locator('.dos-shell-menu').boundingBox();
    assert(box.x >= 0 && box.y >= 30 && box.x + box.width <= 1440 && box.y + box.height <= 900, "context menu is clamped inside its desktop");
    await page.keyboard.press("Escape");
  }
  const readme = page.locator('.dos-icon[aria-label="Open README.md"]');
  await readme.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
  if (output) await page.screenshot({ path: join(output, "desktop-context-menu.png") });
  await page.keyboard.press("Escape");
  await expect(readme).toBeFocused();
  await readme.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await expect(page.locator('.dos-window[data-app-id="viewer"]')).toBeVisible();
  console.log("Shell browser smoke passed: mobile and embedded menu fit, compact menu access, focus restoration, control panel");
} finally {
  await browser.close();
}
