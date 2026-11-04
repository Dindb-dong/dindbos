import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { PNG } = require(join(process.cwd(), "node_modules/playwright-core/lib/utilsBundle.js"));
const output = process.env.DINDBOS_QA_OUTPUT || "internal/docs/qa/liquid-glass";
const source = `
import {attachLiquidGlass} from '/src/ui/liquid-glass.js';
import '/src/styles/liquid-glass.css';
const root=document.querySelector('#scene');
window.__glassCleanup=attachLiquidGlass(root,{selector:'[data-glass-surface]',blur:0,strength:1.6,maxSurfaces:4});
window.__otherCleanup=attachLiquidGlass(document.querySelector('#other'),{selector:'[data-glass-surface]',blur:0});
document.querySelector('.lens button').onclick=event=>event.target.textContent='Clicked';
`;
const html = `<!doctype html><html><head><style>
body{margin:0;background:#dce7e1;font:16px system-ui} .dindbos-host{position:relative;width:600px;height:460px;overflow:hidden;display:inline-block} .pattern{position:absolute;inset:-80px;background:repeating-linear-gradient(0deg,transparent 0 18px,#192c24 18px 22px),repeating-linear-gradient(90deg,#fff 0 18px,#13765e 18px 22px);padding:140px 40px;color:#c12b35;font:bold 40px sans-serif} .lens{position:absolute;left:110px;top:110px;width:320px;height:220px;border-radius:48px;display:grid;place-items:center;border:1px solid #ffffff88} .lens button{font:600 18px system-ui;color:#172b24;background:#ffffffaa;border:0;padding:12px 28px;border-radius:16px} #other{width:300px;height:460px} #other .lens{left:35px;width:220px}
</style></head><body><div id="scene" class="dindbos-host"><div class="pattern">LIVE DOM<br>0123456789</div><div class="lens" data-glass-surface><button>Crystal</button></div></div><div id="other" class="dindbos-host"><div class="pattern">OTHER</div><div class="lens" data-glass-surface></div></div><script type="module" src="/glass-fixture.js"></script></body></html>`;
const server = await createServer({ configFile: false, logLevel: "error", optimizeDeps: { entries: [] }, plugins: [{ name: "glass-fixture", resolveId(id) { if(id==="/glass-fixture.js")return "\0glass-fixture"; }, load(id) { if(id==="\0glass-fixture")return source; }, configureServer(vite) { vite.middlewares.use(async(req,res,next)=>{if(req.url?.split("?")[0]!=="/glass-fixture")return next();res.setHeader("Content-Type","text/html");res.end(await vite.transformIndexHtml(req.url,html));}); } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
let browser;
try {
  await mkdir(output,{recursive:true}); await server.listen();
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const context=await browser.newContext({viewport:{width:940,height:500},recordVideo:{dir:output,size:{width:940,height:500}}});
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/glass-fixture`);
  const lens=page.locator('#scene .lens');
  await expect(lens).toHaveAttribute('data-liquid-glass-mode','refraction');
  await expect.poll(()=>page.locator('#scene filter feImage').getAttribute('href')).toMatch(/^data:image\/png/);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const actual=await lens.screenshot({path:join(output,'refraction.png')});
  const filter=await lens.evaluate(element=>element.style.backdropFilter);
  await lens.evaluate(element=>{element.style.backdropFilter='blur(0px) saturate(1.18)';element.style.webkitBackdropFilter='blur(0px) saturate(1.18)';});
  const baseline=await lens.screenshot({path:join(output,'without-refraction.png')});
  const a=PNG.sync.read(actual),b=PNG.sync.read(baseline);let changed=0;
  for(let y=12;y<a.height-12;y++)for(let x=12;x<a.width-12;x++){
    if(x>52&&x<a.width-52&&y>52&&y<a.height-52)continue;
    const i=(y*a.width+x)*4;
    if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>40)changed++;
  }
  assert(changed>1200,`SVG refraction must displace live backdrop pixels beyond an identical blur/tint baseline; changed=${changed}`);
  await lens.evaluate((element,value)=>{element.style.backdropFilter=value;element.style.webkitBackdropFilter=value;},filter);
  await page.getByRole('button',{name:'Crystal',exact:true}).click();await expect(page.getByRole('button',{name:'Clicked',exact:true})).toBeVisible();
  const before=await lens.screenshot();
  await page.locator('#scene .pattern').evaluate(element=>element.style.transform='translate(11px,9px)');
  const after=await lens.screenshot({path:join(output,'moved-live-backdrop.png')});
  assert.notDeepEqual(before,after,'moving real DOM behind the lens updates its refracted image without recapturing a scene');
  const ids=await page.locator('filter').evaluateAll(elements=>elements.map(element=>element.id));assert.equal(new Set(ids).size,ids.length,'two roots use isolated filter IDs');
  await lens.evaluate(element=>element.style.width='360px');
  await expect.poll(()=>page.locator('#scene filter').getAttribute('width')).toBe('362');
  await page.evaluate(()=>new Promise(resolve=>{let n=0;const step=()=>{document.querySelector('#scene .pattern').style.transform=`translate(${Math.sin(n/12)*32}px,${Math.cos(n/15)*22}px)`;if(++n<75)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);}));
  await page.screenshot({path:join(output,'two-live-roots.png')});
  await page.emulateMedia({forcedColors:'active'});
  await expect(lens).toHaveAttribute('data-liquid-glass-mode','reduced');
  assert.equal(await lens.evaluate(element=>getComputedStyle(element).backdropFilter),'none','forced colors disables the optical filter');
  await page.emulateMedia({forcedColors:'none'});
  await expect(lens).toHaveAttribute('data-liquid-glass-mode','refraction');
  await page.evaluate(()=>{for(let n=0;n<6;n++){const node=document.createElement('div');node.dataset.glassSurface='dynamic';node.className='dynamic-lens';node.style.cssText='width:60px;height:30px;border-radius:8px';document.querySelector('#scene').append(node);}});
  await expect.poll(()=>page.locator('#scene filter').count()).toBe(4);
  await page.locator('.dynamic-lens').evaluateAll(nodes=>nodes.forEach(node=>node.remove()));
  await expect.poll(()=>page.locator('#scene filter').count()).toBe(1);
  const rebuilds = await page.evaluate(async () => {
    let maps = 0;
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) { maps++; return original.apply(this, args); };
    try {
      const lens = document.querySelector('#scene .lens');
      for (let n = 0; n < 24; n++) {
        lens.style.width = `${360 + n}px`;
        await new Promise(requestAnimationFrame);
      }
      await new Promise(resolve => setTimeout(resolve, 130));
      return maps;
    } finally { HTMLCanvasElement.prototype.toDataURL = original; }
  });
  assert(rebuilds <= 4, `animated resize should coalesce 24 frames into <=4 maps, received ${rebuilds}`);
  await expect.poll(()=>page.locator('#scene filter').getAttribute('width')).toBe('385');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(async () => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    // A slow image encoder makes repeated budget overruns reproducible on fast hosts.
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const started = performance.now();
      while (performance.now() - started < 16) { /* isolated test workload */ }
      return original.apply(this, args);
    };
    try {
      const other = document.querySelector('#other .lens');
      for (let n = 0; n < 8; n++) {
        other.style.width = `${221 + n}px`;
        await new Promise(resolve => setTimeout(resolve, 140));
      }
    } finally { HTMLCanvasElement.prototype.toDataURL = original; }
  });
  await expect(page.locator('#other')).toHaveAttribute('data-glass-engine', 'frosted');
  await expect(page.locator('#scene')).toHaveAttribute('data-glass-engine', 'refraction');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cdp.detach();
  await page.evaluate(()=>{window.__glassCleanup();window.__glassCleanup();});
  assert.equal(await page.locator('#scene filter').count(),0);assert.equal(await lens.getAttribute('data-liquid-glass-mode'),null);
  assert.equal(await page.locator('#other filter').count(),1,'destroying one root must not remove another root filters');
  await page.evaluate(()=>window.__otherCleanup());
  assert.equal(await page.locator('[data-liquid-glass-definitions]').count(),0);assert.deepEqual(errors,[]);
  const video=page.video();await context.close();await video.saveAs(join(output,'live-refraction.webm'));await video.delete();
  console.log(`liquid glass browser smoke ok: ${changed} refracted rim pixels, live moving DOM, foreground input, resize, forced colors, bounded dynamic surfaces, two roots, 24 resize frames -> ${rebuilds} maps, throttled adaptive fallback, idempotent cleanup`);
}finally{await browser?.close();await server.close();}
