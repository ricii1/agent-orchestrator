import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Engine } from './engine.js';
import { Scheduler } from './scheduler.js';
import { UsageService } from './usage.js';
import { allowedWorkspace, browseFolders, contains, diff, merge, repoRoot } from './workspace.js';
import type { Settings } from './types.js';
const exec=promisify(execFile);
async function body(req: IncomingMessage) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON content-type is required');
  let bytes=0; const chunks: Buffer[]=[];
  for await (const chunk of req) { bytes+=chunk.length; if(bytes>256000) throw new Error('Request too large'); chunks.push(chunk); }
  const parsed=JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('JSON object required');
  return parsed;
}
const text=(value: unknown,name: string,max=100000): string=> { if(typeof value!=='string' || !value.trim() || value.length>max) throw new Error(`Invalid ${name}`); return value; };
const provider=(value: unknown)=> { if(value!=='claude' && value!=='codex') throw new Error('Invalid provider'); return value; };
export function server(engine: Engine,scheduler: Scheduler,publicDir: string,usage=new UsageService()) {
  const streams=new Set<ServerResponse>();
  let healthCache: {time:number;value:any} | undefined;
  const app=createServer(async(req,res)=> {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    const json=(status: number,value: unknown)=> { if(res.destroyed) return; res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(value)); };
    try {
      if(req.headers.host!==new URL(engine.url).host) return json(403,{error:'Invalid host'});
      if(req.headers.origin && req.headers.origin!==engine.url) return json(403,{error:'Invalid origin'});
      const url=new URL(req.url || '/',engine.url), path=url.pathname;
      const auth=req.headers.authorization?.replace(/^Bearer /,'') || '';
      if(path==='/internal/tool' && req.method==='POST') {
        if(!auth) return json(401,{error:'Task capability required'});
        const input=await body(req);
        return json(200,await engine.tool(auth,text(input.name,'tool',100),input.arguments || {}));
      }
      if(path.startsWith('/api/')) {
        if(req.method==='POST' && path==='/api/folders') {
          const input=await body(req);
          if(input.path!==undefined&&(typeof input.path!=='string'||!input.path.length||input.path.length>4096)) throw new Error('Invalid folder path');
          if(input.hidden!==undefined&&typeof input.hidden!=='boolean') throw new Error('Invalid hidden-folder option');
          return json(200,await browseFolders(input.path,input.hidden===true));
        }
        if(req.method==='GET' && path==='/api/usage') return json(200,await usage.get(url.searchParams.get('refresh')==='1'));
        if(req.method==='POST' && path==='/api/pm/messages') { const input=await body(req); return json(200,await engine.messagePM(text(input.workspace,'workspace',4096),text(input.text,'message'))); }
        if(req.method==='GET' && path==='/api/state') return json(200,{ tasks:engine.store.tasks(),approvals:engine.store.approvals(),schedules:engine.store.all('schedules'),settings:engine.store.settings() });
        if(req.method==='GET' && path==='/api/providers') {
          if(!healthCache || Date.now()-healthCache.time>30000) {
            const entries=await Promise.all(['claude','codex'].map(async p=> {
              try {
                const command=p==='claude' ? process.env.CLAUDE_BIN || 'claude' : process.env.CODEX_BIN || 'codex';
                const {stdout,stderr}=await exec(command,p==='claude' ? ['auth','status']:['login','status'],{timeout:10000});
                const state=p==='claude' ? JSON.parse(stdout).loggedIn : /Logged in/i.test(stdout+stderr);
                return [p,{available:!!state,message:state?'CLI login available':'Login required'}];
              } catch { return [p,{available:false,message:'CLI unavailable or login required. Run login in your terminal.'}]; }
            }));
            healthCache={time:Date.now(),value:Object.fromEntries(entries)};
          }
          return json(200,healthCache.value);
        }
        if(req.method==='GET' && path==='/api/events') {
          let cursor=Number(url.searchParams.get('after') || 0);
          if(!Number.isSafeInteger(cursor) || cursor<0) throw new Error('Invalid event cursor');
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
          res.flushHeaders();
          streams.add(res);
          let flushing=false;
          const flush=()=> {
            if(flushing || res.destroyed) return;
            flushing=true;
            try {
              for(;;) {
                const batch=engine.store.events(cursor);
                for(const event of batch) { cursor=event.id; if(!res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)) { res.destroy(); return; } }
                if(batch.length<500) break;
              }
            } finally { flushing=false; }
          };
          const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
          engine.on('event',flush); res.on('close',()=> { clearInterval(heartbeat); engine.off('event',flush); streams.delete(res); }); flush(); return;
        }
        const match=/^\/api\/tasks\/([^/]+)(?:\/(messages|cancel|resume|diff|merge|events))?$/.exec(path);
        if(match) {
          const [,id,action]=match; const task=engine.store.task(id);
          if(req.method==='GET' && action==='diff') return json(200,await diff(task));
          if(req.method==='GET' && action==='events') {
            if(url.searchParams.has('before')) {
              const before=Number(url.searchParams.get('before'));
              if(!Number.isSafeInteger(before)||before<1) throw new Error('Invalid history cursor');
              return json(200,engine.store.recentEvents(id,300,before));
            }
            if(url.searchParams.get('tail')==='1') return json(200,engine.store.recentEvents(id));
            const after=Number(url.searchParams.get('after') || 0); if(!Number.isSafeInteger(after) || after<0) throw new Error('Invalid cursor');
            return json(200,engine.store.events(after,id));
          }
          if(req.method==='POST') {
            const input=await body(req);
            if(action==='messages') { await engine.message(id,text(input.text,'message')); return json(200,{ok:true}); }
            if(action==='cancel') { engine.cancel(id); return json(200,{ok:true}); }
            if(action==='resume') { await engine.resume(id); return json(200,{ok:true}); }
            if(action==='merge') {
              if(input.confirm!==true || task.status!=='completed' || engine.running.has(id)) throw new Error('Review the completed worktree diff and explicitly confirm merge');
              // Serialized per repository, including while a Git subprocess is running.
              const repository=await repoRoot(task.workspace);
              if(!repository) throw new Error('Repository not found');
              if(merging.has(repository) || engine.running.has(id) || engine.store.task(id).status!=='completed') throw new Error('Task or repository is busy');
              merging.add(repository); engine.lockedTasks.add(id);
              try { const result=await merge(task); engine.event(id,'merge',result); return json(200,result); }
              catch(e) { engine.event(id,'merge_failed',{error:String(e)}); throw e; }
              finally { merging.delete(repository); engine.lockedTasks.delete(id); void engine.drain(); }
            }
          }
        }
        if(req.method==='POST' && path==='/api/tasks') { const input=await body(req); return json(201,await engine.create({prompt:text(input.prompt,'prompt'),workspace:text(input.workspace,'workspace',4096),provider:input.provider===undefined?undefined:provider(input.provider),model:typeof input.model==='string'?input.model:undefined})); }
        if(req.method==='POST' && path==='/api/approvals') { const input=await body(req); if(typeof input.approved!=='boolean') throw new Error('approved must be boolean'); engine.answer(text(input.id,'approval ID',100),input.approved,typeof input.answer==='string'?input.answer:''); return json(200,{ok:true}); }
        if(req.method==='PUT' && path==='/api/settings') {
          const input=await body(req);
          if(!Array.isArray(input.roots) || input.roots.length>30 || input.roots.some((x:unknown)=>typeof x!=='string')) throw new Error('Invalid workspace directories');
          const roots=await Promise.all(input.roots.map(async(p:string)=>allowedWorkspace(p,[p])));
          if(!Number.isInteger(input.maxWorkers) || input.maxWorkers<1 || input.maxWorkers>10) throw new Error('Worker limit must be 1–10');
          const settings:Settings={roots,coordinatorProvider:provider(input.coordinatorProvider),workerProvider:provider(input.workerProvider),maxWorkers:input.maxWorkers,claudeModel:typeof input.claudeModel==='string'?input.claudeModel:'',codexModel:typeof input.codexModel==='string'?input.codexModel:''};
          if(engine.running.size || engine.lockedTasks.size) throw new Error('Stop active agents before changing access settings');
          engine.store.saveSettings(settings); engine.event(null,'settings',settings); void engine.drain(); return json(200,settings);
        }
        if(req.method==='POST' && path==='/api/schedules') {
          const input=await body(req);
          const workspace=await allowedWorkspace(text(input.workspace,'workspace',4096),engine.store.settings().roots);
          return json(200,scheduler.save({id:typeof input.id==='string'?input.id:undefined,title:text(input.title,'title',200),prompt:text(input.prompt,'prompt'),workspace,provider:provider(input.provider),model:typeof input.model==='string'?input.model:'',cron:text(input.cron,'cron',100),timezone:text(input.timezone,'timezone',100),enabled:input.enabled===true}));
        }
        if(req.method==='DELETE' && path.startsWith('/api/schedules/')) { engine.store.db.prepare('DELETE FROM schedules WHERE id=?').run(path.split('/').pop()); engine.event(null,'schedule_deleted',{}); return json(200,{ok:true}); }
        return json(404,{error:'Not found'});
      }
      if(req.method!=='GET') return json(405,{error:'Method not allowed'});
      const target=join(publicDir,path==='/'?'index.html':decodeURIComponent(path));
      if(!contains(publicDir,target)) return json(403,{error:'Forbidden'});
      const actual=await realpath(target);
      if(!contains(publicDir,actual)) return json(403,{error:'Forbidden'});
      const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
      const bytes=await readFile(actual); res.writeHead(200,{'content-type':mime[extname(actual)] || 'application/octet-stream','cache-control':extname(actual)==='.html'?'no-store':'no-cache'}); res.end(bytes);
    } catch(error) { json(400,{error: error instanceof Error?error.message:String(error)}); }
  });
  const merging=new Set<string>();
  return { app, closeStreams:()=> { for(const res of streams) res.end(); } };
}
