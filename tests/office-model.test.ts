import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freelancers,archive,pmFor,type Task} from '../web/model.ts';
const task=(id:string,overrides:Partial<Task>):Task=>({id,parentId:null,title:id,prompt:id,provider:'codex',model:'',workspace:'/project',executionPath:null,branch:null,baseCommit:null,sessionId:null,status:'queued',result:'',error:'',scheduleId:null,createdAt:'2026-11-04',updatedAt:'2026-11-04',...overrides});
test('only active freelancers appear in office; finished work remains in archive and PM stays separate',()=>{
 const tasks=[task('pm',{kind:'pm',status:'completed'}),task('active',{parentId:'pm',role:'Frontend',status:'running'}),task('waiting',{parentId:'pm',status:'waiting'}),task('done',{parentId:'pm',status:'completed'}),task('failed',{parentId:'pm',status:'failed'}),task('other',{parentId:'pm',workspace:'/another',status:'running'})];
 assert.deepEqual(freelancers(tasks,'/project').map(t=>t.id),['active','waiting']);
 assert.deepEqual(archive(tasks,'/project').map(t=>t.id),['done','failed']);
 assert.equal(pmFor(tasks,'/project','codex')?.id,'pm');assert.equal(pmFor(tasks,'/project','claude'),undefined);
});
