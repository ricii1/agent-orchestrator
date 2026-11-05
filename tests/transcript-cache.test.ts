import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTranscriptEvent,TRANSCRIPT_EVENT_LIMIT,TRANSCRIPT_TEXT_LIMIT} from '../web/transcript-cache.js';
import type {Event} from '../web/model.js';
import {chatEntries} from '../web/chat.js';
import type {Task} from '../web/model.js';

const event=(id:number,type:string,text='')=>({id,taskId:'task',type,data:{text},createdAt:new Date(id).toISOString()}) as Event;

test('out-of-order deltas retain immutable IDs and render in exact order',()=>{
 let cache:Event[]=[];
 for(const item of [event(1,'text','A'),event(3,'text','C'),event(2,'text','B')])cache=mergeTranscriptEvent(cache,item);
 assert.deepEqual(cache.map(item=>item.id),[1,2,3]);
 assert.equal(cache.map(item=>(item.data as any).text).join(''),'ABC');
 const task={id:'task',parentId:null,prompt:'',result:'',workspace:'/fixture',provider:'codex',createdAt:'',updatedAt:'',status:'running',title:'PM'} as Task;
 assert.equal(chatEntries(task,cache).find(item=>item.kind==='message')?.text,'ABC');
});

test('replay deduplication and raw event/text budgets hold after more than 1000 chunks',()=>{
 let cache:Event[]=[];
 for(let id=1;id<=1100;id++)cache=mergeTranscriptEvent(cache,event(id,'text','x'));
 assert.equal(cache.length,TRANSCRIPT_EVENT_LIMIT);
 assert.equal(cache.reduce((sum,item)=>sum+(item.data as any).text.length,0),TRANSCRIPT_EVENT_LIMIT);
 const before=cache;
 cache=mergeTranscriptEvent(cache,event(1100,'text','x'));
 assert.equal(cache,before,'duplicate retained ID does not append text');
 cache=mergeTranscriptEvent(cache,event(1,'text','x'));
 assert.deepEqual(cache,before,'replay outside the retained window cannot displace or duplicate current transcript');
 let large:Event[]=[];for(let id=1;id<=4;id++)large=mergeTranscriptEvent(large,event(id,'text','x'.repeat(9000)));
 assert.ok(large.reduce((sum,item)=>sum+(item.data as any).text.length,0)<=TRANSCRIPT_TEXT_LIMIT);
});

test('final messages remove only their turn deltas across tools and preserve later turns',()=>{
 let cache:Event[]=[];
 const sequence=[event(1,'created','prompt'),event(2,'turn_started'),event(3,'text','first '),event(4,'tool','read'),event(5,'text','turn'),event(6,'message','first turn'),event(7,'user_message','next'),event(8,'turn_started'),event(9,'text','second '),event(10,'tool','write'),event(11,'text','turn'),event(12,'message','second turn'),event(13,'status','completed')];
 for(const item of sequence)cache=mergeTranscriptEvent(cache,item);
 assert.deepEqual(cache.map(item=>item.id),[1,2,4,6,7,8,10,12]);
 assert.equal(mergeTranscriptEvent(cache,event(6,'message','first turn')),cache);
});
