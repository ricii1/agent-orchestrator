import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {Store} from '../src/store.js';
import {Engine} from '../src/engine.js';
import {Scheduler} from '../src/scheduler.js';
import {server} from '../src/server.js';
import {workspaceAgents,type Adapter,type RunContext,type WorkspaceAgents} from '../src/types.js';
import {git} from '../src/workspace.js';
import {pmFor,pmHistory,pmDraftKey,inWorkspace} from '../web/model.js';

const until=async(check:()=>boolean)=>{for(let n=0;n<500;n++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Timed out');};
class Fake implements Adapter {
  runs=new Map<string,{ctx:RunContext;resolve:(text:string)=>void}>();
  run(ctx:RunContext){let resolve!:(text:string)=>void;const done=new Promise<string>(r=>resolve=r);this.runs.set(ctx.task.id,{ctx,resolve});ctx.session('fake-'+ctx.task.id);return {done,cancel:()=>resolve('cancelled')};}
  finish(id:string){this.runs.get(id)!.resolve('done');}
}
class Response extends Writable {
  statusCode=200;chunks:string[]=[];
  setHeader(){} flushHeaders(){}
  writeHead(status:number){this.statusCode=status;return this;}
  _write(chunk:any,_encoding:any,callback:()=>void){this.chunks.push(String(chunk));callback();}
}
async function fixture(t:any){
  const dir=await mkdtemp(join(tmpdir(),'office-multi-')),a=join(dir,'A'),b=join(dir,'B');await Promise.all([mkdir(a),mkdir(b)]);
  const store=new Store(join(dir,'test.db'));store.saveSettings({...store.settings(),roots:[a],codexModel:'codex-global',claudeModel:'claude-global'});
  const fake=new Fake(),engine=new Engine(store,{codex:fake,claude:fake},dir,'http://127.0.0.1:4317');
  const scheduler=new Scheduler(engine),{app,closeStreams}=server(engine,scheduler,dir);
  const request=(path:string,method='GET',input?:unknown)=>{
    const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]) as any;
    req.url='/api/'+path;req.method=method;req.headers={host:'127.0.0.1:4317','content-type':'application/json'};
    const res=new Response();app.emit('request',req,res);return res;
  };
  const api=async(path:string,method='GET',input?:unknown)=>{const res=request(path,method,input);if(!res.writableFinished)await new Promise(r=>res.once('finish',r));return {status:res.statusCode,data:JSON.parse(res.chunks.join(''))};};
  const config=async(workspace:string,patch:Partial<WorkspaceAgents>,expected=workspaceAgents(store.settings(),workspace))=>api('workspaces/agents','PUT',{workspace,expected,agents:{...expected,...patch}});
  t.after(async()=>{closeStreams();app.close();await engine.shutdown();store.close();await rm(dir,{recursive:true,force:true});});
  return {dir,a,b,store,fake,engine,scheduler,api,config,request};
}

test('legacy settings fallback is side-effect free; scoped settings and task defaults persist across reload',async t=>{
  const {dir,a,store,config,engine}=await fixture(t);
  assert.equal(store.settings().workspaceAgents,undefined);
  assert.equal(workspaceAgents(store.settings(),a).coordinatorProvider,'codex');
  const configured=await config(a,{coordinatorProvider:'claude',workerProvider:'claude',claudeModel:'claude-A'});assert.equal(configured.status,200);
  const task=await engine.messagePM(a,'Persist snapshot');
  const reopened=new Store(join(dir,'test.db'));
  try{assert.equal(workspaceAgents(reopened.settings(),a).claudeModel,'claude-A');assert.equal(reopened.task(task.id).workerDefaults?.workerProvider,'claude');assert.equal(reopened.settings().coordinatorProvider,'codex');}finally{reopened.close();}
});

