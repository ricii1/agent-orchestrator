import './style.css';
import {PixelOffice} from './office.js';
import {approvalView} from './approval.js';
import {renderMessage} from './format.js';
import {chatEntries,chatName,workerChats,chatOption} from './chat.js';
import type {FolderListing} from '../src/workspace.js';
import {freelancers,pmFor,archive,roleOf,shortPath,statusText,isWorking,type Task,type Settings,type Approval,type Schedule,type Event,type Usage,type ProviderQuota} from './model.js';

type State={tasks:Task[];settings:Settings;approvals:Approval[];schedules:Schedule[]};
const app=document.querySelector<HTMLDivElement>('#app')!;
let state:State;
let selectedChatId:string|null=null;
const completeHistory=new Set<string>(),expandedHistory=new Set<string>(),loadingHistory=new Set<string>();
let workspace=localStorage.getItem('office-workspace')||'';
let usage:Usage|null=null,usageLoading=false,connected=false,sending=false,cursor=0;
let chatFrame=0;
let refreshTimer:number|undefined,streamController:AbortController|undefined;
let refreshInFlight:Promise<void>|undefined,refreshAgain=false;
const eventCache=new Map<string,Event[]>();
const drafts=new Map<string,string>();
const office=new PixelOffice(id=>void showChat(id==='pm'?null:id).catch(notify));
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
function formatted(text:string,cls='message-text'){const node=el('div',cls);renderMessage(node,text);return node;}
function button(text:string,action:()=>unknown,cls=''){
  const b=el('button',cls,text);b.type='button';b.onclick=()=>void Promise.resolve().then(action).catch(notify);return b;
}
function notify(error:unknown){
  document.querySelector('.toast')?.remove();
  const box=el('div','toast',error instanceof Error?error.message:String(error));box.setAttribute('role','alert');
  document.body.append(box);setTimeout(()=>box.remove(),9000);
}
async function api(path:string,method='GET',body?:unknown){
  const response=await fetch('/api/'+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error||`Permintaan gagal (${response.status}).`);
  if(data===null)throw new Error('Respons API tidak valid. Pastikan backend dan UI memakai versi yang sama.');
  return data;
}
function pm(){return pmFor(state.tasks,workspace,state.settings.coordinatorProvider);}
function chatTask(){return selectedChatId?state.tasks.find(t=>t.id===selectedChatId&&t.workspace===workspace):pm();}
async function showChat(id:string|null){
  if(id&&!state.tasks.some(t=>t.id===id&&t.workspace===workspace))throw new Error('Percakapan tidak ditemukan di workspace ini.');
  selectedChatId=id===pm()?.id?null:id;render();const current=chatTask();if(current)await loadEvents(current.id);
  if(!selectedChatId)document.querySelector<HTMLTextAreaElement>('#pm-message')?.focus();
}
function badge(task:Task){return el('span','status '+task.status,statusText[task.status]);}
function rememberWorkspace(value:string){selectedChatId=null;workspace=value;localStorage.setItem('office-workspace',value);render();const current=pm();if(current)void loadEvents(current.id).catch(notify);}
function refresh():Promise<void>{
  if(refreshInFlight){refreshAgain=true;return refreshInFlight;}
  refreshInFlight=(async()=>{
    do{
      refreshAgain=false;
      const next:State=await api('state');
      if(JSON.stringify(next)!==JSON.stringify(state)){
        state=next;
        if(!state.settings.roots.includes(workspace))workspace=state.settings.roots[0]||'';
        if(selectedChatId&&!state.tasks.some(t=>t.id===selectedChatId&&t.workspace===workspace))selectedChatId=null;
        render();
      }
    }while(refreshAgain);
  })().finally(()=>{refreshInFlight=undefined;});
  return refreshInFlight;
}
function scheduleRefresh(){
  // Do not postpone an already scheduled refresh when more workers emit events.
  if(refreshTimer!==undefined)return;
  refreshTimer=window.setTimeout(()=>{refreshTimer=undefined;void refresh().catch(notify);},160);
}
async function refreshUsage(manual=false){
  if(usageLoading)return;usageLoading=true;renderUsage();
  try{usage=await api('usage'+(manual?'?refresh=1':''));}catch{if(manual)notify('Kuota belum dapat dimuat. Koneksi atau provider mungkin tidak tersedia.');}
  finally{usageLoading=false;renderUsage();}
}
function render(){
  const openApprovalPanels=[...app.querySelectorAll<HTMLDetailsElement>('[data-approval-panel][open]')].map(panel=>panel.dataset.approvalPanel);
  const approvalDrafts=[...app.querySelectorAll<HTMLTextAreaElement>('[data-approval]')].map(e=>({id:e.dataset.approval!,text:e.value,focused:e===document.activeElement}));
  const chatFocus=document.activeElement?.id==='pm-message';
  const oldChat=app.querySelector<HTMLElement>('#conversation'),chatKey=chatTask()?.id||'pm:'+workspace,sameChat=oldChat?.dataset.chatId===chatKey;
  const scroll=sameChat?oldChat!.scrollTop:0,atBottom=!sameChat||oldChat!.scrollHeight-oldChat!.scrollTop-oldChat!.clientHeight<100;
  const layout=el('div','layout'),sidebar=el('aside','sidebar');
  const brand=el('div','brand');brand.append(el('span','pixel-mark'),el('strong','','kantor'));sidebar.append(brand);
  const projectHeading=el('div','sidebar-heading'),addFolder=button('+',addWorkspace,'icon-button');addFolder.title='Pilih folder workspace';addFolder.setAttribute('aria-label','Pilih folder workspace');projectHeading.append(el('span','','Workspace'),addFolder);sidebar.append(projectHeading);
  const projects=el('nav','projects');projects.setAttribute('aria-label','Workspace');
  for(const path of state.settings.roots){const b=button(shortPath(path),()=>rememberWorkspace(path),'project'+(path===workspace?' selected':''));b.title=path;projects.append(b);}
  if(!state.settings.roots.length)projects.append(button('+ Pilih folder',addWorkspace,'project'));
  sidebar.append(projects);
  const account=el('section','accounts');account.id='account-usage';sidebar.append(account,button('Pengaturan',settingsDialog,'settings-button'));
  const main=el('main','main'),header=el('header','topbar'),heading=el('div');
  heading.append(el('h1','','Kantor'),el('span','workspace-path',workspace||'Belum ada workspace'));
  const controls=el('div','toolbar');controls.append(el('span','connection',connected?'Terhubung':'Menghubungkan…'),button('Riwayat',historyDialog,'quiet'));
  header.append(heading,controls);main.append(header);
  const stage=el('section','office-stage');stage.setAttribute('aria-label','Kantor freelancer');stage.append(office.canvas);
  const live=freelancers(state.tasks,workspace),current=pm();
  office.update([{id:'pm',name:'PM',provider:current?.provider||state.settings.coordinatorProvider,status:current&&isWorking(current.status)?current.status:'idle',pm:true},...live.map(t=>({id:t.id,name:roleOf(t),provider:t.provider,status:t.status}))]);
  const people=el('div','people');people.append(button('PM',()=>showChat(null),'person pm-person'));
  for(const task of live){const b=button('',()=>showChat(task.id),'person');b.append(el('span','person-dot '+task.provider),el('span','',roleOf(task)),badge(task));people.append(b);}
  if(!live.length)people.append(el('span','no-freelancers','Belum ada freelancer yang bekerja.'));
  stage.append(people);main.append(stage);
  const problemTasks=state.tasks.filter(t=>t.parentId&&t.workspace===workspace&&['failed','interrupted'].includes(t.status));
  if(problemTasks.length){const attention=el('div','attention');for(const t of problemTasks)attention.append(button(`${roleOf(t)} · ${statusText[t.status]}`,()=>openTask(t.id),'attention-link'));main.append(attention);}
  const note=el('footer','office-note');note.append(el('span','','Freelancer hadir saat dibutuhkan. Hasil pekerjaan tetap ada di riwayat.'));main.append(note);
  const viewed=chatTask(),logView=selectedChatId!==null;
  const chat=el('aside','chat-panel'),chatHeader=el('div','chat-header'),title=el('div','chat-title');
  const picker=el('div','chat-switcher'),chooser=el('details','chat-chooser'),summary=el('summary','',logView&&viewed?chatOption(viewed):'PM · '+state.settings.coordinatorProvider);
  summary.setAttribute('aria-label','Pilih chat agent');chooser.append(summary);
  const choices=el('div','chat-choices');choices.setAttribute('aria-label','Daftar chat agent');
  const addChoice=(id:string|null,label:string)=>{const option=button(label,()=>{chooser.open=false;return showChat(id);},'chat-choice');option.dataset.chatId=id||'';option.setAttribute('aria-pressed',String((selectedChatId||null)===id));choices.append(option);};
  addChoice(null,'PM · '+state.settings.coordinatorProvider);
  const workers=workerChats(state.tasks,workspace);
  for(const [label,active]of [['Sedang bekerja',true],['Riwayat freelancer',false]] as const){
    const tasks=workers.filter(t=>isWorking(t.status)===active);if(!tasks.length)continue;
    choices.append(el('p','chat-choice-heading',label));
    for(const task of tasks)addChoice(task.id,chatOption(task));
  }
  if(selectedChatId&&viewed&&!workers.some(t=>t.id===selectedChatId))addChoice(viewed.id,chatOption(viewed));
  chooser.append(choices);picker.append(el('span','','Percakapan'),chooser);title.append(picker,el('span','chat-provider',viewed?.provider||state.settings.coordinatorProvider));
  const chatControls=el('div','pm-controls');chatControls.append(el('span','pm-state',viewed?statusText[viewed.status]:'Siap'));
  if(viewed&&isWorking(viewed.status))chatControls.append(button('Hentikan',async()=>{await api('tasks/'+viewed.id+'/cancel','POST',{});await refresh();},'stop-pm'));
  chatHeader.append(title,chatControls);chat.append(chatHeader);
  const conversation=el('div','conversation');conversation.id='conversation';conversation.dataset.chatId=chatKey;conversation.setAttribute('aria-label','Percakapan '+(viewed?chatName(viewed):'PM'));chat.append(conversation);
  const approvals=el('div','chat-approvals');approvals.id='chat-approvals';chat.append(approvals);
  if(viewed&&['failed','interrupted','cancelled'].includes(viewed.status)){const error=el('div','inline-error');error.append(el('p','',viewed.error||'Sesi dihentikan. Riwayat tetap tersimpan.'),button('Lanjutkan '+chatName(viewed),async()=>{await api('tasks/'+viewed.id+'/resume','POST',{});await refresh();}));chat.append(error);}
  let composerInput:HTMLTextAreaElement|undefined;
  if(logView&&viewed){
    const footer=el('div','worker-chat-footer');footer.append(el('p','',`${chatName(viewed)} mengerjakan instruksi PM. Log diperbarui otomatis. Untuk memberi arahan, kembali ke PM.`));
    const actions=el('div','actions');actions.append(button('Chat PM',()=>showChat(null),'primary'),button('Detail pekerjaan',()=>openTask(viewed.id),'quiet'));footer.append(actions);chat.append(footer);
  }else{
    const composer=el('form','composer'),message=el('textarea');composerInput=message;message.id='pm-message';const pmStopped=!!current&&['failed','interrupted','cancelled'].includes(current.status);message.placeholder=pmStopped?'Lanjutkan PM untuk melanjutkan percakapan.':workspace?'Beri PM sebuah tujuan…':'Tambahkan folder proyek untuk memulai.';message.setAttribute('aria-label','Pesan untuk PM');message.rows=3;message.required=true;message.disabled=!workspace||pmStopped;message.value=drafts.get(workspace)||'';message.oninput=()=>drafts.set(workspace,message.value);
    const composerFooter=el('div','composer-footer');composerFooter.append(el('small','','Ctrl / ⌘ + Enter untuk kirim'));
    const submit=el('button','primary',sending?'Mengirim…':'Kirim');submit.type='submit';submit.disabled=!workspace||sending||pmStopped;composerFooter.append(submit);composer.append(message,composerFooter);
    composer.onsubmit=event=>{event.preventDefault();void sendMessage(message.value);};
    message.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();composer.requestSubmit();}};
    if(!workspace)composer.append(button('Pilih folder workspace',addWorkspace,'quiet'));
    chat.append(composer);
  }
  layout.append(sidebar,main,chat);app.replaceChildren(layout);
  renderUsage();renderChat(false);renderApprovals();
  const newChat=app.querySelector('#conversation');if(newChat)newChat.scrollTop=atBottom?newChat.scrollHeight:scroll;
  if(chatFocus)composerInput?.focus();
  for(const panel of app.querySelectorAll<HTMLDetailsElement>('[data-approval-panel]'))if(openApprovalPanels.includes(panel.dataset.approvalPanel))panel.open=true;
  for(const draft of approvalDrafts){const input=[...app.querySelectorAll<HTMLTextAreaElement>('[data-approval]')].find(e=>e.dataset.approval===draft.id);if(input){input.value=draft.text;input.dispatchEvent(new window.Event('input'));if(draft.text||draft.focused){const panel=input.closest('details');if(panel)panel.open=true;}if(draft.focused)input.focus();}}
}
function renderUsage(){
  const target=document.querySelector('#account-usage');if(!target)return;
  const heading=el('div','sidebar-heading');heading.append(el('span','','Kuota akun'));
  const reload=button(usageLoading?'…':'↻',()=>refreshUsage(true),'icon-button');reload.title='Perbarui kuota akun';reload.setAttribute('aria-label','Perbarui kuota akun');reload.disabled=usageLoading;heading.append(reload);target.replaceChildren(heading);
  for(const provider of ['claude','codex'] as const){
    const data:ProviderQuota|undefined=usage?.[provider],section=el('div','quota');
    section.append(el('strong','',provider==='claude'?'Claude':'Codex'));
    if(!data)section.append(el('small','muted',usageLoading?'Memuat kuota…':'Kuota belum tersedia.'));
    for(const w of data?.windows||[]){
      const row=el('div','quota-row'),label=el('div','quota-label');label.append(el('span','',w.label),el('span','',`${Math.round(w.usedPercent)}% terpakai`));
      const progress=el('progress',data?.status==='stale'?'stale':'');progress.max=100;progress.value=w.usedPercent;progress.setAttribute('aria-label',`${provider} ${w.label}: ${Math.round(w.usedPercent)}% terpakai`);
      row.append(label,progress);
      if(w.resetsAt)row.append(el('small','reset','Reset '+new Date(w.resetsAt).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})));
      section.append(row);
    }
    if(data?.note)section.append(el('small','quota-note',data.status==='stale'?'Data terakhir · '+data.note:data.note));
    if(data?.updatedAt)section.title='Diperbarui '+new Date(data.updatedAt).toLocaleString('id-ID');
    target.append(section);
  }
}
async function sendMessage(text:string){
  if(sending||!text.trim())return;sending=true;const target=workspace;render();
  try{
    const task:Task=await api('pm/messages','POST',{workspace:target,text});drafts.delete(target);
    await refresh();await loadEvents(task.id);
  }catch(error){notify(error);}finally{sending=false;render();}
}
function cacheEvent(event:Event){
  if(!event.taskId)return;
  const events=eventCache.get(event.taskId)||[];
  // The SSE stream replays from its cursor; a fetched transcript may already be newer.
  if(events.length&&event.id<=events[events.length-1].id)return;
  if(event.type==='message')for(let i=events.length-1;i>=0;i--)if(events[i].type==='text')events.splice(i,1);
  const last=events.at(-1);
  if(event.type==='text'&&last?.type==='text'){last.data={text:((last.data as any).text+(event.data as any).text).slice(-24000)};last.id=event.id;}
  else events.push(event);
  if(events.length>300&&!expandedHistory.has(event.taskId)){completeHistory.delete(event.taskId);eventCache.set(event.taskId,events.slice(-300));}
  else eventCache.set(event.taskId,events);
}
function renderChat(follow=true){
  const target=document.querySelector('#conversation');if(!target)return;
  const nearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100;
  const open=new Set([...target.querySelectorAll<HTMLDetailsElement>('details[open]')].map(e=>e.dataset.event));
  const current=chatTask(),events=current?eventCache.get(current.id)||[]:[];
  target.replaceChildren();
  if(current&&events.length&&!completeHistory.has(current.id)){const older=button(loadingHistory.has(current.id)?'Memuat…':'Muat pesan sebelumnya',loadOlder,'load-older');older.disabled=loadingHistory.has(current.id);target.append(older);}
  const entries=current?chatEntries(current,events):[];
  for(const entry of entries){
    if(entry.kind==='activity'){
      const item=el('details','chat-activity');item.dataset.event=String(entry.id);item.open=open.has(String(entry.id));
      const summary=el('summary','',entry.text);item.append(summary);
      if(entry.detail)item.append(el('pre','',entry.detail));
      target.append(item);continue;
    }
    const instruction=current?.parentId?entry.speaker==='PM'||entry.speaker==='Instruksi kerja':entry.speaker==='Kamu';
    const bubble=el('article','bubble '+(instruction?'user':'assistant'));
    const label=el('div','message-label');label.append(el('small','',entry.speaker));
    const date=new Date(entry.createdAt);if(Number.isFinite(date.getTime())){const time=el('time','',date.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}));time.dateTime=date.toISOString();label.append(time);}
    bubble.append(label,formatted(entry.text));target.append(bubble);
  }
  if(!entries.length){const empty=el('div','chat-empty');empty.append(el('span','mini-pm',selectedChatId&&current?chatName(current):'PM'),el('p','',selectedChatId?'Belum ada respons dari worker.':'Ceritakan pekerjaan yang ingin diselesaikan.'),el('small','',selectedChatId?'Aktivitas akan muncul saat worker berjalan.':'PM akan memanggil freelancer saat diperlukan.'));target.append(empty);}
  if(current&&isWorking(current.status))target.append(el('div','thinking',`${chatName(current)} ${current.status==='waiting'?'sedang menunggu jawaban atau hasil.':current.status==='queued'?'sedang mengantre…':'sedang bekerja…'}`));
  if(follow&&nearBottom)target.scrollTop=target.scrollHeight;
}
function approvalCard(approval:Approval){
  const card=el('section','approval'),task=state.tasks.find(t=>t.id===approval.taskId),view=approvalView(approval);
  card.dataset.approvalId=approval.id;
  const actor=task&&!task.parentId?'PM':task?roleOf(task):'Freelancer';
  const heading=el('div','approval-heading');heading.append(el('span','approval-icon',view.question?'?':'›'),el('strong','',view.title));
  card.append(heading,el('small','approval-requester',actor+(task?' · '+(task.provider==='codex'?'Codex':'Claude'):'')));
  if(view.reason)card.append(formatted(view.reason,'approval-reason'));
  if(view.question)card.append(formatted(view.question,'approval-question'));
  if(view.target)card.append(el('code','approval-target',view.target));
  if(view.command){
    const terminal=el('div','approval-terminal');
    terminal.append(el('div','terminal-label','Terminal'),el('pre','approval-command',view.command));card.append(terminal);
  }
  if(view.location){const location=el('div','approval-folder');location.append(el('span','','Folder'),el('code','',view.location));card.append(location);}
  if(view.preview)card.append(el('pre','approval-preview',view.preview));
  const answer=el('textarea');answer.rows=2;answer.dataset.approval=approval.id;answer.setAttribute('aria-label',view.answer==='optional'?'Catatan untuk '+actor:'Jawaban untuk '+actor);
  answer.placeholder=view.answer==='required'?'Tulis jawabanmu…':view.answer==='json'?'Jawaban dalam format JSON':'Catatan opsional…';
  let notes:HTMLDetailsElement|undefined;
  if(view.answer==='required'||view.answer==='json'){
    if(view.options.length){const choices=el('div','approval-options');for(const option of view.options){const choice=button('',()=>{answer.value=option.label;answer.dispatchEvent(new window.Event('input'));answer.focus();},'approval-option');choice.append(el('strong','',option.label));if(option.description)choice.append(el('small','',option.description));choices.append(choice);}card.append(choices);}
    card.append(answer);
  }else if(view.canApprove&&view.answer==='optional'){
    notes=el('details','approval-notes');notes.dataset.approvalPanel='notes-'+approval.id;notes.append(el('summary','','Tambahkan catatan'),answer);
  }
  const technical=el('details','approval-technical');technical.dataset.approvalPanel='technical-'+approval.id;
  technical.append(el('summary','','Detail teknis'),el('pre','',JSON.stringify(approval.details,null,2)));
  const actions=el('div','actions approval-actions');let busy=false;
  const allow=button(view.allowLabel,()=>respond(true),'primary'),deny=button(view.denyLabel,()=>respond(false),'quiet');
  const update=()=>{allow.disabled=busy||!view.canApprove||(['required','json'].includes(view.answer)&&!answer.value.trim());deny.disabled=busy;};
  const respond=async(approved:boolean)=>{
    if(busy)return;
    if(approved&&view.answer==='json'){try{JSON.parse(answer.value);}catch{notify('Jawaban harus berupa JSON yang valid.');return;}}
    busy=true;update();
    try{await api('approvals','POST',{id:approval.id,approved,answer:approved&&view.answer==='none'?'{}':answer.value});await refresh();}finally{busy=false;update();}
  };
  answer.oninput=update;
  if(view.canApprove)actions.append(allow);
  actions.append(deny);card.append(actions);
  if(view.canApprove&&['none','optional'].includes(view.answer))card.append(el('small','approval-scope','Berlaku untuk permintaan ini saja.'));
  if(notes)card.append(notes);card.append(technical);
  update();return card;
}
function renderApprovals(){const target=document.querySelector('#chat-approvals');if(!target)return;target.replaceChildren();for(const a of state.approvals.filter(a=>a.status==='pending'&&state.tasks.some(t=>t.id===a.taskId&&t.workspace===workspace)))target.append(approvalCard(a));}
async function loadEvents(id:string){
  const events:Event[]=await api('tasks/'+id+'/events?tail=1');
  if(events.length<300)completeHistory.add(id);else completeHistory.delete(id);
  const lastMessage=Math.max(0,...events.filter(e=>e.type==='message').map(e=>e.id));
  const cached=(eventCache.get(id)||[]).filter(e=>e.type!=='text'||e.id>lastMessage);
  const merged=[...new Map([...events,...cached].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
  eventCache.set(id,expandedHistory.has(id)?merged:merged.slice(-300));renderChat();
}
async function loadOlder(){
  const current=chatTask();if(!current||loadingHistory.has(current.id))return;
  const id=current.id,events=eventCache.get(id)||[],first=events.find(e=>e.type!=='text');if(!first)return;
  const old=document.querySelector('#conversation'),height=old?.scrollHeight||0,top=old?.scrollTop||0;
  loadingHistory.add(id);renderChat(false);
  try{
    const older:Event[]=await api('tasks/'+id+'/events?before='+first.id);
    if(older.length<300)completeHistory.add(id);
    expandedHistory.add(id);
    const merged=new Map([...older,...(eventCache.get(id)||[])].map(e=>[e.id,e]));
    eventCache.set(id,[...merged.values()].sort((a,b)=>a.id-b.id));
  }finally{loadingHistory.delete(id);if(chatTask()?.id===id){renderChat(false);const next=document.querySelector('#conversation');if(next)next.scrollTop=top+next.scrollHeight-height;}}
}
async function stream(signal:AbortSignal){
  while(!signal.aborted){
    try{
      const response=await fetch('/api/events?after='+cursor,{signal});
      if(!response.ok||!response.body)throw new Error('Stream tidak tersedia');
      connected=true;updateConnection();scheduleRefresh();
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
      for(;;){
        const part=await reader.read();if(part.done)break;
        pending+=decoder.decode(part.value,{stream:true});let end;
        while((end=pending.indexOf('\n\n'))!==-1){
          const frame=pending.slice(0,end);pending=pending.slice(end+2);
          const data=frame.split('\n').find(line=>line.startsWith('data: '));if(!data)continue;
          const event:Event=JSON.parse(data.slice(6));if(event.id<=cursor)continue;cursor=event.id;cacheEvent(event);
          if(event.taskId===chatTask()?.id&&!chatFrame)chatFrame=requestAnimationFrame(()=>{chatFrame=0;renderChat();});
          if(['status','created','approval','approval_resolved','settings','schedule_updated','schedule_deleted','result','merge'].includes(event.type)){
            scheduleRefresh();
          }
        }
      }
    }catch{if(signal.aborted)return;}
    connected=false;updateConnection();await new Promise(r=>setTimeout(r,1500));
  }
}
function updateConnection(){const target=document.querySelector('.connection');if(target)target.textContent=connected?'Terhubung':'Menghubungkan…';}
function dialog(title:string){const d=el('dialog'),header=el('div','dialog-header');header.append(el('h2','',title),button('Tutup',()=>d.close(),'quiet'));d.append(header);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();return d;}
function field(label:string,value='',multiline=false){const l=el('label','',label),input=multiline?el('textarea'):el('input');input.value=value;l.append(input);return{label:l,input};}
function select(label:string,values:string[],value:string){const l=el('label','',label),input=el('select');for(const v of values){const option=el('option','',v);option.value=v;input.append(option);}input.value=value;l.append(input);return{label:l,input};}
function pickFolder(initial=workspace):Promise<string|null>{
  return new Promise(resolve=>{
    const d=dialog('Pilih folder workspace');d.classList.add('folder-picker');
    const navigation=el('div','folder-navigation'),up=button('↑ Naik',()=>browse(listing?.parent||undefined),'quiet'),home=button('Home',()=>browse(listing?.home),'quiet');
    const location=el('form','folder-location'),path=el('input'),go=el('button','quiet','Buka');
    path.setAttribute('aria-label','Lokasi folder');path.autocomplete='off';go.type='submit';location.append(path,go);
    const hiddenLabel=el('label','folder-hidden'),hidden=el('input');hidden.type='checkbox';hiddenLabel.append(hidden,el('span','','Tampilkan folder tersembunyi'));
    const error=el('p','folder-error'),list=el('div','folder-list');list.setAttribute('aria-label','Daftar subfolder');list.setAttribute('role','group');error.setAttribute('role','alert');
    const footer=el('div','folder-footer'),selected=el('span','path'),choose=button('Gunakan folder ini',()=>{if(ready&&listing){resolve(listing.path);d.close();}},'primary');
    footer.append(selected,choose);navigation.append(up,home);d.append(navigation,location,hiddenLabel,error,list,footer);
    let listing:FolderListing|undefined,ready=false,request=0;
    async function browse(target?:string){
      const id=++request;ready=false;choose.disabled=true;up.disabled=true;home.disabled=true;go.disabled=true;error.textContent='';list.replaceChildren(el('p','muted','Memuat folder…'));
      try{
        const next:FolderListing=await api('folders','POST',{...(target?{path:target}:{}),hidden:hidden.checked});
        if(!d.isConnected||id!==request)return;
        listing=next;path.value=next.path;selected.textContent=next.path;list.replaceChildren();
        for(const folder of next.directories){const row=button('',()=>browse(folder.path),'folder-row');row.append(el('span','folder-symbol','▸'),el('span','',folder.name));list.append(row);}
        if(!next.directories.length)list.append(el('p','empty','Tidak ada subfolder. Folder ini tetap bisa dipilih.'));
        ready=true;choose.disabled=false;
      }catch(e){if(d.isConnected&&id===request){list.replaceChildren();error.textContent=e instanceof Error?e.message:String(e);}}
      finally{if(d.isConnected&&id===request){up.disabled=!listing?.parent;home.disabled=false;go.disabled=false;}}
    }
    location.onsubmit=event=>{event.preventDefault();void browse(path.value.trim()||undefined);};
    hidden.onchange=()=>void browse(listing?.path);
    d.addEventListener('close',()=>resolve(null),{once:true});
    void browse(initial||undefined);
  });
}
async function addWorkspace(){
  const path=await pickFolder();if(!path)return;
  if(!state.settings.roots.includes(path))await api('settings','PUT',{...state.settings,roots:[...state.settings.roots,path]});
  await refresh();rememberWorkspace(path);
}
function settingsDialog(){
  const d=dialog('Pengaturan'),form=el('form'),s=state.settings;
  const roots=field('Folder workspace · satu path lengkap per baris',s.roots.join('\n'),true),coordinator=select('Provider PM',['codex','claude'],s.coordinatorProvider),worker=select('Default freelancer',['codex','claude'],s.workerProvider);
  const browse=button('Pilih folder…',async()=>{
    const path=await pickFolder();if(!path)return;
    roots.input.value=[...new Set([...roots.input.value.split('\n').map(p=>p.trim()).filter(Boolean),path])].join('\n');
  },'quiet browse-folder');
  form.append(roots.label,browse,coordinator.label,worker.label);
  const advanced=el('details'),summary=el('summary','','Pengaturan lanjutan');advanced.append(summary);
  const limit=field('Freelancer bersamaan',String(s.maxWorkers)),claude=field('Model Claude · kosong untuk default',s.claudeModel),codex=field('Model Codex · kosong untuk default',s.codexModel);
  limit.input.setAttribute('type','number');limit.input.setAttribute('min','1');limit.input.setAttribute('max','10');
  advanced.append(limit.label,claude.label,codex.label,el('p','muted','PM menyimpan percakapan per workspace dan provider. Pekerjaan lama tidak dihapus saat provider diganti.'));
  form.append(advanced);const save=el('button','primary','Simpan');save.type='submit';form.append(save);
  form.onsubmit=async event=>{event.preventDefault();try{await api('settings','PUT',{roots:roots.input.value.split('\n').map(p=>p.trim()).filter(Boolean),coordinatorProvider:coordinator.input.value,workerProvider:worker.input.value,maxWorkers:Number(limit.input.value),claudeModel:claude.input.value,codexModel:codex.input.value});d.close();await refresh();const current=pm();if(current)await loadEvents(current.id);}catch(error){notify(error);}};
  d.append(form,button('Jadwal pekerjaan',scheduleList,'quiet settings-extra'));
}
function historyDialog(){
  const d=dialog('Riwayat pekerjaan'),tasks=archive(state.tasks,workspace);
  if(!tasks.length)d.append(el('p','empty','Belum ada pekerjaan selesai. Freelancer yang selesai akan tercatat di sini.'));
  for(const task of tasks){const row=button('',()=>{d.close();return showChat(task.id);},'history-row'),text=el('div');text.append(el('strong','',task.title),el('small','',`${task.role||task.provider} · ${new Date(task.updatedAt).toLocaleString('id-ID')}`));row.append(text,badge(task));d.append(row);}
}
async function openTask(id:string){
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  const d=dialog(task.role||task.title),meta=el('div','task-meta');meta.append(el('span','',task.provider),badge(task));d.append(meta,el('p','task-title',task.prompt),el('p','path',task.executionPath||task.workspace));
  for(const a of state.approvals.filter(a=>a.taskId===id&&a.status==='pending'))d.append(approvalCard(a));
  if(task.result)d.append(el('h3','','Hasil'),formatted(task.result,'result message-text'));
  if(task.error)d.append(el('p','inline-error',task.error));
  const actions=el('div','actions');actions.append(button('Buka chat / log',()=>{d.close();return showChat(task.id);},'quiet'));
  if(isWorking(task.status))actions.append(button('Hentikan',async()=>{await api('tasks/'+id+'/cancel','POST',{});d.close();await refresh();},'danger'));
  else if(['failed','interrupted','cancelled'].includes(task.status))actions.append(button('Lanjutkan',async()=>{await api('tasks/'+id+'/resume','POST',{});d.close();await refresh();},'quiet'));
  if(task.branch)actions.append(button('Tinjau perubahan',()=>diffDialog(task),'quiet'));d.append(actions);
  const activity=el('details');activity.append(el('summary','','Aktivitas teknis'));
  const events:Event[]=await api('tasks/'+id+'/events?tail=1');
  for(const event of events.filter(e=>['tool','tool_output','tool_result','log','provider_error','permission_denied'].includes(e.type)))activity.append(el('pre','activity',JSON.stringify(event.data,null,2)));
  d.append(activity);
}
async function diffDialog(task:Task){
  const data=await api('tasks/'+task.id+'/diff'),d=dialog('Tinjau perubahan');d.append(el('p','path',task.branch||''),el('pre','result',data.diff||'Tidak ada perubahan file terlacak.'));
  for(const preview of data.previews||[])d.append(el('h3','',preview.path),el('pre','result',preview.content));
  if(data.untracked)d.append(el('p','path','File baru:\n'+data.untracked));
  if(task.status==='completed')d.append(button('Gabungkan ke checkout',async()=>{if(!confirm('Setujui commit perubahan worker dan gabungkan ke checkout utama? Merge akhir tetap perlu kamu review dan commit.'))return;const result=await api('tasks/'+task.id+'/merge','POST',{confirm:true});d.close();notify(result.message);},'primary'));
}
function scheduleList(){
  const d=dialog('Jadwal pekerjaan');d.append(button('Tambah jadwal',()=>scheduleDialog(),'primary'));
  for(const s of state.schedules){const row=el('div','schedule-row');row.append(el('strong','',s.title),el('p','path',`${s.cron} · ${s.timezone}`));const actions=el('div','actions');actions.append(button(s.enabled?'Jeda':'Aktifkan',async()=>{await api('schedules','POST',{...s,enabled:!s.enabled});await refresh();d.close();scheduleList();},'quiet'),button('Ubah',()=>scheduleDialog(s),'quiet'),button('Hapus',async()=>{if(confirm('Hapus jadwal ini?')){await api('schedules/'+s.id,'DELETE');await refresh();d.close();scheduleList();}},'danger'));row.append(actions);d.append(row);}
}
function scheduleDialog(s?:Schedule){
  if(!state.settings.roots.length){notify('Tambahkan workspace terlebih dahulu.');return;}
  const d=dialog(s?'Ubah jadwal':'Tambah jadwal'),form=el('form'),title=field('Nama',s?.title),prompt=field('Instruksi',s?.prompt,true),cron=field('Cron · menit jam tanggal bulan hari',s?.cron||'0 9 * * 1-5'),timezone=field('Zona waktu',s?.timezone||'Asia/Jakarta'),folder=select('Workspace',state.settings.roots,s?.workspace||workspace),provider=select('Provider',['codex','claude'],s?.provider||state.settings.coordinatorProvider);
  form.append(title.label,prompt.label,cron.label,timezone.label,folder.label,provider.label);const save=el('button','primary','Simpan jadwal');save.type='submit';form.append(save);
  form.onsubmit=async event=>{event.preventDefault();try{await api('schedules','POST',{id:s?.id,title:title.input.value,prompt:prompt.input.value,cron:cron.input.value,timezone:timezone.input.value,workspace:folder.input.value,provider:provider.input.value,model:s?.model||'',enabled:s?.enabled??true});d.close();await refresh();}catch(error){notify(error);}};d.append(form);
}
async function start(){await refresh();const current=pm();if(current)await loadEvents(current.id);streamController=new AbortController();void stream(streamController.signal);void refreshUsage();}
setInterval(()=>{if(!document.hidden)void refreshUsage();},60000);
setInterval(()=>{if(state&&!document.hidden)void refresh().catch(()=>{});},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state)void refresh().catch(notify);void refreshUsage();}});
window.addEventListener('online',()=>{if(state)void refresh().catch(notify);});
void start().catch(error=>{const box=el('section','startup-error');box.append(el('h1','','Kantor belum dapat dibuka'),el('p','',error instanceof Error?error.message:String(error)),button('Coba lagi',()=>location.reload(),'primary'));app.replaceChildren(box);});
