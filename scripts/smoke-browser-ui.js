#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const output = process.env.DINDBOS_QA_OUTPUT || 'internal/docs/qa/browser-refinement';
const source = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__browserReady = createAndBootDindbOS({ root: document.getElementById('desktop'), storage:{backend:'memory',name:'browser-chrome-smoke'}, bootstrapPackages:false, builtins:{include:['browser']} }).then(os => {
  window.__browserOS = os;
  os.fs.createFile('/home/guest/Documents/first.html','/',{mime:'text/html',content:'<!doctype html><title>First document</title><h1>Local document one</h1><p>This document should get the space, not browser diagnostics.</p>'});
  os.fs.createFile('/home/guest/Documents/second.html','/',{mime:'text/html',content:'<!doctype html><title>Second document</title><h1>Local document two</h1>'});
  os.fs.createFile('/home/guest/Documents/third.html','/',{mime:'text/html',content:'<!doctype html><title>Third document</title><h1>Local document three</h1><label>Draft<input aria-label="Draft"></label>'});
  os.launch('browser',{url:'/home/guest/Documents/first.html'});
});`;
const server = await createServer({
  configFile:false, logLevel:'error', optimizeDeps:{entries:[]},
  plugins:[{name:'browser-chrome-fixture',resolveId(id){if(id==='/browser-chrome-fixture.js')return '\0browser-chrome-fixture';},load(id){if(id==='\0browser-chrome-fixture')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/browser-chrome-fixture')return next();res.setHeader('Content-Type','text/html');try{res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/browser-chrome-fixture.js"></script></body></html>'));}catch(error){next(error);}});}}],
  server:{host:'127.0.0.1',port:0,hmr:false,watch:null},
});
let browser;
try {
  await server.listen();
  await mkdir(output,{recursive:true});
  browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/browser-chrome-fixture`);
  const app=page.locator('.browser-app');
  const local=page.frameLocator('[data-browser-local]');
  await expect(local.getByRole('heading',{name:'Local document one',exact:true})).toBeVisible();
  await expect(app.locator('.browser-connection')).not.toHaveAttribute('open');
  await expect(app.locator('[data-browser-diagnostics-panel]')).not.toBeVisible();
  await expect(app.locator('[data-browser-status]')).not.toBeVisible();
  await expect(app.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
  await expect(app.getByRole('button',{name:'Go',exact:true})).not.toBeVisible();
  assert(!/mono/i.test(await app.getByRole('textbox',{name:'Address',exact:true}).evaluate(el=>getComputedStyle(el).fontFamily)));
  const chrome=await app.evaluate(el=>{const vp=el.querySelector('.browser-viewport').getBoundingClientRect(),rect=el.getBoundingClientRect();return{height:vp.top-rect.top,ratio:vp.height/rect.height};});
  assert(chrome.height<105,'Browser chrome must stay compact');
  assert(chrome.ratio>.7,'Document owns the majority of the window');
  await page.screenshot({path:`${output}/local-document-light.png`});
  const address=app.getByRole('textbox',{name:'Address',exact:true});
  await address.fill('/home/guest/Documents/second.html');
  await expect(app.getByRole('button',{name:'Go',exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Reload',exact:true})).not.toBeVisible();
  await address.press('Enter');
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Back',exact:true}).click();
  await expect(local.getByRole('heading',{name:'Local document one',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Forward',exact:true}).click();
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'New tab',exact:true}).click();
  await expect(app.getByRole('tab')).toHaveCount(2);
  await expect(app.getByRole('heading',{name:'Start Page',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Close New Tab',exact:true}).click();
  await expect(app.getByRole('tab')).toHaveCount(1);
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  // Closing a background tab must preserve both active selection and live iframe state.
  await address.fill('/home/guest/Documents/first.html');
  await address.press('Enter');
  await expect(local.getByRole('heading',{name:'Local document one',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'New tab',exact:true}).click();
  await address.fill('/home/guest/Documents/second.html');
  await address.press('Enter');
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'New tab',exact:true}).click();
  await address.fill('/home/guest/Documents/third.html');
  await address.press('Enter');
  await expect(local.getByRole('heading',{name:'Local document three',exact:true})).toBeVisible();
  await local.getByRole('textbox',{name:'Draft',exact:true}).fill('Keep this unsaved iframe state');
  await expect(app.getByRole('tab')).toHaveCount(3);
  await app.getByRole('button',{name:'Close first.html',exact:true}).click();
  await expect(app.getByRole('tab')).toHaveCount(2);
  await expect(app.getByRole('tab',{name:'third.html',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(address).toHaveValue('/home/guest/Documents/third.html');
  await expect(local.getByRole('heading',{name:'Local document three',exact:true})).toBeVisible();
  await expect(local.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('Keep this unsaved iframe state');
  await app.getByRole('button',{name:'Close third.html',exact:true}).click();
  await expect(app.getByRole('tab',{name:'second.html',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  await app.getByLabel('Connection settings',{exact:true}).click();
  await expect(app.getByRole('heading',{name:'External Browsing',exact:true})).toBeVisible();
  await expect(app.locator('[data-browser-diagnostics-panel]')).not.toBeVisible();
  await app.locator('.browser-advanced > summary').click();
  await expect(app.locator('[data-browser-diagnostics-panel]')).toBeVisible();
  await page.screenshot({path:`${output}/connection-advanced.png`});
  await page.keyboard.press('Escape');
  await expect(app.locator('[data-browser-diagnostics-panel]')).not.toBeVisible();
  await page.evaluate(()=>window.__browserOS.setAppearance({mode:'dark'}));
  await page.screenshot({path:`${output}/local-document-dark.png`});
  await page.setViewportSize({width:390,height:844});
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  const bounds=await app.locator('.browser-toolbar').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:document.documentElement.clientWidth}));
  assert(bounds.left>=0&&bounds.right<=bounds.width,'narrow browser chrome remains contained');
  await app.getByLabel('Connection settings',{exact:true}).click();
  const panel=await app.locator('.browser-connection-panel').boundingBox();
  assert(panel.x>=0&&panel.x+panel.width<=390,'narrow connection popover remains contained');
  await page.keyboard.press('Escape');
  await page.screenshot({path:`${output}/local-document-390-dark.png`});
  // Failed external startup must expose a useful action, without touching an external site.
  await page.route('http://127.0.0.1:65534/health', route=>route.abort('connectionrefused'));
  await page.evaluate(()=>{
    for (const [id, task] of window.__browserOS.windows.windows) if(task.appId==='browser') window.__browserOS.windows.close(id,{force:true});
    window.__browserOS.launch('browser',{url:'https://example.invalid',companionUrl:'ws://127.0.0.1:65534/browser'});
  });
  await expect(app.getByRole('alert')).toBeVisible();
  await expect(app.getByRole('alert')).toContainText('Could not connect to external browsing');
  await expect(app.getByRole('alert')).toContainText('choose Connect');
  await expect(app.getByRole('button',{name:'Connect',exact:true})).toBeVisible();
  await expect(app.locator('[data-browser-diagnostics-panel]')).not.toBeVisible();
  await page.screenshot({path:`${output}/external-startup-failure.png`});
  await app.getByRole('button',{name:'Connect',exact:true}).click();
  await expect(app.getByRole('alert')).toBeVisible();
  await address.fill('/home/guest/Documents/second.html');
  await address.press('Enter');
  await expect(local.getByRole('heading',{name:'Local document two',exact:true})).toBeVisible();
  await expect(app.getByRole('alert')).not.toBeVisible();
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.__browserOS.destroy());
  console.log('Browser UI smoke passed: content-first chrome, hidden connection diagnostics, local back/forward, active/background tab closure preserving live iframe state, popover Escape, narrow/dark layout, actionable external startup failure/retry and local recovery, teardown');
} finally {await browser?.close();await server.close();}
