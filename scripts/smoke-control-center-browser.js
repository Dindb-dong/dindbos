import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const output = process.env.DINDBOS_QA_OUTPUT || "internal/docs/qa/control-center";
const source = `import {createAndBootDindbOS} from '/src/sdk/index.js';import '/src/styles/index.css';import '/src/styles/control-center.css';window.__ready=createAndBootDindbOS({ui:{style:'macos'},root:document.querySelector('#desktop'),storage:{backend:'memory',name:'controls-smoke'},bootstrapPackages:false,builtins:{include:['files','applications','music','settings']}}).then(os=>{window.__os=os;os.launch('files');});`;
const server = await createServer({configFile:false,logLevel:"error",optimizeDeps:{entries:[]},plugins:[{name:"control-fixture",resolveId(id){if(id==='/control-fixture.js')return '\0control-fixture';},load(id){if(id==='\0control-fixture')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/control-fixture')return next();res.setHeader('Content-Type','text/html');try{res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/control-fixture.js"></script></body></html>'));}catch(error){next(error);}});}}],server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
function wave(frequency) {const rate=8000,length=rate*20,b=Buffer.alloc(44+length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);for(let n=0;n<length;n++)b.writeInt16LE(Math.round(Math.sin(n/rate*frequency*Math.PI*2)*1500),44+n*2);return b;}
let browser;
try {
  await server.listen();await mkdir(output,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/control-fixture`);await page.evaluate(()=>window.__ready);
  const open=()=>page.getByRole('button',{name:'Control Center',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Control Center',exact:true});
  await open();await expect(panel).toBeVisible();
  await expect(panel.locator('[data-control-track]')).toHaveText('Not Playing');
  await expect(panel.getByRole('slider',{name:'Music volume',exact:true})).toBeDisabled();
  await expect(panel.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  assert.equal(await panel.locator('[data-shell-action="wallpaper"],[data-shell-action="accent"],[data-shell-dock-size]').count(),0,'preferences belong to Settings');
  await page.screenshot({path:`${output}/control-center-light.png`});
  await panel.getByRole('button',{name:'Dark',exact:true}).click();await expect(panel.getByRole('button',{name:'Dark',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:`${output}/control-center-dark.png`});
  await panel.getByRole('button',{name:'Light',exact:true}).click();
  await panel.locator('.cc-artwork').click();
  const music=page.locator('.music-app');await expect(music).toBeVisible();
  await music.locator('input[type=file]').setInputFiles([{name:'one.wav',mimeType:'audio/wav',buffer:wave(220)},{name:'two.wav',mimeType:'audio/wav',buffer:wave(330)}]);
  await music.getByRole('button',{name:'Play one.wav',exact:true}).click();
  await expect.poll(()=>music.locator('audio').evaluate(audio=>!audio.paused)).toBe(true);
  await open();await expect(panel.locator('[data-control-track]')).toHaveText('one.wav');
  await panel.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>music.locator('audio').evaluate(audio=>audio.paused)).toBe(true);
  await panel.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>music.locator('audio').evaluate(audio=>!audio.paused)).toBe(true);
  await panel.getByRole('button',{name:'Next song',exact:true}).click();await expect(panel.locator('[data-control-track]')).toHaveText('two.wav');
  await panel.getByRole('button',{name:'Previous song',exact:true}).click();await expect(panel.locator('[data-control-track]')).toHaveText('one.wav');
  await panel.getByRole('slider',{name:'Music volume',exact:true}).fill('0.25');
  assert.equal(await music.locator('audio').evaluate(audio=>audio.volume),.25);await expect(music.getByRole('slider',{name:'Volume',exact:true})).toHaveValue('0.25');
  await page.screenshot({path:`${output}/control-center-playing.png`});
  await page.keyboard.press('Escape');
  await music.getByRole('slider',{name:'Volume',exact:true}).fill('0.4');await open();await expect(panel.getByRole('slider',{name:'Music volume',exact:true})).toHaveValue('0.4');
  const fullscreen=panel.locator('[data-shell-action="control-fullscreen"]');
  if(await fullscreen.count()){await fullscreen.click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.querySelector('.dindbos-host'))).toBe(true);await fullscreen.click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);}
  await page.evaluate(async()=>{for(const win of [...window.__os.windows.windows.values()].filter(w=>w.appId==='music'))await window.__os.windows.close(win.id);});
  await expect(panel.getByRole('slider',{name:'Music volume',exact:true})).toBeDisabled();await expect(panel.locator('[data-control-track]')).toHaveText('Not Playing');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/control-center-390.png`});
  const box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=390,'panel fits mobile');
  assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'panel never overflows horizontally');
  await panel.getByRole('button',{name:/Show Desktop/}).click();await expect(panel).toHaveCount(0);
  assert(await page.evaluate(()=>[...window.__os.windows.windows.values()].every(w=>w.minimized)),'Show Desktop minimizes the actual windows');
  await page.evaluate(()=>window.__os.destroy());assert.deepEqual(errors,[]);
  console.log('control center browser smoke ok: modular chrome, appearance, real Music transport+volume, fullscreen, desktop, narrow layout and cleanup');
} finally {await browser?.close();await server.close();}
