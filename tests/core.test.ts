import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { compileCron, Scheduler } from '../src/scheduler.js';
import { allowedWorkspace, prepareWorkspace, git, merge, diff } from '../src/workspace.js';
import { server } from '../src/server.js';
import type { Adapter, RunContext } from '../src/types.js';
const delay=()=>new Promise(r=>setTimeout(r,10));
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await delay();}throw new Error('Timed out waiting for test state');}
class Fake implements Adapter {
  runs=new Map<string,{ctx:RunContext;resolve:(s:string)=>void;reject:(e:Error)=>void}>();
  run(ctx:RunContext){let resolve!:(s:string)=>void,reject!:(e:Error)=>void;const done=new Promise<string>((a,b)=>{resolve=a;reject=b;});this.runs.set(ctx.task.id,{ctx,resolve,reject});ctx.session('session-'+ctx.task.id);return {done,cancel:()=>reject(new Error('Stopped'))};}
  finish(id:string,text='done'){this.runs.get(id)!.resolve(text);}
}
async function fixture(t:any,maxWorkers=3){const dir=await mkdtemp(join(tmpdir(),'office-test-'));const workspace=join(dir,'workspace');await mkdir(workspace);const store=new Store(join(dir,'office.db'));store.saveSettings({...store.settings(),roots:[workspace],maxWorkers});const fake=new Fake();const engine=new Engine(store,{claude:fake,codex:fake},dir,'http://127.0.0.1:4317');t.after(async()=>{await engine.shutdown();store.close();await rm(dir,{recursive:true,force:true});});return {dir,workspace,store,fake,engine};}

test('queue limits workers, serializes overlapping non-Git paths, and wakes coordinator with cross-provider results',async t=>{
  const {engine,workspace,store,fake}=await fixture(t,2);
  const root=await engine.create({prompt:'Coordinate',workspace,provider:'claude'});
  await until(()=>fake.runs.has(root.id));
  const cap=engine.running.get(root.id)!.capability;
  const dirs=await Promise.all([0,1,2].map(async i=>{const p=join(workspace,String(i));await mkdir(p);return p;}));
  const children=[];
  for(const p of dirs)children.push(await engine.tool(cap,'spawn_task',{prompt:'Implement',provider:'codex',workspace:p}));
  const [a,b,c]=children;
  await until(()=>fake.runs.has(a.id)&&fake.runs.has(b.id));
  assert.equal(store.task(c.id).status,'queued');
  assert.equal(store.task(a.id).title,'Implement');
  await assert.rejects(()=>engine.tool(engine.running.get(a.id)!.capability,'spawn_task',{prompt:'Forbidden'}),/cannot delegate/);
  fake.finish(root.id,'Delegated');await until(()=>store.task(root.id).status==='waiting');
  fake.finish(a.id,'verified');await until(()=>fake.runs.has(c.id)&&store.task(root.id).status==='running');
  assert.match(fake.runs.get(root.id)!.ctx.prompt,/verified/);
  assert.equal(store.task(a.id).sessionId,'session-'+a.id);
});

test('non-Git directory locks cover ancestor paths',async t=>{
 const {engine,workspace,fake,store}=await fixture(t);const root=await engine.create({prompt:'Coordinate',workspace});await until(()=>fake.runs.has(root.id));
 const nested=join(workspace,'nested');await mkdir(nested);
 const a=await engine.create({prompt:'write',workspace,parentId:root.id});
 const b=await engine.create({prompt:'write nested',workspace:nested,parentId:root.id});
 await until(()=>fake.runs.has(a.id));assert.equal(store.task(b.id).status,'queued');
 fake.finish(a.id);await until(()=>fake.runs.has(b.id));
});

test('approval survives browser absence, is one-shot, expires on cancellation, and cannot cross task capability',async t=>{
 const {engine,workspace,fake,store}=await fixture(t);const task=await engine.create({prompt:'Work',workspace});await until(()=>fake.runs.has(task.id));
 const pending=fake.runs.get(task.id)!.ctx.approve('permission',{command:'safe-test'});
 assert.equal(store.task(task.id).status,'waiting');const a=store.approvals()[0];
 engine.answer(a.id,true,'yes');assert.deepEqual(await pending,{approved:true,answer:'yes'});
 assert.throws(()=>engine.answer(a.id,true,''),/already answered/);
 await assert.rejects(()=>engine.tool('wrong','get_status',{}),/capability/);
 const second=fake.runs.get(task.id)!.ctx.approve('permission',{});engine.cancel(task.id);
 assert.equal((await second).approved,false);await until(()=>!engine.running.has(task.id));
 assert.equal(store.approvals()[1].status,'expired');assert.equal(store.task(task.id).status,'cancelled');
});

