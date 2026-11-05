import type {TerminalPanel} from './terminal.js';
import {approvalChoices,type ApprovalChoice} from '../src/approval-options.js';
import './style.css';
import './review.css';
import './office-view.css';
import {PixelOffice} from './office.js';
import {approvalView,formExample} from './approval.js';
import {renderMessage} from './format.js';
import {chatEntries,chatName,workerChats,chatOption} from './chat.js';
import {mergeTranscriptEvent} from './transcript-cache.js';
import type {FolderListing} from '../src/workspace.js';
import {workspaceAgents,pmDraftKey,pmHistory,freelancers,pmFor,archive,inWorkspace,roleOf,shortPath,statusText,isWorking,needsReview,reviewReason,reviewTasks,type Task,type Settings,type Approval,type Schedule,type Event,type Usage,type ProviderQuota} from './model.js';

type TerminalSummary={id:string;workspace:string;exitCode:number|null};
type State={terminals?:TerminalSummary[];capabilities?:{permissionModes?:boolean};tasks:Task[];settings:Settings;approvals:Approval[];schedules:Schedule[]};
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
const taskCursors=new Map<string,number>();
let streamGeneration=0,catchupInFlight=new Set<string>();
let streamRun:Promise<void>|undefined;
const drafts=new Map<string,string>();
const agents=()=>workspaceAgents(state.settings,workspace);
const draftKey=()=>pmDraftKey(workspace,state.settings);
const transcriptLoading=new Set<string>(),transcriptErrors=new Map<string,string>();
const approvalState=new Map<string,{answer:string;error:string;busy:boolean}>();
const sendErrors=new Map<string,string>();
let officeOpen=false,officeExpanded=localStorage.getItem('office-expanded')==='true',accountOpen=false,usageError='',usageRefreshed=0;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
function feedback(message:string){const p=el('p','inline-error',message);p.setAttribute('role','alert');return p;}
function persistentAction(container:HTMLElement,action:()=>Promise<unknown>){let busy=false;return async()=>{if(busy)return;busy=true;const trigger=document.activeElement instanceof HTMLButtonElement?document.activeElement:null;const disabled=trigger?.disabled;if(trigger)trigger.disabled=true;container.setAttribute('aria-busy','true');container.querySelector(':scope > .action-error')?.remove();try{await action();}catch(e){const p=feedback(errorText(e));p.classList.add('action-error');container.append(p);}finally{busy=false;container.removeAttribute('aria-busy');if(trigger)trigger.disabled=disabled||false;}};}
const terminals=new Map<string,TerminalPanel>();
async function openTerminal(command?:string,session?:TerminalSummary){
  if(!workspace)throw new Error('Pilih workspace terlebih dahulu.');
  const target=session?.workspace||workspace;
  let panel=session?[...terminals.values()].find(p=>p.sessionId===session.id):terminals.get(target);
  if(!panel||!panel.node.isConnected){const {TerminalPanel}=await import('./terminal.js');panel=new TerminalPanel(target,api,notify,session?.id);terminals.set(session?.id||target,panel);}
  await panel.show(command);void refresh().catch(notify);
}
async function compactChat(){const task=chatTask();if(!task)throw new Error('Mulai percakapan terlebih dahulu.');await api('tasks/'+task.id+'/compact','POST',{});await refresh();await loadEvents(task.id);}
const office=new PixelOffice(id=>void showChat(id==='pm'?null:id).catch(notify));
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
function formatted(text:string,cls='message-text'){const node=el('div',cls);renderMessage(node,text,workspace);return node;}
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
  if(!response.ok)throw Object.assign(new Error(data?.error||`Permintaan gagal (${response.status}).`),{status:response.status});
  if(data===null)throw new Error('Respons API tidak valid. Pastikan backend dan UI memakai versi yang sama.');
  return data;
}
function pm(){return pmFor(state.tasks,workspace,agents().coordinatorProvider,agents());}
function chatTask(){return selectedChatId?state.tasks.find(t=>t.id===selectedChatId&&inWorkspace(t,workspace,state.tasks)):pm();}
async function showChat(id:string|null){
  if(id&&!state.tasks.some(t=>t.id===id&&inWorkspace(t,workspace,state.tasks)))throw new Error('Percakapan tidak ditemukan di workspace ini.');
  selectedChatId=id===pm()?.id?null:id;render();const current=chatTask();if(current){await loadEvents(current.id);void catchupTask(current.id);}
  if(!selectedChatId)document.querySelector<HTMLTextAreaElement>('#pm-message')?.focus();
}
function badge(task:Task){return el('span','status '+task.status,statusText[task.status]);}
function rememberWorkspace(value:string){selectedChatId=null;workspace=value;localStorage.setItem('office-workspace',value);render();const current=pm();if(current){void loadEvents(current.id).then(()=>catchupTask(current.id)).catch(notify);}}
function refresh():Promise<void>{
  if(refreshInFlight){refreshAgain=true;return refreshInFlight;}
  refreshInFlight=(async()=>{
    do{
      refreshAgain=false;
      const next:State=await api('state');
      if(JSON.stringify(next)!==JSON.stringify(state)){
        state=next;
        if(!state.settings.roots.includes(workspace))workspace=state.settings.roots[0]||'';
        if(selectedChatId&&!state.tasks.some(t=>t.id===selectedChatId&&inWorkspace(t,workspace,state.tasks)))selectedChatId=null;
        render();for(const d of document.querySelectorAll<HTMLDialogElement>('.review-dialog'))(d as HTMLDialogElement&{refreshReview?:()=>void}).refreshReview?.();
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
  const restoreFocus=document.querySelector('#account-usage')?.contains(document.activeElement);if(usageLoading)return;if(manual&&Date.now()-usageRefreshed<15000){usageError='Refresh manual tersedia setiap 15 detik.';renderUsage();return;}if(manual)usageRefreshed=Date.now();usageLoading=true;usageError='';renderUsage();
  try{usage=await api('usage'+(manual?'?refresh=1':''));}catch{usageError='Kuota belum dapat dimuat. Data terakhir mungkin tertinggal. Coba refresh kembali.';}
  finally{usageLoading=false;renderUsage();if(restoreFocus)document.querySelector<HTMLElement>('#account-usage button')?.focus({preventScroll:true});}
}
function render(){
  const active=document.activeElement as HTMLElement|null;
  const focusKey=active&&app.contains(active)?active.dataset.focusKey:undefined;
  const selection=active instanceof HTMLTextAreaElement?[active.selectionStart,active.selectionEnd]:undefined;
  const openDetails=[...app.querySelectorAll<HTMLDetailsElement>('details[open][data-detail-key]')].map(e=>e.dataset.detailKey);

  const openApprovalPanels=[...app.querySelectorAll<HTMLDetailsElement>('[data-approval-panel][open]')].map(panel=>panel.dataset.approvalPanel);
  const approvalDrafts=[...app.querySelectorAll<HTMLTextAreaElement>('[data-approval]')].map(e=>({id:e.dataset.approval!,text:e.value,start:e.selectionStart,end:e.selectionEnd,focused:e===document.activeElement}));
  const chatFocus=document.activeElement?.id==='pm-message';
  const oldChat=app.querySelector<HTMLElement>('#conversation'),chatKey=chatTask()?.id||'pm:'+draftKey(),sameChat=oldChat?.dataset.chatId===chatKey;
  const scroll=sameChat?oldChat!.scrollTop:0,atBottom=!sameChat||oldChat!.scrollHeight-oldChat!.scrollTop-oldChat!.clientHeight<100;
  const layout=el('div','layout'),sidebar=el('aside','sidebar');layout.classList.toggle('office-expanded-layout',officeExpanded);
  const brand=el('div','brand');brand.append(el('span','pixel-mark'),el('strong','','kantor'));sidebar.append(brand);
  const projectHeading=el('div','sidebar-heading'),addFolder=button('+',addWorkspace,'icon-button');addFolder.title='Pilih folder workspace';addFolder.setAttribute('aria-label','Pilih folder workspace');projectHeading.append(el('span','','Workspace'),addFolder);sidebar.append(projectHeading);
  const projects=el('nav','projects');projects.setAttribute('aria-label','Workspace');
  for(const path of state.settings.roots){const b=button('',()=>rememberWorkspace(path),'project'+(path===workspace?' selected':''));b.append(el('strong','',shortPath(path)),el('small','path',path));b.title=path;projects.append(b);}
  if(!state.settings.roots.length)projects.append(button('+ Pilih folder',addWorkspace,'project'));
  sidebar.append(projects);
  const account=el('section','accounts');account.id='account-usage';sidebar.append(account,button('Pengaturan',settingsDialog,'settings-button'));sidebar.classList.toggle('mobile-open',accountOpen);
  const main=el('main','main'),header=el('header','topbar'),heading=el('div');
  heading.append(el('h1','',shortPath(workspace)||'Kantor'),el('span','workspace-path',workspace||'Belum ada workspace'));
  const controls=el('div','toolbar');controls.append(el('span','connection',connected?'Terhubung':'Menghubungkan kembali · status mungkin tertinggal'),button(officeExpanded?'Kembali ke percakapan':'Kantor besar',()=>setOfficeExpanded(!officeExpanded),'office-mode-toggle quiet'),button('Agent workspace',workspaceAgentsDialog,'quiet'),button('Riwayat',historyDialog,'quiet'),button('Terminal'+(state.terminals?' · '+state.terminals.filter(t=>t.exitCode===null).length:''),terminalList,'quiet'),button('Workspace & akun',()=>{accountOpen=!accountOpen;render();},'account-toggle quiet'),button('Pengaturan',settingsDialog,'mobile-settings quiet'));
  const officeModeButton=controls.querySelector<HTMLButtonElement>('.office-mode-toggle')!;officeModeButton.dataset.focusKey='office-mode-toggle';officeModeButton.setAttribute('aria-pressed',String(officeExpanded));
  const reviewCount=reviewTasks(state.tasks,workspace).length;if(reviewCount){const reviewButton=button('⚠ Perlu ditinjau · '+reviewCount,()=>historyDialog(true),'review-cta');reviewButton.setAttribute('aria-label',`${reviewCount} tugas perlu ditinjau di workspace ini`);controls.append(reviewButton);}controls.querySelector('.connection')?.setAttribute('role','status');if(workspace)heading.append(button('Salin path',async()=>{try{await navigator.clipboard.writeText(workspace);}catch{const range=document.createRange();range.selectNodeContents(heading.querySelector('.workspace-path')!);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}},'copy-path quiet'));header.append(heading,controls);
  const guide=el('details','head-guide');guide.dataset.detailKey='head-guide';guide.open=!pm();guide.append(el('summary','','Freelancer Git mulai dari commit terakhir'),el('p','','Perubahan lokal yang belum di-commit tidak ikut. Git baru memerlukan initial commit. Folder non-Git yang tumpang tindih dikerjakan bergantian. Ini panduan statis, bukan pemeriksaan HEAD atau perubahan lokal.'));
  main.append(guide);
  const stage=el('section','office-stage office-view-stage');stage.setAttribute('aria-label','Kantor freelancer');stage.append(office.canvas);
  const live=freelancers(state.tasks,workspace),current=pm();
  office.update([{id:'pm',name:'PM',provider:current?.provider||agents().coordinatorProvider,status:current&&isWorking(current.status)?current.status:'idle',pm:true},...live.map(t=>({id:t.id,name:roleOf(t),provider:t.provider,status:t.status}))]);
  const people=el('div','people');people.append(button('PM',()=>showChat(null),'person pm-person'));
  for(const task of live){const b=button('',()=>showChat(task.id),'person');b.append(el('span','person-dot '+task.provider),el('span','',roleOf(task)),badge(task));people.append(b);}
  if(!live.length)people.append(el('span','no-freelancers','Belum ada freelancer yang bekerja.'));
  const fold=button(officeOpen?'Lipat kantor':'Lihat kantor',()=>{officeOpen=!officeOpen;render();},'office-toggle quiet');fold.setAttribute('aria-expanded',String(officeOpen));fold.setAttribute('aria-controls','office-canvas');office.canvas.id='office-canvas';stage.classList.toggle('office-open',officeOpen);stage.prepend(fold);stage.append(people);main.append(stage);
  const problemTasks=reviewTasks(state.tasks,workspace);
  if(problemTasks.length){const attention=el('div','attention');for(const t of problemTasks){const link=button('',()=>openTask(t.id),'review-attention');link.append(el('span','review-icon','⚠'),el('span','review-copy',`${roleOf(t)} · ${statusText[t.status]} · ${t.provider}`),el('small','review-why',reviewReason(t)));attention.append(link);}main.append(attention);}
  const note=el('footer','office-note');note.append(el('span','','Freelancer hadir saat dibutuhkan. Hasil pekerjaan tetap ada di riwayat.'));main.append(note);
  const viewed=chatTask(),logView=selectedChatId!==null;
  const chat=el('aside','chat-panel'),chatHeader=el('div','chat-header'),title=el('div','chat-title');
  const picker=el('div','chat-switcher'),chooser=el('details','chat-chooser'),summary=el('summary','',logView&&viewed?chatOption(viewed):'PM · '+agents().coordinatorProvider);
  summary.setAttribute('aria-label','Pilih chat agent');chooser.append(summary);
  const choices=el('div','chat-choices');choices.setAttribute('aria-label','Daftar chat agent');
  const addChoice=(id:string|null,label:string)=>{const option=button(label,()=>{chooser.open=false;return showChat(id);},'chat-choice');option.dataset.chatId=id||'';option.setAttribute('aria-pressed',String((selectedChatId||null)===id));choices.append(option);};
  addChoice(null,'PM · '+agents().coordinatorProvider);
  const oldPMs=pmHistory(state.tasks,workspace).filter(task=>task.id!==current?.id);
  if(oldPMs.length){choices.append(el('p','chat-choice-heading','Sesi PM lain · provider/model terpisah'));for(const task of oldPMs)addChoice(task.id,`PM · ${task.provider} · ${task.model||'model default'} · ${statusText[task.status]} · ${task.id.slice(0,8)}`);}
  const workers=workerChats(state.tasks,workspace);
  for(const [label,active]of [['Sedang bekerja',true],['Riwayat freelancer',false]] as const){
    const tasks=workers.filter(t=>isWorking(t.status)===active);if(!tasks.length)continue;
    choices.append(el('p','chat-choice-heading',label));
    for(const task of tasks)addChoice(task.id,chatOption(task));
  }
  if(selectedChatId&&viewed&&!workers.some(t=>t.id===selectedChatId)&&!oldPMs.some(t=>t.id===selectedChatId))addChoice(viewed.id,chatOption(viewed));
  chooser.append(choices);picker.append(el('span','','Percakapan'),chooser);title.append(picker,el('span','chat-provider',viewed?.provider||agents().coordinatorProvider));
  const chatControls=el('div','pm-controls');chatControls.append(el('span','pm-state',viewed?statusText[viewed.status]:'Siap'));
  if(viewed&&isWorking(viewed.status))chatControls.append(button(viewed.parentId?'Hentikan freelancer':'Hentikan PM + anak',persistentAction(chat,async()=>{if(!viewed.parentId&&!confirm('Hentikan PM dan semua freelancer anak yang masih aktif?'))return;await api('tasks/'+viewed.id+'/cancel','POST',{});await refresh();}),'stop-pm'));
  const compactButton=button('/compact',persistentAction(chat,compactChat),'stop-pm');compactButton.title='Ringkas konteks sesi agent';compactButton.disabled=!viewed?.sessionId||!!viewed&&['running','queued'].includes(viewed.status);chatControls.append(compactButton);
  const pendingCount=state.approvals.filter(a=>a.status==='pending'&&state.tasks.some(t=>t.id===a.taskId&&inWorkspace(t,workspace,state.tasks))).length;if(pendingCount)chatControls.append(button('Lihat '+pendingCount+' permintaan',()=>{const panel=document.querySelector<HTMLElement>('#chat-approvals');if(panel){panel.scrollTop=0;panel.focus();panel.scrollIntoView({block:'nearest'});}},'quiet'));chatHeader.append(title,chatControls);chat.append(chatHeader);
  const conversation=el('div','conversation');conversation.tabIndex=0;conversation.id='conversation';conversation.dataset.chatId=chatKey;conversation.setAttribute('aria-label','Percakapan '+(viewed?chatName(viewed):'PM'));chat.append(conversation);
  const approvals=el('div','chat-approvals');approvals.id='chat-approvals';approvals.tabIndex=0;approvals.setAttribute('aria-label','Permintaan keputusan workspace');chat.append(approvals);
  if(viewed&&['failed','interrupted','cancelled'].includes(viewed.status)){const error=feedback(viewed.error||(viewed.status==='interrupted'?'Sesi terputus. Tinjau aktivitas dan perubahan sebelum melanjutkan.':'Tugas dihentikan. Riwayat tetap tersimpan.'));error.append(button('Tinjau lalu lanjutkan',()=>openTask(viewed.id),'quiet'));chat.append(error);}
  let composerInput:HTMLTextAreaElement|undefined;
  if(logView&&viewed){
    const footer=el('div','worker-chat-footer');footer.append(el('p','',viewed.kind==='pm'?'Sesi PM tersimpan. Log diperbarui otomatis. Kembali ke PM aktif untuk mengirim pesan.':`${chatName(viewed)} mengerjakan instruksi PM. Log diperbarui otomatis. Untuk memberi arahan, kembali ke PM.`));
    const actions=el('div','actions');actions.append(button('Kembali ke PM',()=>showChat(null),'primary'),button('Detail pekerjaan',()=>openTask(viewed.id),'quiet'));footer.append(actions);chat.append(footer);
  }else{
    const composer=el('form','composer'),message=el('textarea');composerInput=message;message.id='pm-message';const pmStopped=!!current&&['failed','interrupted','cancelled'].includes(current.status);message.placeholder=pmStopped?'Lanjutkan PM untuk melanjutkan percakapan.':workspace?'Beri PM sebuah tujuan…':'Tambahkan folder proyek untuk memulai.';message.setAttribute('aria-label','Pesan untuk PM');message.rows=3;message.required=true;message.disabled=!workspace||pmStopped;message.value=drafts.get(draftKey())||'';message.oninput=()=>drafts.set(draftKey(),message.value);
    composer.append(el('small','composer-context',`${workspace||'Pilih workspace'} · PM ${agents().coordinatorProvider} · ${agents().coordinatorProvider==='claude'?agents().claudeModel||'model default':agents().codexModel||'model default'}`));if(workspace&&!current)composer.append(el('small','','Freelancer Git mulai dari commit terakhir; perubahan lokal yang belum di-commit tidak ikut. Git baru memerlukan initial commit.'));
    const composerFooter=el('div','composer-footer');composerFooter.append(el('small','','Enter kirim · Shift+Enter baris baru · !perintah langsung ke shell, bukan pesan PM'));
    const submit=el('button','primary',sending?'Mengirim…':'Kirim');submit.type='submit';submit.disabled=!workspace||sending||pmStopped;composerFooter.append(submit);composer.append(message,composerFooter,button('Bantuan perintah',()=>sendMessage('/help'),'quiet'));if(sendErrors.has(draftKey()))composer.append(feedback(sendErrors.get(draftKey())!));
    composer.onsubmit=event=>{event.preventDefault();void sendMessage(message.value);};
    message.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!event.repeat)composer.requestSubmit();}};
    if(!workspace)composer.append(button('Pilih folder workspace',addWorkspace,'quiet'));
    chat.append(composer);
  }
  layout.append(sidebar,header,chat,main);app.replaceChildren(layout);
  renderUsage();renderChat(false);renderApprovals();
  const newChat=app.querySelector('#conversation');if(newChat)newChat.scrollTop=atBottom?newChat.scrollHeight:scroll;
  for(const detail of app.querySelectorAll<HTMLDetailsElement>('[data-detail-key]'))if(openDetails.includes(detail.dataset.detailKey))detail.open=true;
  for(const [index,control] of [...app.querySelectorAll<HTMLElement>('button,summary,textarea,input,select,[tabindex]')].entries())if(!control.dataset.focusKey)control.dataset.focusKey=(control.closest('[data-approval-id]')?.getAttribute('data-approval-id')||'shell')+':'+control.tagName+':'+(control.getAttribute('aria-label')||control.textContent||String(index));
  if(focusKey){const next=[...app.querySelectorAll<HTMLElement>('[data-focus-key]')].find(e=>e.dataset.focusKey===focusKey);next?.focus({preventScroll:true});if(next instanceof HTMLTextAreaElement&&selection)next.setSelectionRange(selection[0],selection[1]);}
  else if(chatFocus)composerInput?.focus({preventScroll:true});

  for(const panel of app.querySelectorAll<HTMLDetailsElement>('[data-approval-panel]'))if(openApprovalPanels.includes(panel.dataset.approvalPanel))panel.open=true;
  for(const card of document.querySelectorAll<HTMLElement>('dialog [data-approval-id]'))if(!state.approvals.some(a=>a.id===card.dataset.approvalId&&a.status==='pending')){for(const control of card.querySelectorAll<HTMLButtonElement|HTMLTextAreaElement>('button,textarea'))control.disabled=true;if(!card.querySelector('.resolved-status'))card.append(el('p','resolved-status','Permintaan sudah diputuskan atau kedaluwarsa.'));}
  for(const draft of approvalDrafts){const input=[...app.querySelectorAll<HTMLTextAreaElement>('[data-approval]')].find(e=>e.dataset.approval===draft.id);if(input){if(input.value||draft.focused){const panel=input.closest('details');if(panel)panel.open=true;}if(draft.focused){input.focus({preventScroll:true});input.setSelectionRange(draft.start,draft.end);}}}
}
function setOfficeExpanded(expanded:boolean){const pageScroll=window.scrollY;officeExpanded=expanded;officeOpen=expanded;localStorage.setItem('office-expanded',String(expanded));render();window.scrollTo(0,pageScroll);}
function renderUsage(){
  const target=document.querySelector('#account-usage');if(!target)return;
  const heading=el('div','sidebar-heading');heading.append(el('span','','Penggunaan seluruh akun'));
  const reload=button(usageLoading?'…':'↻',()=>refreshUsage(true),'icon-button');reload.title='Perbarui kuota akun';reload.setAttribute('aria-label','Perbarui kuota akun');reload.disabled=usageLoading;heading.append(reload);target.replaceChildren(heading);if(usageLoading){const status=el('small','','Memuat penggunaan…');status.setAttribute('role','status');target.append(status);}if(usageError)target.append(feedback(usageError));
  for(const provider of ['claude','codex'] as const){
    const data:ProviderQuota|undefined=usage?.[provider],section=el('div','quota');
    section.append(el('strong','',provider==='claude'?'Claude':'Codex'));
    if(!data)section.append(el('small','muted',usageLoading?'Memuat kuota…':'Kuota belum tersedia.'));
    for(const w of data?.windows||[]){
      const row=el('div','quota-row'),label=el('div','quota-label');label.append(el('span','',w.label),el('span','',`${Math.round(w.usedPercent)}% terpakai`));
      const progress=el('progress',data?.status==='stale'?'stale':'');progress.max=100;progress.value=w.usedPercent;progress.setAttribute('aria-label',`${provider} ${w.label}: ${Math.round(w.usedPercent)}% terpakai`);
      row.append(label,progress);
      if(w.resetsAt)row.append(el('small','reset','Reset '+new Date(w.resetsAt).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})));
      section.append(row);
    }
    if(data?.note)section.append(el('small','quota-note',data.status==='stale'?'Data terakhir · '+data.note:data.note));
    if(data?.status==='stale')section.append(el('small','','Data terakhir · kedaluwarsa'));if(data?.updatedAt)section.append(el('small','', 'Diperbarui '+new Date(data.updatedAt).toLocaleString('id-ID',{timeZoneName:'short'})));
    target.append(section);
  }
}
async function sendMessage(text:string){
  if(sending||!text.trim())return;sending=true;const target=workspace,key=draftKey(),expectedAgents=agents();sendErrors.delete(key);render();
  try{
    const input=text.trim();
    if(input.startsWith('!')){if(!input.slice(1).trim())throw new Error('Tulis perintah setelah !, misalnya !git status');await openTerminal(input.slice(1).trim());drafts.delete(key);return;}
    if(input==='/compact'){await compactChat();drafts.delete(key);return;}
    if(input==='/terminal'){await openTerminal();drafts.delete(key);return;}
    if(input==='/help'){const d=dialog('Perintah chat');d.append(el('p','path','/compact — ringkas konteks agent yang dipilih\n/terminal — buka shell interaktif laptop\n!perintah — jalankan di terminal, bukan melalui PM\n/help — daftar perintah\n\nTerminal mendukung shell, input password, Ctrl+C, dan program interaktif. Perintah slash lain belum dipetakan di chat; gunakan CLI aslinya di terminal untuk antarmuka lengkap. Output terminal tidak otomatis masuk konteks PM.'));if(drafts.get(key)?.trim()===input)drafts.delete(key);return;}
    if(input.startsWith('/'))throw new Error('Perintah belum didukung di chat ini. Ketik /help atau gunakan CLI aslinya di Terminal.');
    const task:Task=await api('pm/messages','POST',{workspace:target,text,expectedAgents});drafts.delete(key);
    await refresh();await loadEvents(task.id);
  }catch(error){sendErrors.set(key,errorText(error)+' Periksa riwayat sebelum mengirim ulang bila hasil pengiriman belum pasti.');}finally{sending=false;render();}
}
function cacheEvent(event:Event){
  if(!event.taskId)return;
  const previous=eventCache.get(event.taskId)||[],next=mergeTranscriptEvent(previous,event,expandedHistory.has(event.taskId));
  if(previous.length>=300&&next.length>=300&&next[0].id>previous[0].id&&!expandedHistory.has(event.taskId))completeHistory.delete(event.taskId);
  eventCache.set(event.taskId,next);
}
function renderChat(follow=true){
  const target=document.querySelector('#conversation');if(!target)return;
  const focusOlder=document.activeElement?.classList.contains('load-older');
  const oldTop=target.scrollTop,focusedEvent=(document.activeElement?.closest('[data-event]') as HTMLElement|null)?.dataset.event;
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
  if(current&&transcriptLoading.has(current.id))target.append(el('p','transcript-status','Memuat percakapan…'));
  if(current&&transcriptErrors.has(current.id)){const error=feedback(transcriptErrors.get(current.id)!);error.append(button('Coba lagi',()=>loadEvents(current.id),'quiet'));target.append(error);}
  if(!entries.length&&!(current&&(transcriptLoading.has(current.id)||transcriptErrors.has(current.id)))){const empty=el('div','chat-empty');empty.append(el('span','mini-pm',selectedChatId&&current?chatName(current):'PM'),el('p','',selectedChatId?'Belum ada respons dari worker.':'Ceritakan pekerjaan yang ingin diselesaikan.'),el('small','',selectedChatId?'Aktivitas akan muncul saat worker berjalan.':'PM akan memanggil freelancer saat diperlukan.'));target.append(empty);}
  if(current&&isWorking(current.status)){
    const approvals=state.approvals.filter(a=>a.status==='pending'&&(a.taskId===current.id||state.tasks.some(t=>t.id===a.taskId&&t.parentId===current.id)));
    const actors=[...new Set(approvals.map(a=>{const task=state.tasks.find(t=>t.id===a.taskId);return task?chatName(task):'Agent';}))];
    const waiting=actors.length?`menunggu jawaban atau izin untuk ${actors.join(', ')}. Lihat permintaan di bawah.`:'sedang menunggu hasil worker.';
    target.append(el('div','thinking',`${chatName(current)} ${current.status==='waiting'?waiting:current.status==='queued'?'sedang mengantre…':'sedang bekerja…'}`));
  }
  if(follow&&nearBottom)target.scrollTop=target.scrollHeight;
  else{target.scrollTop=oldTop;if(focusedEvent)[...target.querySelectorAll<HTMLElement>('details[data-event]')].find(e=>e.dataset.event===focusedEvent)?.querySelector('summary')?.focus({preventScroll:true});}
  if(focusOlder)(target.querySelector<HTMLButtonElement>('.load-older:not(:disabled)')||target as HTMLElement).focus({preventScroll:true});
  if(follow&&!nearBottom&&events.length){const newer=button('Pesan baru',()=>{target.scrollTop=target.scrollHeight;newer.remove();},'new-messages');target.append(newer);}

}
function approvalCard(approval:Approval){
  const card=el('section','approval'),task=state.tasks.find(t=>t.id===approval.taskId),view=approvalView(approval);
  card.dataset.approvalId=approval.id;
  const saved=approvalState.get(approval.id)||{answer:'',error:'',busy:false};approvalState.set(approval.id,saved);

  const actor=task&&!task.parentId?'PM':task?roleOf(task):'Freelancer';
  const heading=el('div','approval-heading');heading.append(el('span','approval-icon',view.question?'?':'›'),el('strong','',view.title));
  card.append(heading,button('Permintaan dari '+actor+(task?' · '+task.provider+' · '+task.title+' · '+task.id.slice(0,8):' · tugas tidak tersedia'),()=>openTask(approval.taskId),'approval-requester quiet'),el('small','path','Workspace: '+workspace));
  if(view.command&&!view.location)card.append(el('small','','Folder permintaan tidak disediakan provider.'));

  if(view.reason)card.append(formatted(view.reason,'approval-reason'));
  if(view.question)card.append(formatted(view.question,'approval-question'));
  if(view.target){if(/^https?:\/\//i.test(view.target)){const link=el('a','approval-target',view.target);link.href=view.target;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}else card.append(el('code','approval-target',view.target));}
  if(view.command){
    const terminal=el('div','approval-terminal');
    terminal.append(el('div','terminal-label','Terminal'),el('pre','approval-command',view.command));card.append(terminal);
  }
  if(view.location){const location=el('div','approval-folder');location.append(el('span','','Folder'),el('code','',view.location));card.append(location);}
  if(view.preview)card.append(el('pre','approval-preview',view.preview));
  const answer=el('textarea');answer.rows=2;answer.dataset.approval=approval.id;answer.setAttribute('aria-label',view.answer==='optional'?'Catatan untuk '+actor:'Jawaban untuk '+actor);
  answer.placeholder=view.answer==='required'?'Tulis jawabanmu…':view.answer==='json'?'Jawaban dalam format JSON':'Catatan opsional…';
  answer.value=saved.answer;if(saved.error.startsWith('JSON belum valid'))answer.setAttribute('aria-invalid','true');
  let notes:HTMLDetailsElement|undefined;
  if(view.answer==='json'){const example=formExample((approval.details as {requestedSchema?:unknown})?.requestedSchema);if(example!==undefined){const preview=el('details');preview.append(el('summary','','Contoh format dari schema · isi jawaban sendiri'),el('pre','',JSON.stringify(example,null,2)));card.append(preview);}}
  if(view.answer==='required'||view.answer==='json'){
    if(view.options.length){const choices=el('div','approval-options');for(const option of view.options){const choice=button('',()=>{answer.value=option.label;answer.dispatchEvent(new window.Event('input'));answer.focus();},'approval-option');choice.append(el('strong','',option.label));if(option.description)choice.append(el('small','',option.description));choices.append(choice);}card.append(choices);}
    card.append(answer);
  }else if(view.canApprove&&view.answer==='optional'){
    notes=el('details','approval-notes');notes.dataset.approvalPanel='notes-'+approval.id;notes.append(el('summary','','Tambahkan catatan'),answer);
  }
  const technical=el('details','approval-technical');technical.dataset.approvalPanel='technical-'+approval.id;
  technical.append(el('summary','','Detail teknis'),el('pre','',JSON.stringify(approval.details,null,2)));
  const actions=el('div','actions approval-actions'),error=feedback(saved.error);error.hidden=!saved.error;card.append(error);let busy=saved.busy;
  const choices=approvalChoices(approval.kind,approval.details),choiceButtons:{button:HTMLButtonElement;choice:ApprovalChoice}[]=[];
  const allow=button(view.allowLabel,()=>respond(true),'primary'),deny=button(view.denyLabel,()=>respond(false),'quiet');
  const update=()=>{allow.disabled=busy||!view.canApprove||(['required','json'].includes(view.answer)&&!answer.value.trim());deny.disabled=busy;answer.disabled=busy;for(const option of card.querySelectorAll<HTMLButtonElement>('.approval-option'))option.disabled=busy;for(const item of choiceButtons)item.button.disabled=busy||(item.choice.approved&&(['required','json'].includes(view.answer)&&!answer.value.trim()));};
  const respond=async(approved:boolean,choice?:string)=>{
    if(busy)return;
    if(approved&&view.answer==='json'){try{JSON.parse(answer.value);}catch{saved.error='JSON belum valid. Periksa tanda kutip dan koma.';error.textContent=saved.error;error.hidden=false;answer.setAttribute('aria-invalid','true');answer.focus();return;}}
    busy=true;saved.busy=true;saved.error='';error.hidden=true;update();
    try{await api('approvals','POST',{id:approval.id,approved,answer:approved&&view.answer==='none'?'{}':answer.value,...(choice?{choice}:{})});await refresh();}catch(e){saved.error=errorText(e);error.textContent=saved.error;error.hidden=false;await refresh().catch(()=>{});}finally{busy=false;saved.busy=false;update();render();}
  };
  answer.oninput=()=>{saved.answer=answer.value;if(saved.error.startsWith('JSON belum valid')){try{JSON.parse(answer.value);answer.removeAttribute('aria-invalid');}catch{answer.setAttribute('aria-invalid','true');}}update();};
  if(choices.length){
    actions.classList.add('provider-choices');
    for(const choice of choices){
      const b=button(choice.label,()=>respond(choice.approved,choice.id),choice.id.endsWith(':0')||choice.id==='claude:once'?'primary':'quiet');
      b.dataset.approvalChoice=choice.id;choiceButtons.push({button:b,choice});
      const row=el('div','approval-choice');row.append(b);
      if(choice.detail)row.append(el('small','approval-choice-detail',choice.detail));
      actions.append(row);
    }
  }else{if(view.canApprove)actions.append(allow);actions.append(deny);}
  card.append(actions);
  if(!choices.length&&view.canApprove&&['none','optional'].includes(view.answer))card.append(el('small','approval-scope','Berlaku untuk permintaan ini saja.'));
  if(notes)card.append(notes);card.append(technical);
  update();return card;
}
function renderApprovals(){
  const target=document.querySelector('#chat-approvals');if(!target)return;target.replaceChildren();
  const pending=state.approvals.filter(a=>a.status==='pending'&&state.tasks.some(t=>t.id===a.taskId&&inWorkspace(t,workspace,state.tasks)));
  if(pending.length){const heading=el('h3','decision-count',`${pending.length} permintaan di workspace ini`);target.append(heading);}
  for(const [label,question] of [['Pertanyaan',true],['Izin tindakan & konfirmasi',false]] as const){const group=pending.filter(a=>(a.kind==='question')===question);if(!group.length)continue;target.append(el('p','decision-group',label));for(const a of group)target.append(approvalCard(a));}
}
async function loadEvents(id:string){
  transcriptLoading.add(id);transcriptErrors.delete(id);renderChat(false);
  try{const events:Event[]=await api('tasks/'+id+'/events?tail=1');
  if(events.length<300)completeHistory.add(id);else completeHistory.delete(id);
  let merged=eventCache.get(id)||[];for(const event of events)merged=mergeTranscriptEvent(merged,event,expandedHistory.has(id));
  eventCache.set(id,merged);}catch(e){transcriptErrors.set(id,errorText(e));}finally{transcriptLoading.delete(id);if(chatTask()?.id===id)renderChat(false);}
}
async function catchupTask(id:string){
  if(catchupInFlight.has(id)||document.hidden)return;catchupInFlight.add(id);
  try{
    let after=taskCursors.get(id);
    if(after===undefined){const sync:{after:number}=await api('tasks/'+id+'/events?sync=1');after=Math.max(0,sync.after-1);taskCursors.set(id,after);}
    for(;;){const batch:Event[]=await api('tasks/'+id+'/events?after='+after);if(!batch.length)break;for(const event of batch)cacheEvent(event);after=batch.at(-1)!.id;taskCursors.set(id,after);if(batch.length<500)break;}
  }catch{}finally{catchupInFlight.delete(id);if(chatTask()?.id===id)renderChat(false);}
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
    let next:Event[]=[];for(const event of [...merged.values()].sort((a,b)=>a.id-b.id))next=mergeTranscriptEvent(next,event,true);eventCache.set(id,next);
  }catch(e){transcriptErrors.set(id,errorText(e));}finally{loadingHistory.delete(id);if(chatTask()?.id===id){renderChat(false);const next=document.querySelector('#conversation');if(next)next.scrollTop=top+next.scrollHeight-height;}}
}
async function stream(signal:AbortSignal){
  const generation=++streamGeneration;
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
          if(['status','created','approval','approval_resolved','settings','schedule_updated','schedule_deleted','result','merge','command_started','command_result'].includes(event.type)){
            scheduleRefresh();
          }
        }
      }
    }catch{if(signal.aborted||generation!==streamGeneration)return;}
    if(signal.aborted||generation!==streamGeneration)return;
    connected=false;updateConnection();await new Promise(r=>setTimeout(r,1500));
    const current=chatTask();if(current)await catchupTask(current.id);
  }
}
function startStream(){
  streamController?.abort();const controller=new AbortController();streamController=controller;
  const previous=streamRun;
  streamRun=(async()=>{await previous;if(!controller.signal.aborted)await stream(controller.signal);})();
}
function updateConnection(){const target=document.querySelector('.connection');if(target){target.setAttribute('role','status');target.textContent=connected?'Terhubung':'Menghubungkan kembali · status mungkin tertinggal';}}
let dialogSequence=0;
function dialog(title:string){const trigger=document.activeElement as HTMLElement|null,d=el('dialog'),header=el('div','dialog-header'),heading=el('h2','',title);heading.id='dialog-'+(++dialogSequence);heading.tabIndex=-1;d.setAttribute('aria-labelledby',heading.id);header.append(heading,button('Tutup',()=>d.close(),'quiet'));d.append(header);document.body.append(d);d.addEventListener('close',()=>{d.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});else document.querySelector<HTMLElement>('.topbar button')?.focus({preventScroll:true});},{once:true});d.showModal();heading.focus();return d;}
function terminalList(){const d=dialog('Terminal workspace');d.append(el('p','','Sembunyikan panel tidak menghentikan shell. Setiap terminal memakai workspace saat sesi dibuat.'),button('Buka terminal workspace ini',()=>{d.close();return openTerminal();},'primary'));if(!state.terminals)d.append(el('p','','Backend tidak menyediakan ringkasan; hanya sesi yang diketahui tab ini tersedia.'));for(const session of state.terminals||[...terminals.values()].filter(p=>p.sessionId&&p.node.isConnected).map(p=>({id:p.sessionId,workspace:p.context,exitCode:null}))){d.append(button(`${session.workspace} · ${session.exitCode===null?'Aktif / mungkin tersembunyi':'Berakhir'} · ${session.id.slice(0,8)}`,()=>{d.close();return openTerminal(undefined,session);},'history-row'));}}

