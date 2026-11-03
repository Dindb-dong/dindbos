#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Keep this fixture memory-only: no document or session data survives the run.
const moduleSource = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__filesReady = createAndBootDindbOS({
  root: document.getElementById('desktop'), storage: {backend:'memory', name:'files-ui-smoke'},
  bootstrapPackages: false, builtins: {include:['files','calculator']},
  launch:[],
}).then(os => {
  for (const path of ['/mnt', '/mnt/portfolio', '/mnt/portfolio/presentations']) if (!os.fs.exists(path)) os.fs.createDirectory(path, '/', {owner:'guest',group:'guest'});
  const base='/mnt/portfolio/presentations';
  os.fs.createFile(base+'/clip-blip2-retrieval.html','/',{content:'<h1>Presentation</h1>',mime:'text/html',owner:'guest',group:'guest'});
  os.fs.createFile(base+'/notes.txt','/',{content:'Presentation notes',mime:'text/plain',owner:'guest',group:'guest'});
  os.fs.createDirectory('/home/guest/Projects','/',{owner:'guest',group:'guest'});
  os.fs.createDirectory('/home/guest/Desktop/Boards','/',{owner:'guest',group:'guest'});
  os.fs.createDirectory('/home/guest/Second Folder','/',{owner:'guest',group:'guest'});
  os.registerApp({id:'custom-file-icon',name:'Custom File Icon',icon:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>'),render:({content})=>{content.textContent='Custom app';}});
  os.shell.renderDesktop();
  os.fs.createFile('/home/guest/move-me.txt','/',{content:'Keep these bytes',mime:'text/plain',owner:'guest',group:'guest'});
  os.fs.createFile('/home/guest/readonly-test.txt','/',{content:'Must survive',mime:'text/plain',owner:'guest',group:'guest'});
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
  await expect(files).toHaveAttribute('data-files-view','icons');
  await expect(files.locator('.files-entry-art .files-document-art').first()).toBeVisible();
  await files.getByRole('button',{name:'New tab',exact:true}).click();
  await expect(files.getByRole('tab')).toHaveCount(2);
  await files.locator('.files-sidebar [data-nav="/home/guest"]').click();
  const folder=files.locator('.files-row[data-path="/home/guest/Projects"]');
  await folder.click();
  await expect(files.locator('.files-folder-title')).toHaveText('Home');
  await expect(folder).toHaveAttribute('aria-selected','true');
  await folder.dblclick();
  await expect(files.locator('.files-folder-title')).toHaveText('Projects');
  await files.getByRole('button',{name:'Close Projects tab',exact:true}).click();
  await expect(files.getByRole('tab')).toHaveCount(1);
  await expect(files.locator('.files-folder-title')).toHaveText('presentations');
  await files.getByRole('button',{name:'Search',exact:true}).click();
  await files.getByRole('searchbox',{name:'Search files'}).fill('notes');
  await expect(row).toHaveCount(0);
  await files.getByRole('searchbox',{name:'Search files'}).press('Escape');
  await expect(row).toBeVisible();
  await expect(files.getByRole('searchbox',{name:'Search files'})).toBeHidden();

  await expect(files.locator('.files-dropzone')).toBeHidden();
  await page.screenshot({path:output+'/files-toolbar.png'});
  await expect(files.locator('.files-sidebar .is-active')).toHaveCount(1);
  await files.locator('.files-more-actions summary').click();
  const more=page.getByRole('menu',{name:'More file actions',exact:true});
  await expect(more).toBeVisible();
  assert((await more.boundingBox()).width <= 250, 'More menu uses compact native-sized width');
  await page.screenshot({path:output+'/files-more-layer.png'});
  for (const item of await more.locator('button').all()) {
    assert(await item.evaluate((button)=>{const box=button.getBoundingClientRect();const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return button===hit||button.contains(hit);}), `More menu command must receive actual pointer hit: ${await item.evaluate(button=>({text:button.textContent,rect:button.getBoundingClientRect().toJSON(),hit:document.elementFromPoint(button.getBoundingClientRect().x+button.offsetWidth/2,button.getBoundingClientRect().y+button.offsetHeight/2)?.outerHTML.slice(0,200)}))}`);
  }
  await page.screenshot({path:output+'/files-more-layer.png'});
  await more.getByRole('menuitem',{name:'Add Current Folder to Favorites',exact:true}).click();
  await expect(files.locator('[data-favorite][data-nav="/mnt/portfolio/presentations"]')).toBeVisible();
  await page.locator('.dos-icon[aria-label="Open Boards"]').dragTo(files.locator('[data-favorite-drop]'));
  await expect(files.locator('[data-favorite][data-nav="/home/guest/Desktop/Boards"]')).toBeVisible();
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Desktop/Boards')),'dragging a desktop folder to Favorites keeps it on the desktop');
  const emptyTransfer=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.setData('application/x-dindbos-path','');return transfer;});
  await files.locator('[data-favorite-drop]').dispatchEvent('drop',{dataTransfer:emptyTransfer});
  await expect(files.locator('[data-favorite][data-nav="/"]')).toHaveCount(0);
  await files.locator('.files-sidebar').getByRole('button',{name:'Home',exact:true}).click();
  await files.locator('.files-sidebar').getByRole('button',{name:'Desktop',exact:true}).click();
  await expect(files.locator('.files-sidebar .is-active')).toHaveCount(1);
  await expect(files.locator('.files-sidebar .is-active')).toHaveAttribute('data-nav','/home/guest/Desktop');
  await files.locator('.files-sidebar').getByRole('button',{name:'Home',exact:true}).click();
  const projects=files.locator('.files-row[data-path="/home/guest/Projects"]');
  await projects.dragTo(files.locator('[data-favorite-drop]'));
  const pinnedProjects=files.locator('[data-favorite][data-nav="/home/guest/Projects"]');
  await expect(pinnedProjects).toBeVisible();
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Projects')), 'pinning a folder never moves the original');
  await pinnedProjects.dragTo(files.locator('[data-favorite][data-nav="/home/guest"]'),{targetPosition:{x:25,y:2}});
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Projects');
  await files.locator('.files-row[data-path="/home/guest/move-me.txt"]').dragTo(pinnedProjects);
  await expect.poll(()=>page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Projects/move-me.txt'))).toBe(true);
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/move-me.txt')),false);
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.readFile('/home/guest/Projects/move-me.txt')),'Keep these bytes');
  const imported=await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['Imported into favorite'],'external.txt',{type:'text/plain'}));return transfer;});
  await pinnedProjects.dispatchEvent('drop',{dataTransfer:imported});
  await expect.poll(()=>page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Projects/external.txt'))).toBe(true);
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.readFile('/home/guest/Projects/external.txt')),'Imported into favorite');
  await files.locator('.files-sidebar').getByRole('button',{name:'Home',exact:true}).click();
  await files.locator('.files-row[data-path="/home/guest/readonly-test.txt"]').dragTo(files.locator('.files-sidebar').getByRole('button',{name:'System',exact:true}));
  await expect.poll(()=>page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/readonly-test.txt'))).toBe(true);
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.exists('/etc/readonly-test.txt')),false,'denied target never receives a partial move');
  await pinnedProjects.click({button:'right'});
  await page.getByRole('menuitem',{name:'Move Down',exact:true}).click();
  await expect(files.locator('[data-favorite]').nth(1)).toHaveAttribute('data-nav','/home/guest/Projects');
  await pinnedProjects.click({button:'right'});
  await page.getByRole('menuitem',{name:'Move Up',exact:true}).click();
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Projects');
  const persisted=await page.evaluate(()=>JSON.parse(window.__filesOS.fs.readFile('/home/guest/.config/dindbos/files-favorites.json')));
  assert.equal(persisted[0],'/home/guest/Projects');
  await page.locator('.dos-window[data-app-id="files"] button[aria-label="Close"]').click();
  await expect(files).toHaveCount(0);
  await page.evaluate(()=>window.__filesOS.launch('files',{path:'/mnt/portfolio/presentations'}));
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Projects');
  await pinnedProjects.focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem',{name:'Remove from Favorites',exact:true}).click();
  await expect(pinnedProjects).toHaveCount(0);
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Projects/move-me.txt')),'removing a favorite never removes its folder or files');
  await expect(files.locator('.files-sidebar .is-active')).toHaveCount(1);
  await page.screenshot({path:output+'/files-favorites.png'});

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
  const rename = files.getByRole('textbox', {name:'Rename item',exact:true});
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue('Untitled Folder');
  assert.deepEqual(await rename.evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,15]);
  await page.screenshot({path:output+'/files-new-folder-rename.png'});
  await rename.fill('Created Folder'); await rename.press('Enter');
  await expect(rename).toHaveCount(0);
  await expect(files.locator('.files-row').filter({hasText:'Created Folder'})).toBeVisible();
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/mnt/portfolio/presentations/Created Folder')));
  const notes=files.locator('.files-row[data-path="/mnt/portfolio/presentations/notes.txt"]');
  await notes.click({button:'right'}); await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await expect(rename).toBeFocused();
  assert.deepEqual(await rename.evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,5], 'rename selects basename while preserving extension');
  await rename.fill('clip-blip2-retrieval.html'); await rename.press('Enter');
  await expect(rename).toHaveAttribute('aria-invalid','true');
  await expect(files.getByRole('alert')).toContainText('already exists');
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.readFile('/mnt/portfolio/presentations/notes.txt')),'Presentation notes');
  await rename.fill(''); await rename.press('Enter');
  await expect(files.getByRole('alert')).toContainText('Invalid filename');
  await rename.fill('not/allowed.txt'); await rename.press('Enter');
  await expect(files.getByRole('alert')).toContainText('cannot contain');
  await rename.press('Escape'); await expect(rename).toHaveCount(0);
  await expect(notes).toBeVisible();
  for (const mode of ['list','columns','icons']) {
    await files.locator('.files-view-menu summary').click();
    await page.getByRole('menuitemradio',{name:mode==='list'?'as List':mode==='columns'?'as Columns':'as Icons',exact:true}).click();
    await notes.click({button:'right'}); await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();
    await expect(rename).toBeFocused();
    await rename.fill('draft.txt'); await rename.press('Escape');
    await expect(notes).toBeVisible();
  }
  await notes.click({button:'right'}); await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await rename.fill('Updated notes.txt'); await files.locator('.files-folder-title').click();
  await expect(files.locator('.files-row[data-path="/mnt/portfolio/presentations/Updated notes.txt"]')).toBeVisible();
  assert.equal(await page.evaluate(()=>window.__filesOS.fs.readFile('/mnt/portfolio/presentations/Updated notes.txt')),'Presentation notes');
  await files.getByRole('button',{name:'New Folder',exact:true}).click();
  await expect(rename).toBeFocused(); await rename.press('Escape');
  await expect(files.locator('.files-row[data-path="/mnt/portfolio/presentations/Untitled Folder"]')).toBeVisible();
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
  await expect(page.getByRole('menuitemradio',{name:'as List',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio',{name:'as Columns',exact:true})).toBeFocused();
  await page.keyboard.press('Escape'); await expect(view).toBeFocused();
  await view.click(); await page.getByRole('menuitemradio',{name:'as Columns',exact:true}).click();
  await expect(files).toHaveAttribute('data-files-view','columns');
  const sort=files.locator('.files-sort-menu summary');
  await sort.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio',{name:'Name',exact:true})).toBeFocused(); await page.keyboard.press('Enter');
  await expect(files.locator('.files-sort-menu')).not.toHaveAttribute('open',''); await sort.click(); await expect(page.getByRole('menuitemradio',{name:'Name',exact:true})).toHaveAttribute('aria-checked','true'); await page.keyboard.press('Escape');
  await files.locator('.files-sidebar').getByRole('button',{name:'Portfolio',exact:true}).click();
  await files.getByRole('button',{name:'Back',exact:true}).click();
  await expect(files.locator('.files-folder-title')).toHaveText('presentations');
  await files.getByRole('button',{name:'Forward',exact:true}).click();
  await expect(files.locator('.files-folder-title')).toHaveText('portfolio');
  await files.locator('.files-more-actions summary').click();
  await page.getByRole('menuitem',{name:'Add Current Folder to Favorites',exact:true}).click();
  await expect(files.locator('.files-sidebar [data-nav="/mnt/portfolio"]')).toHaveCount(2);
  await expect(files.locator('.files-sidebar .is-active')).toHaveCount(1);
  await expect(files.locator('.files-sidebar .is-active')).toHaveAttribute('data-favorite','true');
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
  await files.locator('.files-more-actions summary').click();
  const compactMenu=page.getByRole('menu',{name:'More file actions',exact:true});
  await expect(compactMenu).toBeVisible();
  await page.screenshot({path:output+'/files-more-mobile.png'});
  await expect.poll(()=>compactMenu.locator('button').last().evaluate(button=>{const b=button.getBoundingClientRect();return button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  const compactBox=await compactMenu.boundingBox(); const compactContent=await content.boundingBox();
  assert(compactBox.x>=compactContent.x&&compactBox.x+compactBox.width<=compactContent.x+compactContent.width+1,'narrow toolbar menu stays in its window');
  await page.screenshot({path:output+'/files-more-mobile.png'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.dos-window[data-app-id="files"] button[aria-label="Maximize"]').click();
  await page.evaluate(()=>{for(let index=0;index<35;index++)window.__filesOS.fs.createFile('/home/guest/scroll-'+index+'.txt','/',{content:'row '+index,mime:'text/plain',owner:'guest',group:'guest'});});
  await files.locator('.files-sidebar').getByRole('button',{name:'Home',exact:true}).click();
  await files.locator('.files-view-menu summary').click();
  await page.getByRole('menuitemradio',{name:'as List',exact:true}).click();
  await files.locator('.files-more-actions summary').click();
  await files.locator('.files-column').evaluate(column=>{column.scrollTop=300;});
  await expect.poll(()=>files.locator('.files-column').evaluate(column=>column.scrollTop)).toBeGreaterThan(0);
  await expect.poll(()=>page.getByRole('menu',{name:'More file actions',exact:true}).locator('button').last().evaluate(button=>{const b=button.getBoundingClientRect();return button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  await page.screenshot({path:output+'/files-menu-scrolled.png'});
  await page.keyboard.press('Escape');

  // New content folders can be pinned between rows, rather than moved into them.
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>window.__filesOS.setAppearance({mode:"light"}));
  await files.locator('.files-sidebar [data-nav="/home/guest"]').click();
  await files.locator('.files-row[data-path="/home/guest/Projects"]').dragTo(files.locator('[data-favorite][data-nav="/home/guest"]'),{targetPosition:{x:25,y:2}});
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Projects');
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Projects/move-me.txt')),'inserting a favorite leaves the original folder and contents intact');
  await files.locator('.files-row[data-path="/home/guest/Second Folder"]').dragTo(files.locator('[data-favorite][data-nav="/home/guest"]'),{targetPosition:{x:25,y:30}});
  const order=await files.locator('[data-favorite]').evaluateAll(items=>items.map(item=>item.dataset.nav));
  assert.equal(order[order.indexOf('/home/guest')+1],'/home/guest/Second Folder','a new folder inserts after the targeted row');
  assert(await page.evaluate(()=>window.__filesOS.fs.exists('/home/guest/Second Folder')),'pinning must not move a folder into Home or another Favorite');
  const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.setData('application/x-dindbos-path','/home/guest/Second Folder');return data;});
  const firstFavorite=files.locator('[data-favorite]').first();
  const firstBox=await firstFavorite.boundingBox();
  await firstFavorite.dispatchEvent('dragover',{dataTransfer:transfer,clientY:firstBox.y+2});
  await expect(firstFavorite).toHaveClass(/is-favorite-before/);
  await page.screenshot({path:output+'/files-insertion-indicator.png'});
  await firstFavorite.dispatchEvent('drop',{dataTransfer:transfer,clientY:firstBox.y+2});
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Second Folder');
  assert.equal(await files.locator('[data-favorite][data-nav="/home/guest/Second Folder"]').count(),1,'reinserting an existing folder never duplicates its shortcut');
  await transfer.dispose();
  await page.locator('.dos-window[data-app-id="files"] button[aria-label="Close"]').click();
  await page.evaluate(()=>window.__filesOS.launch('files',{path:'/usr/share/applications'}));
  await expect(files.locator('[data-favorite]').first()).toHaveAttribute('data-nav','/home/guest/Second Folder');
  await files.locator('.files-view-menu > summary').click();
  await page.getByRole('menuitemradio',{name:'as Icons',exact:true}).click();
  const calculatorIcon=files.locator('[data-files-app-icon="calculator"]');
  await expect(calculatorIcon.locator('svg.dos-app-icon')).toBeVisible();
  await expect(files.locator('[data-files-app-icon="custom-file-icon"] img')).toBeVisible();
  await expect(files.locator('.files-row:has([data-files-app-icon]) .files-document-art')).toHaveCount(0);
  await page.screenshot({path:output+'/files-application-icons.png'});
  await files.locator('.files-view-menu > summary').click();
  await page.getByRole('menuitemradio',{name:'as List',exact:true}).click();
  await expect(calculatorIcon.locator('svg.dos-app-icon')).toBeVisible();
  await page.screenshot({path:output+'/files-application-icons-list.png'});
  await page.evaluate(()=>{for(let index=0;index<20;index++)window.__filesOS.registerApp({id:'scroll-app-'+index,name:'Scroll App '+index,icon:'app',render:()=>{}});window.__filesOS.setAppearance({mode:'dark'});});
  await files.locator('.files-sidebar [data-nav="/home/guest"]').click();
  await files.locator('.files-sidebar [data-nav="/usr/share/applications"]').click();
  await files.locator('.files-view-menu > summary').click();
  await page.getByRole('menuitemradio',{name:'as Icons',exact:true}).click();
  assert.equal(await files.locator('.files-column').evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)','a column must not tint only the occupied part of the icon viewport');
  await files.evaluate(element=>{const frame=element.closest('.dos-window');frame.classList.remove('is-maximized');Object.assign(frame.style,{width:'760px',height:'520px'});});
  const scrollArea=files.locator('.files-column-view');
  await scrollArea.evaluate(element=>{element.scrollTop=150;});
  await expect.poll(()=>scrollArea.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({path:output+'/files-icons-dark-scrolled.png'});
  await files.locator('.files-sidebar [data-nav="/mnt/portfolio/presentations"]').click();
  await page.setViewportSize({width:390,height:844});
  const updatedNotes=files.locator('.files-row[data-path="/mnt/portfolio/presentations/Updated notes.txt"]');
  await updatedNotes.click({button:'right'}); await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();
  await expect(rename).toBeFocused();
  const renameBox=await rename.boundingBox(), renameFrame=await files.boundingBox();
  assert(renameBox.x>=renameFrame.x&&renameBox.x+renameBox.width<=renameFrame.x+renameFrame.width+1,'inline name editor stays in narrow dark Finder');
  await page.screenshot({path:output+'/files-rename-mobile-dark.png'});
  await page.evaluate(()=>window.__filesOS.destroy());
  await expect(page.locator('[data-files-rename]')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('Files UI browser smoke passed: inline new-folder/rename/save/cancel/collision/validation/blur in all views, overlay hit-tests, Favorites, drops, context commands, keyboard menus, history, dark/mobile and rename teardown');
} catch(error) {
  console.error(await page?.locator('body').innerText().catch(()=>''));
  throw error;
} finally { await browser?.close(); await server.close(); }