test('recovery preserves session, interrupts active work, and expires stale approvals',async t=>{
 const {store,workspace}=await fixture(t);const task=store.createTask({prompt:'recover',workspace,provider:'codex',status:'running',sessionId:'thread-1'});
 store.saveApproval({id:'a',taskId:task.id,kind:'permission',details:{},status:'pending',answer:'',createdAt:new Date().toISOString()});
 store.recover();assert.equal(store.task(task.id).status,'interrupted');assert.equal(store.task(task.id).sessionId,'thread-1');assert.equal(store.approvals()[0].status,'expired');
});

test('workspace admission resolves symlinks and rejects prefix lookalikes',async t=>{
 const {workspace,dir}=await fixture(t);const outside=join(dir,'workspace-evil');await mkdir(outside);await symlink(outside,join(workspace,'escape'));
 await assert.rejects(()=>allowedWorkspace(outside,[workspace]),/outside/);
 await assert.rejects(()=>allowedWorkspace(join(workspace,'escape'),[workspace]),/outside/);
 assert.equal(await allowedWorkspace(workspace,[workspace]),workspace);
});

test('worktree isolates changes, merge requires a clean checkout, and keeps integration uncommitted',async t=>{
 const {workspace,store,dir}=await fixture(t);await git(workspace,'init');await git(workspace,'config','user.name','Office Test');await git(workspace,'config','user.email','office@example.invalid');
 await writeFile(join(workspace,'file.txt'),'original\n');await git(workspace,'add','.');await git(workspace,'commit','-m','initial');
 const task=store.createTask({prompt:'change',workspace,provider:'codex',parentId:'parent'});await prepareWorkspace(task,dir);
 await writeFile(join(task.executionPath!,'file.txt'),'worker\n');await git(task.executionPath!,'add','.');await git(task.executionPath!,'commit','-m','worker change');assert.match((await diff(task)).diff,/worker/);assert.equal(await readFile(join(workspace,'file.txt'),'utf8'),'original\n');
 await writeFile(join(workspace,'dirty.txt'),'dirty');await assert.rejects(()=>merge(task),/clean/);await rm(join(workspace,'dirty.txt'));
 await merge(task);assert.equal(await readFile(join(workspace,'file.txt'),'utf8'),'worker\n');assert.ok(await git(workspace,'rev-parse','--verify','MERGE_HEAD'));
});

test('numeric cron validates syntax and honors timezone and day matching',()=>{
 const weekdays=compileCron('0 9 * * 1-5','Asia/Jakarta');assert.equal(weekdays(new Date('2026-11-04T02:00:00Z')),true);assert.equal(weekdays(new Date('2026-11-07T02:00:00Z')),false);
 assert.equal(compileCron('*/15 0-23 * * *','UTC')(new Date('2026-11-04T01:30:00Z')),true);
 assert.equal(compileCron('0 9 1 * 1','UTC')(new Date('2026-11-02T09:00:00Z')),true);
 assert.throws(()=>compileCron('60 * * * *','UTC'),/range/);assert.throws(()=>compileCron('* * * * *','Invalid/Zone'));assert.throws(()=>compileCron('* * * *','UTC'),/five/);
});

test('scheduler skips missed minutes, prevents duplicate/overlapping runs, and holds interrupted work',async t=>{
 const {engine,workspace,store,fake}=await fixture(t);const scheduler=new Scheduler(engine);scheduler.minute=0;
 scheduler.save({title:'routine',prompt:'scheduled',workspace,provider:'codex',model:'',cron:'* * * * *',timezone:'UTC',enabled:true});
 const date=new Date('2026-11-04T03:00:00Z');await scheduler.tick(date);await scheduler.tick(date);assert.equal(store.tasks().length,1);
 await scheduler.tick(new Date(date.getTime()+600000));assert.equal(store.tasks().length,1);
 const id=store.tasks()[0].id;await until(()=>fake.runs.has(id));fake.finish(id);await until(()=>store.task(id).status==='completed');
 await scheduler.tick(new Date(date.getTime()+660000));assert.equal(store.tasks().length,2);
});