test('A active Codex permits canonical B registration, Claude PM and concurrent defaults without touching A approvals/session',async t=>{
  const {dir,a,b,store,fake,engine,api,config}=await fixture(t);
  const pmA=await engine.messagePM(a,'A continues');await until(()=>fake.runs.has(pmA.id));
  const pending=fake.runs.get(pmA.id)!.ctx.approve('question',{question:'A question'}),approval=store.approvals()[0];
  const before=store.task(pmA.id),settings=store.settings();
  const alias=join(dir,'B-alias');await symlink(b,alias);
  assert.equal((await api('workspaces','POST',{workspace:alias})).data.workspace,b);
  assert.equal((await api('workspaces','POST',{workspace:b})).status,200);assert.equal(store.settings().roots.length,2);
  assert.equal((await config(alias,{coordinatorProvider:'claude',workerProvider:'claude',claudeModel:'claude-B'})).status,200);
  const [pmB,duplicate]=await Promise.all([engine.messagePM(b,'B starts'),engine.messagePM(alias,'B second')]);assert.equal(pmB.id,duplicate.id);
  await until(()=>fake.runs.has(pmB.id));assert.equal(engine.running.has(pmA.id),true);
  assert.deepEqual(store.task(pmA.id),before);assert.equal(store.approvals()[0].status,'pending');
  assert.equal(store.settings().permissions,settings.permissions);assert.equal(store.settings().coordinatorProvider,'codex');
  const workerB=await engine.tool(engine.running.get(pmB.id)!.capability,'spawn_task',{prompt:'B worker'});
  assert.equal(workerB.provider,'claude');assert.equal(workerB.model,'claude-B');
  const workerA=await engine.tool(engine.running.get(pmA.id)!.capability,'spawn_task',{prompt:'A worker'});
  assert.equal(workerA.provider,'codex');assert.equal(workerA.model,'codex-global');
  engine.answer(approval.id,true,'A answer');assert.equal((await pending).answer,'A answer');
  assert.equal((await engine.tool(engine.running.get(pmA.id)!.capability,'get_status',{})).children[0].id,workerA.id);
  await assert.rejects(()=>engine.tool(engine.running.get(pmA.id)!.capability,'send_message',{taskId:workerB.id,message:'cross workspace'}),/does not belong/);
});

test('children snapshot parent workspace defaults even with another target, UI selection, global changes, and explicit overrides',async t=>{
  const {a,b,store,engine,api,config}=await fixture(t);await api('workspaces','POST',{workspace:b});
  await config(a,{workerProvider:'claude',claudeModel:'parent-model'});await config(b,{workerProvider:'codex',codexModel:'B-model'});
  const parent=await engine.messagePM(a,'parent');
  store.saveSettings({...store.settings(),workerProvider:'codex',claudeModel:'changed-global',workspaceAgents:{...store.settings().workspaceAgents,[a]:{...workspaceAgents(store.settings(),a),workerProvider:'codex'}}});
  const child=await engine.create({prompt:'child elsewhere',workspace:b,parentId:parent.id});
  assert.equal(child.provider,'claude');assert.equal(child.model,'parent-model');
  const explicit=await engine.create({prompt:'explicit',workspace:b,parentId:parent.id,provider:'codex',model:'explicit-model'});assert.equal(explicit.model,'explicit-model');assert.equal(explicit.provider,'codex');
  const empty=await engine.create({prompt:'provider default',workspace:b,parentId:parent.id,provider:'claude',model:''});assert.equal(empty.model,'');
  assert.equal(inWorkspace(child,a,store.tasks()),true);assert.equal(inWorkspace(child,b,store.tasks()),false);
});

test('legacy parent children resolve parent workspace rather than child target defaults',async t=>{
  const {a,b,store,engine,api,config}=await fixture(t);await api('workspaces','POST',{workspace:b});await config(a,{workerProvider:'claude',claudeModel:'legacy-A'});
  const parent=store.createTask({prompt:'old PM',workspace:a,provider:'codex',status:'completed'});
  const child=await engine.create({prompt:'child',workspace:b,parentId:parent.id});assert.equal(child.provider,'claude');assert.equal(child.model,'legacy-A');
});

