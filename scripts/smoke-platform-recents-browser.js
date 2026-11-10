import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const primary = repo.split("/.worktrees/")[0];
const output = resolve(process.env.DINDBOS_QA_OUTPUT || `${primary}/internal/docs/mobile-home-recents/runtime`);
await mkdir(output, { recursive: true });
const server = await createServer({ root: repo, server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [];
try {
  for (const style of ["android", "ios"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", recordVideo: { dir: `${output}/videos`, size: { width: 390, height: 844 } } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5198/scripts/fixtures/platform-apps.html?style=${style}&width=390`);
    const root = page.locator("#platform-apps-host");
    await expect(root).toHaveAttribute("data-qa-ready", "true");
    await page.addStyleTag({ content: `
      [data-recent-mobile-nav], [data-recent-frame-layout] { display: none; }
      .dos-window[data-app-id="recent-draft"] > .dos-window-content {
        container-type: inline-size; container-name: portfolio-window;
      }
      @container portfolio-window (max-width: 760px) {
        [data-recent-desktop-nav] { display: none; }
        [data-recent-mobile-nav] { display: block; }
      }
      @container recent-frame (max-width: 760px) {
        [data-recent-frame-layout] { display: block; }
      }
    ` });
    await page.evaluate(() => {
      const os = window.platformAppsQA.os;
      for (const task of [...os.windows.windows.values()]) os.windows.close(task.id, { force: true });
      os.registerApp({ id: "recent-draft", name: "Draft", icon: "text", singleton: true, render({ content }) { content.innerHTML = '<nav data-recent-desktop-nav>Desktop navigation</nav><nav data-recent-mobile-nav>Mobile navigation</nav><span data-recent-frame-layout>Compact frame layout</span><label>Draft text<input aria-label="Draft text" value="Original"></label>'; } });
      for (const id of ["calculator", "notes", "recent-draft"]) os.launch(id);
      os.windows.windows.get("recent-draft").frame.style.containerName = "recent-frame";
    });
    const original = root.locator('.dos-window[data-app-id="recent-draft"] input');
    await expect(root.locator('.dos-window[data-app-id="recent-draft"] [data-recent-mobile-nav]')).toBeVisible();
    await original.fill("Unsaved test draft");
    const home = root.getByRole("button", { name: "Home", exact: true });
    const swipe = async (locator, dx, dy, duration = 0) => {
      const bounds = await locator.boundingBox();
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 12 });
      if (duration) await page.waitForTimeout(duration);
      await page.mouse.up();
    };
    if (style === "ios") await swipe(home, 0, -100);
    else await home.click();
    await expect(original).toBeHidden();
    const open = async () => {
      if (style === "ios") await swipe(home, 0, -100);
      else await root.getByRole("button", { name: "Recent apps", exact: true }).click();
      await expect(root.locator(".dos-recent-apps")).toBeVisible();
    };
    await root.screenshot({ path: `${output}/${style}-home.png` });
    await open();
    const dialog = root.getByRole("dialog", { name: "Recent apps" });
    await expect(dialog.locator(".dos-recent-card")).toHaveCount(3);
    const preview = dialog.locator('[data-recent-window-id="recent-draft"]');
    await expect(preview.locator('[data-recent-mobile-nav]')).toBeVisible();
    await expect(preview.locator('[data-recent-desktop-nav]')).toBeHidden();
    await expect(preview.locator('[data-recent-frame-layout]')).toBeVisible();
    assert.equal(await dialog.locator('[data-recent-window-id="recent-draft"] input').inputValue(), "Unsaved test draft", "preview preserves current form state");
    await root.screenshot({ path: `${output}/${style}-recents.png` });
    const rail = dialog.locator(".dos-recents-rail");
    await swipe(dialog.getByRole("button", { name: "Draft", exact: true }), -180, 0);
    assert(await rail.evaluate(el => el.scrollLeft) > 100, "horizontal dragging moves the app carousel");
    await page.keyboard.press("ArrowRight");
    await root.screenshot({ path: `${output}/${style}-recents-carousel.png` });
    await page.keyboard.press("ArrowLeft");
    await dialog.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(original).toHaveValue("Unsaved test draft");
    if (style === "ios") {
      await swipe(home, 0, -100, 550);
      await expect(root.locator(".dos-recent-apps")).toBeVisible();
    } else await open();
    await page.evaluate(() => { window.platformAppsQA.os.windows.windows.get("recent-draft").beforeClose = () => false; });
    await dialog.getByRole("button", { name: "Close Draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert(await page.evaluate(() => window.platformAppsQA.os.windows.windows.has("recent-draft")), "rejected close preserves the draft");
    await expect(dialog.locator('[data-recent-window-id="recent-draft"]')).toHaveCount(1);
    await page.evaluate(() => { window.platformAppsQA.os.windows.windows.get("recent-draft").beforeClose = async () => { throw new Error("Rejected guard"); }; });
    await dialog.getByRole("button", { name: "Close Draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.locator('[data-recent-window-id="recent-draft"]')).toHaveCount(1);
    await page.evaluate(() => {
      const windows = window.platformAppsQA.os.windows;
      window.recentTrustedSurface = windows.openTrustedPrompt({ id: "recents-protection", capability: "close-confirmation", message: "Preserve this prompt" }, { onDecision: (_decision, surface) => windows.closeTrustedPrompt(surface.id) }).id;
    });
    const trusted = root.locator(".trusted-ui-surface");
    await expect(trusted).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trusted).toBeVisible();
    await expect(dialog).toBeVisible();
    await trusted.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(trusted).toHaveCount(0);
    await page.evaluate(() => { window.platformAppsQA.os.windows.windows.get("recent-draft").beforeClose = async () => true; });
    await swipe(dialog.getByRole("button", { name: "Draft", exact: true }), 0, -140);
    await expect(dialog.locator('[data-recent-window-id="recent-draft"]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.platformAppsQA.os.windows.windows.has("recent-draft")), false, "swipe dismiss uses the real guarded window lifecycle");
    if (style === "android") {
      await page.evaluate(() => {
        const windows = window.platformAppsQA.os.windows;
        const tasks = [...windows.windows.values()].sort((a, b) => Number(b.frame.style.zIndex) - Number(a.frame.style.zIndex));
        window.pendingRecentId = tasks[0].id;
        tasks[0].beforeClose = () => new Promise(resolve => { window.resolveRecentBatch = resolve; });
      });
      await dialog.getByRole("button", { name: "Close all", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.resolveRecentBatch)).toBe("function");
      await home.click();
      await open();
      await page.evaluate(() => window.resolveRecentBatch(true));
      await expect.poll(() => page.evaluate(() => window.platformAppsQA.os.windows.windows.size)).toBe(1);
      await expect(dialog.locator(".dos-recent-card")).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.platformAppsQA.os.windows.windows.size), 1, "an old Close all request must not close apps in a reopened overview");
      await dialog.getByRole("button", { name: "Close all", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.platformAppsQA.os.windows.windows.size), 0);
    } else {
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
    await expect(root).not.toHaveAttribute("data-recent-apps", "true");
    await context.close();
    console.log(`${style}: horizontal drag, previews, restore, upward dismissal, close guards, keyboard and cleanup passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
