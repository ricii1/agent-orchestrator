import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {ClaudeAdapter} from '../src/adapters/claude.js';
import {CodexAdapter} from '../src/adapters/codex.js';
import type {RunContext,Provider} from '../src/types.js';
const requested=process.argv[2];
if(requested && !['claude','codex'].includes(requested))throw new Error('Usage: npm run smoke -- [claude|codex]');
const dir=await mkdtemp(join(tmpdir(),'agent-office-smoke-'));
const store=new Store(':memory:');
try{
 for(const provider of (requested?[requested]:['claude','codex']) as Provider[]){
  const adapter=provider==='claude'?new ClaudeAdapter():new CodexAdapter();
  const task=store.createTask({prompt:'Reply exactly OFFICE_SMOKE_OK. Do not call any tools or read files.',provider,workspace:dir,executionPath:dir});
  let lastLog='';
  const context:RunContext={task,prompt:task.prompt,url:'http://127.0.0.1:4317',capability:'smoke-no-tools',bridge:resolve('dist/mcp.js'),event:(type,data:any)=>{if(type==='log'||type==='provider_error')lastLog=JSON.stringify(data).slice(-1200);},session:id=>{task.sessionId=id;},approve:async()=>({approved:false,answer:'Smoke test denies all actions'})};
  for(const turn of ['initial','resume']){
   const run=adapter.run(context);
   const timeout=setTimeout(()=>run.cancel(),25000);
   try{const result=await run.done;if(!result.includes('OFFICE_SMOKE_OK'))throw new Error('Unexpected smoke response');console.log(`${provider} ${turn}: PASS (session captured: ${!!task.sessionId})`);}
   catch(e){console.error(`${provider} ${turn}: FAIL: ${String(e)}${lastLog?'\nProvider diagnostic: '+lastLog:''}`);process.exitCode=1;break;}
   finally{clearTimeout(timeout);}
  }
 }
}finally{store.close();await rm(dir,{recursive:true,force:true});}