test('scoped config blocks relevant active/queued children and merge locks, permits unrelated B, and validates capability boundary',async t=>{
  const {a,b,store,engine,api,config}=await fixture(t);await api('workspaces','POST',{workspace:b});
  const pm=await engine.messagePM(a,'active');
  assert.equal((await config(a,{coordinatorProvider:'claude'})).status,400);
  assert.equal((await config(b,{coordinatorProvider:'claude'})).status,200);
  const nested=join(a,'nested');await mkdir(nested);assert.equal((await config(nested,{workerProvider:'claude'})).status,400);
  engine.cancel(pm.id);await until(()=>!engine.running.has(pm.id));
  const child=store.createTask({prompt:'queued',workspace:b,parentId:pm.id,provider:'codex'});
  assert.equal((await config(a,{workerProvider:'claude'})).status,400);
  child.status='completed';store.saveTask(child);engine.lockedTasks.add(child.id);
  assert.equal((await config(a,{workerProvider:'claude'})).status,400);engine.lockedTasks.delete(child.id);
  for(const input of [
    {workspace:b,permissions:{codex:'full'}},
    {workspace:b,roots:[]},
    {workspace:'/etc',agents:workspaceAgents(store.settings(),b),expected:workspaceAgents(store.settings(),b)},
    {workspace:b,agents:{...workspaceAgents(store.settings(),b),codexModel:'bad\nmodel'},expected:workspaceAgents(store.settings(),b)},
  ])assert.equal((await api('workspaces/agents','PUT',input)).status,400);
  assert.equal((await api('workspaces','POST',{workspace:b,permissions:{codex:'full'}})).status,400);
});

test('global guard protects live roots and full modes; queued work and optimistic conflicts remain guarded',async t=>{
  const {a,b,store,engine,api,config}=await fixture(t);const old=store.settings();const pm=await engine.messagePM(a,'active');
  await api('workspaces','POST',{workspace:b});await config(b,{coordinatorProvider:'claude'});
  assert.equal((await api('settings','PUT',{...old,expectedSettings:old})).status,409);
  for(const patch of [{roots:[b]},{maxWorkers:9},{coordinatorProvider:'claude'},{permissions:{codex:'full'}}])assert.equal((await api('settings','PUT',{...store.settings(),...patch})).status,400);
  assert.equal((await api('settings','PUT',{...store.settings(),permissions:{codex:'auto'}})).status,200);
  assert.equal(workspaceAgents(store.settings(),b).coordinatorProvider,'claude');
  engine.cancel(pm.id);await until(()=>!engine.running.has(pm.id));
  const queued=store.createTask({prompt:'queued',workspace:a,provider:'codex'});
  assert.equal((await api('settings','PUT',{...store.settings(),roots:[b]})).status,400);
  queued.status='completed';store.saveTask(queued);
  assert.equal((await api('settings','PUT',{...store.settings(),roots:[b]})).status,200);
  await assert.rejects(()=>engine.create({prompt:'removed',workspace:a}),/outside/);
});

test('concurrent scoped writes compare expected values and concurrent registrations preserve both roots',async t=>{
  const {dir,b,store,api,config}=await fixture(t);const c=join(dir,'C');await mkdir(c);
  const adds=await Promise.all([api('workspaces','POST',{workspace:b}),api('workspaces','POST',{workspace:c})]);assert.ok(adds.every(r=>r.status===200));assert.equal(store.settings().roots.length,3);
  const expected=workspaceAgents(store.settings(),b);
  const writes=await Promise.all([config(b,{workerProvider:'claude'},expected),config(b,{codexModel:'different'},expected)]);
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
  assert.equal((await api('pm/messages','POST',{workspace:b,text:'stale composer',expectedAgents:expected})).status,400);assert.equal(store.tasks().length,0);
});

