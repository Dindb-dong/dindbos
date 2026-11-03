#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Isolated in-memory files and apps; no native windows or remote services.
const source = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__ready=createAndBootDindbOS({root:document.getElementById('desktop'),storage:{backend:'memory',name:'files-context-menu'},bootstrapPackages:false,builtins:{include:['files','text','viewer']}}).then(os=>{
 const base='/home/guest/Documents';
 os.fs.createFile(base+'/notes.txt','/',{content:'Context menu evidence',mime:'text/plain',owner:'guest',group:'guest'});
 os.fs.createDirectory(base+'/Projects','/',{owner:'guest',group:'guest'});
 window.__opened=[];
 for(const [id,name,associationPriority] of [['low-editor','Low Editor',30],['preferred-editor','Preferred Editor',90]]) os.registerApp({id,name,accepts:['text/plain'],associationPriority,icon:'text',render:({content,context})=>{window.__opened.push({id,path:context.path,nodePath:context.node?.path});content.textContent=name;}});
 window.__os=os;
 window.__sourceId=os.launch('files',{path:base}).id;
 return os;
});`;
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[],include:['react','react-dom/client']},plugins:[{name:'files-context-fixture',resolveId(id){if(id==='/files-context.js')return '\0files-context';},load(id){if(id==='\0files-context')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/files-context')return next();try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/files-context.js"></script>'));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const output=process.env.DINDBOS_QA_OUTPUT||'internal/docs/qa/files-context-menu';
let browser;
try {
 await mkdir(output,{recursive:true});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/files-context`);await page.evaluate(()=>window.__ready);
 const sourceId=await page.evaluate(()=>window.__sourceId);
 const frame=page.locator(`.dos-window[data-window-id="${sourceId}"]`);
 const files=frame.locator('.files-app');
 let path='/home/guest/Documents/notes.txt';
 const row=()=>files.locator(`.files-row[data-path="${path}"]`);
 const menu=()=>frame.getByRole('menu',{name:'File actions',exact:true});
 const openMenu=async()=>{await row().click({button:'right'});await expect(menu()).toBeVisible();};
 const command=action=>menu().locator(`[data-context-action="${action}"]`);
 const closeOtherWindows=()=>page.evaluate(id=>{for(const task of [...window.__os.windows.windows.values()])if(task.id!==id)task.api.close();window.__os.windows.focus(id);},sourceId);
 await openMenu();
 for(const action of ['open','open-with','trash','info','rename','compress','duplicate','make-alias','quick-look','copy','share','quick-actions'])await expect(command(action)).toBeVisible();
 assert(await menu().getByRole('separator').count()>=4,'Finder context commands have visual groups');
 await command('open-with').hover();
 const submenu=()=>frame.getByRole('menu',{name:'Open With submenu',exact:true});
 await expect(submenu()).toBeVisible();
 await expect(submenu().getByRole('menuitem').first()).toHaveText('Preferred Editor (Default)');
 await expect(submenu().getByRole('menuitem').nth(1)).toHaveText('Low Editor');
 await page.screenshot({path:output+'/context-open-with-desktop.png'});
 // Hover and keyboard use one submenu lifecycle, with focus returning to its trigger.
 await command('open-with').focus();await page.keyboard.press('ArrowRight');
 await expect(submenu().getByRole('menuitem').first()).toBeFocused();
 await page.keyboard.press('ArrowLeft');await expect(submenu()).toHaveCount(0);await expect(command('open-with')).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(submenu()).toBeVisible();
 await submenu().getByRole('menuitem').first().click();
 await expect.poll(()=>page.evaluate(()=>window.__opened.at(-1))).toEqual({id:'preferred-editor',path,nodePath:path});
 await expect(frame.locator('.files-context-menu')).toHaveCount(0);await closeOtherWindows();
 // Open uses the same actual registered association as the default Open With command.
 await openMenu();await command('open').click();
 await expect.poll(()=>page.evaluate(()=>window.__opened.length)).toBe(2);
 assert.equal(await page.evaluate(()=>window.__opened.at(-1).id),'preferred-editor');
 await closeOtherWindows();
 await openMenu();await command('quick-look').click();
 await expect(page.locator('.dos-window[data-app-id="viewer"]')).toBeVisible();
 await expect(page.locator('.dos-window[data-app-id="viewer"]')).toContainText('Context menu evidence');
 await closeOtherWindows();
 const folder=files.locator('.files-row[data-path="/home/guest/Documents/Projects"]');
 await folder.click({button:'right'});await expect(command('open-new-window')).toBeVisible();await expect(command('open-with')).toHaveCount(0);
 await command('open-new-window').click();
 await expect(page.locator('.files-app[data-files-path="/home/guest/Documents/Projects"]')).toBeVisible();
 await closeOtherWindows();
 // Tag persists through redraw and inline rename, and a second activation toggles it off.
 await openMenu();await menu().getByRole('button',{name:'Red Tag',exact:true}).click();
 await openMenu();await expect(menu().getByRole('button',{name:'Red Tag',exact:true})).toHaveAttribute('aria-pressed','true');
 await command('rename').click();
 const rename=files.getByRole('textbox',{name:'Rename item',exact:true});
 await expect(rename).toBeFocused();await rename.fill('renamed.txt');await rename.press('Enter');
 path='/home/guest/Documents/renamed.txt';await expect(row()).toBeVisible();
 await openMenu();await expect(menu().getByRole('button',{name:'Red Tag',exact:true})).toHaveAttribute('aria-pressed','true');
 const storedTags=await page.evaluate(()=>JSON.parse(window.__os.fs.readFile('/home/guest/.config/dindbos/file-tags.json')).files);
 assert.deepEqual(storedTags[path],['red']);assert(!storedTags['/home/guest/Documents/notes.txt'],'renaming removes old tag mapping');
 await menu().getByRole('button',{name:'Red Tag',exact:true}).click();
 await openMenu();await expect(menu().getByRole('button',{name:'Red Tag',exact:true})).toHaveAttribute('aria-pressed','false');
 await command('compress').click();
 await expect(files.locator(`.files-row[data-path="${path}.zip"]`)).toBeVisible();
 assert.deepEqual(await page.evaluate(p=>[...window.__os.fs.readFileBytes(p).slice(0,4)],path+'.zip'),[0x50,0x4b,0x03,0x04],'Compress writes a real ZIP local-file header');
 await openMenu();await command('info').click();
 await expect(files.locator('.files-inspector')).toBeVisible();
 await expect(files.locator('.files-inspector dl').first().locator('dd').first()).toHaveText(path);
 await openMenu();await command('info').click();await expect(files.locator('.files-inspector')).toBeHidden();
 for(let attempt=0;attempt<3;attempt++){
   await openMenu();await command('open-with').focus();await page.keyboard.press('ArrowRight');await expect(submenu()).toBeVisible();
   await page.keyboard.press('Escape');await expect(frame.locator('.files-context-menu')).toHaveCount(0);
   await openMenu();await frame.getByRole('button',{name:'New tab',exact:true}).click();
   await expect(frame.locator('.files-context-menu')).toHaveCount(0);
   await expect(files.getByRole('tab')).toHaveCount(attempt+2);
 }
 // Small dark desktop: both the parent and child menus remain inside their window.
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__os.setAppearance({mode:'dark'}));
 await expect(files.locator('.files-row').first()).toBeVisible();
 await openMenu();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await expect(submenu()).toBeVisible();
 const contentBounds=await frame.locator('.dos-window-content').boundingBox();
 for(const panel of await frame.locator('.files-context-menu').all()){
   const box=await panel.boundingBox();
   assert(box.x>=contentBounds.x-1 && box.y>=contentBounds.y-1,'small menus stay inside window top/left');
   assert(box.x+box.width<=contentBounds.x+contentBounds.width+1 && box.y+box.height<=contentBounds.y+contentBounds.height+1,'small menus stay inside window bottom/right');
 }
 await page.screenshot({path:output+'/context-open-with-mobile-dark.png'});
 await submenu().getByRole('menuitem').first().focus();await page.keyboard.press('Escape');
 await expect(frame.locator('.files-context-menu')).toHaveCount(0);
 await openMenu();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await page.evaluate(()=>window.__os.destroy());
 await expect(page.locator('.files-context-menu')).toHaveCount(0);
 assert.deepEqual(errors,[]);
 console.log('Files context menu browser smoke passed: grouped file/folder commands, default associations, hover/keyboard submenus, Quick Look, new window, persistent tags through rename, real ZIP, exact Get Info, bounded dark mobile and cleanup');
} finally {await browser?.close();await server.close();}
