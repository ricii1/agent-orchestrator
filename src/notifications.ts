import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Engine} from './engine.js';
import type {Task} from './types.js';
const exec=promisify(execFile);
export type NotificationPreferences={enabled:boolean;decision:boolean;complete:boolean;desktop:boolean};
export type NativeSender=(title:string,body:string)=>Promise<void>;
const off:NotificationPreferences={enabled:false,decision:true,complete:true,desktop:true};
export class TaskNotifications {
  private prefs={...off};private sent=new Set<string>();private claimed=new Set<string>();private failed=false;private capability:{available:boolean;reason:string;session:boolean}={available:false,reason:'Belum diperiksa',session:false};
  constructor(private engine:Engine,private sender?:NativeSender){}
  preferences(){return {...this.prefs};}
  async status(){
    if(this.failed)return {...this.capability,clickAction:false,mode:'browser-or-in-app'};
    const session=!!(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)&&!!process.env.DBUS_SESSION_BUS_ADDRESS;
    if(this.sender)this.capability={available:true,reason:'Pengirim native tersedia (adapter QA).',session:true};
    else if(!session)this.capability={available:false,reason:'DISPLAY/WAYLAND_DISPLAY atau DBUS_SESSION_BUS_ADDRESS tidak tersedia pada sesi daemon.',session:false};
    else try{await exec('notify-send',['--version'],{timeout:1500});this.capability={available:true,reason:'notify-send tersedia pada sesi desktop daemon.',session:true};}
    catch(e){const error=e as NodeJS.ErrnoException;this.capability={available:false,reason:error.code==='ENOENT'?'Command notify-send tidak ditemukan.':'notify-send gagal diperiksa: '+(error.code||'command error'),session:true};}
    return {...this.capability,clickAction:false,mode:this.prefs.enabled&&this.prefs.desktop&&this.capability.available?'native':'browser-or-in-app'};
  }
  setPreferences(value:unknown){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid notification preferences');
    const p=value as Record<string,unknown>;
    for(const key of ['enabled','decision','complete','desktop'])if(typeof p[key]!=='boolean')throw new Error('Invalid notification preference: '+key);
    this.prefs={enabled:p.enabled as boolean,decision:p.decision as boolean,complete:p.complete as boolean,desktop:p.desktop as boolean};return this.preferences();
  }
  claim(key:string){if(this.claimed.has(key))return false;this.claimed.add(key);while(this.claimed.size>500)this.claimed.delete(this.claimed.values().next().value!);return true;}
  async test(){
    if(!this.prefs.enabled)throw new Error('Aktifkan notifikasi terlebih dahulu.');
    const capability=await this.status();if(!this.prefs.desktop||!capability.available)throw new Error(capability.reason||'Desktop notification tidak tersedia.');
    try{if(this.sender)await this.sender('Uji notifikasi','Notifikasi desktop lokal Kantor berfungsi.');else await exec('notify-send',['--app-name=Kantor','--urgency=normal','Uji notifikasi','Notifikasi desktop lokal Kantor berfungsi.'],{timeout:5000,windowsHide:true});}
    catch(e){this.failed=true;this.capability={...this.capability,available:false,reason:'Pengiriman gagal: '+((e as NodeJS.ErrnoException).code||'command error')};throw new Error(this.capability.reason);}
  }
  async onEvent(event:{id:number;taskId:string|null;type:string;data:any}){
    if(!event.taskId||!this.prefs.enabled||!this.prefs.desktop||!this.capability.available)return;
    let key='',title='',body='';const task=this.engine.store.task(event.taskId);
    if(event.type==='approval'&&this.prefs.decision){const a=event.data;if(!a||a.status!=='pending'||!a.id)return;key='approval:'+a.id;title=a.kind==='question'?'Pertanyaan baru':'Konfirmasi diperlukan';body=this.description(task);}
    if(event.type==='status'&&event.data?.status==='completed'&&this.prefs.complete){key='completed:'+task.id+':'+event.id;title='Tugas selesai';body=this.description(task);}
    if(!key||this.sent.has(key))return;this.sent.add(key);while(this.sent.size>500)this.sent.delete(this.sent.values().next().value!);
    try{if(this.sender)await this.sender(title,body);else await exec('notify-send',['--app-name=Kantor','--urgency=normal',title,body],{timeout:5000,windowsHide:true});}
    catch(e){this.failed=true;this.capability={...this.capability,available:false,reason:'Pengiriman gagal: '+((e as NodeJS.ErrnoException).code||'command error')};}
  }
  private description(task:Task){const root=task.parentId?this.engine.store.task(task.parentId).workspace:task.workspace;return `${root.split('/').filter(Boolean).at(-1)||root} · ${task.role||(task.kind==='pm'?'PM':'Agent')}`;}
}