test('model/provider switches retain separate PM sessions, selector history and per-context drafts',async t=>{
  const {a,b,store,fake,engine,api,config}=await fixture(t);await api('workspaces','POST',{workspace:b});
  const old=await engine.messagePM(a,'codex session');await until(()=>fake.runs.has(old.id));fake.finish(old.id);await until(()=>!engine.running.has(old.id));
  const oldSettings=store.settings(),oldKey=pmDraftKey(a,oldSettings);
  await config(a,{coordinatorProvider:'claude',workerProvider:'claude',claudeModel:'claude-v1'});
  const claude=await engine.messagePM(a,'claude session');await until(()=>fake.runs.has(claude.id));fake.finish(claude.id);await until(()=>!engine.running.has(claude.id));
  await config(a,{claudeModel:'claude-v2'});const newer=await engine.messagePM(a,'new model');
  assert.notEqual(newer.id,claude.id);assert.notEqual(oldKey,pmDraftKey(a,store.settings()));assert.notEqual(pmDraftKey(a,store.settings()),pmDraftKey(b,store.settings()));
  assert.equal(pmFor(store.tasks(),a,'claude',workspaceAgents(store.settings(),a))?.id,newer.id);
  assert.deepEqual(new Set(pmHistory(store.tasks(),a).map(t=>t.id)),new Set([old.id,claude.id,newer.id]));
  assert.equal(store.task(old.id).provider,'codex');assert.equal(store.task(claude.id).model,'claude-v1');
  const history=await api('tasks/'+old.id+'/events?tail=1');assert.ok(history.data.some((e:any)=>e.type==='result'));
  assert.equal(pmDraftKey(b,oldSettings),pmDraftKey(b,store.settings()));
});

test('schedule explicit provider/model and legacy empty-model fallback survive workspace overrides',async t=>{
  const {a,store,engine,scheduler,config}=await fixture(t);await config(a,{coordinatorProvider:'claude',workerProvider:'claude',claudeModel:'workspace-claude',codexModel:'workspace-codex'});
  scheduler.minute=0;scheduler.save({title:'explicit',prompt:'scheduled',workspace:a,provider:'codex',model:'schedule-model',cron:'* * * * *',timezone:'UTC',enabled:true});
  scheduler.save({title:'empty',prompt:'scheduled',workspace:a,provider:'codex',model:'',cron:'* * * * *',timezone:'UTC',enabled:true});
  await scheduler.tick(new Date('2026-11-05T03:00:00Z'));
  const tasks=store.tasks();assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.provider==='codex'));
  assert.equal(tasks.find(t=>t.title==='explicit')?.model,'schedule-model');assert.equal(tasks.find(t=>t.title==='empty')?.model,'codex-global');
  assert.equal((await engine.create({prompt:'explicit task',workspace:a,provider:'codex',model:'task-model'})).model,'task-model');
});

test('parallel PM roots keep Git workers isolated and preserve source checkouts',async t=>{
  const {a,b,store,fake,engine,api}=await fixture(t);await api('workspaces','POST',{workspace:b});
  for(const path of [a,b]){await git(path,'init');await git(path,'config','user.name','Test');await git(path,'config','user.email','test@example.invalid');await writeFile(join(path,'source.txt'),'original');await git(path,'add','.');await git(path,'commit','-m','initial');}
  const [pmA,pmB]=await Promise.all([engine.messagePM(a,'A'),engine.messagePM(b,'B')]);await until(()=>fake.runs.has(pmA.id)&&fake.runs.has(pmB.id));
  const child=await engine.create({prompt:'isolated edit',workspace:a,parentId:pmA.id});await until(()=>fake.runs.has(child.id));
  assert.ok(store.task(child.id).branch);assert.notEqual(store.task(child.id).executionPath,a);
  await writeFile(join(store.task(child.id).executionPath!,'source.txt'),'worker');assert.equal(await readFile(join(a,'source.txt'),'utf8'),'original');
});

test('overlapping PM paths serialize while disjoint PM runs continue; alias first messages deduplicate',async t=>{
  const {dir,a,b,store,fake,engine,api}=await fixture(t);await api('workspaces','POST',{workspace:b});
  const alias=join(dir,'alias');await symlink(a,alias);const nested=join(a,'nested');await mkdir(nested);
  const [first,second]=await Promise.all([engine.messagePM(a,'one'),engine.messagePM(alias,'two')]);assert.equal(first.id,second.id);
  const overlapping=await engine.messagePM(nested,'nested');const other=await engine.messagePM(b,'other');await until(()=>fake.runs.has(first.id)&&fake.runs.has(other.id));
  assert.equal(store.task(overlapping.id).status,'queued');assert.equal(fake.runs.has(overlapping.id),false);
  engine.cancel(first.id);await until(()=>fake.runs.has(overlapping.id));
});

