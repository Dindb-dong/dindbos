#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Keep this fixture memory-only: no document or session data survives the run.
const moduleSource = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
${["dindbos", "theme", "shell", "windows", "dock", "apps"].map((name) => `import '/src/styles/${name}.css';`).join("\n")}
window.__editorReady = createAndBootDindbOS({
  root: document.getElementById('desktop'), storage: {backend:'memory', name:'editor-close-smoke'},
  bootstrapPackages: false, builtins: {include:['text','files']},
  launch:['text'],
}).then(os => window.__editorOS = os);
`;
const server = await createServer({
  configFile: false,
  logLevel: "error",
  optimizeDeps: { entries: [], include: ["react", "react-dom/client"] },
  plugins: [{
    name: "editor-close-fixture",
    resolveId(id) { if (id === "/editor-close-fixture.js") return "\0editor-close-fixture"; },
    load(id) { if (id === "\0editor-close-fixture") return moduleSource; },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/editor-close-fixture") return next();
        response.setHeader("Content-Type", "text/html");
        try {
          response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/editor-close-fixture.js"></script></body></html>'));
        } catch (error) { next(error); }
      });
    },
  }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
let page;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/editor-close-fixture`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  page = await browser.newPage({ viewport: { width: 1200, height: 850 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const editor = page.locator('.dos-window[data-app-id="text"]');
  const document = page.getByRole("textbox", { name: "Document text", exact: true });
  const close = () => editor.getByRole("button", { name: "Close", exact: true }).click();
  const changes = page.getByRole("dialog", { name: "Save changes", exact: true });
  const destination = page.getByRole("dialog", { name: "Save document", exact: true });
  const draft = "A draft survives cancellation.\n한글 저장과 다시 열기 ✓";

  await page.goto(url);
  await expect(document).toBeEnabled();
  await document.fill(draft);
  await close();
  await expect(changes).toBeVisible();
  await changes.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(changes).toHaveCount(0);
  await expect(document).toHaveValue(draft);
  await expect(editor.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.locator('[data-dock-app-id="text"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Quit", exact: true }).click();
  await expect(changes).toBeVisible();
  await changes.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(document).toHaveValue(draft);
  await expect(editor).toBeVisible();
  await close();
  await changes.getByRole("button", { name: "Don’t Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__editorOS.fs.exists('/home/guest/Documents/Untitled.txt')), false);

  await page.evaluate(() => window.__editorOS.launch('text'));
  await expect(document).toHaveValue("");
  await document.fill(draft);
  await close();
  await changes.getByRole("button", { name: "Save", exact: true }).click();
  await expect(destination).toBeVisible();
  await expect(document).toHaveAttribute("readonly", "");
  const path = destination.getByRole("textbox", { name: "File path", exact: true });
  await path.fill("relative.txt");
  await destination.getByRole("button", { name: "Save", exact: true }).click();
  await expect(destination.getByRole("alert")).toHaveText("Enter an absolute file path, including a file name.");
  await expect(document).toHaveValue(draft);
  await path.fill("/missing-folder/draft.txt");
  await destination.getByRole("button", { name: "Save", exact: true }).click();
  await expect(destination.getByRole("alert")).not.toBeEmpty();
  await expect(destination).toBeVisible();
  await path.fill("/home/guest/Documents/close-saved.txt");
  await destination.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__editorOS.fs.readFile('/home/guest/Documents/close-saved.txt')), draft);

  await page.evaluate(() => window.__editorOS.launch('files', {path:'/home/guest/Documents'}));
  await page.locator('.files-row').filter({hasText:'close-saved.txt'}).dblclick();
  await expect(document).toHaveValue(draft);
  await expect(editor.locator('.dos-window-titlebar strong')).toHaveText('close-saved.txt');
  await document.fill(`${draft}\nUnsaved after reopening`);
  await close();
  await expect(changes).toBeVisible();
  await assertDestroySettlesClose(page);
  await expect(page.locator('.app-sheet-backdrop')).toHaveCount(0);

  // Destroying while Save As awaits input must settle the same pending close.
  await page.goto(url);
  await expect(document).toBeEnabled();
  await document.fill("Destroy a pending save destination");
  await close();
  await changes.getByRole("button", {name:'Save', exact:true}).click();
  await expect(destination).toBeVisible();
  await assertDestroySettlesClose(page);
  await expect(page.locator('.dos-window')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('Editor browser smoke passed: cancel preserves draft, discard closes, invalid destination recovers, save closes, Files reopens exact text, destroy settles both pending sheets');
} catch (error) {
  console.error("Editor fixture diagnostics:", await page?.locator("body").innerText().catch(() => "Page unavailable"));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}

async function assertDestroySettlesClose(page) {
  const result = await page.evaluate(async () => {
    const os = window.__editorOS;
    const task = [...os.windows.windows.values()].find(task => task.frame.dataset.appId === 'text');
    const pending = task.closeRequest;
    if (!pending || typeof pending.then !== 'function') throw new Error('Expected a pending editor close request');
    await os.destroy();
    let timer;
    try {
      return await Promise.race([pending, new Promise(resolve => {timer = setTimeout(() => resolve('unresolved'), 1500);})]);
    } finally { clearTimeout(timer); }
  });
  assert.equal(result, false, 'forced runtime teardown settles the pending editor close without saving');
}
