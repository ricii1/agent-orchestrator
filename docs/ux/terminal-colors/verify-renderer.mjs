import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
// Reuse the installed browser tooling; no dependency/package changes.
const {chromium}=await import(process.env.TERMINAL_PLAYWRIGHT_MODULE || `${homedir()}/.cache/ms-playwright-go/1.50.1/package/index.mjs`);
import {writeFile} from 'node:fs/promises';
const repo=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');
const phase=process.argv[2]||'after',real=process.argv.includes('--real');
const server=await createServer({configFile:false,root:repo,server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.TERMINAL_CHROMIUM || `${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/docs/ux/terminal-colors/fixture.html${real?'?real':''}`);
 await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);if(real)await page.keyboard.type('echo');await page.waitForTimeout(400);
 const results=[];
 for(const size of [{width:1440,height:1000},{width:390,height:844},{width:320,height:640}]){
 await page.setViewportSize(size);await page.waitForTimeout(300);
 results.push(await page.evaluate(()=>{
 const p=window.panel,t=p.term,host=p.node.querySelector('.terminal-screen'),screen=p.node.querySelector('.xterm-screen'),rows=[...p.node.querySelectorAll('.xterm-rows>div')];
 return {viewport:[innerWidth,innerHeight],cols:t.cols,rows:t.rows,theme:t.options.theme,minimumContrastRatio:t.options.minimumContrastRatio,fontsStatus:document.fonts.status,font:t.options.fontFamily,panel:getComputedStyle(p.node).backgroundColor,host:host.getBoundingClientRect().toJSON(),screen:screen.getBoundingClientRect().toJSON(),spans:rows.slice(0,12).map(r=>[...r.children].map(s=>({text:s.textContent,color:getComputedStyle(s).color,opacity:getComputedStyle(s).opacity}))),lastResize:window.lastResize};
 }));
 await page.screenshot({path:`${repo}/docs/ux/terminal-colors/${phase}-${size.width}.png`});
 }
 if(real){
 await page.keyboard.press('Enter');await page.waitForTimeout(350);
 const end=await page.evaluate(()=>{const b=panel.term.buffer.active;return Array.from({length:5},(_,i)=>b.getLine(b.cursorY-4+i)?.translateToString(true)||'').join('\n');});
 assert(!end.includes('suggestion-demo'),'Enter must execute only typed echo');
 results.push({enterDidNotAcceptGhost:true,lastLines:end});
 }
 await page.keyboard.type('x');await page.keyboard.press('Backspace');await page.waitForTimeout(100);
 results.push(await page.evaluate(()=>({inputs,errors})));
 for(const r of results.filter(r=>r.viewport)){
 assert(r.screen.width<=r.host.width && r.screen.height<=r.host.height,'grid must fit host');
 assert(r.lastResize.cols===r.cols && r.lastResize.rows===r.rows,'resize sent to shell');
 assert.equal(r.minimumContrastRatio,1);
 assert.equal(r.panel,'rgb(22, 29, 25)');
 const spans=r.spans.flat();
 assert(spans.some(s=>s.color==='rgb(138, 148, 141)'),'ANSI8 must be readable gray');
 assert(spans.some(s=>s.color==='rgb(88, 88, 88)'),'ANSI240 must stay shell gray');
 assert(spans.some(s=>s.color==='rgba(228, 239, 220, 0.5)'),'dim must remain dim');
 if(!real)assert(spans.some(s=>s.color==='rgb(120, 160, 200)'),'RGB must pass through');
 }
 if(!real){
 const r=results[0],spans=r.spans.flat();
 const keys=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
 for(const key of keys){const h=r.theme[key];const rgb=`rgb(${[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(', ')})`;assert(spans.some(s=>s.color===rgb),`${key} rendered`);}
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(150);
 await page.evaluate(()=>panel.term.select(0,1,8));await page.waitForTimeout(100);
 await page.screenshot({path:`${repo}/docs/ux/terminal-colors/${phase}-selection.png`});
 }
 const inputResult=results.at(-1);assert.deepEqual(inputResult.errors,[]);assert.deepEqual(inputResult.inputs.slice(-2),['x','\x7f']);
 await writeFile(`${repo}/docs/ux/terminal-colors/${phase}-results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.map(r=>({viewport:r.viewport,cols:r.cols,rows:r.rows,screen:r.screen,host:r.host,inputs:r.inputs,errors:r.errors})),null,2));
}finally{await browser.close();await server.close();}
