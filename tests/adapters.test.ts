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

for(const provider of ['claude','codex'] as const)test(`${provider} compacts an existing provider session`,async()=>{
 const store=new Store(':memory:');const key=provider.toUpperCase()+'_BIN',old=process.env[key];process.env[key]=resolve('tests/fake-cli.cjs');
 try{
  const task=store.createTask({prompt:'history',workspace:process.cwd(),executionPath:process.cwd(),sessionId:'existing-session',provider});
  const ctx:RunContext={task,prompt:'/compact',compact:true,url:'http://127.0.0.1:4317',capability:'test',bridge:'test',event:()=>{},session:()=>{},approve:async()=>{throw new Error('Compaction must not start a model turn/approval in this fixture');}};
  const result=await(provider==='codex'?new CodexAdapter():new ClaudeAdapter()).run(ctx).done;
  assert.equal(result,provider==='codex'?'Konteks Codex berhasil diringkas.':'received /compact');
 }finally{if(old===undefined)delete process.env[key];else process.env[key]=old;store.close();}
});

for(const provider of ['claude','codex'] as const)test(`${provider} full access is an explicit native adapter mode`,async()=>{
 const store=new Store(':memory:'),key=provider.toUpperCase()+'_BIN',old=process.env[key],oldFull=process.env.OFFICE_TEST_FULL;
 process.env[key]=resolve('tests/fake-cli.cjs');process.env.OFFICE_TEST_FULL='1';
 try{
  const task=store.createTask({prompt:'hello',provider,workspace:process.cwd(),executionPath:process.cwd()});
  const ctx:RunContext={task,prompt:'hello',permissionMode:'full',url:'http://127.0.0.1:4317',capability:'test',bridge:'test',event:()=>{},session:()=>{},approve:async()=>({approved:true,answer:''})};
  const result=await(provider==='claude'?new ClaudeAdapter():new CodexAdapter()).run(ctx).done;assert.ok(result);
 }finally{if(old===undefined)delete process.env[key];else process.env[key]=old;if(oldFull===undefined)delete process.env.OFFICE_TEST_FULL;else process.env.OFFICE_TEST_FULL=oldFull;store.close();}
});
