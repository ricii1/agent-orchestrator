import {roleOf,statusText,isWorking,inWorkspace,type Task,type Event} from './model.js';
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const string=(...values:unknown[])=>values.find(v=>typeof v==='string'&&v.length) as string|undefined;
export interface ChatEntry {id:number;kind:'message'|'activity';speaker:string;text:string;detail?:string;createdAt:string;group?:string;}
export const chatName=(task:Task)=>task.parentId?roleOf(task):'PM';
export const workerChats=(tasks:Task[],workspace:string)=>tasks.filter(t=>t.parentId&&inWorkspace(t,workspace,tasks)).sort((a,b)=>Number(isWorking(b.status))-Number(isWorking(a.status))||b.createdAt.localeCompare(a.createdAt));
export function chatOption(task:Task){return `${chatName(task)} · ${task.provider} · ${statusText[task.status]} · ${task.title} · ${new Date(task.updatedAt).toLocaleString('id-ID')} · ${task.id.slice(0,8)}`;}
function activity(data:Record<string,any>):{text:string;detail?:string}{
  const input=object(data.input),name=string(data.name,data.tool,data.type)||'Tool';
  const command=string(data.command,input.command),file=string(input.file_path,input.path,data.path);
  if(command)return {text:'Menjalankan perintah',detail:command};
  if(name==='fileChange')return {text:'Mengubah file',detail:Array.isArray(data.changes)?data.changes.map((v:any)=>v.path).filter(Boolean).join('\n'):undefined};
  if(file)return {text:`${name==='Read'?'Membaca':name==='Edit'||name==='Write'?'Mengubah':'Mengakses'} file`,detail:file};
  return {text:`Menggunakan ${name.replace(/^mcp__orchestrator__/,'')}`,detail:Object.keys(input).length?JSON.stringify(input,null,2):undefined};
}
export function chatEntries(task:Task,events:Event[]):ChatEntry[]{
  const entries:ChatEntry[]=[],name=chatName(task),completedText=new Set<number>();let queued:string[]=[],spoken=false;
  events.forEach((event,index)=>{if(event.taskId!==task.id||event.type!=='message')return;let boundary=index-1;while(boundary>=0&&!['turn_started','created','user_message'].includes(events[boundary].type))boundary--;for(let i=index-1;i>boundary;i--)if(events[i].taskId===task.id&&events[i].type==='text')completedText.add(events[i].id);});
  const message=(event:Event,speaker:string,text:string)=>entries.push({id:event.id,kind:'message',speaker,text,createdAt:event.createdAt});
  for(const event of events){
    if(event.taskId!==task.id)continue;
    const data=object(event.data);
    if(event.type==='created'||event.type==='user_message'){
      const text=string(data.text,data.prompt);if(text){message(event,task.parentId?'PM':'Kamu',text);queued.push(text);}continue;
    }
    if(event.type==='turn_started'){
      const text=string(data.text);
      if(task.parentId&&text&&text!==queued.join('\n\n'))message(event,'Instruksi kerja',text);
      queued=[];spoken=false;continue;
    }
    if(event.type==='text'&&completedText.has(event.id))continue;
    if(event.type==='message'||event.type==='text'){
      if(typeof data.text==='string'&&data.text){
        const last=entries.at(-1);
        if(event.type==='text'&&last?.kind==='message'&&last.speaker===name&&last.id!==0&&events.find(e=>e.id===last.id)?.type==='text')last.text+=data.text;
        else message(event,name,data.text);
        if(event.type==='message')spoken=true;
      }
      continue;
    }
    if(event.type==='result'){if(!spoken&&typeof data.text==='string'&&data.text)message(event,name,data.text);spoken=true;continue;}
    if(event.type==='command_started'||event.type==='command_result'){
      entries.push({id:event.id,kind:'activity',speaker:'Sistem',text:event.type==='command_started'?String(data.command||'Perintah')+' sedang berjalan…':data.success?'Konteks berhasil diringkas':'Perintah gagal',detail:string(data.text),createdAt:event.createdAt});continue;
    }
    if(event.type==='tool'){
      entries.push({id:event.id,kind:'activity',speaker:name,...activity(data),createdAt:event.createdAt});continue;
    }
    if(['tool_output','tool_result','log','provider_error','permission_denied'].includes(event.type)){
      const detail=string(data.text,data.aggregatedOutput,data.error?.message);
      const output=event.type==='tool_output'||event.type==='tool_result';
      const title=output?'Output tool':event.type==='log'?'Log proses':event.type==='permission_denied'?'Izin ditolak':'Pesan provider';
      const group=`${title}:${data.itemId||data.id||''}`,last=entries.at(-1);
      if(event.type==='tool_output'&&last?.group===group){last.detail=(last.detail||'')+(detail||'');continue;}
      entries.push({id:event.id,kind:'activity',speaker:name,text:title+(typeof data.exitCode==='number'?` · exit ${data.exitCode}`:''),detail:detail||undefined,createdAt:event.createdAt,group});
    }
  }
  if(task.parentId&&!events.some(e=>e.taskId===task.id&&e.type==='created'))entries.unshift({id:0,kind:'message',speaker:'PM',text:task.prompt,createdAt:task.createdAt});
  if(task.result&&!entries.some(e=>e.kind==='message'&&e.speaker===name))entries.push({id:0,kind:'message',speaker:name,text:task.result,createdAt:task.updatedAt});
  return entries;
}
