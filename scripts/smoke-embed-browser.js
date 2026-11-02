#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const port = Number(process.env.DINDBOS_EMBED_QA_PORT || 5197);
const output = resolve(process.env.DINDBOS_EMBED_QA_OUTPUT || "internal/docs/qa/embed");
const server = await createServer({
  configFile: false,
  optimizeDeps: { entries: ["examples/embedded/index.html"] },
  resolve: { alias: [
    { find: /^dindbos\/react$/, replacement: resolve("src/sdk/react.js") },
  ] },
  plugins: [{
    name: "sdk-embed-style-entry",
    resolveId(id) { if (id === "dindbos/styles.css") return "\0sdk-embed-styles"; },
    load(id) {
      if (id === "\0sdk-embed-styles") return ["dindbos", "theme", "shell", "windows", "dock", "apps"].map((name) => `import ${JSON.stringify(resolve(`src/styles/${name}.css`))};`).join("\n");
    },
  }],
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null },
});
let browser;
let page;
const errors = [];
try {
  await server.listen();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/examples/embedded/?qa=1`);
  await page.getByTestId("notes-first").waitFor();
  await page.getByTestId("notes-second").waitFor();
  await page.waitForFunction(() => window.__dindbosEmbedQA.runtimes.first && window.__dindbosEmbedQA.runtimes.second);

  const host = await page.evaluate(() => {
    const button = getComputedStyle(document.querySelector("[data-testid='host-save']"));
    const body = getComputedStyle(document.body);
    return { radius: button.borderRadius, background: button.backgroundColor, font: button.fontFamily, overflow: body.overflowY, bodyFont: body.fontFamily, height: document.documentElement.scrollHeight };
  });
  assert.equal(host.radius, "0px", "desktop styles must not round the host's button");
  assert.equal(host.background, "rgb(217, 228, 206)");
  assert.match(host.font, /Georgia/);
  assert.match(host.bodyFont, /Georgia/);
  assert.notEqual(host.overflow, "hidden", "host page remains scrollable");
  assert(host.height > 1050);
  await page.getByTestId("host-save").click();
  assert.equal(await page.getByTestId("host-saved").textContent(), "Saved 1 times");

  const roots = await page.evaluate(() => ["first", "second"].map((name) => {
    const os = window.__dindbosEmbedQA.runtimes[name];
    const rect = os.root.getBoundingClientRect();
    return { name, x: rect.x, y: rect.y, width: rect.width, height: rect.height, mode: os.root.dataset.appearance, key: os.storage.key };
  }));
  assert(roots[0].x > 0 && roots[0].y > 100, "the primary desktop is offset inside the host page");
  assert(roots[0].width > 700 && roots[1].width < 400, "both desktop and narrow container layouts are exercised");
  assert.equal(roots[0].mode, "light");
  assert.equal(roots[1].mode, "dark");
  assert.notEqual(roots[0].key, roots[1].key, "instances use different storage namespaces");
  await assertContained("first", "initial desktop window");
  await assertContained("second", "initial narrow window");
  await page.screenshot({ path: resolve(output, "two-independent-desktops.png"), fullPage: false });

  for (const name of ["first", "second"]) {
    await page.evaluate((key) => window.__dindbosEmbedQA.runtimes[key].windows.maximize("notes"), name);
    await assertContained(name, "maximized window");
    await page.evaluate((key) => window.__dindbosEmbedQA.runtimes[key].windows.maximize("notes"), name);
    await assertContained(name, "restored window");
  }

  const firstWindow = page.locator(".embedded-desktop-first > .dos-shell .dos-window[data-window-id='notes']").first();
  const title = firstWindow.locator(".dos-window-titlebar");
  let titleBox = await title.boundingBox();
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(1490, 1000, { steps: 12 });
  await assertContained("first", "extreme drag while pointer is held");
  await page.mouse.up();
  await assertContained("first", "extreme bottom-right drag");
  titleBox = await title.boundingBox();
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  await assertContained("first", "extreme top-left drag");

  const resize = firstWindow.locator("[data-resize='bottom-right']");
  const resizeBox = await resize.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(1490, 1000, { steps: 12 });
  await page.mouse.up();
  await assertContained("first", "resize stays inside its container");

  await page.getByTestId("host-bottom").scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => window.scrollY > 100), "the outer page scrolls below both desktops");
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const key of ["w", "k"]) {
    const prevented = await dispatchShortcut("[data-testid='host-input']", key);
    assert.equal(prevented, false, `host Ctrl+${key.toUpperCase()} must not be consumed`);
  }
  assert.equal(await windowCount("first"), 1);
  assert.equal(await windowCount("second"), 1);

  const secondOnly = await dispatchShortcut(".embedded-desktop-second input[aria-label='second notebook title']", "w");
  assert.equal(secondOnly, true);
  await page.waitForFunction(() => window.__dindbosEmbedQA.runtimes.second.windows.windows.size === 0);
  assert.equal(await windowCount("first"), 1, "closing one instance never closes the other");
  await page.evaluate(() => window.__dindbosEmbedQA.runtimes.second.launch("notes"));
  await page.getByTestId("notes-second").waitFor();

  await page.evaluate(() => window.__dindbosEmbedQA.runtimes.first.setAppearance({ mode: "dark", accent: "#8c5b30" }));
  const appearance = await page.evaluate(() => {
    const { first, second } = window.__dindbosEmbedQA.runtimes;
    return { first: first.appearance, second: second.appearance };
  });
  assert.equal(appearance.first.mode, "dark");
  assert.equal(appearance.first.accent, "#8c5b30");
  assert.equal(appearance.second.accent, "#4c91b5");

  await page.getByTestId("nested-toggle-first").click();
  await page.waitForFunction(() => Boolean(window.__dindbosEmbedQA.runtimes.nested));
  await page.getByTestId("notes-nested").waitFor({ state: "attached" });
  const nestedK = await dispatchShortcut(".embedded-desktop-nested input[aria-label='nested notebook title']", "k");
  assert.equal(nestedK, true);
  assert.equal(await page.evaluate(() => window.__dindbosEmbedQA.runtimes.nested.shell.activePanel), "launcher");
  assert.equal(await page.evaluate(() => window.__dindbosEmbedQA.runtimes.first.shell.activePanel), "", "outer shell does not consume a nested desktop shortcut");
  await page.evaluate(() => window.__dindbosEmbedQA.runtimes.nested.shell.closePanel());
  const beforeNested = await page.evaluate(() => window.__dindbosEmbedQA.runtimes.first.windows.inputRouter.routed);
  await dispatchShortcut(".embedded-desktop-nested input[aria-label='nested notebook title']", "w");
  assert.equal(await windowCount("nested"), 0);
  assert.equal(await windowCount("first"), 1);
  assert.equal(await page.evaluate(() => window.__dindbosEmbedQA.runtimes.first.windows.inputRouter.routed), beforeNested, "outer window manager ignores nested desktop keyboard input");
  await page.screenshot({ path: resolve(output, "nested-shortcut-isolation.png"), fullPage: false });

  await page.getByTestId("toggle-first").click();
  await page.waitForFunction(() => window.__dindbosEmbedQA.runtimes.first.destroyed && window.__dindbosEmbedQA.runtimes.nested.destroyed);
  assert.equal(await page.locator(".embedded-desktop-first").count(), 0);
  assert.equal(await windowCount("second"), 1, "the remaining desktop stays alive after route teardown");
  assert.equal(await page.evaluate(() => window.__dindbosEmbedQA.runtimes.second.destroyed), false);
  await page.getByTestId("host-save").click();
  assert.equal(await page.getByTestId("host-saved").textContent(), "Saved 2 times");
  await page.screenshot({ path: resolve(output, "host-after-desktop-removal.png"), fullPage: false });
  assert.deepEqual(await page.evaluate(() => window.__dindbosEmbedQA.errors), []);
  assert.deepEqual(errors, []);
  console.log(`embedding browser smoke ok two containers geometry drag resize maximize host CSS scroll keyboard nested routing independent appearance teardown screenshots=${output}`);
} catch (error) {
  if (page) {
    console.error("Embedding fixture diagnostics", await page.evaluate(() => ({ errors: window.__dindbosEmbedQA?.errors, body: document.body.innerText.slice(0, 2000) })).catch(() => ({})));
    await page.screenshot({ path: resolve(output, "failure.png"), fullPage: false }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}

async function windowCount(name) {
  return page.evaluate((key) => window.__dindbosEmbedQA.runtimes[key].windows.windows.size, name);
}

async function dispatchShortcut(selector, key) {
  return page.evaluate(({ selector, key }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing shortcut target: ${selector}`);
    target.focus();
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, key });
}

async function assertContained(name, scenario) {
  const rects = await page.evaluate((key) => {
    const os = window.__dindbosEmbedQA.runtimes[key];
    const root = os.root.getBoundingClientRect();
    const frame = os.windows.windows.get("notes").frame.getBoundingClientRect();
    return { root: { left: root.left, top: root.top, right: root.right, bottom: root.bottom }, frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom } };
  }, name);
  const { root, frame } = rects;
  for (const edge of ["left", "top"]) assert(frame[edge] >= root[edge] - 1, `${name} ${scenario}: ${edge} outside container ${JSON.stringify(rects)}`);
  for (const edge of ["right", "bottom"]) assert(frame[edge] <= root[edge] + 1, `${name} ${scenario}: ${edge} outside container ${JSON.stringify(rects)}`);
}
