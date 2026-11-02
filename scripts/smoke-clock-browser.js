import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const output=process.env.DINDBOS_QA_OUTPUT||'internal/docs/qa/clock';
const source=`
import {renderClock} from '/src/dindbos/apps/clock.js';
import '/src/styles/theme.css';
import '/src/styles/clock.css';
const intervalIds=new Set();
const createInterval=window.setInterval.bind(window),removeInterval=window.clearInterval.bind(window);
window.setInterval=(...args)=>{const id=createInterval(...args);intervalIds.add(id);return id};
window.clearInterval=(id)=>{intervalIds.delete(id);removeInterval(id)};
window.__activeClockIntervals=()=>intervalIds.size;
if (new URLSearchParams(location.search).has('registry')) {
 document.querySelector('.dindbos-host').style.containerType='normal';
 document.querySelector('.dindbos-host').style.containerName='none';
 const {createAndBootDindbOS}=await import('/src/sdk/index.js');
 await import('/src/styles/index.css');
 window.__clockOS=await createAndBootDindbOS({root:document.querySelector('.dindbos-host'),storage:{backend:'memory',name:'clock-registry-smoke'},bootstrapPackages:false,builtins:{include:['clock']}});
 window.__clockOS.launch('clock');
} else window.__cleanupClock=renderClock({},document.getElementById('app'),{}, {setTitle(){}});
`;
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[]},plugins:[{
 name:'clock-fixture',resolveId(id){if(id==='/clock-fixture.js')return '\0clock-fixture';},load(id){if(id==='\0clock-fixture')return source;},
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/clock-fixture')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><body style="margin:0"><div class="dindbos-host" data-appearance="light" style="width:100vw;height:100vh;container-type:inline-size;container-name:app-pane"><main id="app" style="height:100%"></main></div><script type="module" src="/clock-fixture.js"></script></body></html>'));});}
}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
let browser;
try {
 await server.listen();await mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:680,height:560}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/clock-fixture`);
 await expect(page.locator('.clock-city')).toHaveCount(3);
 await page.getByRole('combobox',{name:'City',exact:true}).selectOption('6');
 await page.getByRole('button',{name:'Add city',exact:true}).click();
 await expect(page.getByRole('heading',{name:'New York',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remove New York',exact:true}).click();
 await expect(page.locator('.clock-city')).toHaveCount(3);
 await page.screenshot({path:output+'/world-clock.png'});
 await page.getByRole('tab',{name:'Stopwatch',exact:true}).click();
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await expect.poll(()=>page.locator('[data-clock-display]').textContent()).not.toBe('00:00.00');
 await page.getByRole('button',{name:'Lap',exact:true}).click();
 await expect(page.locator('.clock-laps li')).toHaveCount(1);
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 const frozen=await page.locator('[data-clock-display]').textContent();
 await page.getByRole('tab',{name:'World Clock',exact:true}).click();
 await page.getByRole('tab',{name:'Stopwatch',exact:true}).click();
 assert.equal(await page.locator('[data-clock-display]').textContent(),frozen);
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await expect(page.locator('[data-clock-display]')).toHaveText('00:00.00');
 await page.getByRole('tab',{name:'Timer',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Minutes',exact:true}).fill('60');
 await expect(page.getByRole('button',{name:'Start',exact:true})).toBeDisabled();
 await expect(page.locator('[data-timer-validation]')).toBeVisible();
 await page.getByRole('spinbutton',{name:'Minutes',exact:true}).fill('0');
 await page.getByRole('spinbutton',{name:'Seconds',exact:true}).fill('2');
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Resume',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Timer finished',{timeout:5000});
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.setViewportSize({width:390,height:700});
 await page.locator('.dindbos-host').evaluate(el=>el.dataset.appearance='dark');
 await page.screenshot({path:output+'/timer-mobile-dark.png'});
 const appBox=await page.locator('.clock-app').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));
 assert.equal(appBox.width,appBox.scrollWidth,'Clock does not overflow its narrow host');
 const intervalsBeforeClose=await page.evaluate(()=>window.__activeClockIntervals());
 assert(intervalsBeforeClose>=1);
 await page.evaluate(()=>window.__cleanupClock());
 assert.equal(await page.evaluate(()=>window.__activeClockIntervals()),intervalsBeforeClose-1,'Closing Clock clears its update interval without touching unrelated intervals');
 assert.deepEqual(errors,[]);
 const registry=await browser.newPage({viewport:{width:1280,height:900}});
 registry.on('pageerror',e=>errors.push(e.message));
 await registry.goto(`http://127.0.0.1:${server.httpServer.address().port}/clock-fixture?registry=1`);
 await expect(registry.locator('.dos-window[data-app-id="clock"] .clock-app')).toBeVisible();
 await registry.getByRole('tab',{name:'Stopwatch',exact:true}).click();
 await registry.getByRole('button',{name:'Start',exact:true}).click();
 await expect.poll(()=>registry.locator('[data-clock-display]').textContent()).not.toBe('00:00.00');
 await registry.screenshot({path:output+'/clock-runtime.png'});
 await registry.setViewportSize({width:390,height:844});
 await registry.evaluate(()=>window.__clockOS.setAppearance({mode:'dark'}));
 const withinClock = async () => {
  const invalid=await registry.locator('.clock-app').evaluate(app=>{
   const bounds=app.getBoundingClientRect();
   return [...app.querySelectorAll('button,input,select,.clock-city,.clock-digits')].filter(el=>{
    const rect=el.getBoundingClientRect();
    return rect.width>0&&(rect.left<bounds.left-1||rect.right>bounds.right+1);
   }).map(el=>el.outerHTML);
  });
  assert.deepEqual(invalid,[],'Clock controls, digits and cards stay within the actual narrow app');
 };
 const paneContainer=await registry.locator('.dos-window-content:has(> .clock-app)').evaluate(el=>getComputedStyle(el).containerName);
 assert.equal(paneContainer,'app-pane','The actual app content owns responsive container rules');
 await registry.getByRole('tab',{name:'Timer',exact:true}).click();
 await withinClock();
 const narrowPadding=await registry.locator('.clock-pane').evaluate(el=>getComputedStyle(el).paddingLeft);
 assert.equal(narrowPadding,'16px','Narrow container styling applies inside the registered app');
 await registry.screenshot({path:output+'/clock-runtime-timer-390-dark.png'});
 await registry.getByRole('tab',{name:'World Clock',exact:true}).click();
 await withinClock();
 await registry.screenshot({path:output+'/clock-runtime-world-390-dark.png'});
 const registryIntervals=await registry.evaluate(()=>window.__activeClockIntervals());
 await registry.locator('.dos-window[data-app-id="clock"] button[aria-label="Close"]').click();
 await expect(registry.locator('.clock-app')).toHaveCount(0);
 assert.equal(await registry.evaluate(()=>window.__activeClockIntervals()),registryIntervals-1,'AppSandbox close clears Clock update interval');
 await registry.evaluate(()=>window.__clockOS.destroy());
 assert.deepEqual(errors,[]);
 console.log('Clock browser smoke passed world cities, stopwatch laps/pause, timer pause/resume/finish, narrow dark layout and interval teardown');
}finally{await browser?.close();await server.close();}
