import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalView,formExample} from '../web/approval.ts';
import {CodexAdapter} from '../src/adapters/codex.ts';
import type {Approval,RunContext} from '../src/types.ts';
const approval=(details:unknown,kind='item/commandExecution/requestApproval'):Approval=>({id:'request',taskId:'pm',kind,details,status:'pending',answer:'',createdAt:'2026-11-04'});

test('command approval shows the exact command and folder, without protocol metadata or inferred safety',()=>{
  const command='/usr/bin/zsh -lc "rg -n localhost src/server.ts\nss -ltn\ngit status --short"';
  const data={kind:'command',command,cwd:'/project',threadId:'private-thread',turnId:'private-turn',itemId:'private-item',proposedExecpolicyAmendment:['/usr/bin/zsh','-lc','other command'],availableDecisions:['accept','cancel'],commandActions:[{type:'unknown',command:'incomplete summary'}]};
  const view=approvalView(approval(data));
  assert.equal(view.command,command);assert.equal(view.location,'/project');assert.equal(view.title,'Jalankan perintah terminal?');
  assert.equal(view.allowLabel,'Izinkan sekali');assert.equal(view.answer,'optional');assert.equal(view.canApprove,true);
  assert.ok(!JSON.stringify(view).includes('private-thread'));assert.ok(!JSON.stringify(view).includes('other command'));
});

test('Claude commands and file edits get useful previews; questions expose their text and options',()=>{
  const bash=approvalView(approval({tool_name:'Bash',input:{command:'npm test'},reason:'Periksa hasil perubahan'},'permission'));
  assert.equal(bash.command,'npm test');assert.equal(bash.reason,'Periksa hasil perubahan');
  const file=approvalView(approval({tool_name:'Edit',input:{file_path:'/project/app.ts',new_string:'const safe = true;'}},'permission'));
  assert.equal(file.title,'Izinkan perubahan file?');assert.equal(file.location,'/project/app.ts');assert.equal(file.preview,'const safe = true;');
  const question=approvalView(approval({questions:[{id:'provider',question:'Provider mana?',options:[{label:'Claude',description:'Gunakan Claude'},{label:'Codex'}]}]},'question'));
  assert.equal(question.question,'Provider mana?');assert.equal(question.answer,'required');assert.equal(question.options[0].label,'Claude');
  const unsupported=approvalView(approval({},'unsupported_permissions'));assert.equal(unsupported.canApprove,false);
});

test('permission decisions stay one-shot and respect provider cancellation choices',async()=>{
  const adapter=new CodexAdapter();
  const context={approve:async()=>({approved:true,answer:''})} as unknown as RunContext;
  const offered={availableDecisions:['accept',{acceptWithExecpolicyAmendment:{execpolicy_amendment:['sh']}},'cancel']};
  assert.deepEqual(await adapter.serverRequest(context,'item/commandExecution/requestApproval',offered),{decision:'accept'});
  context.approve=async()=>({approved:false,answer:''});
  assert.deepEqual(await adapter.serverRequest(context,'item/commandExecution/requestApproval',offered),{decision:'cancel'});
  assert.deepEqual(await adapter.serverRequest(context,'item/commandExecution/requestApproval',{}),{decision:'decline'});
});

test('empty MCP tool-confirmation form needs a click rather than a JSON answer',async()=>{
  const details={threadId:'thread',serverName:'orchestrator',mode:'form',_meta:{codex_approval_kind:'mcp_tool_call',persist:['session','always'],tool_params:{question:'Boleh menugaskan freelancer untuk domain lokal?'}},message:'Allow the orchestrator MCP server to run tool "ask_user"?',requestedSchema:{type:'object',properties:{}}};
  const view=approvalView(approval(details,'elicitation'));
  assert.equal(view.answer,'none');assert.equal(view.title,'Izinkan pertanyaan ini?');assert.equal(view.allowLabel,'Tampilkan pertanyaan');
  assert.equal(view.question,details._meta.tool_params.question);
  const adapter=new CodexAdapter();
  const context={approve:async()=>({approved:true,answer:'iya'})} as unknown as RunContext;
  assert.deepEqual(await adapter.serverRequest(context,'mcpServer/elicitation/request',details),{action:'accept',content:{}});
  context.approve=async()=>({approved:false,answer:''});
  assert.deepEqual(await adapter.serverRequest(context,'mcpServer/elicitation/request',details),{action:'decline',content:null});
});

test('real elicitation fields still require their structured answer; URL confirmations are preserved',async()=>{
  const details={mode:'form',message:'Nama domain?',requestedSchema:{type:'object',properties:{domain:{type:'string'}},required:['domain']}};
  assert.equal(approvalView(approval(details,'elicitation')).answer,'json');
  const adapter=new CodexAdapter();
  const context={approve:async()=>({approved:true,answer:'{"domain":"kantor.test"}'})} as unknown as RunContext;
  assert.deepEqual(await adapter.serverRequest(context,'mcpServer/elicitation/request',details),{action:'accept',content:{domain:'kantor.test'}});
  context.approve=async()=>({approved:true,answer:'iya'});
  assert.deepEqual(await adapter.serverRequest(context,'mcpServer/elicitation/request',details),{action:'decline',content:null});
  assert.deepEqual(await adapter.serverRequest(context,'mcpServer/elicitation/request',{mode:'url',url:'https://example.invalid/authorize'}),{action:'accept',content:null});
});


test('form examples derive only from supplied schema and do not invent unsupported fields',()=>{
  assert.deepEqual(formExample({type:'object',properties:{domain:{type:'string'},count:{type:'integer'},scope:{enum:['project','user']},enabled:{type:'boolean'},unknown:{$ref:'#/missing'}}}),{domain:'…',count:0,scope:'project',enabled:false});
  assert.equal(formExample({oneOf:[{type:'string'}]}),undefined);
  assert.deepEqual(formExample({type:'object',properties:{name:{examples:['docs']}}}),{name:'docs'});
});
