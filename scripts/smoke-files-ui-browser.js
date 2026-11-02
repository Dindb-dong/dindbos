#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Keep this fixture memory-only: no document or session data survives the run.
const moduleSource = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
${["dindbos", "theme", "shell", "windows", "dock", "apps", "files"].map((name) => `import '/src/styles/${name}.css';`).join("\n")}
window.__filesReady = createAndBootDindbOS({
  root: document.getElementById('desktop'), storage: {backend:'memory', name:'files-ui-smoke'},
  bootstrapPackages: false, builtins: {include:['files']},
  launch:[],
}).then(os => {
  for (const path of ['/mnt', '/mnt/portfolio', '/mnt/portfolio/presentations']) if (!os.fs.exists(path)) os.fs.createDirectory(path, '/', {owner:'guest',group:'guest'});
  const base='/mnt/portfolio/presentations';
  os.fs.createFile(base+'/clip-blip2-retrieval.html','/',{content:'<h1>Presentation</h1>',mime:'text/html',owner:'guest',group:'guest'});
  os.fs.createFile(base+'/notes.txt','/',{content:'Presentation notes',mime:'text/plain',owner:'guest',group:'guest'});
  os.launch('files', {path:base});
  return window.__filesOS = os;
});
`;
const server = await createServer({
  configFile: false,
  logLevel: "error",
  optimizeDeps: { entries: [], include: ["react", "react-dom/client"] },
  plugins: [{
    name: "files-ui-fixture",
    resolveId(id) { if (id === "/files-ui-fixture.js") return "\0files-ui-fixture"; },
    load(id) { if (id === "\0files-ui-fixture") return moduleSource; },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/files-ui-fixture") return next();
        response.setHeader("Content-Type", "text/html");
        try {
          response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/files-ui-fixture.js"></script></body></html>'));
        } catch (error) { next(error); }
      });
    },
  }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
let page;
const output = process.env.DINDBOS_QA_OUTPUT || 'internal/docs/qa/files-refinement';
try {
  await mkdir(output, {recursive:true});
  await server.listen();
  const address=server.httpServer.address();
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/files-ui-fixture`);
  const files=page.locator('.files-app');
  const row=page.locator('.files-row').filter({hasText:'clip-blip2-retrieval.html'});
  await expect(row).toBeVisible();
  await expect(files.locator('select')).toHaveCount(0);
  await expect(files.locator('.files-dropzone')).toBeHidden();
  await page.screenshot({path:output+'/files-toolbar.png'});
  const menu=page.getByRole('menu',{name:'File actions',exact:true});
  await row.click({button:'right'});
  await expect(menu).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.files-status')).toContainText('1 selected');
  await menu.getByRole('menuitem',{name:'Copy',exact:false}).click();
  await expect(menu).toHaveCount(0);
  await row.click({button:'right'});
  await expect(menu).toBeVisible();
  await page.screenshot({path:output+'/files-context.png'});
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const area=page.locator('.files-column-view');
  await area.click({button:'right',position:{x:470,y:250}});
  const background=page.getByRole('menu',{name:'Folder actions',exact:true});
  await expect(background).toBeVisible();
  await expect(background.getByRole('menuitem',{name:'Rename',exact:true})).toHaveCount(0);
  await background.getByRole('menuitem',{name:'New Folder',exact:true}).click();
  await expect(page.locator('.files-row').filter({hasText:'untitled-folder'})).toBeVisible();
  await row.click({button:'right'});
  await files.locator('.files-folder-title').click();
  await expect(menu).toHaveCount(0);
  const content=page.locator('.dos-window-content').filter({has:files});
  const box=await content.boundingBox();
  await page.mouse.click(box.x+box.width-22,box.y+box.height-42,{button:'right'});
  await expect(background).toBeVisible();
  const menuBox=await background.boundingBox();
  assert(menuBox.x>=box.x&&menuBox.y>=box.y&&menuBox.x+menuBox.width<=box.x+box.width+1&&menuBox.y+menuBox.height<=box.y+box.height+1,'right-bottom menu stays in content bounds');
  await page.keyboard.press('Escape');
  const view=files.locator('.files-view-menu summary');
  await view.focus(); await page.keyboard.press('ArrowDown');
  await expect(files.getByRole('menuitemradio',{name:'as List',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(files.getByRole('menuitemradio',{name:'as Columns',exact:true})).toBeFocused();
  await page.keyboard.press('Escape'); await expect(view).toBeFocused();
  await view.click(); await files.getByRole('menuitemradio',{name:'as Columns',exact:true}).click();
  await expect(files).toHaveAttribute('data-files-view','columns');
  const sort=files.locator('.files-sort-menu summary');
  await sort.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await expect(files.getByRole('menuitemradio',{name:'Name',exact:true})).toBeFocused(); await page.keyboard.press('Enter');
  await expect(files.locator('.files-sort-menu')).not.toHaveAttribute('open',''); await sort.click(); await expect(files.getByRole('menuitemradio',{name:'Name',exact:true})).toHaveAttribute('aria-checked','true'); await page.keyboard.press('Escape');
  await files.getByRole('button',{name:'Portfolio',exact:true}).click();
  await files.getByRole('button',{name:'Back',exact:true}).click();
  await expect(files.locator('.files-folder-title')).toHaveText('presentations');
  await files.getByRole('button',{name:'Forward',exact:true}).click();
  await expect(files.locator('.files-folder-title')).toHaveText('portfolio');
  await page.evaluate(()=>window.__filesOS.setAppearance({mode:'dark'}));
  await page.screenshot({path:output+'/files-dark.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.dos-menubar')).toHaveCount(1);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(() => files.locator('.files-column[data-column="/mnt/portfolio"]').evaluate((column) => {
    const viewport = column.parentElement.getBoundingClientRect();
    const current = column.getBoundingClientRect();
    return current.right <= viewport.right + 1 && current.left >= viewport.left - 1;
  })).toBe(true);
  await page.screenshot({path:output+'/files-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('Files UI browser smoke passed: compact toolbar, row/background context commands and dismissal, bounds, keyboard menus, view/sort, navigation history, dark/mobile');
} catch(error) {
  console.error(await page?.locator('body').innerText().catch(()=>''));
  throw error;
} finally { await browser?.close(); await server.close(); }
