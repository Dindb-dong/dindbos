import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
const source=`import {createAndBootDindbOS} from '/src/sdk/index.js';import '/src/styles/index.css';window.__os=await createAndBootDindbOS({root:document.getElementById('app'),storage:{backend:'memory'},bootstrapPackages:false,builtins:{include:['calculator']}});window.__os.launch('calculator');`;
const server=await createServer({configFile:false,logLevel:'error',optimizeDeps:{entries:[]},plugins:[{name:'calculator-fixture',resolveId(id){if(id==='/calculator-fixture.js')return '\0calculator';},load(id){if(id==='\0calculator')return source;},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/calculator-fixture')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><body style="margin:0"><div id="app" style="height:100vh"></div><script type="module" src="/calculator-fixture.js"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/calculator-fixture`);
 const app=page.locator('.calculator-app');await expect(app).toBeVisible();
 const frame=page.locator('.dos-window[data-app-id="calculator"]');
 const size=await frame.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));assert.deepEqual(size,{width:230,height:408});
 await expect(app.locator('.calculator-keys button')).toHaveCount(20);
 const key=await app.locator('[data-key="0"]').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));assert(Math.abs(key.width-key.height)<3,'native basic keys are circular');
 const output=app.locator('output');assert(await output.evaluate(el=>el.offsetHeight)<45,'The result line has no inherited 64px minimum height');await app.focus();await page.keyboard.type('12+3');await page.keyboard.press('Enter');await expect(output).toHaveText('15');
 await app.getByRole('button',{name:'Calculation history',exact:true}).click();await expect(app.locator('.calculator-history')).toBeVisible();await app.locator('[data-calculator-result="0"]').click();await expect(output).toHaveText('15');
 await app.getByRole('button',{name:'Clear',exact:true}).click();await app.focus();await page.keyboard.type('1/0');await page.keyboard.press('Enter');await expect(output).toHaveText('Error');
 await page.keyboard.type('8');await expect(output).toHaveText('8');await page.keyboard.press('Backspace');await expect(output).toHaveText('0');
 await app.getByRole('button',{name:'Calculation history',exact:true}).click();await page.keyboard.press('Escape');await expect(app.locator('.calculator-history')).toBeHidden();
 await page.evaluate(()=>window.__os.destroy());assert.deepEqual(errors,[]);
 console.log('Calculator browser smoke passed native size, 20 circular keys, keyboard, history, division-by-zero recovery and Escape');
}finally{await browser?.close();await server.close();}
