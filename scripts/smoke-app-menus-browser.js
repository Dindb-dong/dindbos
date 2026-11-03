import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const source = `
import {createAndBootDindbOS} from '/src/sdk/index.js';
import {demoFileSystem} from '/src/demo/portfolio-demo.js';
import '/src/styles/index.css';
window.__ready=createAndBootDindbOS({root:document.getElementById('desktop'),storage:{backend:'memory',name:'app-menu-fixture'},bootstrapPackages:false,fileSystem:demoFileSystem}).then(os=>{
 window.__os=os;
 os.registerApp({id:'host-menu',name:'Host Menu',menus:({content})=>({file:[{label:'Run Host Command',accelerator:'Mod+Shift+L',shortcut:'<img src=x onerror="window.__unsafe=true">',run:({os:appOS,content,window,context})=>{if(appOS===os)throw Error('raw kernel leaked');content.dataset.command=String(Number(content.dataset.command||0)+1);window.setTitle('Host command ran');}},{label:'Mutable Command',enabled:()=>!window.__commandDisabled,run:()=>{window.__mutableRan=true;}},{label:'Disabled Command',enabled:()=>false,run:()=>{window.__disabledRan=true;}}],view:[{label:'Throwing Enabled',enabled:()=>{throw Error('enabled failure');},run:()=>{}}]}),render:({content})=>{content.innerHTML='<textarea aria-label="Host text"></textarea>';}});
 os.registerApp({id:'bad-menu',name:'Bad Menu',menus:()=>{throw Error('factory failure');},render:({content})=>{content.textContent='Failure isolation';}});
 os.registerApp({id:'neutral',name:'Neutral App',render:({content})=>{content.textContent='Host app without custom menus';}});
 os.launch('neutral');return os;
});`;
const output=process.env.DINDBOS_QA_OUTPUT||'internal/docs/qa/app-menus';
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[]},plugins:[{name:'app-menu-fixture',resolveId(id){if(id==='/app-menu-fixture.js')return '\0app-menu-fixture';},load(id){if(id==='\0app-menu-fixture')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/app-menu-fixture')return next();try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/app-menu-fixture.js"></script>'));}catch(error){next(error);}});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
let browser;
try{
 await mkdir(output,{recursive:true});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/app-menu-fixture`);await page.evaluate(()=>window.__ready);
 const menu=page.getByRole('menu',{name:'file menu',exact:true});
 const open=async(name)=>{await page.locator(`[data-shell-panel="${name}"]`).click();};
 const launch=async(id,context={})=>{await page.keyboard.press('Escape');await page.evaluate(({id,context})=>window.__os.launch(id,context),{id,context});await expect(page.locator(`.dos-window[data-app-id="${id}"]`).last()).toBeVisible();};
 await open('file');await expect(menu.getByRole('menuitem')).toHaveCount(1);await expect(menu.getByRole('menuitem',{name:/Close Window/})).toBeEnabled();
 await expect(menu).not.toContainText('New Files');await expect(page.locator('[data-shell-panel="view"]')).toBeHidden();
 await page.screenshot({path:`${output}/neutral-file.png`});await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await page.locator('.dos-active-app').click();await expect(page.getByRole('menuitem',{name:'View…',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});
 await launch('files',{path:'/home/guest/Documents'});await expect(page.locator('.files-app')).toBeVisible();
 await open('file');await menu.getByRole('menuitem',{name:/New Tab/}).click();await expect(page.locator('.files-app [role="tab"]')).toHaveCount(2);
 await open('view');await page.getByRole('menu',{name:'view menu',exact:true}).getByRole('menuitem',{name:'as List',exact:true}).click();await expect(page.locator('.files-app')).toHaveAttribute('data-files-view','list');
 await open('file');await page.screenshot({path:`${output}/files-file.png`});await menu.getByRole('menuitem',{name:/Close Tab/}).click();await expect(page.locator('.files-app [role="tab"]')).toHaveCount(1);
 await launch('text');const textFrame=page.locator('.dos-window[data-app-id="text"]').last();const editor=textFrame.getByRole('textbox',{name:'Document text',exact:true});await editor.fill('The active editor keeps its selection context.');await editor.click();
 await open('edit');await page.evaluate(()=>window.__os.windows.focusLatestAppWindow('files'));await page.getByRole('menu',{name:'edit menu',exact:true}).getByRole('menuitem',{name:/Select All/}).click();assert.deepEqual(await editor.evaluate(element=>[element.selectionStart,element.selectionEnd]),[0,46]);
 await expect(textFrame).toHaveClass(/is-active/);await open('file');await expect(menu).not.toContainText('New Files');await menu.getByRole('menuitem',{name:/Save/}).click();await expect(page.getByRole('dialog',{name:'Save document',exact:true})).toBeVisible();await page.getByRole('dialog',{name:'Save document',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
 await launch('calculator');await open('file');await expect(menu.getByRole('menuitem')).toHaveCount(1);await page.keyboard.press('Escape');
 await page.locator('.calculator-app [data-key="7"]').click();await open('edit');await page.getByRole('menu',{name:'edit menu',exact:true}).getByRole('menuitem',{name:'Clear',exact:true}).click();await expect(page.locator('.calculator-app output')).toHaveText('0');
 await open('view');await page.getByRole('menu',{name:'view menu',exact:true}).getByRole('menuitem',{name:'Show History',exact:true}).click();await expect(page.locator('.calculator-history')).toBeVisible();
 await launch('clock');await expect(page.locator('[data-clock-mode="timer"]')).toBeVisible();await open('view');await page.getByRole('menu',{name:'view menu',exact:true}).getByRole('menuitem',{name:'Timer',exact:true}).click();await expect(page.locator('.clock-app')).toHaveAttribute('data-clock-view','timer');
 await launch('notes');await open('file');await menu.getByRole('menuitem',{name:'New Note',exact:true}).click();await expect(page.getByRole('textbox',{name:'Note text',exact:true})).toBeVisible();
 await launch('host-menu');await open('file');await page.evaluate(()=>{window.__commandDisabled=true;});await menu.getByRole('menuitem',{name:'Mutable Command',exact:true}).click();assert.equal(await page.evaluate(()=>Boolean(window.__mutableRan)),false);await open('file');await expect(menu.locator('kbd img')).toHaveCount(0);await expect(menu).toContainText('<img');await expect(menu.getByRole('menuitem',{name:'Disabled Command',exact:true})).toBeDisabled();
 // Changing focus while a menu is open must not reroute the original command.
 await page.evaluate(()=>window.__os.windows.focusLatestAppWindow('calculator'));
 await menu.getByRole('menuitem',{name:/Run Host Command/}).click();await expect(page.locator('.dos-window[data-app-id="host-menu"] .dos-window-content')).toHaveAttribute('data-command','1');
 assert.equal(await page.evaluate(()=>Boolean(window.__disabledRan||window.__unsafe)),false);
 await page.evaluate(()=>window.__os.windows.focusLatestAppWindow('host-menu'));await page.locator('[aria-label="Host text"]').focus();await page.keyboard.press('Control+Shift+L');await expect(page.locator('.dos-window[data-app-id="host-menu"] .dos-window-content')).toHaveAttribute('data-command','2');
 await page.evaluate(()=>window.__os.windows.focusLatestAppWindow('calculator'));await page.locator('.calculator-app').click();await page.keyboard.press('Control+Shift+L');await expect(page.locator('.dos-window[data-app-id="host-menu"] .dos-window-content')).toHaveAttribute('data-command','2');
 await launch('bad-menu');await open('file');await expect(menu.getByRole('menuitem',{name:'Application menu unavailable',exact:true})).toBeDisabled();await expect(menu.getByRole('menuitem',{name:/Close Window/})).toBeEnabled();await expect(page.locator('.dos-shell-toast')).toContainText('Bad Menu menu: factory failure');
 await page.screenshot({path:`${output}/bad-menu-isolation.png`});await page.keyboard.press('Escape');await page.locator('[data-shell-panel=system]').click();await page.getByRole('menuitem',{name:'About DindbOS.js',exact:true}).click();await expect(page.getByRole('dialog',{name:'About DindbOS.js',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.evaluate(()=>window.__os.destroy());assert.deepEqual(errors,[]);
 console.log('app menus browser smoke ok active app commands, real Files/Text/Calculator/Clock/Notes actions, captured targets, custom accelerators, escaping, disabled/error isolation and teardown');
}finally{await browser?.close();await server.close();}
