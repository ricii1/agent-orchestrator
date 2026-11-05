import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const {chromium}=await import(process.env.TERMINAL_PLAYWRIGHT_MODULE || `${homedir()}/.cache/ms-playwright-go/1.50.1/package/index.mjs`);
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const out=fileURLToPath(new URL('./',import.meta.url));
const plugin='/home/ricii/.oh-my-zsh/custom/plugins';
const home=await mkdtemp(join(tmpdir(),'terminal-retest-home-'));
const rc=`HISTFILE=/dev/null\nSAVEHIST=0\nHISTSIZE=20\nsetopt no_beep\nbindkey -e\nsource ${plugin}/zsh-autosuggestions/zsh-autosuggestions.zsh\nsource ${plugin}/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh\nPROMPT='%F{green}fixture%f ❯ '\nprint -s 'echo suggestion-demo'\n`;
await writeFile(join(home,'.zshrc'),rc,{mode:0o600});
const vite=await createServer({configFile:false,root,appType:'custom',server:{middlewareMode:true},logLevel:'error'});
const sessions=new Map();let active;
const server=httpServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{ };
  const json=x=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(x));};
  if(url.pathname==='/api/terminals'&&req.method==='POST'){
   const child=spawn('python3',['-u',join(root,'scripts/terminal-bridge.py'),home,'/bin/zsh'],{cwd:home,env:{PATH:'/usr/bin:/bin',HOME:home,ZDOTDIR:home,TERM:'xterm-256color',LANG:'C.UTF-8',HISTFILE:'/dev/null'},stdio:['pipe','pipe','pipe']});
   const s={child,seq:0,queue:[],raw:[],closed:false};sessions.set('fixture',s);active=s;
   const rl=createInterface({input:child.stdout});rl.on('line',line=>{try{const v=JSON.parse(line);if(v.data){s.queue.push({id:++s.seq,data:v.data});s.raw.push(v.data);}if(typeof v.exitCode==='number')s.closed=true;}catch{}});
   child.stderr.on('data',d=>console.error('QA bridge:',String(d).slice(0,300)));
   child.on('close',()=>{s.closed=true;});return json({id:'fixture',workspace:home});
  }
  if(url.pathname==='/api/terminals/fixture'&&req.method==='GET')return json({id:'fixture',workspace:home,chunks:active.queue.filter(c=>c.id>Number(url.searchParams.get('after')||0)),cursor:active.seq,exitCode:active.closed?0:null});
  if(url.pathname==='/api/terminals/fixture'&&req.method==='POST'){
   if(body.action==='input')active.child.stdin.write(JSON.stringify({data:Buffer.from(body.data).toString('base64')})+'\n');
   if(body.action==='resize')active.child.stdin.write(JSON.stringify(body)+'\n');
   if(body.action==='close'){active.child.stdin.write('{"close":true}\n');active.child.stdin.end();setTimeout(()=>{if(!active.closed)active.child.kill('SIGTERM')},1000).unref();}
   return json({ok:true});
  }
  res.writeHead(404);return res.end();
 }
 if(url.pathname==='/docs/ux/terminal-retest/fixture.html'){res.writeHead(200,{'content-type':'text/html'});return res.end(await readFile(join(out,'fixture.html')));}
 vite.middlewares(req,res,()=>{res.writeHead(404);res.end('not found');});
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await chromium.launch({executablePath:process.env.TERMINAL_CHROMIUM||`${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>console.error('PAGEERROR',e.message));page.on('requestfailed',r=>console.error('REQFAIL',r.url(),r.failure()?.errorText));page.on('response',r=>{if(r.status()>=400)console.error('RESP',r.status(),r.url())});page.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/docs/ux/terminal-retest/fixture.html`);
 await page.waitForFunction(()=>window.ready,{timeout:8000}).catch(async()=>console.error('INIT WAIT',await page.evaluate(()=>({ready:window.ready,error:window.initError,errors:window.errors,body:document.body.innerText}))));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);
 const snap=async name=>{await page.screenshot({path:join(out,name)});return page.evaluate(()=>{const t=panel.term,b=t.buffer.active;return {cols:t.cols,rows:t.rows,cursor:{x:b.cursorX,y:b.cursorY},lines:Array.from({length:Math.min(8,b.length)},(_,i)=>b.getLine(i)?.translateToString(true)),input:window.inputs,colors:[...panel.node.querySelectorAll('.xterm-rows>div')].slice(0,10).flatMap(r=>[...r.children].map(s=>({text:s.textContent,color:getComputedStyle(s).color}))).filter(x=>x.text)}});};
 const evidence={before:await snap('before-desktop.png')};
 await page.keyboard.type('echo',{delay:90});await page.waitForTimeout(800);
 evidence.suggestion=await snap('suggestion-desktop.png');
 evidence.suggestionAnsi=await page.evaluate(()=>({tail:panel.term.buffer.active.getLine(panel.term.buffer.active.cursorY)?.translateToString(true),rows:[...panel.node.querySelectorAll('.xterm-rows>div')].slice(0,8).map(r=>[...r.children].map(s=>({text:s.textContent,color:getComputedStyle(s).color})).filter(s=>s.text))}));
 await page.keyboard.press('Enter');await page.waitForTimeout(900);
 evidence.enter=await snap('enter-desktop.png');
 evidence.enterLines=await page.evaluate(()=>Array.from({length:8},(_,i)=>panel.term.buffer.active.getLine(i)?.translateToString(true)));
 await page.keyboard.type('echo',{delay:90});await page.waitForTimeout(500);await page.keyboard.press('ArrowRight');await page.waitForTimeout(300);
 evidence.arrowRight=await snap('arrowright-desktop.png');
 await page.keyboard.press('Backspace');await page.waitForTimeout(300);evidence.backspace=await snap('backspace-desktop.png');
 await page.keyboard.press('Tab');await page.waitForTimeout(350);evidence.tab=await snap('tab-desktop.png');
 await page.keyboard.press('Control+C');await page.waitForTimeout(250);
 await page.keyboard.type('if true; then',{delay:50});await page.waitForTimeout(300);evidence.syntax=await snap('syntax-desktop.png');
 await page.keyboard.press('Control+C');await page.setViewportSize({width:390,height:844});await page.waitForTimeout(450);evidence.mobile=await snap('mobile-390.png');
 evidence.errors=await page.evaluate(()=>errors);
 evidence.ptyAnsi=active.raw.map(s=>Buffer.from(s,'base64').toString('utf8')).join('').match(/\u001b\[[0-9;]*m/g)||[];
 evidence.ptyInput=await page.evaluate(()=>inputs);
 assert(evidence.suggestionAnsi.tail.includes('echo suggestion-demo'),'zsh plugin must render its real ghost suggestion');
 assert(evidence.suggestionAnsi.rows.flat().some(s=>s.text==='suggestion-demo'&&s.color==='rgb(138, 148, 141)'),'ghost suggestion uses readable ANSI8 color');
 assert(evidence.enterLines.join('\n').includes('fixture ❯ ')&&!evidence.enterLines.join('\n').includes('suggestion-demo'),'Enter must not accept the ghost suggestion');
 assert(evidence.ptyInput.includes('\x1bOC')&&evidence.ptyInput.includes('\x7f')&&evidence.ptyInput.includes('\t'),'ArrowRight, Backspace, and Tab reached the real PTY');
 await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({before:evidence.before,suggestionAnsi:evidence.suggestionAnsi,enter:evidence.enterLines,arrowRight:evidence.arrowRight.lines,backspace:evidence.backspace.lines,mobile:{cols:evidence.mobile.cols,rows:evidence.mobile.rows},errors:evidence.errors},null,2));
 await page.evaluate(()=>panel.dispose());
}finally{
 await browser.close();if(active&&!active.closed){active.child.stdin.write('{"close":true}\n');active.child.stdin.end();await new Promise(r=>setTimeout(r,400));if(!active.closed)active.child.kill('SIGTERM');}
 await new Promise(ok=>server.close(ok));await vite.close();await rm(home,{recursive:true,force:true});
}
