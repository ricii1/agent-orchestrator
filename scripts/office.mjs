#!/usr/bin/env node
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,readlinkSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(process.env.ORCHESTRATOR_DATA_DIR||join(root,'.data'));
const port=Number(process.env.PORT||4317),url=`http://127.0.0.1:${port}`;
const entry=join(root,'dist/main.js'),log=join(dataDir,'server.log');
const exec=promisify(execFile);
function daemon(){
  let pid;try{pid=Number(readFileSync(join(dataDir,'daemon.pid'),'utf8'));}catch{return null;}
  if(!Number.isInteger(pid)||pid<=1)throw new Error('File PID tidak valid.');
  try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return null;throw e;}
  const args=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
  if(readlinkSync(`/proc/${pid}/cwd`)!==root||!args.some(a=>[entry,'dist/main.js',join(root,'src/main.ts'),'src/main.ts'].includes(a)))throw new Error('PID bukan daemon kantor ini; proses tidak disentuh.');
  return pid;
}
async function serviceActive(){try{await exec('systemctl',['--user','is-active','--quiet','agent-office.service'],{timeout:3000});return true;}catch{return false;}}
async function state(){try{const r=await fetch(url+'/api/state',{signal:AbortSignal.timeout(2000)});if(!r.ok)throw new Error(`API ${r.status}`);return await r.json();}catch{return null;}}
async function idle(){const snapshot=await state();if(!snapshot)throw new Error('Daemon berjalan tetapi statusnya tidak dapat dibaca. Hentikan dari terminal asal sebelum mencoba lagi.');if(snapshot.tasks.some(t=>['running','waiting','queued'].includes(t.status)))throw new Error('Masih ada pekerjaan aktif. Selesaikan atau hentikan melalui UI sebelum restart.');}
async function stop(){
  const pid=daemon();if(!pid)return;
  await idle();
  if(await serviceActive())await exec('systemctl',['--user','stop','agent-office.service']);
  else process.kill(pid,'SIGTERM');
  for(let i=0;i<200;i++){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;}await new Promise(r=>setTimeout(r,100));}
  throw new Error('Daemon belum berhenti; periksa log sebelum mencoba lagi.');
}
async function run(){
  const action=process.argv[2]||'start';
  if(!['start','restart','stop','status'].includes(action))throw new Error('Gunakan: npm run office -- start|restart|stop|status');
  if(action==='status'){console.log(daemon()?`Kantor berjalan: ${url}`:'Kantor belum berjalan.');return;}
  if(action==='stop'){await stop();console.log('Kantor berhenti.');return;}
  // Build before stopping an idle daemon, so a failed build leaves the old version available.
  await new Promise((ok,no)=>{const build=spawn('npm',['run','build'],{cwd:root,stdio:'inherit'});build.on('error',no);build.on('close',code=>code===0?ok():no(new Error('Build gagal.')));});
  const service=await serviceActive();
  if(daemon())await idle();
  if(service)await exec('systemctl',['--user','restart','agent-office.service']);
  else {
    await stop();process.umask(0o077);mkdirSync(dataDir,{recursive:true,mode:0o700});
    const fd=openSync(log,'a',0o600);let p;
    try{p=spawn(process.execPath,[entry],{cwd:root,detached:true,stdio:['ignore',fd,fd],env:{...process.env,PORT:String(port),ORCHESTRATOR_DATA_DIR:dataDir}});await new Promise((ok,no)=>{p.once('spawn',ok);p.once('error',no);});}finally{closeSync(fd);}
    p.unref();
  }
  for(let i=0;i<30;i++){if(await state()){console.log(`\nKantor siap: ${url}`);return;}await new Promise(r=>setTimeout(r,500));}
  throw new Error(`Kantor belum merespons. Periksa ${log} atau journalctl --user -u agent-office.service.`);
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
