import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {ClaudeAdapter} from '../src/adapters/claude.js';
import {CodexAdapter} from '../src/adapters/codex.js';
import {Store} from '../src/store.js';
import type {RunContext} from '../src/types.js';
for(const provider of ['claude','codex'] as const)test(`${provider} adapter handles session, output, and protocol result`,async()=>{
 const store=new Store(':memory:');const old=process.env[provider.toUpperCase()+'_BIN'];process.env[provider.toUpperCase()+'_BIN']=resolve('tests/fake-cli.cjs');
 try{
  const task=store.createTask({prompt:'hello',workspace:process.cwd(),provider,executionPath:process.cwd()});let session='',approvals=0;const events:string[]=[];
  const context:RunContext={task,prompt:'hello',url:'http://127.0.0.1:4317',capability:'test-cap',bridge:resolve('dist/mcp.js'),event:(type)=>events.push(type),session:id=>session=id,approve:async()=>{approvals++;return {approved:false,answer:'no'};}};
  const run=(provider==='claude'?new ClaudeAdapter():new CodexAdapter()).run(context);const result=await run.done;
  assert.ok(session);assert.ok(events.includes('message'));assert.ok(events.includes('tool_result'));if(provider==='codex')assert.ok(events.includes('tool_output'));assert.equal(result,provider==='claude'?'received hello':'permission decline');assert.equal(approvals,provider==='codex'?1:0);
 }finally{if(old===undefined)delete process.env[provider.toUpperCase()+'_BIN'];else process.env[provider.toUpperCase()+'_BIN']=old;store.close();}
});
