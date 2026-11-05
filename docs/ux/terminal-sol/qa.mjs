import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const phase=process.argv[2];
assert(['before','after'].includes(phase),'Use before or after');
const baseline='5caecdb49f385911ab83328977426f5e25a8ec9e';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const out=fileURLToPath(new URL('./',import.meta.url));
const home=await mkdtemp(join(tmpdir(),'terminal-sol-'));
const bridge=phase==='before'?join(home,'terminal-bridge.py'):join(root,'scripts/terminal-bridge.py');
const rgPath=process.env.TERMINAL_RG_PATH||execFileSync('which',['rg'],{encoding:'utf8'}).trim();
if(phase==='before')await writeFile(bridge,execFileSync('git',['show',`${baseline}:scripts/terminal-bridge.py`],{cwd:root}));
await writeFile(join(home,'.zshrc'),`ZSH=/home/ricii/.oh-my-zsh
ZSH_THEME=robbyrussell
plugins=(git zsh-autosuggestions zsh-syntax-highlighting)
DISABLE_AUTO_UPDATE=true
HISTFILE=/dev/null
SAVEHIST=0
source $ZSH/oh-my-zsh.sh
print -s 'echo suggestion-demo'
`,{mode:0o600});
await writeFile(join(home,'sample.txt'),'color\n');
const {chromium}=await import(process.env.TERMINAL_PLAYWRIGHT_MODULE||`${homedir()}/.cache/ms-playwright-go/1.50.1/package/index.mjs`);
const vite=await createServer({configFile:false,root,appType:'custom',server:{middlewareMode:true},logLevel:'error'});
const sessions=new Map();let next=0;
const server=httpServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/api/terminals'&&req.method==='POST'){
  const id=String(++next);
  const child=spawn('python3',['-u',bridge,home,'/bin/zsh'],{cwd:home,env:{PATH:`${dirname(rgPath)}:/usr/bin:/bin`,HOME:home,ZDOTDIR:home,TERM:'dumb',COLORTERM:'',NO_COLOR:'1',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
  const session={child,chunks:[],seq:0,raw:[],input:[],closed:false,error:''};sessions.set(id,session);
  createInterface({input:child.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.data){session.chunks.push({id:++session.seq,data:value.data});session.raw.push(Buffer.from(value.data,'base64').toString());}if(typeof value.exitCode==='number')session.closed=true;}catch(e){session.error=String(e);}});
  child.stderr.on('data',data=>session.error+=String(data));child.on('close',()=>session.closed=true);
  return json({id,workspace:home});
 }
 const match=/^\/api\/terminals\/(fixture|\d+)$/.exec(url.pathname);
 if(match){
  const session=sessions.get(match[1]==='fixture'?String(next):match[1]);if(!session){res.writeHead(404);return res.end();}
  if(req.method==='GET')return json({chunks:session.chunks.filter(c=>c.id>Number(url.searchParams.get('after')||0)),cursor:session.seq,exitCode:session.closed?0:null,error:session.error||undefined});
  const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts));
  if(body.action==='input'){session.input.push(body.data);session.child.stdin.write(JSON.stringify({data:Buffer.from(body.data).toString('base64')})+'\n');}
  if(body.action==='resize')session.child.stdin.write(JSON.stringify(body)+'\n');
  if(body.action==='close')session.child.stdin.end();
  return json({ok:true});
 }
 if(url.pathname==='/docs/ux/terminal-retest/fixture.html'){res.writeHead(200,{'content-type':'text/html'});return res.end(await readFile(join(root,'docs/ux/terminal-retest/fixture.html')));}
 vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const browser=await chromium.launch({executablePath:process.env.TERMINAL_CHROMIUM||`${homedir()}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,headless:true});
const evidence={phase,baseline,sessions:[]};
try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:width===1440?1000:width===390?844:640}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/ux/terminal-retest/fixture.html`);
  await page.waitForFunction(()=>window.ready,{timeout:15000});await page.evaluate(()=>document.fonts.ready);
  const id=String(next),session=sessions.get(id);
  const waitFor=async text=>{for(let n=0;n<90;n++){const value=session.raw.join('');if(value.includes(text))return;await page.waitForTimeout(100);}throw new Error(`Timed out waiting for ${text}: ${session.raw.join('').slice(-800)}`);};
  await waitFor('➜');
  await page.keyboard.type('echo',{delay:70});await waitFor('suggestion-demo');await page.waitForTimeout(250);
  await page.screenshot({path:join(out,`${phase}-${width}-suggestion.png`)});
  const suggestion=await page.evaluate(()=>({lines:[...panel.node.querySelectorAll('.xterm-rows>div')].slice(0,4).map(r=>r.textContent),colors:[...panel.node.querySelectorAll('.xterm-rows>div')].slice(0,4).flatMap(r=>[...r.children].map(s=>({text:s.textContent,color:getComputedStyle(s).color}))).filter(x=>x.text),cols:panel.term.cols,rows:panel.term.rows}));
  await page.keyboard.press('Enter');await page.waitForTimeout(250);
  const afterEnter=await page.evaluate(()=>[...panel.node.querySelectorAll('.xterm-rows>div')].slice(0,8).map(r=>r.textContent));
  const command="rg --color=auto --colors 'match:fg:red' color sample.txt";
  await page.keyboard.type(command,{delay:4});await page.keyboard.press('Enter');await waitFor('sample.txt');await page.waitForTimeout(700);
  await page.screenshot({path:join(out,`${phase}-${width}-output.png`)});
  const rendered=await page.evaluate(()=>({lines:[...panel.node.querySelectorAll('.xterm-rows>div')].map(r=>r.textContent).filter(Boolean).slice(-12),colors:[...panel.node.querySelectorAll('.xterm-rows>div')].flatMap(r=>[...r.children].map(s=>({text:s.textContent,color:getComputedStyle(s).color}))).filter(x=>x.text).slice(-25)}));
  await page.keyboard.type('printf "ENV_TERM=%s COLORTERM=%s NO_COLOR=%s\\n" "$TERM" "$COLORTERM" "${NO_COLOR-unset}"',{delay:2});
  await page.keyboard.press('Enter');await waitFor('ENV_TERM=xterm-256color COLORTERM=');
  const raw=session.raw.join('');const envLine=raw.match(/ENV_TERM=xterm-256color COLORTERM=[^\r\n]* NO_COLOR=[^\r\n]*/g)?.at(-1);
  const row={width,suggestion,afterEnter,rendered,pty:{redMatch:raw.includes('\x1b[31mcolor'),envLine,input:session.input,ansiCount:(raw.match(/\x1b\[[0-9;]*m/g)||[]).length},errors};
  evidence.sessions.push(row);
  assert(suggestion.lines.some(s=>s.includes('suggestion-demo')),'real zsh suggestion missing');
  assert.notEqual(suggestion.colors.find(x=>x.text==='echo')?.color,suggestion.colors.find(x=>x.text==='suggestion-demo')?.color,'suggestion must differ from input');
  assert(!afterEnter.some(s=>s.includes('suggestion-demo')),'Enter accepted ghost suggestion');
  assert(session.input.includes('\r'),'Enter did not reach PTY');
  assert.equal(row.pty.redMatch,phase==='after',`rg auto color differs across bridge versions: ${JSON.stringify(raw.slice(-1000))}`);
  assert.equal(rendered.colors.some(x=>x.text==='color'&&x.color==='rgb(255, 155, 147)'),phase==='after','rendered command output color differs');
  assert.equal(envLine,phase==='after'?'ENV_TERM=xterm-256color COLORTERM=truecolor NO_COLOR=unset':'ENV_TERM=xterm-256color COLORTERM= NO_COLOR=1');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>panel.dispose());await page.close();
 }
 await writeFile(join(out,`${phase}-evidence.json`),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({phase,sessions:evidence.sessions.map(s=>({width:s.width,redMatch:s.pty.redMatch,suggestion:s.suggestion.colors.filter(c=>c.text.includes('suggestion-demo')),ansiCount:s.pty.ansiCount,errors:s.errors}))},null,2));
}finally{
 await browser.close();for(const session of sessions.values()){session.child.stdin.end();if(!session.closed)session.child.kill('SIGTERM');}
 await new Promise(ok=>server.close(ok));await vite.close();await rm(home,{recursive:true,force:true});
}
