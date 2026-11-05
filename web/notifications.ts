import type {Approval,Task} from './model.js';

export type NoticeKind='decision'|'complete';
export type NoticeTarget={workspace:string;taskId:string;approvalId?:string};
export type NoticeState={tasks:Task[];approvals:Approval[];statusVersions?:Record<string,number>};
type Preferences={enabled:boolean;decision:boolean;complete:boolean;desktop:boolean};
const prefKey='kantor-notifications-v1';
const defaults:Preferences={enabled:false,decision:true,complete:true,desktop:true};
let seenDb:Promise<IDBDatabase>|undefined;
function database(){return seenDb??=new Promise((resolve,reject)=>{if(!('indexedDB'in window)){reject(new Error('IndexedDB unavailable'));return;}const request=indexedDB.open('kantor-notification-dedupe',1);request.onupgradeneeded=()=>request.result.createObjectStore('seen',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function claim(key:string){
  try{const db=await database();return await new Promise<boolean>((resolve,reject)=>{const tx=db.transaction('seen','readwrite'),store=tx.objectStore('seen');let claimed=false;const get=store.get(key);get.onsuccess=()=>{if(get.result)return;claimed=true;store.put({key,at:Date.now()});const all=store.getAll();all.onsuccess=()=>{const rows=all.result.sort((a:any,b:any)=>a.at-b.at);for(const old of rows.slice(0,Math.max(0,rows.length-200)))store.delete(old.key);};};tx.oncomplete=()=>resolve(claimed);tx.onerror=()=>reject(tx.error);});}catch{return false;}
}
export class Notifications {
  private prefs:Preferences;
  private previous?:NoticeState;
  private originalTitle=document.title;
  private nativeAvailable=false;
  private syncQueue:Promise<void>=Promise.resolve();
  constructor(private navigate:(target:NoticeTarget)=>void){
    try{this.prefs={...defaults,...JSON.parse(localStorage.getItem(prefKey)||'{}')};}catch{this.prefs={...defaults};}
    window.addEventListener('storage',e=>{if(e.key===prefKey){this.readPrefs();void this.syncBackend();}});
    window.addEventListener('focus',()=>{document.title=this.originalTitle;});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)document.title=this.originalTitle;});
    void this.syncBackend();
  }
  private readPrefs(){try{this.prefs={...defaults,...JSON.parse(localStorage.getItem(prefKey)||'{}')};}catch{}}
  private save(){localStorage.setItem(prefKey,JSON.stringify(this.prefs));void this.syncBackend();}
  private syncBackend(){const snapshot={...this.prefs};this.syncQueue=this.syncQueue.then(async()=>{const r=await fetch('/api/notifications',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)});if(!r.ok)throw new Error('Notification settings sync failed');}).catch(()=>{});return this.syncQueue;}
  private status(){if(!('Notification'in window))return 'Browser tidak mendukung notifikasi desktop. Badge dan pesan tab tetap tersedia.';if(!window.isSecureContext)return 'Origin ini bukan secure context; notifikasi desktop browser tidak tersedia. Badge dan pesan tab tetap tersedia.';return `Izin browser: ${Notification.permission}.`}
  private async emit(key:string,title:string,body:string,target:NoticeTarget,forceDesktop=false){
    const send=async()=>{
      let claimedByServer=false;try{const r=await fetch('/api/notifications/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});if(r.ok){if(!(await r.json()).claimed)return;claimedByServer=true;}}
      catch{/* The IndexedDB transaction below is the offline fallback. */}
      if(!claimedByServer&&!await claim(key))return;
      document.title='• '+this.originalTitle;
      const toast=document.createElement('button');toast.className='toast kantor-notice';toast.type='button';toast.textContent=`${title} · ${body} — Buka konteks`;toast.setAttribute('aria-label',`${title}. ${body}. Buka konteks.`);toast.onclick=()=>this.navigate(target);document.body.append(toast);setTimeout(()=>toast.remove(),12000);
      if(this.prefs.desktop&&!this.nativeAvailable&&'Notification'in window&&window.isSecureContext&&Notification.permission==='granted'&&(document.hidden||forceDesktop)){try{const n=new Notification(title,{body,tag:key});n.onclick=()=>{window.focus();this.navigate(target);n.close();};}catch{/* In-app notice remains available. */}}
    };
    if(navigator.locks)await navigator.locks.request('kantor-notice:'+key,send);else await send();
  }
  observe(next:NoticeState){
    const prev=this.previous;this.previous=next;
    if(!this.prefs.enabled)return;
    if(prev){
      for(const a of next.approvals){if(a.status!=='pending'||prev.approvals.some(p=>p.id===a.id))continue;if(!this.prefs.decision)continue;const t=next.tasks.find(x=>x.id===a.taskId);if(t){const parent=t.parentId?next.tasks.find(x=>x.id===t.parentId):undefined,root=parent?.workspace||t.workspace;void this.emit('approval:'+a.id,a.kind==='question'?'Pertanyaan baru':'Konfirmasi diperlukan',`${root.split('/').filter(Boolean).at(-1)||root} · ${t.role||(t.kind==='pm'?'PM':'Agent')}`,{workspace:root,taskId:t.id,approvalId:a.id});}}
      for(const t of next.tasks){const p=prev.tasks.find(x=>x.id===t.id),version=next.statusVersions?.[t.id]??t.updatedAt,oldVersion=prev.statusVersions?.[t.id]??p?.updatedAt;if((!p||p.status!=='completed'||version!==oldVersion)&&t.status==='completed'&&this.prefs.complete){const parent=t.parentId?next.tasks.find(x=>x.id===t.parentId):undefined,root=parent?.workspace||t.workspace;void this.emit('completed:'+t.id+':'+version,'Tugas selesai',`${root.split('/').filter(Boolean).at(-1)||root} · ${t.role||(t.kind==='pm'?'PM':'Agent')}`,{workspace:root,taskId:t.id});}}
    }
  }
  settingsPanel():HTMLElement{
    const panel=document.createElement('section');panel.className='notification-settings';panel.setAttribute('aria-label','Notifikasi');
    const heading=document.createElement('h3');heading.textContent='Notifikasi';panel.append(heading);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Memeriksa capability desktop…';panel.append(status);
    const native=document.createElement('p');native.setAttribute('role','status');native.textContent='Notifikasi daemon berlaku global untuk browser yang memakai daemon ini.';panel.append(native);
    void this.syncBackend().then(()=>fetch('/api/notifications')).then(r=>r.json()).then(data=>{this.nativeAvailable=!!data.capability?.available;status.textContent=this.status();native.textContent=`Daemon: ${data.capability?.available?'notify-send tersedia':data.capability?.reason||'tidak tersedia'}. Native desktop tidak menyediakan aksi klik; buka tab Kantor untuk konteks.`;}).catch(()=>{status.textContent=this.status();native.textContent='Status daemon tidak dapat diperiksa.';});
    const check=(label:string,key:keyof Preferences)=>{const l=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.checked=!!this.prefs[key];i.onchange=()=>{(this.prefs[key] as boolean)=i.checked;this.save();void this.syncBackend().then(()=>fetch('/api/notifications')).then(r=>r.json()).then(d=>{this.nativeAvailable=!!d.capability?.available;native.textContent=`Daemon: ${d.capability?.available?'notify-send tersedia':d.capability?.reason||'tidak tersedia'}. Native desktop tidak menyediakan aksi klik; buka tab Kantor untuk konteks.`;}).catch(()=>native.textContent='Preferensi browser tersimpan; daemon tidak menerima pengaturan.');};l.append(i,document.createTextNode(' '+label));panel.append(l);};
    check('Aktifkan notifikasi','enabled');check('Pertanyaan dan konfirmasi','decision');check('Tugas selesai','complete');check('Desktop browser bila tersedia','desktop');
    const test=document.createElement('button');test.type='button';test.textContent='Uji notifikasi';test.onclick=async()=>{if(!this.prefs.enabled){status.textContent='Aktifkan notifikasi terlebih dahulu.';return;}try{const r=await fetch('/api/notifications/test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!r.ok){const data=await r.json().catch(()=>null);throw new Error(data?.error||'Desktop daemon tidak tersedia.');}status.textContent='Uji notifikasi desktop berhasil dikirim.';return;}catch(e){status.textContent=e instanceof Error?e.message:'Desktop tidak tersedia; uji fallback browser.';this.nativeAvailable=false;void this.emit('test:'+Date.now(),'Uji notifikasi','Fallback lokal · Kantor',{workspace:'',taskId:''},true);}};panel.append(test);
    const grant=document.createElement('button');grant.type='button';grant.textContent='Minta izin browser';grant.onclick=async()=>{if(!('Notification'in window)){status.textContent=this.status();return;}if(!window.isSecureContext){status.textContent=this.status();return;}try{await Notification.requestPermission();status.textContent=this.status();}catch{status.textContent='Permintaan izin gagal. '+this.status();}};panel.append(grant);
    return panel;
  }
  navigateTo(target:NoticeTarget){this.navigate(target);}
}
