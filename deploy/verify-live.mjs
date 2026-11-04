import assert from 'node:assert/strict';
import {request} from 'node:http';
import {lookup} from 'node:dns/promises';
import {networkInterfaces} from 'node:os';
function http(path,{host='kantor.test',headers={},method='GET',body}={}){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:host,port:80,path,method,headers,timeout:18000},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),headers:res.headers}));
    });req.on('timeout',()=>req.destroy(new Error('HTTP timeout')));req.on('error',reject);req.end(body);
  });
}
assert.equal((await lookup('kantor.test')).address,'127.0.0.1');
const page=await http('/');assert.equal(page.status,200);assert.match(page.headers['content-type'],/text\/html/);
const state=await http('/api/state',{headers:{origin:'http://kantor.test'}});assert.equal(state.status,200);assert.ok(Array.isArray(JSON.parse(state.body).tasks));
const post=await http('/api/folders',{method:'POST',headers:{origin:'http://kantor.test','content-type':'application/json'},body:JSON.stringify({path:'/home/ricii/gabut/orchestrator-agent'})});assert.equal(post.status,200);
for(const origin of ['http://evil.test','http://127.0.0.1:4317','null'])assert.equal((await http('/api/state',{headers:{origin}})).status,403);
assert.equal((await http('/internal/tool',{method:'POST',headers:{origin:'http://kantor.test','content-type':'application/json'},body:'{}'})).status,401);
assert.notEqual((await http('/api/state',{headers:{host:'evil.test'}})).status,200);
assert.equal((await http('/',{host:'127.0.0.1'})).status,200,'Existing localhost default site must remain available');
await new Promise((resolve,reject)=>{
  const req=request('http://kantor.test/api/events?after=9007199254740991',{headers:{origin:'http://kantor.test'},timeout:18000},res=>{
    assert.equal(res.statusCode,200);assert.match(res.headers['content-type'],/text\/event-stream/);
    res.once('data',chunk=>{try{assert.match(chunk.toString(),/: heartbeat/);resolve();}catch(e){reject(e);}finally{req.destroy();}});
  });req.on('timeout',()=>req.destroy(new Error('SSE heartbeat timed out')));req.on('error',reject);req.end();
});
let checked=0;
for(const item of Object.values(networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal)){
  const response=await http('/api/state',{host:item.address,headers:{host:'kantor.test'}});
  assert.notEqual(response.status,200,`App reachable via nonloopback destination ${item.address}`);checked++;
}
console.log(`PASS live: name resolution, page 200, API + Origin 200, JSON POST 200, foreign origins 403, internal capability required 401, SSE heartbeat, localhost default preserved, ${checked} nonloopback destination(s) cannot reach app API`);
