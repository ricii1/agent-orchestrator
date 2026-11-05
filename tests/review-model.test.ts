import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsReview,reviewTasks,ignoredReviewTasks,reviewReason} from '../web/model.js';
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

test('ignored task leaves attention count, stays visible as ignored in its workspace and restores',()=>{
  const failed=task('failed-a','/a','failed'),other=task('failed-b','/b','interrupted'),tasks=[failed,other],dismissals=[{taskId:failed.id,status:'failed' as const,updatedAt:failed.updatedAt}];
  assert.equal(needsReview(failed,'/a',tasks,dismissals),false);assert.deepEqual(reviewTasks(tasks,'/a',dismissals),[]);
  assert.deepEqual(ignoredReviewTasks(tasks,'/a',dismissals).map(t=>t.id),['failed-a']);
  assert.deepEqual(reviewTasks(tasks,'/b',dismissals).map(t=>t.id),['failed-b']);
  const retried={...failed,status:'interrupted' as const,updatedAt:'new-version'};
  assert.equal(needsReview(retried,'/a',[retried],dismissals),true);
  assert.deepEqual(reviewTasks(tasks,'/a',[]).map(t=>t.id),['failed-a']);
});
