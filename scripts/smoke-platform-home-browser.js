import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { groupMobileHomeEntries } from "../src/ui/desktop-view.js";

const plain = [{ name: "Files", appId: "files" }];
assert.equal(groupMobileHomeEntries(plain), plain, "No empty folder");
const entries = [...plain, ...Array.from({ length: 6 }, (_, i) => ({ name: `Career ${i}`, appId: `experience-${i}` }))];
const grouped = groupMobileHomeEntries(entries);
assert.equal(grouped.length, 2);
assert.equal(grouped[1].children.length, 6);
assert.equal(entries.length, 7, "Grouping never mutates source entries");
assert.equal(groupMobileHomeEntries([...plain, { appId: "experience-one" }]).length, 2, "Single app stays ungrouped");

const output = process.env.DINDBOS_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.DINDBOS_QA_URL || "http://127.0.0.1:5186/?style=ios");
  await page.locator(".dos-boot-screen").waitFor({ state: "detached" });
  await page.evaluate(async () => {
    document.querySelector("#dindbos-root").style.display = "none";
    const { mountDindbOSDesktop } = await import("/src/sdk/desktop.js");
    const root = document.createElement("div");
    root.id = "home-test";
    Object.assign(root.style, { width: "390px", height: "844px" });
    document.body.append(root);
    window.homeOS = await mountDindbOSDesktop({ root, ui: { style: "ios", liquidGlass: false }, bootScreen: false, bootstrapPackages: false,
      storage: { backend: "memory", name: "home-regression" },
      apps: Array.from({ length: 6 }, (_, i) => ({ id: `experience-${i}`, name: `Career ${i}`, icon: "portfolio", pinned: true, desktop: true, singleton: true,
        render({ content }) { content.textContent = `Career detail ${i}`; } })),
    });
  });
  const root = page.locator("#home-test");
  const folder = root.getByRole("button", { name: "Open Experience", exact: true });
  await expect(folder).toBeVisible();
  await expect(folder.locator(".dos-folder-preview svg")).toHaveCount(4);
  await expect(root.locator(".dos-dock-item")).toHaveCount(4);
  assert.equal(await root.locator(".dos-desktop").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length), 4);
  await folder.click();
  const dialog = root.getByRole("dialog", { name: "Experience", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-folder-app-id]")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(folder).toBeFocused();
  await folder.click();
  await dialog.getByRole("button", { name: "Open Career 5", exact: true }).click();
  await expect(root.locator('.dos-window[data-app-id="experience-5"]')).toContainText("Career detail 5");
  await expect(dialog).toHaveCount(0);
  await root.getByRole("button", { name: "Home", exact: true }).click();
  await folder.click();
  await dialog.getByRole("button", { name: "Close folder" }).click();
  await expect(dialog).toHaveCount(0);
  if (output) await root.screenshot({ path: resolve(output, "ios-home.png") });
  await root.evaluate((e) => { e.style.width = "1280px"; });
  await folder.click();
  await dialog.getByRole("button", { name: "Open Career 4", exact: true }).click();
  await expect(root.locator('.dos-window[data-app-id="experience-4"]')).toContainText("Career detail 4");
  await root.getByRole("button", { name: "Home", exact: true }).click();
  await root.evaluate((e) => { e.style.width = "390px"; });
  await folder.click();
  if (output) await root.screenshot({ path: resolve(output, "ios-folder.png") });
  await root.getByRole("button", { name: "Home", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.homeOS.setUIStylePreference({ mobile: "android" }));
  await expect(root).toHaveAttribute("data-ui-style", "android");
  await expect(root.getByRole("button", { name: "Open Experience", exact: true })).toHaveCount(0);
  await expect(root.locator('.dos-desktop [data-desktop-app-id^="experience-"]')).toHaveCount(6);
  for (const [width, columns] of [[320, 4], [390, 4], [480, 5]]) {
    await root.evaluate((e, width) => { e.style.width = `${width}px`; }, width);
    await expect(root.locator(".dos-desktop")).toHaveCSS("grid-template-columns", new RegExp(`^(?:[0-9.]+px ?){${columns}}$`));
    assert.equal(await root.locator(".dos-desktop").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length), columns);
    assert.equal(await root.evaluate((e) => e.scrollWidth > e.clientWidth), false);
    await expect(root.locator(".dos-android-heading")).toHaveCount(0);
    assert.ok(await root.locator(".dos-dock-item:visible").count() <= 5);
  }
  await page.evaluate(() => window.homeOS.destroy());
  assert.deepEqual(errors, []);
  console.log("Mobile home smoke passed: four columns, four dock apps, 2x2 folder preview, all six apps reachable, keyboard/focus/dismiss/launch, Android ungrouped");
} finally { await browser.close(); }