test('dashboard works without a token, rejects foreign origins/hosts, and preserves internal capabilities and SSE replay',async t=>{
 const {engine,workspace}=await fixture(t);const scheduler=new Scheduler(engine);const {app}=server(engine,scheduler,workspace);
 class Response extends Writable {
  statusCode=200; chunks:string[]=[]; raw:Buffer[]=[]; headers:Record<string,string>={};
  setHeader(k:string,v:string){this.headers[k]=v;}
  flushHeaders(){}
  writeHead(status:number,headers:Record<string,string>){this.statusCode=status;Object.assign(this.headers,headers);return this;}
  _write(chunk:any,_encoding:any,callback:()=>void){this.raw.push(Buffer.from(chunk));this.chunks.push(String(chunk));callback();}
 }
 const request=(path:string,headers:Record<string,string>={},method='GET',input?:any)=>{
  const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]) as any;
  req.url=path;req.method=method;req.headers={host:'127.0.0.1:4317',...headers};const res=new Response();
  app.emit('request',req,res);return {req,res};
 };
 const finish=async(r:ReturnType<typeof request>)=>{if(!r.res.writableFinished)await new Promise<void>(resolve=>r.res.on('finish',resolve));return r.res;};
 const headers={'content-type':'application/json'};
 assert.equal((await finish(request('/api/state'))).statusCode,200);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64');
 await writeFile(join(workspace,'preview.png'),image);
 const preview=await finish(request('/api/previews?workspace='+encodeURIComponent(workspace)+'&path=preview.png'));
 assert.equal(preview.statusCode,200);assert.equal(preview.headers['content-type'],'image/png');assert.equal(preview.headers['cache-control'],'no-store');assert.deepEqual(Buffer.concat(preview.raw),image);
 assert.equal((await finish(request('/api/previews?workspace='+encodeURIComponent(workspace)+'&path=preview.png',{host:'evil.invalid'}))).statusCode,403);
 const folderResponse=await finish(request('/api/folders',headers,'POST',{path:workspace}));
 assert.equal(folderResponse.statusCode,200);assert.equal(JSON.parse(folderResponse.chunks.join('')).path,workspace);
 assert.equal((await finish(request('/api/folders',{...headers,origin:'https://evil.invalid'},'POST',{path:workspace}))).statusCode,403);
 assert.equal((await finish(request('/api/folders',headers,'POST',{path:42}))).statusCode,400);
 assert.equal((await finish(request('/api/folders',headers,'POST',{path:workspace,hidden:'yes'}))).statusCode,400);
 assert.deepEqual(engine.store.settings().roots,[workspace]); for(const permissions of [{codex:'yes'},{codex:['auto']},[],{unknown:'auto'},null])assert.equal((await finish(request('/api/settings',headers,'PUT',{...engine.store.settings(),permissions}))).statusCode,400);
 const change=await finish(request('/api/settings',headers,'PUT',{...engine.store.settings(),permissions:{codex:'auto',claude:'manual'}}));assert.equal(change.statusCode,200);assert.equal(engine.store.settings().permissions?.codex,'auto');
 assert.equal((await finish(request('/api/terminals',{...headers,origin:'https://evil.invalid'},'POST',{workspace}))).statusCode,403);
 assert.equal((await finish(request('/api/terminals',headers,'POST',{workspace:'/etc'}))).statusCode,400);
 assert.equal((await finish(request('/api/terminals/invalid-id'))).statusCode,404);

 assert.equal((await finish(request('/internal/tool',headers,'POST',{name:'get_status'}))).statusCode,401);
 assert.equal((await finish(request('/internal/tool',{...headers,authorization:'Bearer invalid-capability'},'POST',{name:'get_status'}))).statusCode,400);
 assert.equal((await finish(request('/api/state',{...headers,origin:'https://evil.invalid'}))).statusCode,403);
 assert.equal((await finish(request('/api/state',{...headers,host:'evil.invalid'}))).statusCode,403);
 assert.equal((await finish(request('/api/tasks',headers,'POST',{prompt:'test',workspace}))).statusCode,201);
 const hotPermission=await finish(request('/api/settings',headers,'PUT',{...engine.store.settings(),permissions:{codex:'manual',claude:'auto'}}));assert.equal(hotPermission.statusCode,200);
 assert.equal((await finish(request('/api/settings',headers,'PUT',{...engine.store.settings(),maxWorkers:9}))).statusCode,400);
 assert.equal((await finish(request('/api/settings',headers,'PUT',{...engine.store.settings(),permissions:{codex:'full'}}))).statusCode,400);
 const savedState=JSON.parse((await finish(request('/api/state'))).chunks.join(''));assert.equal(savedState.capabilities.permissionModes,true);assert.equal(savedState.settings.permissions.claude,'auto');
 const historyTask=engine.store.tasks()[0];
 const historyEvent=engine.store.event(historyTask.id,'message',{text:'history cursor proof'});
 const syncResponse=await finish(request('/api/tasks/'+historyTask.id+'/events?sync=1'));
 assert.equal(JSON.parse(syncResponse.chunks.join('')).after,historyEvent.id);
 const history=await finish(request('/api/tasks/'+historyTask.id+'/events?before='+(historyEvent.id+1)));
 assert.equal(history.statusCode,200);assert.ok(JSON.parse(history.chunks.join('')).some((e:any)=>e.id===historyEvent.id));
 const incrementalStart=JSON.parse(syncResponse.chunks.join('')).after;const incrementalIds:number[]=[];
 for(let i=0;i<505;i++)incrementalIds.push(engine.store.event(historyTask.id,i===250?'text':i%2?'status':'tool',{text:`delta-${i}`}).id);
 const firstPage=JSON.parse((await finish(request(`/api/tasks/${historyTask.id}/events?after=${incrementalStart}`))).chunks.join(''));
 assert.equal(firstPage.length,500);assert.ok(firstPage.some((e:any)=>e.type==='text'&&e.data.text==='delta-250'));
 const secondPage=JSON.parse((await finish(request(`/api/tasks/${historyTask.id}/events?after=${firstPage.at(-1).id}`))).chunks.join(''));
 assert.equal(secondPage.length,5);assert.deepEqual([...firstPage,...secondPage].map((e:any)=>e.id),incrementalIds);
 assert.ok(engine.store.recentEvents(historyTask.id).at(-1)!.id>historyEvent.id,'non-text tail is sparse and newer than the sync boundary');
 assert.equal(JSON.parse((await finish(request(`/api/tasks/${historyTask.id}/events?sync=1`))).chunks.join('')).after,historyEvent.id,'sparse status tail must not advance the incremental boundary');
 for(const cursor of ['0','-1','abc','1.5'])assert.equal((await finish(request('/api/tasks/'+historyTask.id+'/events?before='+cursor))).statusCode,400);
 const stream=request('/api/events?after=0',headers);
 await until(()=>stream.res.chunks.some(c=>c.includes('"type":"created"')));
 // A completed HTTP request does not mean its SSE response disconnected.
 const listeners=engine.listenerCount('event');
 stream.req.emit('close');
 const liveApproval=engine.store.event(historyTask.id,'approval',{id:'live-command',status:'pending'});
 engine.emit('event',liveApproval);
 assert.ok(stream.res.chunks.some(c=>c.includes('live-command')));
 assert.equal(engine.listenerCount('event'),listeners);
 stream.res.emit('close');
 assert.equal(engine.listenerCount('event'),listeners-1);
 stream.res.end();app.close();
});

