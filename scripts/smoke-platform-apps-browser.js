import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const primary = repo.includes("/.worktrees/") ? repo.split("/.worktrees/")[0] : repo;
const output = resolve(process.env.DINDBOS_QA_OUTPUT || `${primary}/internal/docs/platform-apps/runtime`);
const port = Number(process.env.DINDBOS_QA_PORT || 5194);
const server = process.env.DINDBOS_QA_URL ? null : await createServer({ root: repo, server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null } });
await server?.listen();
const base = process.env.DINDBOS_QA_URL || `http://127.0.0.1:${port}/`;
const styles = (process.env.DINDBOS_QA_STYLES || "windows,ios,android").split(",");
const appIds = ["portfolio", "files", "applications", "terminal", "activity-monitor", "text", "browser", "viewer", "calculator", "settings", "notes", "reminders", "calendar", "clock", "photos", "music"];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) }).catch(async (error) => { await server?.close(); throw error; });
const results = [];
try {
  for (const style of styles) {
    const width = style === "windows" || style === "macos" ? 1280 : 390;
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", recordVideo: { dir: `${output}/videos`, size: { width, height: 844 } } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = new URL("scripts/fixtures/platform-apps.html", base);
    url.searchParams.set("style", style); url.searchParams.set("width", String(width));
    await page.goto(url.href);
    const root = page.locator("#platform-apps-host");
    await expect(root).toHaveAttribute("data-qa-ready", "true");
    await expect(root.locator(".dos-dock .dos-app-icon").first()).toHaveAttribute("data-icon-style", style);
    assert.deepEqual((await page.evaluate(() => window.platformAppsQA.appIds)).sort(), [...appIds].sort(), "every builtin must be evaluated");
    for (const app of appIds) {
      const result = { style, app, status: "pass", checks: [], screenshots: [] };
      results.push(result);
      try {
        const id = await page.evaluate((app) => window.platformAppsQA.show(app), app);
        const frame = root.locator(`.dos-window[data-window-id="${id}"]`);
        await expect(frame).toBeVisible();
        await expect(frame.locator(".dos-window-content > *").first()).toBeVisible();
        const bounds = await frame.boundingBox();
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 845, "window is contained by the desktop");
        result.checks.push("real app launch and window bounds");
        if (["ios", "android"].includes(style) && ["notes", "settings"].includes(app)) await expect(frame).toHaveAttribute("data-mobile-pane", /^(list|detail)$/);
        await exerciseApp(page, root, frame, app, style);
        result.checks.push("app-specific functional flow");
        for (const mode of ["light", "dark"]) {
          await page.evaluate((mode) => window.platformAppsQA.os.setAppearance({ mode }), mode);
          if (style === "windows") {
            const dock = await root.locator(".dos-dock").evaluate((element) => { const css = getComputedStyle(element); return { background: css.backgroundColor, image: css.backgroundImage, shadow: css.boxShadow, backdrop: css.backdropFilter }; });
            assert.deepEqual(dock, { background: "rgba(0, 0, 0, 0)", image: "none", shadow: "none", backdrop: "none" }, "Windows taskbar must not contain a second glass Dock plate");
          }
          const path = `${style}-${app}-${mode}.png`;
          await root.screenshot({ path: resolve(output, path) });
          result.screenshots.push(path);
        }
        result.checks.push("light and dark captures with existing Liquid Glass enabled");
        if (width === 390) {
          await page.setViewportSize({ width: 320, height: 740 });
          await root.evaluate((element) => { element.style.width = "320px"; element.style.height = "740px"; });
          await expect(frame).toBeVisible();
          assert.equal(await root.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false, "320px host does not overflow");
          const narrow = await frame.boundingBox();
          assert(narrow.x >= 0 && narrow.x + narrow.width <= 321 && narrow.y + narrow.height <= 741, "320px app remains inside its host");
          if (style === 'android' && app === 'calendar') await assertCalendarEventsFit(frame);
          if (["settings", "notes", "calculator", "browser", "calendar"].includes(app)) {
            const path = `${style}-${app}-320.png`;
            await root.screenshot({ path: resolve(output, path) }); result.screenshots.push(path);
          }
          await page.setViewportSize({ width, height: 844 });
          await root.evaluate((element) => { element.style.width = "390px"; element.style.height = "844px"; });
          result.checks.push("320px containment");
        }
      } catch (error) {
        result.status = "fail"; result.error = error.message;
        await page.screenshot({ path: resolve(output, `${style}-${app}-failure.png`) }).catch(() => {});
      } finally {
        await page.evaluate(() => window.platformAppsQA.os.setAppearance({ mode: "light" }));
      }
      console.log(`${result.status}: ${style}/${app}${result.error ? ` ${result.error.split("\n")[0]}` : ""}`);
    }
    if (errors.length) results.push({ style, app: "runtime", status: "fail", error: errors.join("\n") });
    await page.evaluate(() => window.platformAppsQA.os.destroy());
    await context.close();
    await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  }
} finally {
  await browser.close();
  await server?.close();
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
}
const failures = results.filter((result) => result.status !== "pass");
assert.equal(failures.length, 0, `${failures.length} platform app checks failed; see ${output}/results.json`);
console.log(`platform app browser passed: ${results.length} app/platform paths; evidence ${output}`);

