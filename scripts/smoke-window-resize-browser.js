import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const source = `
import {createAndBootDindbOS} from '/src/sdk/index.js';
import '/src/styles/index.css';
window.__ready=createAndBootDindbOS({root:document.getElementById('desktop'),storage:{backend:'memory'},bootstrapPackages:false,builtins:{include:[]}}).then(os=>{
 window.__os=os;
 for(const id of ['background','foreground']) os.registerApp({id,singleton:true,width:id==='background'?1100:640,height:id==='background'?700:480,render:({content})=>{content.innerHTML='<button type="button" style="width:100%;height:100%">'+id+'</button>';}});
 os.launch('background');os.launch('foreground');return os;
});`;
const server = await createServer({ configFile: false, logLevel: "error", optimizeDeps: { entries: [] }, plugins: [{ name: "window-resize-fixture", resolveId(id) { if (id === "/window-resize-fixture.js") return "\0window-resize-fixture"; }, load(id) { if (id === "\0window-resize-fixture") return source; }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (req.url?.split("?")[0] !== "/window-resize-fixture") return next(); res.setHeader("Content-Type", "text/html"); try { res.end(await vite.transformIndexHtml(req.url, '<!doctype html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/window-resize-fixture.js"></script>')); } catch (error) { next(error); } }); } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const output = process.env.DINDBOS_QA_OUTPUT || "internal/docs/qa/window-resize";
let browser;
try {
  await server.listen(); await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/window-resize-fixture`);
  await page.evaluate(() => window.__ready);
  const frame = page.locator('.dos-window[data-app-id="foreground"]');
  const reset = async () => {
    await page.evaluate(() => { const os=window.__os; const task=os.windows.windows.get('foreground'); Object.assign(task.frame.style,{left:'300px',top:'180px',width:'640px',height:'480px'}); os.windows.activate('foreground'); });
    await expect(frame).toHaveClass(/is-active/);
  };
  const edges = ["top", "right", "bottom", "left", "top-left", "top-right", "bottom-right", "bottom-left"];
  for (const edge of edges) {
    await reset();
    const handle = frame.locator(`[data-resize="${edge}"]`);
    const before = await frame.boundingBox();
    const box = await handle.boundingBox();
    const point = {x:box.x+box.width/2,y:box.y+box.height/2};
    const hit = await page.evaluate(({x,y}) => {const element=document.elementFromPoint(x,y);return {edge:element?.dataset.resize,app:element?.closest('.dos-window')?.dataset.appId};},point);
    assert.deepEqual(hit,{edge,app:'foreground'},`${edge}: the physical handle center must receive the pointer above the background window`);
    const dx = edge.includes("left") ? -35 : edge.includes("right") ? 35 : 0;
    const dy = edge.includes("top") ? -35 : edge.includes("bottom") ? 35 : 0;
    await page.mouse.move(point.x,point.y); await page.mouse.down(); await page.mouse.move(point.x+dx,point.y+dy,{steps:8}); await page.mouse.up();
    const after = await frame.boundingBox();
    if (dx) assert(Math.abs(after.width-before.width-35)<2,`${edge}: real pointer drag changes width`);
    else assert(Math.abs(after.width-before.width)<2,`${edge}: width stays stable`);
    if (dy) assert(Math.abs(after.height-before.height-35)<2,`${edge}: real pointer drag changes height`);
    else assert(Math.abs(after.height-before.height)<2,`${edge}: height stays stable`);
    if (edge.includes("left")) assert(Math.abs(after.x+after.width-before.x-before.width)<2,`${edge}: opposite horizontal edge stays anchored`);
    if (edge.includes("top")) assert(Math.abs(after.y+after.height-before.y-before.height)<2,`${edge}: opposite vertical edge stays anchored`);
    assert.equal(await page.evaluate(()=>window.__os.windows.activeWindowId),'foreground',`${edge}: resize never activates the background`);
  }
  await page.screenshot({path:`${output}/all-eight-handles.png`});
  await reset();
  const corner = frame.locator('[data-resize="top-left"]'); const cornerBox=await corner.boundingBox();
  await page.mouse.move(cornerBox.x+8,cornerBox.y+8);await page.mouse.down();await page.mouse.move(1400,950,{steps:12});await page.mouse.up();
  const minimum=await frame.boundingBox();assert.equal(Math.round(minimum.width),340);assert.equal(Math.round(minimum.height),240);
  await reset();
  const top=await frame.locator('[data-resize="top"]').boundingBox();
  await page.mouse.move(top.x+top.width/2,top.y+3);await page.mouse.down();await page.mouse.move(top.x+top.width/2,-100,{steps:12});await page.mouse.up();
  assert.equal(Math.round((await frame.boundingBox()).y),58,'top resize respects the menu-bar workspace boundary');
  await frame.getByRole('button',{name:'Maximize',exact:true}).click();
  await expect(frame).toHaveClass(/is-maximized/);assert.equal(await frame.locator('[data-resize]:visible').count(),0,'maximized windows expose no inert resize handles');
  await page.setViewportSize({width:390,height:844});assert.equal(await frame.locator('[data-resize]:visible').count(),0,'mobile preserves non-resizable window presentation');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.__os.destroy());
  console.log('window resize browser smoke ok all eight physical handle hit regions, actual pointer growth, anchored opposite edges, minimum sizes, workspace top, maximize/mobile and teardown');
} finally { await browser?.close(); await server.close(); }