test('PM remains one conversation per workspace/provider and concurrent first messages do not hire permanent agents',async t=>{
 const {engine,workspace,store,fake}=await fixture(t);
 const [first,second]=await Promise.all([engine.messagePM(workspace,'First request'),engine.messagePM(workspace,'Second request')]);
 assert.equal(first.id,second.id);assert.equal(store.tasks().filter(t=>t.kind==='pm').length,1);
 await until(()=>fake.runs.has(first.id));
 const cap=engine.running.get(first.id)!.capability;
 const worker=await engine.tool(cap,'spawn_task',{prompt:'Focused change',role:'Frontend',provider:'claude'});
 assert.equal(worker.role,'Frontend');assert.equal(worker.parentId,first.id);assert.equal(worker.kind,undefined);
 await assert.rejects(()=>engine.tool(cap,'spawn_task',{prompt:'invalid',role:'a'.repeat(81)}),/role/);
});

test('selected provider permission rules are validated, audited and returned to Claude unchanged',async t=>{
 const {engine,workspace,fake,store}=await fixture(t);
 const task=await engine.create({prompt:'read',workspace,provider:'claude'});await until(()=>fake.runs.has(task.id));
 const capability=engine.running.get(task.id)!.capability;
 const rule={type:'addRules',behavior:'allow',rules:[{toolName:'Read',ruleContent:'/project/**'}],destination:'session'};
 const input={file_path:'/project/readme'};
 const result=engine.tool(capability,'approve',{tool_name:'Read',input,permission_suggestions:[rule]});
 await until(()=>store.approvals().some(a=>a.status==='pending'));
 const request=store.approvals().find(a=>a.status==='pending')!;
 assert.throws(()=>engine.answer(request.id,true,'','claude:rule:999'),/tidak tersedia/);
 assert.equal(store.approvals()[0].status,'pending');
 engine.answer(request.id,true,'','claude:rule:0');
 assert.deepEqual(await result,{behavior:'allow',updatedInput:input,updatedPermissions:[rule]});
 assert.equal(store.approvals()[0].choice,'claude:rule:0');
 assert.throws(()=>engine.answer(request.id,true,'','claude:rule:0'),/already answered/);
 fake.finish(task.id);await until(()=>!engine.running.has(task.id));
});