async function exerciseApp(page, root, frame, app, style) {
  if (app === "portfolio") await expect(frame.locator(".portfolio-grid article").first()).toBeVisible();
  if (app === "files") {
    await expect(frame.locator('[data-files-new-tab]')).toBeVisible();
    await frame.locator('[data-files-new-tab]').click();
    await expect(frame.locator('[data-files-tab]')).toHaveCount(2);
    await frame.locator('[data-files-close-tab]').last().click();
    await expect(frame.locator('[data-files-tab]')).toHaveCount(1);
    await expect(frame.getByText("Project plan.txt", { exact: true }).first()).toBeVisible();
  }
  if (app === "applications") {
    await frame.getByRole("searchbox", { name: "Search applications" }).fill("Calculator");
    await expect(frame.locator(".applications-item")).toHaveCount(1);
    await expect(frame.getByRole("button", { name: "Open Calculator", exact: true })).toBeVisible();
    await frame.getByRole("searchbox", { name: "Search applications" }).fill("");
  }
  if (app === "terminal") {
    await frame.getByRole("textbox", { name: "Terminal command" }).fill("echo platform-check");
    await frame.getByRole("textbox", { name: "Terminal command" }).press("Enter");
    await expect(frame.getByLabel("Terminal output", { exact: true })).toContainText("platform-check");
  }
  if (app === "activity-monitor") {
    await frame.locator('[data-activity-filter]').fill("terminal");
    await expect(frame.locator('[data-activity-filter]')).toHaveValue("terminal");
    await frame.locator('[data-activity-filter]').fill("");
    await expect(frame.getByRole("table", { name: "Processes" })).toBeVisible();
  }
  if (app === "text") {
    await frame.getByRole("textbox", { name: "Document text" }).fill(`Saved ${style} document`);
    await frame.getByRole("button", { name: "Save document", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.platformAppsQA.os.fs.readFile(`${window.platformAppsQA.os.session.home}/Documents/Project plan.txt`))).toBe(`Saved ${style} document`);
  }
  if (app === "browser") {
    await expect(frame.frameLocator('[data-browser-local]').getByRole("heading", { name: "Local workspace" })).toBeVisible();
    await frame.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(frame.locator('[data-browser-tab]')).toHaveCount(2);
    await frame.locator('[data-browser-tab]').first().click();
    await frame.frameLocator('[data-browser-local]').getByRole("textbox", { name: "Page draft" }).fill("Keep this tab draft");
    await frame.locator('[data-browser-close-tab]').last().click();
    await expect(frame.frameLocator('[data-browser-local]').getByRole("textbox", { name: "Page draft" })).toHaveValue("Keep this tab draft");
  }
  if (app === "viewer") await expect(frame.locator(".viewer-app")).toContainText("Workspace guide");
  if (app === "calculator") {
    for (const key of ["2", "+", "3", "="]) await frame.locator(`[data-key="${key}"]`).click();
    await expect(frame.getByLabel("Result", { exact: true })).toHaveText("5");
    await frame.locator('[data-calculator-history]').click();
    await expect(frame.locator('.calculator-history')).toBeVisible();
    await frame.locator('[data-calculator-history]').click();
  }
  if (app === "settings") {
    const category = frame.locator('[data-settings-section-button="wallpaper"]');
    if (await frame.getAttribute("data-mobile-pane") === "detail") await frame.locator('[data-mobile-app-back]').click();
    await category.click();
    await frame.locator('[data-appearance-wallpaper="dusk"]').click();
    await expect(root).toHaveAttribute("data-wallpaper", "dusk");
    await frame.locator('[data-appearance-wallpaper="meadow"]').click();
  }
  if (app === "notes") {
    const title = frame.getByRole("textbox", { name: "Note title", exact: true });
    if (!await title.isVisible()) await frame.locator('[data-note-id="plan"]').click();
    await title.fill(`${style} preserved note`);
    await frame.getByRole("textbox", { name: "Note text", exact: true }).fill("Edited content survives Home and restore.");
    await frame.getByRole("textbox", { name: "Note text", exact: true }).press("Control+s");
    if (["ios", "android"].includes(style)) await root.getByRole("button", { name: "Home", exact: true }).click();
    else await page.evaluate(() => window.platformAppsQA.os.windows.minimize(window.platformAppsQA.os.windows.activeWindowId));
    await page.evaluate(() => window.platformAppsQA.show("notes"));
    await expect(title).toHaveValue(`${style} preserved note`);
  }
  if (app === "reminders") {
    await frame.getByRole("textbox", { name: "New reminder", exact: true }).fill("Verify platform controls");
    await frame.getByRole("button", { name: "Add reminder", exact: true }).click();
    await frame.getByRole("checkbox", { name: "Complete Verify platform controls", exact: true }).click();
    await frame.locator('[data-reminder-filter="completed"]').click();
    await expect(frame.getByText("Verify platform controls", { exact: true })).toBeVisible();
    await frame.locator('[data-reminder-filter="all"]').click();
  }
  if (app === "calendar") {
    await frame.getByRole("button", { name: "New event", exact: true }).click();
    await frame.getByRole("textbox", { name: "Event title", exact: true }).fill("Platform review");
    await frame.getByRole("button", { name: "Add Event", exact: true }).click();
    await expect(frame.getByText("Platform review", { exact: true }).first()).toBeVisible();
    if (style === 'android') await assertCalendarEventsFit(frame);
  }
  if (app === "clock") {
    await frame.getByRole("tab", { name: "Stopwatch", exact: true }).click();
    await frame.getByRole("button", { name: "Start", exact: true }).click();
    await expect.poll(() => frame.getByRole("timer", { name: "Elapsed time" }).textContent()).not.toBe("00:00.00");
    await frame.getByRole("button", { name: "Stop", exact: true }).click();
    await frame.getByRole("button", { name: "Reset", exact: true }).click();
    await frame.getByRole("tab", { name: "World Clock", exact: true }).click();
  }
  if (app === "photos") {
    await frame.locator('[data-photo-path]').first().click();
    await expect(frame.locator('.photo-viewer')).toBeVisible();
    await frame.getByRole("button", { name: "Show photo grid", exact: true }).click();
  }
  if (app === "music") {
    await frame.getByRole("searchbox", { name: "Search songs", exact: true }).fill("Quiet");
    await expect(frame.locator('.music-track')).toHaveCount(1);
    await frame.getByRole("searchbox", { name: "Search songs", exact: true }).fill("");
    await expect(frame.locator('.music-player')).toBeVisible();
  }
}

async function assertCalendarEventsFit(frame) {
  const clipped = await frame.locator('.calendar-cell-events em').evaluateAll(labels => labels.some(label => {
    const cell = label.closest('button').getBoundingClientRect();
    const rect = label.getBoundingClientRect();
    return rect.top < cell.top || rect.bottom > cell.bottom + 1;
  }));
  assert.equal(clipped, false, 'calendar event labels fit vertically inside their date cells');
}
