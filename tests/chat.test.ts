import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {chatEntries,workerChats} from '../web/chat.js';

test('worker transcript keeps instructions, activity and replies without duplicate result',()=>{
 const store=new Store(':memory:');
 try{
  const worker=store.createTask({prompt:'Check deployment',role:'DevOps',parentId:'pm',workspace:'/project',provider:'codex'});
  const record=(type:string,data:unknown)=>store.event(worker.id,type,data);
  record('created',worker);record('turn_started',{text:worker.prompt});
  record('tool',{command:'git status'});record('tool_output',{itemId:'cmd',text:'first\n'});record('tool_output',{itemId:'cmd',text:'second'});
  record('message',{text:'Deployment ready'});record('result',{text:'Deployment ready'});
  const entries=chatEntries(worker,[...store.events(0,worker.id),store.event('pm','message',{text:'Another chat'})]);
  assert.deepEqual(entries.filter(e=>e.kind==='message').map(e=>[e.speaker,e.text]),[['PM','Check deployment'],['DevOps','Deployment ready']]);
  assert.equal(entries.find(e=>e.text==='Menjalankan perintah')?.detail,'git status');
  assert.equal(entries.find(e=>e.text==='Output tool')?.detail,'first\nsecond');
  assert.equal(chatEntries(worker,[])[0].text,worker.prompt);
  worker.status='completed';worker.result='Saved result';
  assert.equal(chatEntries(worker,[]).at(-1)?.text,'Saved result');
  const live={...worker,id:'live',status:'running' as const};
  assert.deepEqual(workerChats([worker,{...worker,id:'other',workspace:'/other'},live],'/project').map(t=>t.id),['live',worker.id]);
  const parent={...worker,id:'pm',kind:'pm' as const,parentId:null};
  assert.ok(workerChats([parent,{...worker,workspace:'/project/.git'}],'/project').some(t=>t.id===worker.id));
 }finally{store.close();}
});

test('transcript history pages preserve task scope, ordering and exclude text deltas',()=>{
 const store=new Store(':memory:');
 try{
  for(let n=0;n<620;n++){store.event('worker','message',{text:String(n)});store.event('worker','text',{text:'delta'});store.event('other','message',{text:'unrelated'});}
  const latest=store.recentEvents('worker'),older=store.recentEvents('worker',300,latest[0].id),first=store.recentEvents('worker',300,older[0].id);
  const all=[...first,...older,...latest];
  assert.equal(all.length,620);assert.deepEqual(all.map(e=>(e.data as any).text),Array.from({length:620},(_,n)=>String(n)));
  assert.ok(all.every(e=>e.taskId==='worker'&&e.type==='message'));
 }finally{store.close();}
});

test('transcript deltas coalesce per turn and a completed message supersedes its deltas once',()=>{
 const store=new Store(':memory:');
 try{
  const task=store.createTask({prompt:'Start',workspace:'/project',provider:'codex',kind:'pm'});
  const record=(type:string,text:string)=>store.event(task.id,type,{text});
  record('created','Start');record('turn_started','');record('text','partial ');record('text','answer');record('message','partial answer');
  record('user_message','Next');record('turn_started','Next');record('text','second turn');
  const messages=chatEntries(task,store.events(0,task.id)).filter(e=>e.kind==='message').map(e=>e.text);
  assert.deepEqual(messages,['Start','partial answer','Next','second turn']);
  const live=chatEntries(task,store.events(0,task.id).filter(e=>e.type!=='message')).filter(e=>e.kind==='message');
  assert.deepEqual(live.map(e=>e.text),['Start','partial answer','Next','second turn']);
 }finally{store.close();}
});
