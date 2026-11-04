// Isolated Apache integration test. Never opens the real office database.
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'kantor-proxy-'));
const backend=createServer((req,res)=>{
  if(req.headers.host!==`127.0.0.1:${backend.address().port}` || (req.headers.origin && req.headers.origin!==`http://127.0.0.1:${backend.address().port}`)){res.writeHead(403);res.end();return;}
  if(req.url==='/api/events'){
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write('id: 1\ndata: test\n\n');
    const interval=setInterval(()=>res.write(': heartbeat\n\n'),50);
    req.on('close',()=>clearInterval(interval));return;
  }
  if(req.url==='/internal/tool'){res.writeHead(req.headers.authorization==='Bearer fixture'?200:401);res.end();return;}
  res.setHeader('Content-Type','application/json');
  let body='';req.on('data',c=>body+=c);req.on('end',()=>res.end(JSON.stringify({method:req.method,body})));
});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
let apache;
try{
  const vhost=(await readFile(new URL('./kantor.test.conf',import.meta.url),'utf8')).replaceAll('127.0.0.1:80',`127.0.0.1:${port}`).replaceAll('4317',String(backend.address().port));
  const config=`ServerRoot "${dir}"
ServerName localhost
DefaultRuntimeDir "${dir}"
PidFile "${dir}/apache.pid"
ErrorLog "${dir}/error.log"
Listen 127.0.0.1:${port}
${['mpm_event','authz_core','authz_host','proxy','proxy_http','headers','rewrite'].map(m=>`LoadModule ${m}_module /usr/lib/apache2/modules/mod_${m}.so`).join('\n')}
${vhost}`;
  await writeFile(join(dir,'httpd.conf'),config);
  const syntax=spawnSync('/usr/sbin/apache2',['-t','-f',join(dir,'httpd.conf')],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  apache=spawn('/usr/sbin/apache2',['-X','-f',join(dir,'httpd.conf')],{stdio:'ignore'});
  const request=(path,options={})=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port,path,method:options.method||'GET',headers:{host:'kantor.test',...options.headers},signal:AbortSignal.timeout(3000)},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));
      const done=new Promise(r=>res.on('end',r));
      resolve({status:res.statusCode,headers:{get:k=>res.headers[k]},body:Readable.toWeb(res),json:async()=>{await done;return JSON.parse(Buffer.concat(chunks).toString());}});
    });req.on('error',reject);req.end(options.body);
  });
  for(let i=0;i<40;i++){try{await request('/');break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/state',{headers:{origin:'http://kantor.test'}})).status,200);
  const post=await request('/api/folders',{method:'POST',headers:{origin:'http://kantor.test','content-type':'application/json'},body:'{}'});
  assert.equal(post.status,200);assert.deepEqual(await post.json(),{method:'POST',body:'{}'});
  for(const origin of ['http://evil.test','null','http://kantor.test.evil','http://127.0.0.1:4317'])assert.equal((await request('/api/state',{headers:{origin}})).status,403);
  assert.equal((await request('/api/state',{headers:{host:'evil.test'}})).status,403);
  assert.equal((await request('/internal/tool')).status,401);
  assert.equal((await request('/internal/tool',{headers:{authorization:'Bearer fixture'}})).status,200);
  const stream=await request('/api/events',{headers:{origin:'http://kantor.test'}});
  assert.equal(stream.status,200);assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  const reader=stream.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/data: test/);await reader.cancel();
  console.log('PASS Apache syntax, page/API, JSON POST, exact Origin, foreign Host/Origin denial, capability preservation, unbuffered SSE');
}catch(e){console.error(await readFile(join(dir,'error.log'),'utf8').catch(()=>''));throw e;}finally{
  if(apache && apache.exitCode===null){apache.kill('SIGTERM');await new Promise(r=>apache.once('exit',r));}
  backend.closeAllConnections();await new Promise(r=>backend.close(r));
  await rm(dir,{recursive:true,force:true});
}
