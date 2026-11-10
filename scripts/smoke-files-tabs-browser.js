#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Memory-only desktop in an offset host. No user files, native windows or remote services.
const source = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__ready=createAndBootDindbOS({ui:{style:'macos'},root:document.getElementById('desktop'),storage:{backend:'memory',name:'files-tabs-smoke'},bootstrapPackages:false,builtins:{include:['files']}}).then(os=>{
 window.__os=os;
 const windowApi=os.launch('files',{path:'/home/guest'});
 window.__sourceId=windowApi.id;
 Object.assign(os.windows.windows.get(windowApi.id).frame.style,{left:'40px',top:'80px',width:'600px',height:'400px'});
 return os;
});`;
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[]},plugins:[{name:'files-tabs-fixture',resolveId(id){if(id==='/files-tabs.js')return '\0files-tabs';},load(id){if(id==='\0files-tabs')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/files-tabs')return next();try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><body style="margin:0;background:#ddd"><div id="desktop" style="margin:50px 80px;width:1320px;height:900px"></div><script type="module" src="/files-tabs.js"></script>'));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const output=process.env.DINDBOS_QA_OUTPUT || 'internal/docs/qa/files-tabs';
let browser;
try {
 await mkdir(output,{recursive:true});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1020},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/files-tabs`);await page.evaluate(()=>window.__ready);
 const sourceId=await page.evaluate(()=>window.__sourceId);
 const original=page.locator(`.dos-window[data-window-id="${sourceId}"]`);
 const files=original.locator('.files-app');
 const tabs=()=>files.getByRole('tab');
 const tabPaths=()=>tabs().evaluateAll(elements=>elements.map(element=>element.title));
 const newTab=()=>files.getByRole('button',{name:'New tab',exact:true}).click();
 await expect(files).toHaveAttribute('data-files-path','/home/guest');
 await newTab();await expect(tabs()).toHaveCount(2);
 await files.locator('.files-sidebar [data-nav="/home/guest/Documents"]').click();
 await expect(files).toHaveAttribute('data-files-path','/home/guest/Documents');
 await newTab();await expect(tabs()).toHaveCount(3);
 await files.locator('.files-sidebar [data-nav="/home/guest/Downloads"]').click();
 await expect(files).toHaveAttribute('data-files-path','/home/guest/Downloads');
 assert.deepEqual(await tabPaths(),['/home/guest','/home/guest/Documents','/home/guest/Downloads']);
 const dragStart=async(locator)=>{const box=await locator.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();return box;};
 const first=await tabs().first().boundingBox();
 await dragStart(tabs().nth(2));await page.mouse.move(first.x+8,first.y+first.height/2,{steps:12});
 await expect(original.locator('.is-tab-drop-before')).toHaveCount(1);
 await expect(page.locator('.files-tab-drag-preview')).toBeVisible();
 await page.screenshot({path:output+'/tab-insertion.png'});
 await page.mouse.up();
 await expect.poll(tabPaths).toEqual(['/home/guest/Downloads','/home/guest','/home/guest/Documents']);
 await expect(files).toHaveAttribute('data-files-path','/home/guest/Downloads');
 await expect(page.locator('.files-tab-drag-preview')).toHaveCount(0);
 await expect(tabs().first()).toBeFocused();
 const beforeCancel=await tabPaths();
 const bounds=await original.boundingBox();
 const outside={x:bounds.x+bounds.width+80,y:bounds.y+bounds.height/2};
 await dragStart(tabs().nth(1));await page.mouse.move(outside.x,outside.y,{steps:12});
 await expect(page.locator('.files-tab-drag-preview')).toBeVisible();
 await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.locator('.dos-window[data-app-id="files"]')).toHaveCount(1);
 assert.deepEqual(await tabPaths(),beforeCancel,'Escape cancels detaching and reordering');
 await expect(page.locator('.files-tab-drag-preview')).toHaveCount(0);
 // Detach the background Documents tab, preserving its Home -> Documents history.
 const backgroundTab=await tabs().nth(2).boundingBox();
 const firstTab=await tabs().first().boundingBox();
 await dragStart(tabs().nth(2));await page.mouse.move(outside.x,outside.y,{steps:12});await page.mouse.up();
 await expect(page.locator('.dos-window[data-app-id="files"]')).toHaveCount(2);
 await expect(tabs()).toHaveCount(2);
 const detached=page.locator(`.dos-window[data-app-id="files"]:not([data-window-id="${sourceId}"])`);
 await expect(detached.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest/Documents');
 const detachedBounds=await detached.boundingBox();
 assert.equal(detachedBounds.width,bounds.width,'detaching preserves source window width');
 assert.equal(detachedBounds.height,bounds.height,'detaching preserves source window height');
 const grabbedOffsetX=firstTab.x-bounds.x+backgroundTab.width/2;
 const grabbedOffsetY=backgroundTab.y-bounds.y+backgroundTab.height/2;
 assert(Math.abs(detachedBounds.x+grabbedOffsetX-outside.x)<=2,'new window tab keeps the pointer grab point at the release location');
 assert(Math.abs(detachedBounds.y+grabbedOffsetY-outside.y)<=2,'new window follows the pointer vertically in an offset host');
 const savedPlacement=await page.evaluate(()=>window.__os.windows.readWindowPlacements().files);
 const hostBounds=await page.locator('.dindbos-host').boundingBox();
 assert.equal(savedPlacement.left,Math.round(detachedBounds.x-hostBounds.x),'drop location is persisted in host coordinates');
 await detached.getByRole('button',{name:'Back',exact:true}).click();
 await expect(detached.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest');
 await detached.getByRole('button',{name:'Forward',exact:true}).click();
 await expect(detached.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest/Documents');
 await page.screenshot({path:output+'/tab-detached-windows.png'});
 // The remaining source tab can also tear off: new window replaces the source safely.
 await page.evaluate((id)=>window.__os.windows.focus(id),sourceId);
 await files.getByRole('button',{name:'Close Home tab',exact:true}).click();
 await expect(tabs()).toHaveCount(1);
 await dragStart(tabs().first());await page.mouse.move(1490,1000,{steps:12});await page.mouse.up();
 await expect(original).toHaveCount(0);
 await expect(page.locator('.dos-window[data-app-id="files"]')).toHaveCount(2);
 await expect(page.locator('.files-app[data-files-path="/home/guest/Downloads"]')).toHaveCount(1);
 await expect(page.locator('.files-tab-drag-preview')).toHaveCount(0);
 const edgeTarget=page.locator('.dos-window').filter({has:page.locator('.files-app[data-files-path="/home/guest/Downloads"]')});
 const edgeBounds=await edgeTarget.boundingBox();
 const viewport=await page.evaluate(()=>window.__os.windows.viewport());
 assert(edgeBounds.x>=hostBounds.x+8 && edgeBounds.y>=hostBounds.y+58,'edge drop stays below menu and within the host');
 assert(edgeBounds.x+edgeBounds.width<=hostBounds.x+viewport.width-7,'edge drop clamps at the host right edge');
 assert(edgeBounds.y+edgeBounds.height<=hostBounds.y+viewport.height-viewport.bottomInset+1,'edge drop reserves the real Dock');
 await page.screenshot({path:output+'/tab-detached-edge.png'});
 // A transferred tab retains history beyond 100 entries, rather than silently resetting.
 const longSourceId=await page.evaluate(()=>{
   const history=Array.from({length:120},(_,index)=>index%2?'/home/guest/Documents':'/home/guest');
   return window.__os.launch('files',{path:'/home/guest/Documents',filesTab:{history,historyIndex:119}}).id;
 });
 const longSource=page.locator(`.dos-window[data-window-id="${longSourceId}"]`);
 await expect(longSource.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest/Documents');
 await longSource.getByRole('button',{name:'New tab',exact:true}).click();
 await expect(longSource.getByRole('tab')).toHaveCount(2);
 const longBounds=await longSource.boundingBox();
 await dragStart(longSource.getByRole('tab').first());
 await page.mouse.move(Math.min(1490,longBounds.x+longBounds.width+35),Math.min(1000,longBounds.y+longBounds.height+35),{steps:12});await page.mouse.up();
 await expect(longSource.getByRole('tab')).toHaveCount(1);
 const longTargetId=await page.evaluate(()=>window.__os.windows.activeWindowId);
 const longTarget=page.locator(`.dos-window[data-window-id="${longTargetId}"]`);
 await expect(longTarget.getByRole('button',{name:'Back',exact:true})).toBeEnabled();
 await longTarget.getByRole('button',{name:'Back',exact:true}).click();
 await expect(longTarget.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest');
 await longTarget.getByRole('button',{name:'Forward',exact:true}).click();
 await expect(longTarget.locator('.files-app')).toHaveAttribute('data-files-path','/home/guest/Documents');
 assert.equal(await page.evaluate(id=>window.__os.windows.windows.get(id).context.filesTab.history.length,longTargetId),120);
 await longTarget.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(id=>window.__os.windows.focus(id),longSourceId);
 // A failed async destination mount must leave the original tab/window untouched.
 await page.evaluate(()=>{
   const mounts=window.__os.localMounts;
   window.__mountOriginals={isMountedPath:mounts.isMountedPath,syncDirectory:mounts.syncDirectory};
   mounts.isMountedPath=path=>path==='/home/guest/Documents';
   mounts.syncDirectory=async()=>{throw new Error('Synthetic unavailable mount');};
 });
 const windowsBeforeFailure=await page.locator('.dos-window[data-app-id="files"]').count();
 await dragStart(longSource.getByRole('tab').first());
 await page.mouse.move(Math.min(1490,longBounds.x+longBounds.width+35),Math.min(1000,longBounds.y+longBounds.height+35),{steps:12});await page.mouse.up();
 await expect(longSource).toHaveAttribute('aria-label',/Could not detach tab/);
 await expect(longSource.getByRole('tab')).toHaveCount(1);
 await expect(page.locator('.dos-window[data-app-id="files"]')).toHaveCount(windowsBeforeFailure);
 await page.evaluate(()=>Object.assign(window.__os.localMounts,window.__mountOriginals));
 await longSource.getByRole('button',{name:'Close',exact:true}).click();
 // Close Tab handles Cmd/Ctrl+W; adding Shift closes the entire multi-tab window.
 for (const modifier of ['Meta','Control']) {
   const shortcutId=await page.evaluate(()=>window.__os.launch('files',{path:'/home/guest'}).id);
   const shortcutWindow=page.locator(`.dos-window[data-window-id="${shortcutId}"]`);
   await shortcutWindow.getByRole('button',{name:'New tab',exact:true}).click();
   await expect(shortcutWindow.getByRole('tab')).toHaveCount(2);
   await shortcutWindow.getByRole('tab').last().click();
   await expect(shortcutWindow.getByRole('tab').last()).toBeFocused();
   await page.keyboard.press(`${modifier}+w`);
   await expect(shortcutWindow.getByRole('tab')).toHaveCount(1);
   await shortcutWindow.getByRole('button',{name:'New tab',exact:true}).click();
   await expect(shortcutWindow.getByRole('tab')).toHaveCount(2);
   await shortcutWindow.getByRole('tab').last().click();
   await expect(shortcutWindow.getByRole('tab').last()).toBeFocused();
   await page.keyboard.press(`${modifier}+Shift+w`);
   await expect(shortcutWindow).toHaveCount(0);
 }
 // Destroy during a pointer drag must remove the preview and global listeners.
 const remaining=page.locator('.files-app[data-files-path="/home/guest/Downloads"]');
 await dragStart(remaining.getByRole('tab').first());await page.mouse.move(1350,900,{steps:10});
 await expect(page.locator('.files-tab-drag-preview')).toBeVisible();
 await page.evaluate(()=>window.__os.destroy());await page.mouse.up();
 await expect(page.locator('.files-tab-drag-preview')).toHaveCount(0);
 await expect(page.locator('.dos-window')).toHaveCount(0);
 assert.deepEqual(errors,[]);
 console.log('Files tabs browser smoke passed: pointer reorder/cancel/tear-off at release position, host/Dock edge clamp, full history, failed mount recovery, Cmd/Ctrl+W tab close, Shift+Cmd/Ctrl+W window close, offset host and destroy cleanup');
} finally {await browser?.close();await server.close();}
