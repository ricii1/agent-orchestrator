#!/usr/bin/env node
// Synchronous stdio keeps this protocol fixture usable in restricted test sandboxes.
const fs=require('node:fs');
const send=value=>fs.writeSync(1,JSON.stringify(value)+'\n');
if(process.argv.includes('app-server')){
 let pending='';const buffer=Buffer.alloc(65536);
 for(;;){
  let n;try{n=fs.readSync(0,buffer,0,buffer.length,null);}catch(e){if(e.code==='EAGAIN'){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);continue;}throw e;}
  if(!n)break;pending+=buffer.subarray(0,n).toString();let at;
  while((at=pending.indexOf('\n'))!==-1){
   const q=JSON.parse(pending.slice(0,at));pending=pending.slice(at+1);
   if(q.method==='initialize')send({id:q.id,result:{}});
   if(q.method==='account/read')send({id:q.id,result:{account:{type:'chatgpt'}}});
   if(q.method==='account/rateLimits/read')send({id:q.id,result:{rateLimits:{primary:{usedPercent:26,windowDurationMins:300,resetsAt:1800000000}}}});
   if(q.method==='config/read')send({id:q.id,result:{config:{mcp_servers:{inherited:{command:'unexpected'}}}}});
   if(q.method==='thread/start'||q.method==='thread/resume'){
    if(q.params.config.mcp_servers.inherited.enabled!==false)process.exit(4);
    if(q.params.approvalPolicy!=='untrusted'||q.params.config.features.multi_agent!==false)process.exit(3);
    send({id:q.id,result:{thread:{id:'fake-thread'},model:'fake'}});
   }
   if(q.method==='turn/start'){send({id:q.id,result:{turn:{id:'fake-turn'}}});send({id:1000,method:'item/commandExecution/requestApproval',params:{command:'echo test',threadId:'fake-thread',turnId:'fake-turn'}});}
   if(q.id===1000&&q.result){send({method:'item/commandExecution/outputDelta',params:{itemId:'cmd-1',delta:'test output'}});send({method:'item/completed',params:{item:{id:'cmd-1',type:'commandExecution',aggregatedOutput:'test output',exitCode:0}}});send({method:'item/completed',params:{item:{type:'agentMessage',text:'permission '+q.result.decision}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}
  }
 }
}else{
 if(!process.argv.includes('--restricted')||!process.argv.includes('--permission-prompt-tool'))process.exit(3);
 const prompt=fs.readFileSync(0,'utf8');
 send({type:'system',session_id:'fake-session'});send({type:'assistant',message:{content:[{type:'tool_use',id:'tool-1',name:'Read',input:{file_path:'/tmp/test'}}]}});send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'file contents'}]}});send({type:'assistant',message:{content:[{type:'text',text:'received '+prompt}]}});send({type:'result',subtype:'success',is_error:false,result:'received '+prompt,usage:{input_tokens:1,output_tokens:1}});
}
