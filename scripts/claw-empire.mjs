#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,readlinkSync,writeFileSync,mkdirSync,chmodSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const appDir=join(root,'apps','claw-empire');
const stateDir=join(root,'.data','claw-empire');
const recordPath=join(stateDir,'process.json');
const logPath=join(stateDir,'server.log');
const port=8790;
const url=`http://127.0.0.1:${port}`;
const entry=join(appDir,'server','index.ts');

export function prepareEnv(source) {
  // Preserve existing secrets and optional settings; force this installation to loopback.
  let content=source;
  const get=key=>new RegExp(`^${key}\\s*=\\s*(.*)$`,'m').exec(content)?.[1]?.trim().replace(/^["']|["']$/g,'');
  const set=(key,value)=> {
    const pattern=new RegExp(`^${key}\\s*=.*$`,'m');
    content=pattern.test(content)?content.replace(pattern,()=>`${key}=${value}`):content.replace(/\n?$/,`\n${key}=${value}\n`);
  };
  set('HOST','127.0.0.1'); set('PORT',String(port));
  set('REMOTION_RUNTIME_BOOTSTRAP','0');
  for(const key of ['OAUTH_ENCRYPTION_SECRET','INBOX_WEBHOOK_SECRET'])if(!get(key)||get(key)==='__CHANGE_ME__')set(key,randomBytes(32).toString('hex'));
  return content;
}
function run(command,args,cwd=appDir) {
  return new Promise((ok,no)=> {
    const p=spawn(command,args,{cwd,stdio:'inherit',env:{...process.env,REMOTION_RUNTIME_BOOTSTRAP:'0'}});
    p.on('error',no);p.on('close',code=>code===0?ok():no(new Error(`${command} failed (exit ${code})`)));
  });
}
function record() { try{return JSON.parse(readFileSync(recordPath,'utf8'));}catch{return null;} }
function managedProcess(value) {
  if(!value||!Number.isInteger(value.pid)||value.pid<=1)return false;
  try {
    process.kill(value.pid,0);
    const args=readFileSync(`/proc/${value.pid}/cmdline`,'utf8').split('\0');
    return args.includes(entry)&&readlinkSync(`/proc/${value.pid}/cwd`)===appDir;
  }catch{return false;}
}
async function health() {
  try{const r=await fetch(`${url}/healthz`,{signal:AbortSignal.timeout(1500)});return r.ok&&(await r.json()).ok===true;}catch{return false;}
}
async function start() {
  if(managedProcess(record())) {
    if(!await health())throw new Error(`Claw-Empire process exists but health check failed. See ${logPath}`);
    console.log(`Claw-Empire is already running: ${url}`);return;
  }
  if(!existsSync(join(appDir,'dist','index.html')))throw new Error('Run the install command first to download dependencies and build the UI.');
  // Refuse to launch a duplicate instance or replace an unrelated app on this port.
  const net=await import('node:net');
  await new Promise((ok,no)=>{const probe=net.createServer();probe.once('error',()=>no(new Error(`Port ${port} is unavailable. Existing processes were left untouched.`)));probe.listen(port,'127.0.0.1',()=>probe.close(ok));});
  await run(process.execPath,['scripts/auto-apply-v1.0.5.mjs']);
  const loader=createRequire(join(appDir,'package.json')).resolve('tsx');
  const fd=openSync(logPath,'a',0o600);
  let child;
  try {
    child=spawn(process.execPath,['--import',pathToFileURL(loader).href,entry],{cwd:appDir,detached:true,stdio:['ignore',fd,fd],env:{...process.env,HOST:'127.0.0.1',PORT:String(port),REMOTION_RUNTIME_BOOTSTRAP:'0',DB_PATH:join(stateDir,'claw-empire.sqlite'),LOGS_DIR:join(stateDir,'logs')}});
    await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});
  }finally{closeSync(fd);}
  writeFileSync(recordPath,JSON.stringify({pid:child.pid,startedAt:new Date().toISOString(),url})+'\n',{mode:0o600});child.unref();
  for(let i=0;i<40;i++) {
    if(await health()){console.log(`\nClaw-Empire ready: ${url}\nLog: ${logPath}`);return;}
    if(!managedProcess(record()))break;
    await new Promise(r=>setTimeout(r,500));
  }
  await stop();throw new Error(`Startup health check failed. Inspect ${logPath}`);
}
async function stop() {
  const value=record();
  if(!managedProcess(value)){console.log('No managed Claw-Empire process is running.');return;}
  try{process.kill(-value.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
  for(let i=0;i<30&&managedProcess(value);i++)await new Promise(r=>setTimeout(r,100));
  // Finish terminating the process group, including any remaining worker descendants.
  try{process.kill(-value.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  try{unlinkSync(recordPath);}catch{}
  console.log('Claw-Empire stopped.');
}
async function install() {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22+ is required.');
  if(managedProcess(record())){console.log(`Already running: ${url}`);return;}
  if(existsSync(appDir)&&!existsSync(join(appDir,'.git')))throw new Error(`Refusing to overwrite the existing directory: ${appDir}`);
  console.log('Installing Claw-Empire locally. No model tasks will be started.');
  await run('git',['--version'],root);await run('pnpm',['--version'],root);
  mkdirSync(dirname(appDir),{recursive:true});
  if(!existsSync(appDir))await run('git',['-c','credential.helper=','clone','--depth','1','https://github.com/GreenSheep01201/claw-empire.git',appDir],root);
  await run('git',['submodule','update','--init','--recursive','--depth','1']);
  const envPath=join(appDir,'.env');
  writeFileSync(envPath,prepareEnv(readFileSync(existsSync(envPath)?envPath:join(appDir,'.env.example'),'utf8')),{mode:0o600});chmodSync(envPath,0o600);
  await run('pnpm',['install','--frozen-lockfile']);
  await run(process.execPath,['scripts/setup.mjs','--agents-path',join(appDir,'AGENTS.md'),'--port',String(port)]);
  await run('pnpm',['run','build']);
  console.log('Installation and build completed. Starting in the background…');
  await start();
}
export async function main(action='install') {
  if(!['install','start','stop','restart','status','logs'].includes(action))throw new Error('Usage: npm run claw -- install|start|stop|restart|status|logs');
  process.umask(0o077);mkdirSync(stateDir,{recursive:true,mode:0o700});chmodSync(stateDir,0o700);
  if(action==='status'){console.log(managedProcess(record())?`Managed process running; health: ${await health()?'OK':'FAILED'}; ${url}`:'Claw-Empire is not running.');return;}
  if(action==='logs'){if(!existsSync(logPath))throw new Error('No server log yet.');await run('tail',['-n','60',logPath],root);return;}
  const lock=join(stateDir,'control.lock');
  let fd;try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);}catch(e){if(e.code==='EEXIST')throw new Error(`Another install/start/stop may be active. Lock: ${lock}`);throw e;}
  try{if(action==='install')await install();else if(action==='start')await start();else if(action==='stop')await stop();else {await stop();await start();}}
  finally{unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv[2]).catch(error=>{console.error(`Claw-Empire: ${error.message}`);process.exitCode=1;});
