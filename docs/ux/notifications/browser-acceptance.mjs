import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {Store} from '../../../src/store.js';
import {Engine} from '../../../src/engine.js';
import {Scheduler} from '../../../src/scheduler.js';
import {server} from '../../../src/server.js';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const output=fileURLToPath(new URL('.',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'kantor-notification-e2e-'));
const workspace=join(scratch,'registered-workspace'),dataDir=join(scratch,'data');await Promise.all([mkdir(workspace),mkdir(dataDir)]);
const publicDir=process.env.NOTIFICATION_BUILD||'/tmp/kantor-notifications-build';
let failureNext=false;const sent=[];
const fakeSender=async(title,body)=>{sent.push({title,body});if(failureNext){failureNext=false;const e=new Error('fixture sender failure');e.code='EIO';throw e;}};
const store=new Store(join(dataDir,'office.db'));store.saveSettings({...store.settings(),roots:[workspace]});
const startup=store.createTask({prompt:'private startup content',workspace,kind:'pm',title:'PM'});startup.status='completed';store.saveTask(startup);
const adapter={run(ctx){let finish;const done=new Promise(r=>finish=r);ctx.session('notification-e2e');return {done,cancel(){finish('cancelled');}};}};
const engine=new Engine(store,{claude:adapter,codex:adapter},dataDir,'http://127.0.0.1:0');
const quota={status:'unavailable',windows:[],updatedAt:null,note:'Fixture; no provider access.'};
const {app,closeStreams}=server(engine,new Scheduler(engine),publicDir,{get:async()=>({codex:quota,claude:quota})},{nativeSender:fakeSender});
const {chromium}=await import(process.env.NOTIFICATION_PLAYWRIGHT||join(homedir(),'.cache/ms-playwright-go/1.50.1/package/index.mjs'));
let browser;
const checks=[];const record=name=>{checks.push({name,status:'pass'});console.log('PASS '+name);};
const waitFor=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out waiting for browser/server transition');};
const addApproval=(task,kind='question')=>{const a={id:'approval-'+Date.now()+'-'+Math.random(),taskId:task.id,kind,details:{prompt:'PRIVATE APPROVAL CONTENT'},status:'pending',answer:'',createdAt:new Date().toISOString()};store.saveApproval(a);engine.event(task.id,'approval',a);return a;};
const makeTask=(role='Agent QA')=>store.createTask({prompt:'PRIVATE TASK PROMPT',workspace,role});
try{
  assert.ok(publicDir.startsWith('/tmp/'),'browser fixture must use isolated /tmp build output');
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));engine.url=`http://127.0.0.1:${app.address().port}`;
  browser=await chromium.launch({executablePath:process.env.NOTIFICATION_CHROMIUM||'/usr/bin/google-chrome',headless:true});
  const context=await browser.newContext();await context.addInitScript(()=>{
    const instances=[];class FakeNotification{static permission='denied';static requestPermission=async()=>FakeNotification.permission;title;options;onclick=null;constructor(title,options){this.title=title;this.options=options;instances.push(this);}close(){} }
    Object.defineProperty(window,'Notification',{configurable:true,value:FakeNotification});Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});Object.defineProperty(window,'__fakeNotifications',{configurable:true,value:instances});Object.defineProperty(window,'__permission',{configurable:true,get:()=>FakeNotification.permission,set:v=>FakeNotification.permission=v});Object.defineProperty(window,'__forceHidden',{configurable:true,writable:true,value:false});Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__forceHidden});
  });
  const page=context.pages()[0]||await context.newPage();page.on('pageerror',e=>{throw e;});await page.goto(engine.url);await page.getByRole('button',{name:'Notifikasi'}).waitFor();
  const tab2=await context.newPage();await tab2.goto(engine.url);await tab2.getByRole('button',{name:'Notifikasi'}).waitFor();
  let status=await page.request.get(engine.url+'/api/notifications').then(r=>r.json());assert.equal(status.preferences.enabled,false);assert.equal(sent.length,0);record('default off and startup completed task produces no sender calls');
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Aktifkan notifikasi').check();await waitFor(async()=>((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).preferences.enabled));await page.getByRole('button',{name:'Tutup'}).click();
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.screenshot({path:join(output,'settings.png'),timeout:60000,animations:'disabled'});await page.getByRole('button',{name:'Tutup'}).click();
  await tab2.getByRole('button',{name:'Notifikasi'}).click();await tab2.getByRole('button',{name:'Tutup'}).click();
  const task=makeTask('PM');store.saveTask(task);const approval=addApproval(task);await waitFor(async()=>sent.length===1);
  await new Promise(r=>setTimeout(r,500));assert.equal(sent.length,1);assert.match(sent[0].title,/Pertanyaan/);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE/);
  await page.waitForTimeout(1000);await tab2.waitForTimeout(1000);const notices=await Promise.all([page.locator('.kantor-notice').count(),tab2.locator('.kantor-notice').count()]);assert.equal(notices[0]+notices[1],1,'two tabs must claim one notice via IndexedDB/Web Locks');
  const owner=notices[0]?page:tab2;
  const beforeTitle=await owner.title();assert.ok(beforeTitle.startsWith('• '));await owner.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await owner.title(),beforeTitle.replace(/^• /,''));record('tab focus clears the temporary title badge');
  const notice=owner.locator('.kantor-notice');
  // Resolve before click: navigation must load the current task state, without stale approval actions.
  const resolved={...approval,status:'approved',answer:'resolved'};store.saveApproval(resolved);engine.event(task.id,'approval_resolved',resolved);await notice.click();await owner.getByRole('dialog').waitFor();assert.equal(await owner.locator('dialog .approval').count(),0);assert.ok(await owner.locator('dialog').innerText().then(x=>x.includes('PRIVATE TASK PROMPT')));record('approval click opens correct task context and reflects latest resolved state');
  await owner.getByRole('button',{name:'Tutup'}).click();
  // Replay same approval event is ignored server-side; poll/replay creates no second sender call.
  engine.event(task.id,'approval',{...approval});await new Promise(r=>setTimeout(r,300));assert.equal(sent.length,1);record('SSE replay/poll observations do not duplicate the daemon sender');

  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Aktifkan notifikasi').uncheck();await waitFor(async()=>!((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).preferences.enabled));await page.getByRole('button',{name:'Tutup'}).click();
  addApproval(task);await new Promise(r=>setTimeout(r,200));assert.equal(sent.length,1);record('opt-out is global across tabs and suppresses pending events');
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Aktifkan notifikasi').check();await page.getByLabel('Pertanyaan dan konfirmasi').uncheck();await waitFor(async()=>((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).preferences.enabled));await page.getByRole('button',{name:'Tutup'}).click();
  addApproval(task,'permission');await new Promise(r=>setTimeout(r,200));assert.equal(sent.length,1);record('decision-kind filter is honored');
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Tugas selesai').uncheck();await page.getByRole('button',{name:'Tutup'}).click();const fast=makeTask();fast.status='completed';store.saveTask(fast);engine.event(fast.id,'created',fast);engine.event(fast.id,'status',{status:'completed'});await new Promise(r=>setTimeout(r,250));assert.equal(sent.length,1);record('complete-kind filter suppresses a fast created-to-completed task');
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Tugas selesai').check();await waitFor(async()=>((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).preferences.complete));await page.getByRole('button',{name:'Tutup'}).click();
  const completedToastCount=async()=>Promise.all([page.locator('.kantor-notice').filter({hasText:'Tugas selesai'}).count(),tab2.locator('.kantor-notice').filter({hasText:'Tugas selesai'}).count()]).then(xs=>xs[0]+xs[1]);
  const quick=makeTask();quick.status='completed';store.saveTask(quick);engine.event(quick.id,'created',quick);engine.event(quick.id,'status',{status:'completed'});await waitFor(async()=>sent.length===2&&await completedToastCount()===1);assert.equal(sent[1].title,'Tugas selesai');
  quick.status='running';store.saveTask(quick);engine.event(quick.id,'status',{status:'running'});quick.status='completed';store.saveTask(quick);engine.event(quick.id,'status',{status:'completed'});await waitFor(async()=>sent.length===3&&await completedToastCount()===2);record('new completed task and later completed retry each notify once, including between-poll state version');
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByRole('button',{name:'Uji notifikasi'}).click();await waitFor(async()=>sent.length===4);assert.equal(sent[3].title,'Uji notifikasi');assert.doesNotMatch(JSON.stringify(sent[3]),/PRIVATE/);await page.getByRole('button',{name:'Tutup'}).click();record('test button sends only a static fake desktop payload');

  // No actual OS notifications: injected sender fails once; inspect capability then exercise mocked browser Notification.
  await page.getByRole('button',{name:'Notifikasi'}).click();await page.getByLabel('Pertanyaan dan konfirmasi').check();await waitFor(async()=>(await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).preferences.decision);await page.getByRole('button',{name:'Tutup'}).click();
  failureNext=true;const broken=makeTask();store.saveTask(broken);addApproval(broken);await waitFor(async()=>!((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).capability.available));
  assert.match((await page.request.get(engine.url+'/api/notifications').then(r=>r.json())).capability.reason,/Pengiriman gagal/);await waitFor(async()=>(await Promise.all([page.locator('.kantor-notice').count(),tab2.locator('.kantor-notice').count()])).some(n=>n>0));record('sender failure is surfaced and native capability turns unavailable; client fallback toast appears');
  await tab2.getByRole('button',{name:'Notifikasi'}).click();await tab2.waitForTimeout(300);await tab2.getByRole('button',{name:'Tutup'}).click();
  await page.evaluate(()=>{window.__permission='denied';});await page.getByRole('button',{name:'Notifikasi'}).click();await page.locator('.notification-settings [role=status]').first().getByText(/secure context/).waitFor();assert.match(await page.locator('.notification-settings [role=status]').first().innerText(),/secure context/);await page.getByRole('button',{name:'Tutup'}).click();
  const denied=makeTask();store.saveTask(denied);addApproval(denied);await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>window.__fakeNotifications.length),0);record('HTTP fallback and denied mocked permission never invoke Notification');
  for(const p of [page,tab2])await p.evaluate(()=>{Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});window.__permission='granted';window.__forceHidden=true;});
  await tab2.bringToFront();const browserTask=makeTask('Browser');const worktree=join(scratch,'task-execution');await mkdir(worktree);const child=store.createTask({prompt:'PRIVATE CHILD PROMPT',workspace:worktree,parentId:browserTask.id,role:'Worker QA'});const childApproval={...addApproval(child),kind:'question'};
  await waitFor(async()=>await Promise.all([page.evaluate(()=>window.__fakeNotifications.length),tab2.evaluate(()=>window.__fakeNotifications.length)]).then(xs=>xs[0]+xs[1]===1));
  const notifOwner=(await page.evaluate(()=>window.__fakeNotifications.length))?page:tab2;
  const fakeNotice=await notifOwner.evaluate(()=>{const n=window.__fakeNotifications[0];n.onclick?.();return {title:n.title,body:n.options.body,tag:n.options.tag};});assert.match(fakeNotice.title,/Pertanyaan|Konfirmasi/);assert.doesNotMatch(JSON.stringify(fakeNotice),/PRIVATE/);await notifOwner.getByRole('dialog').waitFor();assert.ok((await notifOwner.locator('.project.selected').innerText()).includes('registered-workspace'));record('secure granted branch uses mocked Notification only and click opens child in parent workspace');
  const browserMockCalls=await Promise.all([page.evaluate(()=>window.__fakeNotifications.map(n=>({title:n.title,tag:n.options.tag}))),tab2.evaluate(()=>window.__fakeNotifications.map(n=>({title:n.title,tag:n.options.tag})))]);
  const guard=await new Promise(resolve=>{const req=httpRequest(engine.url+'/api/notifications',{method:'PUT',headers:{host:'evil.test','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',()=>resolve(0));req.end(JSON.stringify({enabled:true,decision:true,complete:true,desktop:true}));});assert.equal(guard,403);
  const originGuard=await new Promise(resolve=>{const target=new URL(engine.url),req=httpRequest({hostname:target.hostname,port:target.port,path:'/api/notifications',method:'GET',headers:{host:target.host,origin:'http://evil.test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',()=>resolve(0));req.end();});assert.equal(originGuard,403);record('host and origin guards reject foreign notification configuration');

  await page.reload();await page.waitForTimeout(500);assert.equal(sent.length,5,'reload must not flood completed history');await page.getByRole('button',{name:'Notifikasi'}).click();assert.equal(await page.getByLabel('Aktifkan notifikasi').isChecked(),true);await page.getByRole('button',{name:'Tutup'}).click();record('reload persists opt-in and does not replay historical completion notifications');
  const evidence={fixture:'temporary SQLite database/workspace, fake engine adapter and injected sender; no notify-send invocation',checks,senderCalls:sent.map(x=>x.title),browserMockCalls,notificationClick:fakeNotice,limitations:'notify-send desktop notifications do not support a reliable click action; browser Notification click is separately tested with a mock. Secure-context branch is simulated in the browser fixture. Screenshot: settings.png.'};
  await writeFile(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,senderCalls:evidence.senderCalls,browserMockCalls:evidence.browserMockCalls,evidence:join(output,'evidence.json')},null,2));
}finally{await browser?.close();closeStreams();app.closeAllConnections();await new Promise(ok=>app.close(ok));await engine.shutdown();store.close();await rm(scratch,{recursive:true,force:true});}
