import type {Approval,Task} from './types.js';
// Only echo choices offered by the provider; never accept arbitrary rule payloads from the UI.
export interface ApprovalChoice {id:string;label:string;approved:boolean;detail?:string;value:unknown;}
const record=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export function approvalChoices(kind:string,raw:unknown):ApprovalChoice[]{
 const d=record(raw),choices:ApprovalChoice[]=[];
 const add=(id:string,label:string,approved:boolean,value:unknown,detail?:string)=>choices.push({id,label,approved,value,detail});
 if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(kind)){
  const values=Array.isArray(d.availableDecisions)?d.availableDecisions:['accept','acceptForSession','decline','cancel',...(kind.includes('commandExecution')&&Array.isArray(d.proposedExecpolicyAmendment)?[{acceptWithExecpolicyAmendment:{execpolicy_amendment:d.proposedExecpolicyAmendment}}]:[])];
  values.forEach((v:any,i:number)=>{
   if(v==='accept')add('codex:'+i,'Izinkan sekali',true,v);
   else if(v==='acceptForSession')add('codex:'+i,'Izinkan selama sesi',true,v,'Berlaku selama sesi yang dikelola proses Codex ini.');
   else if(v==='decline')add('codex:'+i,'Tolak',false,v);
   else if(v==='cancel')add('codex:'+i,'Batalkan giliran',false,v);
   else if(kind.includes('commandExecution')&&Array.isArray(v?.acceptWithExecpolicyAmendment?.execpolicy_amendment)&&v.acceptWithExecpolicyAmendment.execpolicy_amendment.length&&v.acceptWithExecpolicyAmendment.execpolicy_amendment.every((s:unknown)=>typeof s==='string'))add('codex:'+i,'Selalu izinkan aturan perintah ini',true,v,'Aturan prefix yang disimpan oleh Codex:\n'+JSON.stringify(v.acceptWithExecpolicyAmendment.execpolicy_amendment));
   else if(kind.includes('commandExecution')&&typeof v?.applyNetworkPolicyAmendment?.network_policy_amendment?.host==='string'){
    const rule=v.applyNetworkPolicyAmendment.network_policy_amendment;
    if(['allow','deny'].includes(rule.action))add('codex:'+i,rule.action==='allow'?'Selalu izinkan host ini':'Blokir host ini',rule.action==='allow',v,JSON.stringify(rule));
   }
  });
 }else if(kind==='permission'){
  add('claude:once','Izinkan sekali',true,null);
  const suggestions=d.permission_suggestions??d.suggestions;
  if(!d.suppress_always_allow_rule&&!d.suppressAlwaysAllowRule&&Array.isArray(suggestions))suggestions.forEach((s:any,i:number)=>{
   if(s?.type!=='addRules'||s.behavior!=='allow'||!Array.isArray(s.rules)||!s.rules.length||!s.rules.every((r:any)=>typeof r?.toolName==='string'))return;
   const destinations:Record<string,string>={session:'Izinkan aturan selama sesi',localSettings:'Selalu izinkan di proyek ini',projectSettings:'Simpan aturan di konfigurasi proyek',userSettings:'Selalu izinkan untuk pengguna ini'};
   if(destinations[s.destination])add('claude:rule:'+i,destinations[s.destination],true,[s],`Tujuan: ${s.destination}\n`+s.rules.map((r:any)=>r.toolName+(r.ruleContent!==undefined?'('+r.ruleContent+')':'')).join('\n'));
  });
  add('claude:deny','Tolak',false,null);
 }
 return choices;
}
export function selectedChoice(kind:string,details:unknown,id:string,approved:boolean){
 const choice=approvalChoices(kind,details).find(c=>c.id===id);
 if(!choice||choice.approved!==approved)throw new Error('Pilihan izin tidak tersedia untuk permintaan ini');
 return choice;
}

// Claude runs with isolated settings sources. Replay only explicitly saved allow rules,
// without loading project hooks, MCP configuration or unrelated CLI settings.
export function savedClaudeRules(approvals:Approval[],tasks:Task[],task:Task):string[]{
 const rules=new Set<string>();
 for(const approval of approvals){
  if(approval.kind!=='permission'||approval.status!=='approved'||!approval.choice)continue;
  const source=tasks.find(t=>t.id===approval.taskId);if(source?.provider!=='claude')continue;
  const choice=approvalChoices(approval.kind,approval.details).find(c=>c.id===approval.choice);
  if(!choice?.approved||!Array.isArray(choice.value))continue;
  for(const update of choice.value){
   if(update.destination==='session'?source.id!==task.id:update.destination!=='userSettings'&&source.workspace!==task.workspace)continue;
   for(const rule of update.rules)rules.add(rule.toolName+(rule.ruleContent!==undefined?'('+rule.ruleContent+')':''));
  }
 }
 return [...rules];
}
