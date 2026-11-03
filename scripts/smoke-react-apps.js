#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const port = Number(process.env.DINDBOS_REACT_QA_PORT || 5196);
const server = await createServer({
  configFile: false,
  optimizeDeps: { entries: ["scripts/fixtures/react-apps.jsx"] },
  plugins: [{
    name: "react-sdk-fixture",
    configureServer(vite) {
      vite.middlewares.use("/react-sdk-fixture", async (request, response, next) => {
        response.setHeader("Content-Type", "text/html");
        try {
          response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html><head><title>React SDK regression</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/react-apps.jsx"></script></body></html>'));
        } catch (error) { next(error); }
      });
    },
  }],
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("fixture page error:", error.message); });
  await page.goto(`http://127.0.0.1:${port}/react-sdk-fixture`);
  await page.getByTestId("host-context").waitFor().catch(async (error) => {
    console.error("React fixture state", await page.evaluate(() => ({ errors: window.__sdkFixture?.errors, ready: window.__sdkFixture?.ready, body: document.body.innerText.slice(0,1500) })));
    throw error;
  });
  assert.equal(await page.getByTestId("host-context").textContent(), "host context preserved");
  assert.equal(await page.getByTestId("app-identity").textContent(), "launch context preserved");
  await page.getByTestId("increment").click();
  assert.equal(await page.getByTestId("increment").textContent(), "Count 1");
  await page.evaluate(() => { const os = window.__sdkFixture.os; os.registerApp({ id: "association-peer", accepts: ["text/plain", "text/markdown"], associationPriority: 50, render() {} }); });
  assert.equal(await page.evaluate(() => window.__sdkFixture.os.apps.resolveFileApp({ mime: "text/plain" }).id), "association-peer", "initial React priority participates in file associations");
  await page.getByTestId("update-label").click();
  assert.equal(await page.getByTestId("live-label").textContent(), "After update");
  assert.equal(await page.locator('[data-window-id="counter"] .dos-window-titlebar strong').textContent(), "After update: launch context preserved", "reactive title retains its launch context");
  assert.equal(await page.evaluate(() => window.__sdkFixture.os.apps.resolveFileApp({ mime: "text/markdown" }).id), "counter", "live accepts/priority updates change the default associated app");
  assert.equal(await page.evaluate(() => window.__sdkFixture.os.apps.resolveFileApp({ mime: "text/plain" }).id), "association-peer", "removed React MIME associations do not remain registered");
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await page.evaluate(() => window.__sdkFixture.os.windows.restore("counter"));
  assert.equal(await page.getByTestId("increment").textContent(), "Count 1", "minimize/restore retains component state");
  const beforeClose = await page.evaluate(() => window.__sdkFixture.cleanup);
  await page.getByTestId("close-app").click();
  await page.getByTestId("counter-app").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__sdkFixture.cleanup), beforeClose + 1, "closing cleans the running React app exactly once");
  await page.evaluate(() => window.__sdkFixture.os.launch("counter", { message: "reopened" }));
  await page.getByTestId("increment").waitFor();
  assert.equal(await page.getByTestId("increment").textContent(), "Count 0", "reopen creates a new component instance");
  await page.getByTestId("change-app-id").click();
  await page.getByTestId("counter-app").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.__sdkFixture.os.apps.has("counter")), false);
  assert.equal(await page.evaluate(() => window.__sdkFixture.os.apps.has("counter-renamed")), true);
  await page.evaluate(() => window.__sdkFixture.os.launch("counter-renamed", { message: "new identity" }));
  await page.getByTestId("increment").waitFor();
  assert.equal(await page.getByTestId("increment").textContent(), "Count 0");
  await page.getByTestId("toggle-desktop").click();
  await page.waitForFunction(() => window.__sdkFixture.os.destroyed);
  assert.equal(await page.locator(".dos-window").count(), 0);
  assert.equal(await page.getByTestId("host-after").textContent(), "Host content remains available");
  await page.getByTestId("toggle-desktop").click();
  await page.getByTestId("counter-app").waitFor();
  assert.equal(await page.evaluate(() => window.__sdkFixture.ready), 2, "StrictMode creates one ready runtime per real mount");
  assert.deepEqual(await page.evaluate(() => window.__sdkFixture.errors), []);
  assert.deepEqual(errors, []);
  console.log("react apps smoke ok StrictMode context initial launch live children minimize close cleanup renamed app remount");
} finally {
  await browser?.close();
  await server.close();
}