function field(label:string,value='',multiline=false){const l=el('label','',label),input=multiline?el('textarea'):el('input');input.value=value;input.setAttribute('aria-label',label);l.append(input);return{label:l,input};}
function select(label:string,values:string[],value:string){const l=el('label','',label),input=el('select');for(const v of values){const option=el('option','',v);option.value=v;input.append(option);}input.value=value;input.setAttribute('aria-label',label);l.append(input);return{label:l,input};}
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
  const save=async()=>{const result=await api('workspaces','POST',{workspace:path});await refresh();rememberWorkspace(result.workspace);};
  try{await save();}catch(e){const d=dialog('Workspace belum ditambahkan');d.append(el('p','path',path),feedback(errorText(e)),button('Coba simpan workspace lagi',persistentAction(d,async()=>{await save();d.close();}),'primary'));}
}
async function saveSettings(input:unknown){
  const result=await api('settings','PUT',input);
  const expected=(input as any).permissions;
  if(expected&&(['claude','codex'] as const).some(p=>(result.permissions?.[p]||'manual')!==(expected[p]||'manual'))||expected&&!result.permissions)throw new Error('Backend belum menyimpan mode izin. Pembaruan perlu dilakukan pemilik saat pekerjaan idle.');
  return result;
}
function workspaceAgentsDialog(){
  if(!workspace)throw new Error('Pilih workspace terlebih dahulu.');
  const target=workspace,d=dialog('Agent workspace · '+shortPath(target)),form=el('form','settings-section');
  let expected=workspaceAgents(state.settings,target);
  const coordinator=select('Provider PM workspace',['codex','claude'],expected.coordinatorProvider),worker=select('Default freelancer workspace',['codex','claude'],expected.workerProvider);
  const claude=field('Model Claude workspace · kosong untuk default',expected.claudeModel),codex=field('Model Codex workspace · kosong untuk default',expected.codexModel);
  const status=el('p','section-status');status.setAttribute('role','status');
  const save=el('button','primary','Simpan agent workspace');save.type='submit';
  form.append(el('p','path',target),el('p','','Hanya workspace ini. Workspace lain dapat terus berjalan. Perubahan provider/model/default membuka sesi PM terpisah; sesi lama ada di pilihan chat dan Riwayat. Selesaikan PM dan freelancer workspace ini sebelum mengubah konfigurasi.'),coordinator.label,worker.label,claude.label,codex.label,el('p','',`Batas freelancer global: ${state.settings.maxWorkers} bersamaan untuk semua workspace. Terminal dan izin global tidak berubah.`),status,save);
  form.onsubmit=async event=>{
    event.preventDefault();if(save.disabled)return;save.disabled=true;status.textContent='';form.querySelector('.inline-error')?.remove();
    try{
      const settings:Settings=await api('workspaces/agents','PUT',{workspace:target,expected,agents:{coordinatorProvider:coordinator.input.value,workerProvider:worker.input.value,claudeModel:claude.input.value,codexModel:codex.input.value}});
      expected=workspaceAgents(settings,target);await refresh();status.textContent='Agent workspace disimpan.';
    }catch(e){form.append(feedback(errorText(e)));}finally{save.disabled=false;}
  };
  d.append(form);
}
function settingsDialog(){
  const d=dialog('Pengaturan'),s=structuredClone(state.settings);
  if(workspace)d.append(button('Agent workspace · '+shortPath(workspace),()=>{d.close();workspaceAgentsDialog();},'primary'));
  d.append(el('p','','Bagian di bawah berlaku global. Agent workspace memiliki provider/model sendiri; workspace lama mengikuti default global sampai dikonfigurasi.'));
  d.classList.add('settings-dialog');
  const roots=field('Folder workspace · satu path lengkap per baris',s.roots.join('\n'),true),coordinator=select('Provider PM',['codex','claude'],s.coordinatorProvider),worker=select('Default freelancer',['codex','claude'],s.workerProvider);
  const permissionSelect=(name:string,value:string)=>{const f=select(name,['manual','auto','full'],value);for(const o of f.input.options)o.textContent=o.value==='full'?'Akses penuh · berisiko':o.value==='auto'?'Otomatis':'Manual';return f;};
  const codexPermission=permissionSelect('Izin Codex',s.permissions?.codex||'manual'),claudePermission=permissionSelect('Izin Claude',s.permissions?.claude||'manual');
  const limit=field('Freelancer bersamaan',String(s.maxWorkers)),claude=field('Model Claude · kosong untuk default',s.claudeModel),codex=field('Model Codex · kosong untuk default',s.codexModel);
  limit.input.setAttribute('type','number');limit.input.setAttribute('min','1');limit.input.setAttribute('max','10');
  function section(title:string,fields:HTMLElement[],label:string,patch:()=>Partial<Settings>,permission=false){
    const form=el('form','settings-section'),heading=el('h3','',title),status=el('p','section-status');status.setAttribute('role','status');
    const save=el('button','primary',label);save.type='submit';
    const changed=()=>{status.textContent='Perubahan belum disimpan.';};form.addEventListener('input',changed);form.addEventListener('change',changed);
    form.append(heading,...fields,status,save);
    if(permission&&!state.capabilities?.permissionModes){save.disabled=true;codexPermission.input.disabled=true;claudePermission.input.disabled=true;form.append(feedback('Backend ini belum mendukung pengaturan izin. Pembaruan perlu dilakukan pemilik saat pekerjaan idle.'));}
    const accessBusy=state.tasks.some(t=>['running','queued','waiting'].includes(t.status))||state.terminals?.some(t=>t.exitCode===null);
    if(!permission&&accessBusy)form.append(el('p','','Selesaikan atau hentikan agent dan terminal aktif sebelum mengubah bagian ini. Server memeriksa status akhir termasuk tugas yang terkunci.'));
    form.onsubmit=async event=>{
      event.preventDefault();if(save.disabled)return;save.disabled=true;form.querySelector('.action-error')?.remove();
      try{
        const latest:State=await api('state'),update=patch(),keys=Object.keys(update) as (keyof Settings)[];
        if(keys.some(key=>JSON.stringify(latest.settings[key])!==JSON.stringify(s[key]))){for(const key of keys)Object.assign(s,{[key]:structuredClone(latest.settings[key])});if(permission)updatePreview();throw new Error('Bagian ini diperbarui sejak dialog dibuka. Periksa nilai terbaru sebelum menekan Simpan lagi: '+JSON.stringify(Object.fromEntries(keys.map(k=>[k,latest.settings[k]]))));}
        if(permission){
          if(!latest.capabilities?.permissionModes)throw new Error('Backend ini belum mendukung pengaturan izin.');
          const next=update.permissions!,old=latest.settings.permissions;
          const transitions=(['codex','claude'] as const).filter(p=>(old?.[p]||'manual')!==(next[p]||'manual'));
          const full=transitions.filter(p=>(old?.[p]||'manual')==='full'||next[p]==='full');
          if(full.some(p=>latest.tasks.some(t=>t.provider===p&&t.status==='running')))throw new Error('Selesaikan atau hentikan agent provider terkait sebelum mengubah Akses penuh.');
          if(full.length&&!confirm('Simpan perubahan izin di semua workspace?\n'+transitions.map(p=>`${p}: ${old?.[p]||'manual'} → ${next[p]}`).join('\n')+'\nAkses penuh: agent berjalan dengan hak user laptop, tanpa sandbox.'))return;
        }
        const result=await saveSettings({...latest.settings,...update,expectedSettings:latest.settings});
        for(const key of keys)if(JSON.stringify(result[key])!==JSON.stringify(update[key]))throw new Error('Respons server berbeda dari perubahan yang diminta. Periksa pengaturan terbaru.');
        for(const key of keys)Object.assign(s,{[key]:structuredClone(result[key])});if(permission)updatePreview();await refresh();status.textContent=permission?'Izin disimpan.':title+' disimpan.';
      }catch(e){const error=feedback(errorText(e));error.classList.add('action-error');form.append(error);}finally{save.disabled=permission&&!state.capabilities?.permissionModes;}
    };d.append(form);return form;
  }
  const modeHelp=el('div','mode-help');modeHelp.append(el('p','','Berlaku untuk PM dan freelancer provider ini di semua workspace.'),el('p','','Manual: minta keputusan saat provider memerlukan izin.'),el('p','','Otomatis: izinkan sekali permintaan perintah, file, tool dan konfirmasi izin tool-call tanpa klik, termasuk yang sedang menunggu. Tidak membuat aturan permanen otomatis. Pertanyaan, form data dan autentikasi tetap perlu input; batas paksa provider tetap berlaku.'),el('p','permission-warning','Akses penuh: agent berjalan dengan hak user laptop. Codex memakai never + danger-full-access; Claude memakai dangerously-skip-permissions tanpa sandbox. Perubahan dari/ke full memerlukan agent provider terkait tidak running.'));
  const preview=el('p','permission-preview');
  const updatePreview=()=>{preview.textContent=`Semua workspace · Codex: ${s.permissions?.codex||'manual'} → ${codexPermission.input.value}; Claude: ${s.permissions?.claude||'manual'} → ${claudePermission.input.value}. Otomatis juga berlaku pada izin tindakan yang menunggu.`;};
  codexPermission.input.onchange=updatePreview;claudePermission.input.onchange=updatePreview;updatePreview();
  section('Izin global',[codexPermission.label,claudePermission.label,modeHelp,preview],'Simpan izin',()=>({permissions:{codex:codexPermission.input.value as 'manual'|'auto'|'full',claude:claudePermission.input.value as 'manual'|'auto'|'full'}}),true);
  const browse=button('Pilih folder…',async()=>{const path=await pickFolder();if(path){roots.input.value=[...new Set([...roots.input.value.split('\n').map(p=>p.trim()).filter(Boolean),path])].join('\n');roots.input.dispatchEvent(new window.Event('input',{bubbles:true}));}},'quiet');
  section('Registrasi & default global',[roots.label,browse,coordinator.label,el('p','','Mengganti provider membuka percakapan terpisah. Percakapan lama tetap tersimpan.'),worker.label],'Simpan workspace & provider',()=>({roots:roots.input.value.split('\n').map(p=>p.trim()).filter(Boolean),coordinatorProvider:coordinator.input.value as Settings['coordinatorProvider'],workerProvider:worker.input.value as Settings['workerProvider']}));
  const advanced=el('details');advanced.append(el('summary','','Pengaturan lanjutan'));d.append(advanced);
  const advancedForm=section('Pengaturan lanjutan',[limit.label,claude.label,codex.label],'Simpan lanjutan',()=>({maxWorkers:Number(limit.input.value),claudeModel:claude.input.value,codexModel:codex.input.value}));advanced.append(advancedForm);
  d.append(button('Jadwal pekerjaan',scheduleList,'quiet settings-extra'));
}
function historyDialog(reviewOnly=false){
  const d=dialog(reviewOnly?'Perlu ditinjau':'Riwayat pekerjaan');d.classList.add('review-dialog');d.dataset.reviewWorkspace=workspace;
  const modes=el('div','review-filters');const list=el('div','review-list');
  const paint=()=>{
    const focused=document.activeElement instanceof HTMLElement&&d.contains(document.activeElement)?document.activeElement:null,focusMode=focused?.dataset.reviewMode,focusTask=focused?.dataset.reviewTaskId,scroll=list.scrollTop;
    const filtered=d.dataset.reviewOnly==='true';d.dataset.reviewOnly=String(filtered);
    modes.replaceChildren();const all=button('Semua riwayat',()=>{d.dataset.reviewOnly='false';paint();},filtered?'quiet':'review-filter-active');all.dataset.reviewMode='all';const needs=button(`Perlu ditinjau (${reviewTasks(state.tasks,d.dataset.reviewWorkspace||workspace).length})`,()=>{d.dataset.reviewOnly='true';paint();},filtered?'review-filter-active':'quiet');needs.dataset.reviewMode='review';all.setAttribute('aria-pressed',String(!filtered));needs.setAttribute('aria-pressed',String(filtered));modes.append(all,needs);
    const targetWorkspace=d.dataset.reviewWorkspace||workspace;
    const tasks=filtered?reviewTasks(state.tasks,targetWorkspace):[...pmHistory(state.tasks,targetWorkspace),...archive(state.tasks,targetWorkspace)];list.replaceChildren();
    if(!tasks.length)list.append(el('p','empty',filtered?'Tidak ada tugas freelancer yang gagal atau terputus di workspace ini.':'Pekerjaan yang selesai, gagal, terputus, atau dihentikan akan tersimpan di sini.'));
    for(const task of tasks){const needsReviewItem=needsReview(task,targetWorkspace,state.tasks);const row=button('',()=>{d.close();return openTask(task.id);},'history-row'+(needsReviewItem?' review-row':'')),text=el('div','review-row-copy');row.dataset.reviewTaskId=task.id;text.append(el('strong','',task.title),el('small','',`${task.kind==='pm'?'PM':roleOf(task)} · ${task.provider} · ${task.model||'model default'} · ${task.id.slice(0,8)} · ${new Date(task.updatedAt).toLocaleString('id-ID')}`));if(needsReviewItem)text.append(el('small','review-why',`Perlu ditinjau · ${statusText[task.status]}. ${reviewReason(task)}`));row.append(text,badge(task));list.append(row);}
    list.scrollTop=scroll;if(focused){const restore=(focusTask&&list.querySelector<HTMLButtonElement>(`[data-review-task-id="${CSS.escape(focusTask)}"]`))||modes.querySelector<HTMLButtonElement>(`[data-review-mode="${focusMode|| (filtered?'review':'all')}"]`)||modes.querySelector<HTMLButtonElement>('[data-review-mode="review"]');restore?.focus({preventScroll:true});}
  };
  d.dataset.reviewOnly=String(reviewOnly);d.append(modes,list);(d as HTMLDialogElement&{refreshReview?:()=>void}).refreshReview=paint;paint();
}
async function openTask(id:string){
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  const d=dialog(task.role||task.title),meta=el('div','task-meta');meta.append(el('span','',task.provider),badge(task));d.append(meta);if(needsReview(task,workspace,state.tasks))d.append(el('p','review-detail-reason','⚠ Perlu ditinjau · '+statusText[task.status]+'. '+reviewReason(task)));d.append(el('p','task-title',task.prompt),el('p','path',(task.executionPath?'Folder eksekusi: '+task.executionPath:'Workspace (folder eksekusi belum tersedia): '+task.workspace)+(task.branch?'\nBranch: '+task.branch:'')+(task.baseCommit?'\nCommit dasar: '+task.baseCommit:'')));
  for(const a of state.approvals.filter(a=>a.taskId===id&&a.status==='pending'))d.append(approvalCard(a));
  if(task.result)d.append(el('h3','','Hasil'),formatted(task.result,'result message-text'));
  if(!task.result)d.append(el('p','','Belum ada hasil akhir.'));if(task.status==='interrupted')d.append(el('p','','Sesi terputus. Tinjau aktivitas dan perubahan sebelum melanjutkan.'));
  if(task.error)d.append(el('p','inline-error',task.error));
  const actions=el('div','actions');actions.append(button('Buka chat / log',()=>{d.close();return showChat(task.id);},'quiet'));
  if(isWorking(task.status))actions.append(button(task.parentId?'Hentikan freelancer':'Hentikan PM dan anak aktif',persistentAction(d,async()=>{if(!confirm(task.parentId?'Hentikan freelancer ini?':'Hentikan PM dan semua freelancer anak aktif?'))return;await api('tasks/'+id+'/cancel','POST',{});d.close();await refresh();}),'danger'));
  else if(['failed','interrupted','cancelled'].includes(task.status))actions.append(button('Lanjutkan '+roleOf(task),persistentAction(d,async()=>{await api('tasks/'+id+'/resume','POST',{});d.close();await refresh();}),'quiet'));
  if(task.branch)actions.append(button('Tinjau perubahan',()=>{d.close();return diffDialog(task);},'quiet'));d.append(actions);
  const activity=el('details');activity.append(el('summary','','Aktivitas teknis'));
  d.append(activity);activity.append(el('p','transcript-status','Memuat aktivitas…'));
  const load=async()=>{activity.querySelector('.transcript-status')?.remove();const events:Event[]=await api('tasks/'+id+'/events?tail=1');
  for(const event of events.filter(e=>['tool','tool_output','tool_result','log','provider_error','permission_denied'].includes(e.type)))activity.append(el('pre','activity',JSON.stringify(event.data,null,2)));
};const retry=button('Coba muat aktivitas lagi',persistentAction(d,load),'quiet');try{await load();}catch(e){d.append(feedback(errorText(e)),retry);}
}
async function diffDialog(task:Task){
  const d=dialog('Tinjau perubahan');d.append(el('p','transcript-status','Memuat perubahan…'));try{const data=await api('tasks/'+task.id+'/diff');d.querySelector('.transcript-status')?.remove();d.append(el('p','path',task.branch||''),el('pre','result',data.diff||'Tidak ada perubahan file terlacak.'));
  for(const preview of data.previews||[])d.append(el('h3','',preview.path),el('pre','result',preview.content));
  if(data.untracked)d.append(el('p','path','File baru:\n'+data.untracked));
  if(task.status==='completed')d.append(el('p','','Penggabungan membuat commit perubahan worker lalu merge ke checkout asal yang bersih (git merge --no-ff --no-commit). Merge akhir belum di-commit; tinjau dan commit sendiri. Jika konflik, worktree dipertahankan; git merge --abort tersedia setelah meninjau.'),button('Gabungkan ke checkout',persistentAction(d,async()=>{if(!confirm('Setujui commit perubahan worker dan gabungkan ke checkout utama? Merge akhir tetap perlu kamu review dan commit.'))return;const result=await api('tasks/'+task.id+'/merge','POST',{confirm:true});d.append(el('p','',result.message));}),'primary'));}catch(e){d.querySelector('.transcript-status')?.remove();d.append(feedback(errorText(e)),button('Coba lagi',()=>{d.close();return diffDialog(task);},'quiet'));}
}
function scheduleList(){
  const d=dialog('Jadwal pekerjaan');d.append(button('Tambah jadwal',()=>scheduleDialog(),'primary'));
  for(const s of state.schedules){const row=el('div','schedule-row');row.append(el('strong','',s.title),el('p','path',`${s.cron} · ${s.timezone}`));const actions=el('div','actions');actions.append(button(s.enabled?'Jeda':'Aktifkan',persistentAction(row,async()=>{await api('schedules','POST',{...s,enabled:!s.enabled});await refresh();d.close();scheduleList();}),'quiet'),button('Ubah',()=>scheduleDialog(s),'quiet'),button('Hapus',persistentAction(row,async()=>{if(confirm('Hapus jadwal '+s.title+'?')){await api('schedules/'+s.id,'DELETE');await refresh();d.close();scheduleList();}}),'danger'));row.append(actions);d.append(row);}
}
function scheduleDialog(s?:Schedule){
  if(!state.settings.roots.length){notify('Tambahkan workspace terlebih dahulu.');return;}
  const d=dialog(s?'Ubah jadwal':'Tambah jadwal'),form=el('form'),title=field('Nama',s?.title),prompt=field('Instruksi',s?.prompt,true),cron=field('Cron · menit jam tanggal bulan hari',s?.cron||'0 9 * * 1-5'),timezone=field('Zona waktu',s?.timezone||'Asia/Jakarta'),folder=select('Workspace',state.settings.roots,s?.workspace||workspace),provider=select('Provider',['codex','claude'],s?.provider||agents().coordinatorProvider);
  form.append(el('p','','Daemon harus berjalan. Menit terlewat dilewati; run tidak ditumpuk saat sebelumnya aktif/terputus. Contoh: 0 9 * * 1-5 · Senin–Jumat pukul 09.00.'),title.label,prompt.label,cron.label,timezone.label,folder.label,provider.label);const save=el('button','primary','Simpan jadwal');save.type='submit';form.append(save);
  title.input.required=true;prompt.input.required=true;cron.input.required=true;timezone.input.required=true;
  form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;try{await api('schedules','POST',{id:s?.id,title:title.input.value,prompt:prompt.input.value,cron:cron.input.value,timezone:timezone.input.value,workspace:folder.input.value,provider:provider.input.value,model:s?.model||'',enabled:s?.enabled??true});d.close();await refresh();}catch(error){form.querySelector('.inline-error')?.remove();form.append(feedback(errorText(error)));}finally{save.disabled=false;}};d.append(form);
}
async function start(){app.replaceChildren(el('p','startup-error','Membuka Kantor…'));await refresh();const current=pm();if(current){await loadEvents(current.id);void catchupTask(current.id);}startStream();void refreshUsage();}
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!officeExpanded||document.querySelector('dialog[open]')||event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)return;
  event.preventDefault();setOfficeExpanded(false);document.querySelector<HTMLElement>('.office-mode-toggle')?.focus({preventScroll:true});
});
setInterval(()=>{if(!document.hidden)void refreshUsage();},60000);
setInterval(()=>{if(state&&!document.hidden){void refresh().catch(()=>{});const current=chatTask();if(current)void catchupTask(current.id);}},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state)void refresh().catch(notify);void refreshUsage();const current=chatTask();if(current)void catchupTask(current.id);startStream();}});
window.addEventListener('online',()=>{if(state)void refresh().catch(notify);});
void start().catch(error=>{const box=el('section','startup-error');box.append(el('h1','','Kantor belum dapat dibuka'),el('p','',error instanceof Error?error.message:String(error)),button('Coba lagi',()=>location.reload(),'primary'));app.replaceChildren(box);});