test('SSE retains workspace settings, task identity and pending approvals across concurrent PM roots',async t=>{
  const {a,b,store,fake,engine,api,request}=await fixture(t);
  const stream=request('events?after=0');t.after(()=>{stream.emit('close');stream.end();});
  const first=await engine.messagePM(a,'A');await until(()=>fake.runs.has(first.id));
  const pending=fake.runs.get(first.id)!.ctx.approve('question',{question:'A still pending'});
  await api('workspaces','POST',{workspace:b});const second=await engine.messagePM(b,'B');await until(()=>fake.runs.has(second.id));
  const frames=stream.chunks.join('');assert.ok(frames.includes('"type":"settings"'));assert.ok(frames.includes(first.id));assert.ok(frames.includes(second.id));assert.ok(frames.includes('A still pending'));
  const approval=store.approvals()[0];engine.answer(approval.id,true,'scoped answer');await pending;
  assert.ok(stream.chunks.join('').includes('"type":"approval_resolved"'));
  const history=await api('tasks/'+first.id+'/events?tail=1');assert.ok(history.data.every((event:any)=>event.taskId===first.id));
});

test('task admission rechecks roots after filesystem awaits and rejects stale PM configuration',async t=>{
  const {a,store,engine}=await fixture(t);const expected=workspaceAgents(store.settings(),a);
  const pending=engine.create({prompt:'race removal',workspace:a});store.saveSettings({...store.settings(),roots:[]});
  await assert.rejects(()=>pending,/no longer registered/);assert.equal(store.tasks().length,0);
  store.saveSettings({...store.settings(),roots:[a],coordinatorProvider:'claude'});
  await assert.rejects(()=>engine.messagePM(a,'stale',expected),/changed/);assert.equal(store.tasks().length,0);
});

test('manual compaction cannot bypass an overlapping active PM lock via historical session',async t=>{
  const {a,store,fake,engine}=await fixture(t);
  const current=await engine.messagePM(a,'active');await until(()=>fake.runs.has(current.id));
  const history=store.createTask({kind:'pm',prompt:'old',workspace:a,provider:'claude',status:'completed',sessionId:'old-session'});
  await assert.rejects(()=>engine.compact(history.id),/workspace/);assert.equal(store.task(history.id).status,'completed');
});

test('foreign non-Git workers and PMs cannot bypass overlapping write locks',async t=>{
  const {a,b,store,fake,engine,api}=await fixture(t);await api('workspaces','POST',{workspace:b});
  const parent=await engine.messagePM(a,'parent');await until(()=>fake.runs.has(parent.id));
  const worker=await engine.create({prompt:'write B',workspace:b,parentId:parent.id});await until(()=>fake.runs.has(worker.id));
  const pmB=await engine.messagePM(b,'B');assert.equal(store.task(pmB.id).status,'queued');
  fake.finish(worker.id);await until(()=>fake.runs.has(pmB.id));
  const second=await engine.create({prompt:'foreign write B',workspace:b,parentId:parent.id});assert.equal(store.task(second.id).status,'queued');
  assert.equal(fake.runs.has(second.id),false);
  engine.cancel(pmB.id);await until(()=>fake.runs.has(second.id));
});

test('maxWorkers remains global across concurrent PM roots',async t=>{
  const {a,b,store,fake,engine,api}=await fixture(t);await api('workspaces','POST',{workspace:b});store.saveSettings({...store.settings(),maxWorkers:1});
  const [first,second]=await Promise.all([engine.messagePM(a,'A'),engine.messagePM(b,'B')]);await until(()=>fake.runs.has(first.id)&&fake.runs.has(second.id));
  const one=await engine.create({prompt:'worker A',workspace:a,parentId:first.id});await until(()=>fake.runs.has(one.id));
  const two=await engine.create({prompt:'worker B',workspace:b,parentId:second.id});assert.equal(store.task(two.id).status,'queued');
  fake.finish(one.id);await until(()=>fake.runs.has(two.id));assert.equal(engine.running.has(first.id),true);assert.equal(engine.running.has(second.id),true);
});
