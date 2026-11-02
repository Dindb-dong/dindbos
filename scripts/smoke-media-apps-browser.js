#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const output = process.env.DINDBOS_QA_OUTPUT || "internal/docs/qa/media-apps";
const fixture = `
import { createAndBootDindbOS } from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__ready = createAndBootDindbOS({ root:document.querySelector('#desktop'), storage:{backend:'memory',name:'media-app-smoke'}, bootstrapPackages:false, builtins:{include:['photos','music']}}).then(os=>{ window.__os=os; os.launch('photos'); });`;
const server = await createServer({ configFile:false, logLevel:"error", optimizeDeps:{entries:[]}, plugins:[{
 name:"media-fixture", resolveId(id){ if(id==='/media-fixture.js') return '\0media-fixture'; }, load(id){if(id==='\0media-fixture')return fixture;},
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/media-fixture')return next();res.setHeader('Content-Type','text/html');try{res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/media-fixture.js"></script></body></html>'));}catch(error){next(error);}});}
}],server:{host:"127.0.0.1",port:0,hmr:false,watch:null} });
function wave(frequency) {
 const rate=8000, length=rate*3, buffer=Buffer.alloc(44+length*2);
 buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
 for(let index=0;index<length;index++)buffer.writeInt16LE(Math.round(Math.sin(index/rate*frequency*Math.PI*2)*1500),44+index*2);
 return buffer;
}
let browser;
try {
 await server.listen(); await mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.__urls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(blob)=>{const url=create(blob);window.__urls.created.push(url);return url;};URL.revokeObjectURL=(url)=>{window.__urls.revoked.push(url);return revoke(url);};});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/media-fixture`);
 const png = Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');ctx.fillStyle='#287a58';ctx.fillRect(0,0,160,120);ctx.fillStyle='#a9d3bd';ctx.beginPath();ctx.arc(80,60,28,0,Math.PI*2);ctx.fill();return canvas.toDataURL('image/png').split(',')[1];}),'base64');
 const photos=page.locator('.photos-app');await expect(photos.getByRole('heading',{name:'Your photo library'})).toBeVisible();
 await photos.locator('input[type=file]').setInputFiles({name:'green.png',mimeType:'image/png',buffer:png});
 await expect(photos.locator('.photo-tile')).toHaveCount(1);
 await photos.getByRole('button',{name:'Open green.png',exact:true}).click();
 await expect.poll(()=>photos.locator('.photo-viewer img').evaluate(img=>img.naturalWidth)).toBe(160);
 await photos.getByRole('button',{name:'Zoom in',exact:true}).click(); await expect(photos.getByRole('button',{name:'125% · Fit'})).toBeVisible();
 await photos.getByRole('button',{name:'125% · Fit'}).click();
 await expect(photos.locator('[data-media-feedback]')).toBeHidden({timeout:4500});
 await page.screenshot({path:output+'/photos-viewer.png'});
 await page.locator('.dos-window[data-app-id="photos"] button[aria-label="Close"]').click();
 await page.evaluate(()=>window.__os.launch('photos'));
 await expect(photos.locator('.photo-tile')).toHaveCount(1);
 await photos.getByRole('button',{name:'Open green.png',exact:true}).click();
 await photos.getByRole('button',{name:'Move photo to Trash',exact:true}).click();
 await expect(photos.getByRole('heading',{name:'Your photo library'})).toBeVisible();
 assert(await page.evaluate(()=>window.__os.fs.exists('/home/guest/.Trash/green.png')),'removed library copy remains recoverable in Trash');
 await photos.locator('input[type=file]').setInputFiles({name:'not-photo.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
 await expect(photos.getByRole('alert')).toContainText('choose an image');
 await page.evaluate(()=>window.__os.launch('music'));
 const music=page.locator('.music-app');await expect(music.getByRole('heading',{name:'Your music, here'})).toBeVisible();
 await music.locator('input[type=file]').setInputFiles([{name:'one.wav',mimeType:'audio/wav',buffer:wave(440)},{name:'two.wav',mimeType:'audio/wav',buffer:wave(660)}]);
 await expect(music.locator('.music-track')).toHaveCount(2);
 await music.getByRole('button',{name:'Play one.wav',exact:true}).click();
 await expect.poll(()=>music.locator('audio').evaluate(audio=>!audio.paused&&audio.currentTime>0)).toBe(true);
 await music.getByRole('button',{name:'Pause',exact:true}).click();
 await expect.poll(()=>music.locator('audio').evaluate(audio=>audio.paused)).toBe(true);
 await music.getByRole('slider',{name:'Playback position'}).fill('1.5');
 await expect.poll(()=>music.locator('audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(1.3);
 await music.getByRole('slider',{name:'Volume',exact:true}).fill('0.25');
 assert.equal(await music.locator('audio').evaluate(audio=>audio.volume),.25);
 await music.getByRole('button',{name:'Next song',exact:true}).click();await expect(music.locator('[data-music-title]')).toHaveText('two.wav');
 await expect(music.locator('[data-media-feedback]')).toBeHidden({timeout:4500});
 await page.screenshot({path:output+'/music-library.png'});
 await page.evaluate(()=>window.__os.setAppearance({mode:'dark'}));
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:output+'/music-mobile-dark.png'});
 assert(await music.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'music stays inside390 host');
 await music.getByRole('button',{name:'Move song to Trash'}).click();await expect(music.locator('.music-track')).toHaveCount(1);
 await music.getByRole('button',{name:'Play one.wav',exact:true}).click();await expect.poll(()=>music.locator('audio').evaluate(audio=>!audio.paused)).toBe(true);
 await music.locator('audio').evaluate(audio=>window.__audio=audio);
 await page.evaluate(()=>window.__os.destroy());
 assert(await page.evaluate(()=>window.__audio.paused&&!window.__audio.getAttribute('src')),'destroy stops playback and releases source');
 const urls=await page.evaluate(()=>window.__urls);assert(urls.created.every(url=>urls.revoked.includes(url)),'all objectURLs released by app lifecycle');
 assert.deepEqual(errors,[]);
 console.log('media browser smoke ok Photos import/decode/zoom/reopen/Trash/errors, Music actual WAV playback/pause/seek/volume/next/Trash, mobile and teardown');
}finally{await browser?.close();await server.close();}
