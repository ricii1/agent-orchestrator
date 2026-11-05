import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsReview,reviewTasks,reviewReason} from '../web/model.js';
import type {Task} from '../src/types.js';

const task=(id:string,workspace:string,status:Task['status'],parentId:string|null='pm')=>({id,kind:undefined,role:'Builder',parentId,title:id,prompt:'',provider:'codex',model:'',workspace,executionPath:null,branch:null,baseCommit:null,sessionId:null,status,result:'',error:'',scheduleId:null,createdAt:'',updatedAt:id} as Task);

test('review predicate and list agree on failed/interrupted children in active workspace only',()=>{
  const tasks=[task('pm-a','/a','completed',null),task('failed-a','/a','failed'),task('cut-a','/a','interrupted'),task('done-a','/a','completed'),task('cancel-a','/a','cancelled'),task('failed-b','/b','failed')];
  assert.deepEqual(reviewTasks(tasks,'/a').map(t=>t.id),['failed-a','cut-a']);
  assert.equal(tasks.filter(t=>needsReview(t,'/a',tasks)).length,reviewTasks(tasks,'/a').length);
  assert.equal(needsReview(tasks[0]!, '/a', tasks),false);
  assert.match(reviewReason(tasks[1]!),/gagal/);
  assert.match(reviewReason(tasks[2]!),/terputus/);
  assert.equal(reviewReason(tasks[4]!),'');
});
