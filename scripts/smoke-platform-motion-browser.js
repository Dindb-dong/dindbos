import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const primary = repo.split("/.worktrees/")[0];
const output = resolve(process.env.DINDBOS_QA_OUTPUT || `${primary}/internal/docs/mobile-motion-20261110`);
await mkdir(output, { recursive: true });
const server = await createServer({ root: repo, server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const results = [];
try {
  for (const style of ["android", "ios"]) for (const reducedMotion of ["no-preference", "reduce"]) {
    const name = `${style}-${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion, recordVideo: { dir: `${output}/videos`, size: { width: 390, height: 844 } } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    const traces = {};
    const result = { style, reducedMotion, checks: [], status: "running" };
    results.push(result);
    try {
      await page.goto(`http://127.0.0.1:5199/scripts/fixtures/platform-apps.html?style=${style}&width=390`);
      const root = page.locator("#platform-apps-host");
      await expect(root).toHaveAttribute("data-qa-ready", "true");
      await page.evaluate(() => {
        const os = window.platformAppsQA.os;
        for (const task of [...os.windows.windows.values()]) os.windows.close(task.id, { force: true });
        for (const id of ["calculator", "files", "notes"]) window.platformAppsQA.show(id);
        window.motionPointerTypes = [];
        document.addEventListener("pointerdown", event => window.motionPointerTypes.push(event.pointerType), true);
        window.startMotionTrace = selectors => {
          const generation = window.motionTraceGeneration = (window.motionTraceGeneration || 0) + 1;
          window.motionTrace = [];
          window.motionTracing = true;
          const sample = now => {
            if (!window.motionTracing || generation !== window.motionTraceGeneration) return;
            window.motionTrace.push({ now, generation, elements: selectors.map(selector => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const box = element.getBoundingClientRect(), css = getComputedStyle(element);
              if (!box.width || !box.height || css.visibility === "hidden" || css.display === "none") return null;
              return { x: box.x, y: box.y, width: box.width, height: box.height, opacity: Number(css.opacity) };
            }) });
            if (window.motionTracing) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        };
      });
      const home = root.getByRole("button", { name: "Home", exact: true });
      let touch;
      const begin = async locator => {
        const bounds = await locator.boundingBox();
        assert(bounds, "touch target must have bounds");
        touch = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * .55 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touch, id: 1 }] });
      };
      const move = async (dx, dy) => {
        const start = { ...touch };
        for (let step = 1; step <= 10; step++) {
          touch = { x: start.x + dx * step / 10, y: start.y + dy * step / 10 };
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touch, id: 1 }] });
          await page.waitForTimeout(14);
        }
      };
      const end = async (cancel = false) => cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
      const swipe = async (locator, dx, dy) => { await begin(locator); await move(dx, dy); await end(); };
      const trace = async selectors => page.evaluate(selectors => window.startMotionTrace(selectors), selectors);
      const stop = async label => {
        traces[label] = await page.evaluate(() => { window.motionTracing = false; return window.motionTrace; });
        assert(new Set(traces[label].map(sample => sample.generation)).size <= 1, "a trace must not contain samples from previous generations");
        return traces[label];
      };
      const settle = async locator => {
        await expect.poll(async () => locator.evaluate(element => {
          const animations = element.getAnimations({ subtree: true });
          return animations.filter(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity).length;
        }), { timeout: 3000 }).toBe(0);
        await page.waitForTimeout(100);
      };
      const spatialStates = samples => new Set(samples.flatMap(sample => sample.elements.filter(Boolean)).map(box => [box.x, box.y, box.width, box.height].map(value => Math.round(value)).join(","))).size;
      const notes = root.locator('.dos-window[data-app-id="notes"]');
      await settle(notes);
      await trace(['.dos-window[data-app-id="notes"]']);
      if (style === "ios") await swipe(home, 0, -110);
      else await home.tap();
      await expect(notes).toBeHidden();
      const homeMotion = await stop("home");
      if (reducedMotion === "no-preference") assert(spatialStates(homeMotion) > 2, "Home visibly transforms the active app before hiding it");
      else assert(spatialStates(homeMotion) <= 1, "reduced-motion Home has no spatial interpolation");
      result.checks.push("actual app Home transition");
      const open = async () => {
        if (style === "ios") await swipe(home, 0, -110);
        else await root.getByRole("button", { name: "Recent apps", exact: true }).tap();
      };
      await trace([".dos-recent-card:first-child .dos-recent-preview"]);
      await open();
      const dialog = root.getByRole("dialog", { name: "Recent apps" });
      await expect(dialog).toBeVisible();
      await settle(dialog);
      const entrance = await stop("entrance");
      if (reducedMotion === "no-preference") assert(spatialStates(entrance) > 2, "recents entrance visibly interpolates card geometry");
      else assert(spatialStates(entrance) <= 1, "reduced-motion recents entrance has no spatial interpolation");
      result.checks.push("recents entrance geometry");
      if (style === "android") {
        for (const action of ["Back", "Home"]) {
          const button = root.getByRole("button", { name: action, exact: true });
          assert(await button.evaluate(element => {
            const box = element.getBoundingClientRect();
            return element.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === element;
          }), `Android ${action} remains the actual touch target above recents`);
          await button.tap();
          await expect(dialog).toHaveCount(0);
          assert.equal(await page.evaluate(() => window.platformAppsQA.os.windows.windows.size), 3, `${action} preserves running apps`);
          await open();
          await expect(dialog).toBeVisible();
          await settle(dialog);
        }
        result.checks.push("Android Home/Back physical hit-test above recents");
      }
      await root.screenshot({ path: `${output}/${name}-recents-settled.png` });
      const rail = dialog.locator(".dos-recents-rail");
      const first = dialog.locator(".dos-recent-card").first();
      await begin(first.locator(".dos-recent-preview"));
      await move(-155, 0);
      const draggedScroll = await rail.evaluate(element => element.scrollLeft);
      assert(draggedScroll > 80, "actual touch drag moves the carousel");
      await trace([".dos-recent-card:first-child"]);
      await end();
      await expect.poll(async () => rail.evaluate(element => {
        const center = element.getBoundingClientRect().x + element.clientWidth / 2;
        return Math.min(...[...element.children].map(card => { const box = card.getBoundingClientRect(); return Math.abs(box.x + box.width / 2 - center); }));
      }), { timeout: 2500 }).toBeLessThan(3);
      await page.waitForTimeout(120);
      const scroll = await rail.evaluate(element => element.scrollLeft);
      await page.waitForTimeout(100);
      assert(Math.abs(await rail.evaluate(element => element.scrollLeft) - scroll) < 1, "released carousel remains settled");
      const release = await stop("carousel-release");
      if (reducedMotion === "no-preference") assert(spatialStates(release) > 2, "drag release visibly eases to its centered card");
      result.checks.push("touch horizontal drag and stable centered release");
      const centeredId = await rail.evaluate(element => {
        const center = element.getBoundingClientRect().x + element.clientWidth / 2;
        return [...element.children].sort((a, b) => Math.abs(a.getBoundingClientRect().x + a.clientWidth / 2 - center) - Math.abs(b.getBoundingClientRect().x + b.clientWidth / 2 - center))[0].dataset.recentWindowId;
      });
      const card = rail.locator(`[data-recent-window-id="${centeredId}"]`);
      const baseline = await card.boundingBox();
      await begin(card.locator(".dos-recent-preview"));
      await move(0, -50);
      await expect.poll(async () => baseline.y - (await card.boundingBox()).y).toBeGreaterThan(49);
      await trace([`[data-recent-window-id="${centeredId}"]`]);
      await end(true);
      await expect.poll(async () => (await card.boundingBox()).y, { timeout: 2000 }).toBeGreaterThan(baseline.y - 1);
      await settle(card);
      const cancelled = await stop("cancelled-upward-pull");
      if (reducedMotion === "no-preference") assert(spatialStates(cancelled) > 2, "cancelled upward touch animates back to its baseline");
      else assert(spatialStates(cancelled) <= 2, "reduced-motion cancelled pull jumps directly between dragged and resting positions");
      assert(await page.evaluate(id => window.platformAppsQA.os.windows.windows.has(id), centeredId), "cancelled swipe preserves its app");
      result.checks.push("cancelled upward touch returns and preserves app");
      const taskSelector = `.dos-window[data-window-id="${centeredId}"]`;
      await trace([taskSelector]);
      await card.locator(".dos-recent-preview").tap();
      await expect(dialog).toHaveCount(0);
      const restored = root.locator(taskSelector);
      await expect(restored).toBeVisible();
      await settle(restored);
      const restore = await stop("restore");
      if (reducedMotion === "no-preference") assert(spatialStates(restore) > 2, "restoring a card visibly expands it into the real app");
      else assert(spatialStates(restore) <= 2, "reduced-motion restore switches directly between endpoint poses");
      assert.equal(await page.evaluate(id => window.platformAppsQA.os.windows.activeWindowId === id, centeredId), true);
      result.checks.push("card restore becomes focused real app");
      if (style === "ios") {
        await trace([".dos-recent-card:first-child .dos-recent-preview"]);
        await begin(home);
        await move(0, -110);
        await page.waitForTimeout(180);
        await end();
        await expect(dialog).toBeVisible();
        await settle(dialog);
        const pausedEntrance = await stop("paused-app-swipe-to-recents");
        if (reducedMotion === "no-preference") assert(spatialStates(pausedEntrance) > 2, "paused app swipe morphs fullscreen content into recents");
        else assert(spatialStates(pausedEntrance) <= 2, "reduced-motion paused swipe uses discrete endpoint poses");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(restored).toBeVisible();
        result.checks.push("paused iOS app swipe enters recents and returns without losing app");
      }
      if (style === "ios") await swipe(home, 0, -110);
      else await home.tap();
      await expect(restored).toBeHidden();
      await open();
      await expect(dialog).toBeVisible();
      await settle(dialog);
      const closingCard = dialog.locator(`[data-recent-window-id="${centeredId}"]`);
      await page.evaluate(id => { window.platformAppsQA.os.windows.windows.get(id).beforeClose = () => new Promise(resolve => { window.resolveMotionClose = resolve; }); }, centeredId);
      await swipe(closingCard.locator(".dos-recent-preview"), 0, -125);
      await expect.poll(() => page.evaluate(() => typeof window.resolveMotionClose)).toBe("function");
      assert(await page.evaluate(id => window.platformAppsQA.os.windows.windows.has(id), centeredId), "pending close guard retains the running app");
      await expect(closingCard).toHaveCount(1);
      await trace([`[data-recent-window-id="${centeredId}"]`]);
      await page.evaluate(() => window.resolveMotionClose(true));
      await expect(closingCard).toHaveCount(0);
      const exit = await stop("approved-close-exit");
      if (reducedMotion === "no-preference") {
        const positions = exit.flatMap(sample => sample.elements.filter(Boolean));
        assert(positions.length > 3, "approved dismissal retains the card during its exit");
        assert(Math.max(...positions.map(box => box.y)) - Math.min(...positions.map(box => box.y)) > baseline.height * .6, "approved card visibly travels upward before removal");
        assert(Math.min(...positions.map(box => box.y + box.height)) < 100, "dismissed card travels beyond the visible stage");
      }
      assert.equal(await page.evaluate(id => window.platformAppsQA.os.windows.windows.has(id), centeredId), false);
      result.checks.push("guarded app close waits for approval then animates offstage");
      await settle(dialog);
      await root.screenshot({ path: `${output}/${name}-after-dismissal.png` });
      assert((await page.evaluate(() => window.motionPointerTypes)).includes("touch"), "gestures used browser touch events, not synthetic mouse input");
      assert.deepEqual(errors, []);
      result.status = "pass";
      console.log(`${name}: ${result.checks.join("; ")} passed`);
    } catch (error) {
      result.status = "fail";
      result.error = error.message;
      await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {});
      throw error;
    } finally {
      await writeFile(`${output}/${name}-traces.json`, JSON.stringify(traces, null, 2));
      await context.close();
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
  }
} finally { await browser.close(); await server.close(); }
