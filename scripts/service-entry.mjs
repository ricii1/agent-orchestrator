// Let systemd take over a launcher daemon without interrupting active tasks.
import {readFileSync,readlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const data=resolve(process.env.ORCHESTRATOR_DATA_DIR||join(root,'.data'));
const entry=join(root,'dist/main.js');
function incumbent(){
  let pid;
  try { pid=Number(readFileSync(join(data,'daemon.pid'),'utf8')); }
  catch(e){if(e.code==='ENOENT')return false;throw e;}
  if(!Number.isInteger(pid)||pid<=1)throw new Error('Invalid daemon PID');
  try { process.kill(pid,0); }
  catch(e){if(e.code==='ESRCH')return false;throw e;}
  const args=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');
  if(readlinkSync(`/proc/${pid}/cwd`)!==root || !args.some(a=>[entry,'dist/main.js',join(root,'src/main.ts'),'src/main.ts'].includes(a)))throw new Error('PID belongs to another process; refusing takeover');
  return pid;
}
let stopping=false,child,observed;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  stopping=true;
  if(child)child.kill(signal);
  else if(observed){
    // Explicit service stop/restart should also stop a verified launcher daemon.
    try{if(incumbent()===observed)process.kill(observed,signal);}
    catch(e){console.error(e.message);process.exitCode=1;}
  }
});
try {
  let waiting=false;
  while(!stopping && (observed=incumbent())){
    if(!waiting)console.log('Waiting for existing daemon to exit; active work is preserved');
    waiting=true;
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!stopping){
    child=spawn(process.execPath,[entry],{cwd:root,stdio:'inherit'});
    child.on('error',e=>{console.error(e.message);process.exitCode=1;});
    child.on('exit',(code,signal)=>{process.exitCode=stopping?0:(code ?? (signal?1:0));});
  }
}catch(e){console.error(e.message);process.exitCode=1;}
