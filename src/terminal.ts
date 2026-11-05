import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {allowedWorkspace} from './workspace.js';
interface Session {id:string;workspace:string;process:ChildProcessWithoutNullStreams;chunks:{id:number;data:string}[];sequence:number;bytes:number;exitCode:number|null;error?:string;}
export class Terminals {
 sessions=new Map<string,Session>();
 constructor(private roots:()=>string[]){}
 async open(workspace:string){
  const actual=await allowedWorkspace(workspace,this.roots());
  const existing=[...this.sessions.values()].find(s=>s.workspace===actual&&s.exitCode===null&&!s.error);if(existing)return {id:existing.id,workspace:actual};
  if([...this.sessions.values()].filter(s=>s.exitCode===null).length>=10)throw new Error('Maksimal 10 terminal aktif. Tutup terminal yang tidak dipakai.');
  // Keep only a bounded in-memory scrollback. Input/passwords are never logged.
  for(const [id,s] of this.sessions)if(s.exitCode!==null)this.sessions.delete(id);
  const process_=spawn('python3',['-u',fileURLToPath(new URL('../scripts/terminal-bridge.py',import.meta.url)),actual,process.env.SHELL||'/bin/bash'],{stdio:'pipe'});
  const session:Session={id:randomUUID(),workspace:actual,process:process_,chunks:[],sequence:0,bytes:0,exitCode:null};this.sessions.set(session.id,session);
  createInterface({input:process_.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(typeof value.data==='string'){session.chunks.push({id:++session.sequence,data:value.data});session.bytes+=value.data.length;while(session.bytes>512000&&session.chunks.length>1)session.bytes-=session.chunks.shift()!.data.length;}if(typeof value.exitCode==='number')session.exitCode=value.exitCode;}catch{session.error='Respons PTY tidak valid';}});
  process_.stderr.on('data',data=>{session.error=String(data).slice(0,1000);});
  process_.on('error',error=>{session.error=error.message;session.exitCode=-1;});
  process_.on('close',code=>{session.exitCode??=code??-1;});
  process_.stdin.on('error',()=>{});
  return {id:session.id,workspace:actual};
 }
 summary(){return [...this.sessions.values()].map(s=>({id:s.id,workspace:s.workspace,exitCode:s.exitCode}));}
 get(id:string){const session=this.sessions.get(id);if(!session)throw new Error('Terminal tidak ditemukan. Buka terminal baru.');return session;}
 read(id:string,after:number){const s=this.get(id);return {id,workspace:s.workspace,chunks:s.chunks.filter(c=>c.id>after),cursor:s.sequence,exitCode:s.exitCode,error:s.error,truncated:!!s.chunks.length&&after<s.chunks[0].id-1};}
 input(id:string,data:string){const s=this.get(id);if(s.exitCode!==null||s.error)throw new Error(s.error||'Terminal sudah berhenti');if(typeof data!=='string'||data.length>64000)throw new Error('Input terminal terlalu panjang');s.process.stdin.write(JSON.stringify({data:Buffer.from(data).toString('base64')})+'\n');}
 resize(id:string,cols:number,rows:number){if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>500||rows<2||rows>200)throw new Error('Ukuran terminal tidak valid');this.get(id).process.stdin.write(JSON.stringify({cols,rows})+'\n');}
 close(id:string){const s=this.get(id);s.process.stdin.end();const timer=setTimeout(()=>s.process.kill('SIGKILL'),1500);timer.unref();s.process.once('close',()=>clearTimeout(timer));}
 shutdown(){for(const s of this.sessions.values())if(s.exitCode===null)this.close(s.id);}
}
