import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const output = process.env.DINDBOS_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, optimizeDeps: { entries: [] }, server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false }, plugins: [{ name: "customization-fixture", configureServer(server) {
server.middlewares.use((request, response, next) => {
  if (request.url !== "/customization-qa") return next();
  response.setHeader("Content-Type", "text/html");
  response.end('<html><body style="margin:0"><section style="width:640px;height:400px"><div id="custom" style="width:640px;height:400px"></div></section><section style="width:640px;height:400px"><div id="standard" style="width:640px;height:400px"></div></section><script type="module">import "/src/styles/index.css";</script></body></html>');
});
} }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  for (const glass of [true, false, "frosted"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(glass === "frosted" ? { userAgent: "Mozilla/5.0 Firefox/150.0" } : {}) });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:5198/customization-qa");
      await page.evaluate(async (glass) => {
        const { mountDindbOSDesktop } = await import("/src/sdk/desktop.js");
        window.runtimes = [];
        for (const id of ["custom", "standard"]) {
          const custom = id === "custom";
          window.runtimes.push(await mountDindbOSDesktop({
            root: document.getElementById(id), storage: { backend: "memory", name: id },
            builtins: false, bootstrapPackages: false, bootScreen: false,
            apps: [{ id: "notes", name: "Notes", pinned: true, render({ content }) { content.textContent = "Notes"; } }],
            ui: { liquidGlass: glass !== false },
            theme: { mode: "light", wallpaper: custom ? "linear-gradient(red, blue)" : "graphite", ...(custom ? { variables: {
              "--dock-background": "rgb(10, 20, 30)", "--dock-border": "2px solid rgb(40, 50, 60)",
              "--dock-radius": "11px", "--dock-shadow": "none", "--dock-gap": "8px",
              "--dock-padding": "6px 10px 10px", "--dock-bottom": "12px",
            } } : {}) },
          }));
        }
      }, glass);
      const custom = page.locator("#custom .dos-dock");
      if (glass !== false) await expect(custom).toHaveAttribute("data-liquid-glass-mode", glass === "frosted" ? "frosted" : "refraction");
      for (const mode of ["light", "dark"]) {
        await page.evaluate(mode => window.runtimes.forEach(os => os.setAppearance({ mode })), mode);
        const styles = await page.locator(".dos-dock").evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderTopWidth, gap: style.gap, padding: style.padding, bottom: style.bottom, shadow: style.boxShadow };
        }));
        assert.deepEqual(styles[0], { radius: "11px", background: "rgb(10, 20, 30)", border: "2px", gap: "8px", padding: "6px 10px 10px", bottom: "12px", shadow: "none" });
        assert.equal(styles[1].radius, "22px", "second desktop retains default geometry");
        assert.notEqual(styles[1].background, styles[0].background, "custom material stays instance scoped");
      }
      assert.match(await page.locator("#custom").evaluate(element => element.style.getPropertyValue("--wallpaper")), /linear-gradient\(red, blue\)/);
      if (output) await page.screenshot({ path: resolve(output, `customization-${glass}.png`) });
      await page.locator("#custom").evaluate(element => element.style.width = "390px");
      await expect.poll(() => custom.evaluate(element => getComputedStyle(element).borderRadius)).toBe("11px");
      if (glass !== false) {
        await page.emulateMedia({ forcedColors: "active" });
        await expect(custom).toHaveAttribute("data-liquid-glass-mode", "reduced");
        assert.equal(await custom.evaluate(element => getComputedStyle(element).backdropFilter), "none");
        assert.notEqual(await custom.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(10, 20, 30)");
      }
      await page.evaluate(() => Promise.all(window.runtimes.map(os => os.destroy())));
      assert.equal(await page.locator("[data-liquid-glass-definitions]").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log("customization browser smoke ok: SDK theme, two instances, light/dark, refraction/frosted/off, narrow host, forced colors, cleanup");
} finally {
  await browser?.close();
  await server.close();
}
