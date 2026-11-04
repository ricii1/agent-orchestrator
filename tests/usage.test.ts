import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {claudeQuota,codexQuota,parseClaudeQuota,parseCodexQuota,UsageService,type ProviderQuota} from '../src/usage.js';

test('quota normalization preserves genuine zero, missing windows, durations, and reset units',()=>{
  assert.deepEqual(parseClaudeQuota({five_hour:{utilization:0,resets_at:'2026-11-04T12:00:00Z'},seven_day:{utilization:38.5},seven_day_opus:null}),[
    {label:'5 jam',usedPercent:0,resetsAt:'2026-11-04T12:00:00.000Z'},
    {label:'7 hari',usedPercent:38.5,resetsAt:null},
  ]);
  assert.deepEqual(parseClaudeQuota({five_hour:{resets_at:'bad'}}),[]);
  const result=parseCodexQuota({rateLimits:{primary:{usedPercent:10}},rateLimitsByLimitId:{codex:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:100,windowDurationMins:10080}},other:{limitName:'Review',primary:{usedPercent:12,windowDurationMins:15}}}});
  assert.deepEqual(result.map(w=>w.label),['5 jam','7 hari','Review · 15 menit']);
  assert.equal(result[0].resetsAt,new Date(1800000000000).toISOString());
  assert.deepEqual(parseCodexQuota({rateLimits:{primary:{usedPercent:0,windowDurationMins:60}}}),[{label:'1 jam',usedPercent:0,resetsAt:null}]);
});

test('Claude quota uses server-side credential once; responses never include token or raw errors',async()=>{
  const credential=async()=>JSON.stringify({claudeAiOauth:{accessToken:'fake-secret-for-test',expiresAt:Date.now()+60000}});
  let called=0;
  const mock=async(url:unknown,init:any)=>{
    called++;assert.equal(url,'https://api.anthropic.com/api/oauth/usage');
    assert.equal(init.headers.Authorization,'Bearer fake-secret-for-test');assert.equal(init.redirect,'error');
    return new Response(JSON.stringify({five_hour:{utilization:15}}),{status:200});
  };
  const data=await claudeQuota(mock as typeof fetch,credential);assert.equal(data.status,'ok');assert.equal(called,1);assert.ok(!JSON.stringify(data).includes('fake-secret'));
  const denied=await claudeQuota((async()=>new Response('fake-secret-for-test',{status:401})) as typeof fetch,credential);
  assert.equal(denied.status,'login_required');assert.ok(!JSON.stringify(denied).includes('fake-secret'));
  const expired=await claudeQuota(mock as typeof fetch,async()=>JSON.stringify({claudeAiOauth:{accessToken:'expired',expiresAt:1}}));
  assert.equal(expired.status,'login_required');assert.equal(called,1);
});

test('Codex quota reads account limits via CLI without creating a task',async()=>{
  const old=process.env.CODEX_BIN;process.env.CODEX_BIN=resolve('tests/fake-cli.cjs');
  try{const data=await codexQuota();assert.equal(data.status,'ok');assert.equal(data.windows[0].usedPercent,26);assert.equal(data.windows[0].label,'5 jam');}
  finally{if(old===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=old;}
});

test('usage requests coalesce, cache, rate-limit manual refresh, and mark stale data after network failure',async()=>{
  let calls=0,now=100000,fail=false;
  const read=async():Promise<ProviderQuota>=>{calls++;await new Promise(r=>setTimeout(r,2));return fail?{status:'unavailable',windows:[],updatedAt:null,note:'offline'}:{status:'ok',windows:[{label:'5 jam',usedPercent:30,resetsAt:null}],updatedAt:'2026-11-04T12:00:00Z',note:''};};
  const service=new UsageService({claude:read,codex:read},()=>now);
  await Promise.all([service.get(),service.get(),service.get(true)]);assert.equal(calls,2);
  now+=10000;await service.get(true);assert.equal(calls,2);
  now+=60000;fail=true;const stale=await service.get();assert.equal(calls,4);
  assert.equal(stale.claude.status,'stale');assert.equal(stale.claude.windows[0].usedPercent,30);
});
