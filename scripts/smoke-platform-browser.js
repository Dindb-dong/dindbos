import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const url = process.env.DINDBOS_QA_URL || "http://127.0.0.1:5186/";
const output = process.env.DINDBOS_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  const demoURL = new URL(url);
  demoURL.searchParams.set('style', 'macos');
  await page.goto(demoURL.href);
  await page.locator('.dindbos-host[data-ui-style="macos"]').waitFor();
  await page.locator(".dos-boot-screen").waitFor({ state: "detached" });
  await page.evaluate(async () => {
    document.querySelector("#dindbos-root").style.display = "none";
    const { mountDindbOSDesktop } = await import("/src/sdk/desktop.js");
    window.platformMount = async (ui, width) => {
      await window.platformOS?.destroy();
      document.querySelector("#platform-test")?.remove();
      const root = document.createElement("div");
      root.id = "platform-test";
      Object.assign(root.style, { position: "relative", width: `${width}px`, height: "844px" });
      document.body.append(root);
      window.platformOS = await mountDindbOSDesktop({
        root, ui: { ...ui, liquidGlass: false }, bootScreen: false,
        storage: { backend: "memory", name: "platform-regression" }, bootstrapPackages: false,
        apps: [{ id: "draft", name: "Draft", icon: "text", singleton: true, pinned: true, desktop: true,
          render({ content }) { content.innerHTML = '<label>Draft text<input aria-label="Draft text" value="Unsaved"></label><button type="button">Keep working</button>'; } }],
      });
    };
  });
  for (const style of ["macos", "windows", "ios", "android"]) {
    const width = ["ios", "android"].includes(style) ? 390 : 1280;
    await page.evaluate(({ style, width }) => window.platformMount({ style }, width), { style, width });
    const root = page.locator("#platform-test");
    await expect(root).toHaveAttribute("data-ui-style", style);
    await expect(root.locator(".dos-dock .dos-app-icon").first()).toHaveAttribute("data-icon-style", style);
    await root.evaluate(async (element) => {
      const { mountAppIcon } = await import("/src/ui/app-icon.js");
      const target = element.ownerDocument.createElement("span");
      target.dataset.failedIconTest = ""; target.hidden = true; element.append(target);
      window.failedIconCleanup = mountAppIcon(target, "data:image/png;base64,invalid");
    });
    await expect(root.locator('[data-failed-icon-test] svg')).toHaveAttribute("data-icon-style", style);
    await page.evaluate(() => { window.failedIconCleanup(); document.querySelector('[data-failed-icon-test]').remove(); });
    if (output) await root.screenshot({ path: resolve(output, `${style}-home.png`) });
    await root.locator(["ios", "android"].includes(style) ? '[data-desktop-app-id="draft"]' : '[data-dock-app-id="draft"]').click();
    await root.getByRole("textbox", { name: "Draft text", exact: true }).fill(`${style} draft`);
    if (output) await root.screenshot({ path: resolve(output, `${style}-app.png`) });
    const box = await root.locator('.dos-window[data-app-id="draft"]').boundingBox();
    const host = await root.boundingBox();
    assert(box.x >= host.x && box.y >= host.y && box.x + box.width <= host.x + host.width + 1 && box.y + box.height <= host.y + host.height + 1, `${style}: window stays in host`);
    if (["ios", "android"].includes(style)) await root.getByRole("button", { name: "Home", exact: true }).click();
    else await page.evaluate(() => { window.platformOS.windows.minimize("draft"); });
    await expect(root.locator('.dos-window[data-app-id="draft"]')).toBeHidden();
    if (style === "android") {
      await root.getByRole("button", { name: "Recent apps", exact: true }).click();
      await root.getByRole("dialog", { name: "Recent apps" }).getByRole("button", { name: "Draft", exact: true }).click();
    } else await root.locator(style === "ios" ? '[data-desktop-app-id="draft"]' : '[data-dock-app-id="draft"]').click();
    await expect(root.getByRole("textbox", { name: "Draft text", exact: true })).toHaveValue(`${style} draft`);
    await page.evaluate(() => window.platformOS.setAppearance({ mode: "dark" }));
    await expect(root).toHaveAttribute("data-appearance", "dark");
    if (output) await root.screenshot({ path: resolve(output, `${style}-dark.png`) });
  }
  await page.evaluate(() => window.platformMount({ style: "windows", mobileStyle: "ios" }, 1280));
  const root = page.locator("#platform-test");
  await root.locator('[data-dock-app-id="draft"]').click();
  await root.getByRole("textbox", { name: "Draft text", exact: true }).fill("Survives responsive transitions");
  for (const [width, style] of [[760, "ios"], [761, "windows"], [320, "ios"], [1280, "windows"], [390, "ios"], [1280, "windows"]]) {
    await root.evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    await expect(root).toHaveAttribute("data-ui-style", style);
    await expect(root.locator(".dos-dock .dos-app-icon").first()).toHaveAttribute("data-icon-style", style);
    await expect(root.getByRole("textbox", { name: "Draft text", exact: true })).toHaveValue("Survives responsive transitions");
    await expect(root.locator(".dos-window")).toHaveCount(1);
    assert.equal(await root.evaluate((element) => element.scrollWidth > element.clientWidth), false, `${width}: host has no horizontal overflow`);
  }
  await page.evaluate(() => window.platformMount({ style: "android" }, 1280));
  await expect(root).toHaveAttribute("data-ui-style", "android");
  await root.evaluate((element) => { element.style.width = "390px"; });
  await expect(root).toHaveAttribute("data-ui-style", "android");
  await page.evaluate(() => {
    const outside = document.createElement("button");
    outside.id = "outside-platform";
    outside.textContent = "Outside desktop";
    Object.assign(outside.style, { position: "fixed", left: "500px", top: "20px" });
    outside.onclick = () => { outside.textContent = "Outer page works"; };
    document.body.append(outside);
  });
  await root.getByRole("button", { name: "Recent apps", exact: true }).click();
  await expect(root.getByRole("dialog", { name: "Recent apps" })).toBeVisible();
  await page.getByRole("button", { name: "Outside desktop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Outer page works", exact: true })).toBeFocused();
  await expect(root.getByRole("dialog", { name: "Recent apps" })).toHaveCount(0);
  await page.evaluate(() => window.platformOS.destroy());
  await expect(root).not.toHaveAttribute("data-ui-style", /.+/);
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("platform browser passed: four presets, real apps, preserved drafts, dark mode, embedded width, transitions, explicit overrides, cleanup");
} finally {
  await browser.close();
}
