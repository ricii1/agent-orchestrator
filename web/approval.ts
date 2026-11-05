import {isEmptyFormRequest} from '../src/elicitation.js';
import type {Approval} from '../src/types.js';
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const text=(...values:unknown[])=>values.find(value=>typeof value==='string'&&value.trim()) as string|undefined;
export interface ApprovalView {
  title:string; reason?:string; command?:string; location?:string; target?:string; preview?:string;
  question?:string; options:{label:string;description?:string}[];
  answer:'none'|'optional'|'required'|'json'; canApprove:boolean; allowLabel:string; denyLabel:string;
}
export function approvalView(approval:Approval):ApprovalView {
  const details=record(approval.details),input=record(details.input??details.tool_input??details.toolInput);
  const tool=text(details.tool_name,details.toolName,details.tool,details.name);
  const base:ApprovalView={title:'Izinkan tindakan ini?',reason:text(details.reason,details.message),options:[],answer:'optional',canApprove:true,allowLabel:'Izinkan sekali',denyLabel:'Tolak'};
  if(approval.kind==='question') {
    const questions=Array.isArray(details.questions)?details.questions.map(record):[];
    const question=text(details.question)||questions.map((q,i)=>`${questions.length>1?`${i+1}. `:''}${text(q.question,q.header)||'Pertanyaan'}${questions.length>1&&Array.isArray(q.options)?'\nPilihan: '+q.options.map((o:any)=>text(record(o).label)).filter(Boolean).join(', '):''}`).join('\n\n');
    const options=questions.length===1&&Array.isArray(questions[0].options)?questions[0].options.flatMap((option:unknown)=>{const o=record(option),label=text(o.label);return label?[{label,description:text(o.description)}]:[];}):[];
    return {...base,title:'Perlu jawabanmu',question:question||'Buka detail untuk melihat pertanyaannya.',options,answer:'required',allowLabel:'Kirim jawaban'};
  }
  if(approval.kind==='unsupported_permissions')return {...base,title:'Perubahan izin belum didukung',reason:'Permintaan ini akan ditolak. Gunakan workspace yang sudah didaftarkan.',canApprove:false,denyLabel:'Tutup permintaan'};
  const network=record(details.networkApprovalContext);
  const command=text(details.command,input.command);
  if(command||text(network.host))return {...base,title:text(network.host)?'Izinkan akses jaringan?':'Jalankan perintah terminal?',command,location:text(details.cwd,input.cwd),target:text(network.host),reason:text(details.reason,details.message)};
  const file=text(input.file_path,input.path,details.path,details.grantRoot);
  if(file||approval.kind.includes('fileChange'))return {...base,title:tool==='Read'?'Baca file ini?':'Izinkan perubahan file?',location:file,preview:text(input.patch,input.diff,input.new_string,input.content)};
  if(approval.kind==='elicitation'){
    if(isEmptyFormRequest(details)){
      const meta=record(details._meta),params=record(meta.tool_params);
      const askUser=details.serverName==='orchestrator'&&meta.codex_approval_kind==='mcp_tool_call'&&/tool ["']ask_user["']/.test(String(details.message));
      return {...base,title:askUser?'Izinkan pertanyaan ini?':'Konfirmasi permintaan',reason:askUser?'Izin ini membuka pertanyaan berikut. Jawab pertanyaannya setelah ditampilkan; pekerjaan belum disetujui.':text(details.message,details.reason),question:askUser?text(params.question):undefined,answer:'none',allowLabel:askUser?'Tampilkan pertanyaan':'Konfirmasi'};
    }
    return {...base,title:'Konfirmasi permintaan',reason:text(details.message,details.reason),target:text(details.url),answer:details.requestedSchema?'json':'optional',allowLabel:'Konfirmasi'};
  }
  return {...base,title:tool?`Izinkan ${tool}?`:base.title,preview:Object.keys(input).length?JSON.stringify(input,null,2):undefined};
}

// Preview only: never fills or submits an answer, and never replaces server validation.
export function formExample(schema:unknown,depth=0):unknown {
  if(depth>4)return undefined;
  const s=record(schema);
  if(s.default!==undefined)return s.default;
  if(Array.isArray(s.examples)&&s.examples.length)return s.examples[0];
  if(Array.isArray(s.enum)&&s.enum.length)return s.enum[0];
  if(s.type==='object'&&s.properties&&typeof s.properties==='object'){
    return Object.fromEntries(Object.entries(record(s.properties)).slice(0,20).flatMap(([key,value])=>{const example=formExample(value,depth+1);return example===undefined?[]:[[key,example]];}));
  }
  if(s.type==='string')return '…';
  if(s.type==='integer'||s.type==='number')return 0;
  if(s.type==='boolean')return false;
  if(s.type==='array')return [];
  if(s.type==='null')return null;
  return undefined;
}
