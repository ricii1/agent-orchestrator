// Exercise takeover, failure recovery and restart against an empty throwaway DB.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
const root=resolve(new URL('..',import.meta.url).pathname);
const dir=await mkdtemp(join(tmpdir(),'kantor-service-'));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const unit=`kantor-verify-${process.pid}.service`;
const control=(...args)=>execFileSync('systemctl',['--user',...args],{encoding:'utf8'}).trim();
const pause=()=>new Promise(r=>setTimeout(r,150));
async function until(check){for(let i=0;i<100;i++){try{if(await check())return;}catch{}await pause();}throw new Error('Service verification timed out');}
async function pid(){return Number(await readFile(join(dir,'daemon.pid'),'utf8'));}
async function healthy(){const r=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(500)});return r.status===200;}
let incumbent;
try{
  incumbent=spawn(process.execPath,[join(root,'dist/main.js')],{cwd:root,env:{...process.env,PORT:String(port),ORCHESTRATOR_DATA_DIR:dir},stdio:'ignore'});
  await until(healthy);assert.equal(await pid(),incumbent.pid);
  execFileSync('systemd-run',['--user',`--unit=${unit}`,'--property=Restart=on-failure','--property=RestartSec=1',`--working-directory=${root}`,`--setenv=PORT=${port}`,`--setenv=ORCHESTRATOR_DATA_DIR=${dir}`,process.execPath,join(root,'scripts/service-entry.mjs')]);
  await until(()=>control('is-active',unit)==='active');await pause();
  assert.equal(await pid(),incumbent.pid,'Installing supervision must preserve incumbent');
  incumbent.kill('SIGKILL');
  await until(async()=>await pid()!==incumbent.pid && await healthy());
  const owned=await pid();process.kill(owned,'SIGKILL');
  await until(async()=>await pid()!==owned && await healthy());
  assert.ok(Number(control('show',unit,'-p','NRestarts','--value'))>=1);
  const recovered=await pid();control('restart',unit);
  await until(async()=>await pid()!==recovered && await healthy());
  console.log('PASS systemd: incumbent preserved, takeover on exit, crash recovery (NRestarts >= 1), explicit restart, HTTP API restored; isolated database only');
}finally{
  try{control('stop',unit);}catch{}
  try{control('reset-failed',unit);}catch{}
  if(incumbent && incumbent.exitCode===null && incumbent.signalCode===null)incumbent.kill('SIGTERM');
  await rm(dir,{recursive:true,force:true});
}
