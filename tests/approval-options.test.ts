import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalChoices,selectedChoice,savedClaudeRules} from '../src/approval-options.js';
import {CodexAdapter} from '../src/adapters/codex.js';
import type {RunContext} from '../src/types.js';
const command='item/commandExecution/requestApproval';
test('Codex choices echo offered decisions and the exact persisted prefix',async()=>{
 const rule={acceptWithExecpolicyAmendment:{execpolicy_amendment:['npm','test']}};
 const details={availableDecisions:['accept','acceptForSession',rule,'decline','cancel']};
 const options=approvalChoices(command,details);
 assert.deepEqual(options.map(o=>o.value),details.availableDecisions);
 assert.match(options[2].detail!,/\["npm","test"\]/);
 const adapter=new CodexAdapter();
 for(const choice of options){
  const ctx={approve:async()=>({approved:choice.approved,answer:'',choice:choice.id})} as unknown as RunContext;
  assert.deepEqual(await adapter.serverRequest(ctx,command,details),{decision:choice.value});
 }
 assert.equal(approvalChoices(command,{availableDecisions:['accept','cancel']}).length,2);
 assert.throws(()=>selectedChoice(command,details,'codex:2',false),/tidak tersedia/);
 assert.throws(()=>selectedChoice(command,details,'injected-rule',true),/tidak tersedia/);
 assert.ok(approvalChoices('item/fileChange/requestApproval',{}).some(o=>o.value==='acceptForSession'));
});
test('Claude only offers provider suggestions with their original destination and honors suppression',()=>{
 const suggestion={type:'addRules',behavior:'allow',rules:[{toolName:'Bash',ruleContent:'npm test'}],destination:'localSettings'};
 const details={permission_suggestions:[suggestion]};
 const choices=approvalChoices('permission',details);
 assert.deepEqual(choices.map(c=>c.id),['claude:once','claude:rule:0','claude:deny']);
 assert.deepEqual(choices[1].value,[suggestion]);assert.match(choices[1].detail!,/Bash\(npm test\)/);
 assert.equal(approvalChoices('permission',{...details,suppress_always_allow_rule:true}).length,2);
 assert.equal(approvalChoices('permission',{permission_suggestions:[{...suggestion,type:'setMode',mode:'bypassPermissions'}]}).length,2);
 assert.equal(approvalChoices('permission',{}).length,2);
 assert.deepEqual(approvalChoices('question',details),[]);
});

test('Claude saved rules survive later turns with session, workspace and user scopes',()=>{
 const task={id:'a',workspace:'/project',provider:'claude'} as any;
 const same={...task,id:'b'},other={...task,id:'c',workspace:'/other'};
 const rule=(destination:string,toolName:string)=>({kind:'permission',taskId:'a',status:'approved',choice:'claude:rule:0',details:{permission_suggestions:[{type:'addRules',behavior:'allow',destination,rules:[{toolName}]}]}} as any);
 const approvals=[rule('session','Read'),rule('localSettings','Grep'),rule('userSettings','Glob')];
 assert.deepEqual(savedClaudeRules(approvals,[task,same,other],task),['Read','Grep','Glob']);
 assert.deepEqual(savedClaudeRules(approvals,[task,same,other],same),['Grep','Glob']);
 assert.deepEqual(savedClaudeRules(approvals,[task,same,other],other),['Glob']);
 assert.deepEqual(savedClaudeRules(approvals.map(a=>({...a,status:'denied'})),[task],task),[]);
});