test('manual compaction preserves task result and session, blocks overlaps and runs later user messages',async t=>{
 const {engine,workspace,store,fake}=await fixture(t);
 const task=store.createTask({prompt:'existing chat',workspace,provider:'codex',kind:'pm',sessionId:'saved',executionPath:workspace,status:'completed',result:'Previous answer'});
 await engine.compact(task.id);await until(()=>fake.runs.has(task.id));
 assert.equal(fake.runs.get(task.id)!.ctx.compact,true);assert.equal(fake.runs.get(task.id)!.ctx.prompt,'/compact');
 await assert.rejects(()=>engine.compact(task.id),/Tunggu/);
 await engine.message(task.id,'Next message');fake.finish(task.id,'Compacted');
 await until(()=>fake.runs.get(task.id)?.ctx.prompt==='Next message');
 assert.equal(store.task(task.id).result,'Previous answer');
 assert.ok(store.events(0,task.id).some(e=>e.type==='command_result'&&(e.data as any).success));
 fake.finish(task.id,'Next answer');await until(()=>!engine.running.has(task.id));
 assert.equal(store.task(task.id).result,'Next answer');
 await assert.rejects(()=>engine.messagePM(workspace,'!echo must-not-run'),/Terminal/);
});

test('per-provider auto permissions resolve actions immediately, preserve questions and audit decisions',async t=>{
 const {engine,workspace,store,fake}=await fixture(t);
 store.saveSettings({...store.settings(),permissions:{codex:'auto',claude:'manual'}});
 const task=await engine.create({prompt:'work',workspace,provider:'codex'});await until(()=>fake.runs.has(task.id));
 const ctx=fake.runs.get(task.id)!.ctx;
 const answer=await ctx.approve('item/commandExecution/requestApproval',{command:'npm test',availableDecisions:['accept','cancel']});
 assert.equal(answer.approved,true);assert.equal(store.approvals()[0].automatic,true);assert.equal(store.approvals()[0].status,'approved');
 assert.equal((await ctx.approve('unsupported_permissions',{})).approved,false);
 const unavailable=await ctx.approve('item/commandExecution/requestApproval',{availableDecisions:['cancel']});assert.equal(unavailable.approved,false);
 const question=ctx.approve('question',{question:'Pilih nama proyek?'});
 const pending=store.approvals().find(a=>a.status==='pending')!;assert.ok(pending);assert.equal(store.task(task.id).status,'waiting');
 engine.answer(pending.id,true,'Kantor');assert.equal((await question).answer,'Kantor');
 const confirmation=await ctx.approve('elicitation',{mode:'form',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}});assert.equal(confirmation.approved,true);
 const original=engine.store.task(task.id);original.provider='claude';store.saveTask(original);
 const manual=ctx.approve('permission',{tool_name:'Bash',input:{command:'npm test'}});
 assert.ok(store.approvals().some(a=>a.kind==='permission'&&a.status==='pending'));
 store.saveSettings({...store.settings(),permissions:{codex:'auto',claude:'auto'}});engine.applyPermissionSettings();
 assert.equal((await manual).approved,true);assert.ok(!store.approvals().some(a=>a.status==='pending'));
 fake.finish(task.id);await until(()=>!engine.running.has(task.id));
});

test('permission modes survive store reopen and legacy settings writes can preserve them',async t=>{
 const {dir}=await fixture(t);const path=join(dir,'permissions.db');const first=new Store(path);
 first.saveSettings({...first.settings(),permissions:{claude:'full',codex:'auto'}});first.close();
 const reopened=new Store(path);try{assert.deepEqual(reopened.settings().permissions,{claude:'full',codex:'auto'});}finally{reopened.close();}
});
