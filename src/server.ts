import {Terminals} from './terminal.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Engine } from './engine.js';
import { Scheduler } from './scheduler.js';
import { UsageService } from './usage.js';
import { isTextDocument, openLocalDocument as openDocument, readDocument, readPreview } from './artifacts.js';
import {TaskNotifications,type NativeSender} from './notifications.js';
import { allowedWorkspace, browseFolders, contains, diff, merge, repoRoot } from './workspace.js';
import { active, sameWorkspaceAgents, workspaceAgents, type Settings, type WorkspaceAgents } from './types.js';
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
const html=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const js=(value:string)=>JSON.stringify(value).replace(/</g,'\\u003c');
export type ServerOptions={openLocal?:typeof openDocument;nativeSender?:NativeSender};
export function server(engine: Engine,scheduler: Scheduler,publicDir: string,usage=new UsageService(),options:ServerOptions={}) {
  const openLocal=options.openLocal||openDocument,nativeSender=options.nativeSender;
  const streams=new Set<ServerResponse>();
  const terminals=new Terminals(()=>engine.store.settings().roots);
  const taskNotifications=new TaskNotifications(engine,nativeSender);
  const notificationListener=(event:any)=>{void taskNotifications.onEvent(event).catch(()=>{});};
  engine.on('event',notificationListener);
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
        if(req.method==='GET' && path==='/api/previews') {
          const workspace=url.searchParams.get('workspace')||'',file=url.searchParams.get('path')||'';
          try{const preview=await readPreview(file,workspace,engine.store.settings().roots,engine.store.tasks());res.writeHead(200,{'content-type':preview.mime,'content-length':preview.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(preview.bytes);return;}
          catch(previewError){if(!isTextDocument(file))throw previewError;const doc=await readDocument(file,workspace,engine.store.settings().roots,engine.store.tasks()),query=`workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(file)}`,name=file.split(/[\\/]/).at(-1)||'dokumen';const page=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(name)}</title><style>body{font:16px system-ui;max-width:860px;margin:3rem auto;padding:0 1rem;color:#242820}button,a{font:inherit;padding:.6rem 1rem;margin-right:.5rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f3ed;padding:1rem;border-radius:8px}</style><h1>${html(name)}</h1><p>Aplikasi lokal berjalan di laptop tempat backend Orchestrator berjalan.</p><button id="open">Buka di aplikasi lokal</button><a href="/api/document-text?${query}">Lihat teks</a><a download="${html(name)}" href="/api/document-text?${query}&amp;download=1">Unduh</a><p id="status" role="status"></p><pre id="text" hidden>${html(doc.text)}</pre><script>document.querySelector('#open').onclick=async()=>{const s=document.querySelector('#status');try{const r=await fetch('/api/open-local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace:${js(workspace)},path:${js(file)}})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Opener tidak tersedia');s.textContent='Dokumen dibuka di aplikasi lokal.'}catch(e){s.textContent='Aplikasi lokal tidak tersedia: '+e.message+' Teks aman tersedia di bawah.';document.querySelector('#text').hidden=false}}</script></html>`;res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"});res.end(page);return;}
        }
        if(req.method==='POST' && path==='/api/open-local') { const input=await body(req);return json(200,await openLocal(text(input.path,'path',4096),text(input.workspace,'workspace',4096),engine.store.settings().roots,engine.store.tasks())); }
        if(req.method==='GET' && path==='/api/document-text') { const file=await readDocument(url.searchParams.get('path')||'',url.searchParams.get('workspace')||'',engine.store.settings().roots,engine.store.tasks());res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',...(url.searchParams.get('download')==='1'?{'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.path.split(/[\\/]/).at(-1)||'document.txt')}`}:{})});res.end(file.text);return; }
        if(path==='/api/terminals'&&req.method==='POST'){const input=await body(req);return json(200,await terminals.open(text(input.workspace,'workspace',4096)));}
        const terminalMatch=/^\/api\/terminals\/([a-f0-9-]+)$/.exec(path);
        if(terminalMatch){
          const id=terminalMatch[1];
          if(req.method==='GET'){const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid terminal cursor');return json(200,terminals.read(id,after));}
          if(req.method==='POST'){const input=await body(req);if(input.action==='close')terminals.close(id);else if(input.action==='resize')terminals.resize(id,input.cols,input.rows);else if(input.action==='input')terminals.input(id,input.data);else throw new Error('Unknown terminal action');return json(200,{ok:true});}
        }

        if(req.method==='POST' && path==='/api/folders') {
          const input=await body(req);
          if(input.path!==undefined&&(typeof input.path!=='string'||!input.path.length||input.path.length>4096)) throw new Error('Invalid folder path');
          if(input.hidden!==undefined&&typeof input.hidden!=='boolean') throw new Error('Invalid hidden-folder option');
          return json(200,await browseFolders(input.path,input.hidden===true));
        }
        if(req.method==='GET' && path==='/api/usage') return json(200,await usage.get(url.searchParams.get('refresh')==='1'));
        if(req.method==='POST' && path==='/api/pm/messages') { const input=await body(req); return json(200,await engine.messagePM(text(input.workspace,'workspace',4096),text(input.text,'message'),input.expectedAgents)); }
        if(req.method==='GET' && path==='/api/state') return json(200,{ capabilities:{permissionModes:true},tasks:engine.store.tasks(),reviewDismissals:engine.store.reviewDismissals(),statusVersions:engine.store.statusVersions(),terminals:terminals.summary(),approvals:engine.store.approvals(),schedules:engine.store.all('schedules'),settings:engine.store.settings() });
        if(path==='/api/notifications'&&req.method==='GET')return json(200,{preferences:taskNotifications.preferences(),capability:await taskNotifications.status()});
        if(path==='/api/notifications'&&req.method==='PUT'){await taskNotifications.status();return json(200,{preferences:taskNotifications.setPreferences(await body(req))});}
        if(path==='/api/notifications/claim'&&req.method==='POST'){const input=await body(req);return json(200,{claimed:taskNotifications.claim(text(input.key,'notification key',256))});}
        if(path==='/api/notifications/test'&&req.method==='POST'){await body(req);await taskNotifications.test();return json(200,{ok:true});}
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
            if(flushing || res.destroyed || res.writableEnded) return;
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
        const match=/^\/api\/tasks\/([^/]+)(?:\/(messages|cancel|resume|diff|merge|events|compact|review-dismissal))?$/.exec(path);
        if(match) {
          const [,id,action]=match; const task=engine.store.task(id);
          if(req.method==='GET' && action==='diff') return json(200,await diff(task));
          if(req.method==='GET' && action==='events') {
            if(url.searchParams.get('sync')==='1')return json(200,{after:engine.store.syncCursor(id)});
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
            if(action==='compact'){await engine.compact(id);return json(200,{ok:true});}
            if(action==='cancel') { engine.cancel(id); return json(200,{ok:true}); }
            if(action==='resume') { await engine.resume(id); return json(200,{ok:true}); }
            if(action==='review-dismissal') {
              if(Object.keys(input).some(key=>key!=='ignored'&&key!=='expected')||typeof input.ignored!=='boolean'||!input.expected||typeof input.expected!=='object'||Array.isArray(input.expected)||Object.keys(input.expected).length!==2||Object.keys(input.expected).some(key=>key!=='status'&&key!=='updatedAt'))throw new Error('Expected task version and ignored flag are required');
              if(!['failed','interrupted'].includes(input.expected.status))throw new Error('Invalid expected task status');
              const expected={status:input.expected.status,updatedAt:text(input.expected.updatedAt,'expected updatedAt',100)} as const;
              if(!task.parentId)throw new Error('Only child tasks can be ignored');
              const parent=engine.store.task(task.parentId);
              await allowedWorkspace(parent.workspace,engine.store.settings().roots);
              if(!engine.store.setReviewDismissal(id,input.ignored,expected))return json(409,{error:'Tugas berubah sejak terakhir ditampilkan. Daftar sudah diperbarui; tinjau versi terbaru sebelum memilih lagi.'});
              return json(200,{ok:true});
            }
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
        if(req.method==='POST' && path==='/api/approvals') { const input=await body(req); if(typeof input.approved!=='boolean') throw new Error('approved must be boolean'); engine.answer(text(input.id,'approval ID',100),input.approved,typeof input.answer==='string'?input.answer:'',input.choice===undefined?undefined:text(input.choice,'approval choice',100)); return json(200,{ok:true}); }
        // Deliberately additive: never accepts root removal, permissions, or global defaults.
        if(req.method==='POST' && path==='/api/workspaces') {
          const input=await body(req);
          if(Object.keys(input).some(key=>key!=='workspace')) throw new Error('Only workspace registration is allowed');
          const location=text(input.workspace,'workspace',4096);
          const workspace=await allowedWorkspace(location,[location]);
          const latest=engine.store.settings();
          if(!latest.roots.includes(workspace)) {
            if(latest.roots.length>=30) throw new Error('At most 30 workspace directories');
            const settings={...latest,roots:[...latest.roots,workspace]};
            engine.store.saveSettings(settings);engine.event(null,'settings',settings);
          }
          return json(200,{workspace});
        }
        if(req.method==='PUT' && path==='/api/workspaces/agents') {
          const input=await body(req);
          if(Object.keys(input).some(key=>!['workspace','agents','expected'].includes(key))) throw new Error('Only workspace agent configuration is allowed');
          const workspace=await allowedWorkspace(text(input.workspace,'workspace',4096),engine.store.settings().roots);
          const value=input.agents;
          if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||Object.keys(value).some(key=>!['coordinatorProvider','workerProvider','claudeModel','codexModel'].includes(key))) throw new Error('Invalid workspace agent configuration');
          for(const key of ['claudeModel','codexModel']) if(typeof value[key]!=='string'||value[key].length>200||/[\r\n\0]/.test(value[key])) throw new Error('Invalid model');
          const agents:WorkspaceAgents={coordinatorProvider:provider(value.coordinatorProvider),workerProvider:provider(value.workerProvider),claudeModel:value.claudeModel,codexModel:value.codexModel};
          const latest=engine.store.settings();
          if(!latest.roots.some(root=>contains(root,workspace))) throw new Error('Workspace is no longer registered');
          const previous=workspaceAgents(latest,workspace);
          const same=sameWorkspaceAgents;
          if(!same(input.expected,previous)) return json(409,{error:'Konfigurasi workspace berubah. Muat ulang pengaturan sebelum menyimpan.'});
          if(!same(agents,previous)) {
            const overlaps=(path:string)=>contains(path,workspace)||contains(workspace,path);
            const tasks=engine.store.tasks();
            if(tasks.some(task=>(active(task.status)||engine.running.has(task.id)||engine.lockedTasks.has(task.id)) && (overlaps(task.workspace)||!!task.parentId&&overlaps(tasks.find(t=>t.id===task.parentId)?.workspace||task.workspace)))) throw new Error('Selesaikan agent dan freelancer workspace ini sebelum mengubah provider/model. Workspace lain tetap dapat berjalan.');
          }
          const settings={...latest,workspaceAgents:{...latest.workspaceAgents,[workspace]:agents}};
          engine.store.saveSettings(settings);engine.event(null,'settings',settings);return json(200,settings);
        }
        if(req.method==='PUT' && path==='/api/settings') {
          const input=await body(req);
          if(!Array.isArray(input.roots) || input.roots.length>30 || input.roots.some((x:unknown)=>typeof x!=='string')) throw new Error('Invalid workspace directories');
          const roots=await Promise.all(input.roots.map(async(p:string)=>allowedWorkspace(p,[p])));
          if(!Number.isInteger(input.maxWorkers) || input.maxWorkers<1 || input.maxWorkers>10) throw new Error('Worker limit must be 1–10');
          const previous=engine.store.settings();
          if(input.expectedSettings!==undefined&&JSON.stringify(input.expectedSettings)!==JSON.stringify(previous)) return json(409,{error:'Settings changed. Reload before saving.'});
          const permissions=input.permissions===undefined?previous.permissions??{}:input.permissions;
          if(!permissions||typeof permissions!=='object'||Array.isArray(permissions)||Object.keys(permissions).some(key=>!['claude','codex'].includes(key))||Object.values(permissions).some(mode=>typeof mode!=='string'||!['manual','auto','full'].includes(mode)))throw new Error('Mode izin harus manual, auto atau full untuk setiap provider');
          for(const name of ['claude','codex'] as const){
            const old=previous.permissions?.[name]||'manual',next=permissions[name]||'manual';
            if(old!==next&&(old==='full'||next==='full')&&[...engine.running.keys()].some(id=>engine.store.task(id).provider===name))throw new Error('Selesaikan atau hentikan agent '+name+' sebelum mengubah Akses penuh.');
          }
          const settings:Settings={workspaceAgents:previous.workspaceAgents,permissions,roots,coordinatorProvider:provider(input.coordinatorProvider),workerProvider:provider(input.workerProvider),maxWorkers:input.maxWorkers,claudeModel:typeof input.claudeModel==='string'?input.claudeModel:'',codexModel:typeof input.codexModel==='string'?input.codexModel:''};
          const accessChanged=(['roots','coordinatorProvider','workerProvider','maxWorkers','claudeModel','codexModel'] as const).some(key=>JSON.stringify(previous[key])!==JSON.stringify(settings[key]));
          if((engine.store.tasks().some(t=>active(t.status)) || engine.running.size || engine.lockedTasks.size || terminals.summary().some(s=>s.exitCode===null))&&accessChanged)throw new Error('Stop active agents before changing access settings');
          engine.store.saveSettings(settings); engine.event(null,'settings',settings); engine.applyPermissionSettings(); void engine.drain(); return json(200,settings);
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
  app.on('close',()=>{terminals.shutdown();engine.off('event',notificationListener);});
  return { app, closeStreams:()=> { for(const res of streams) res.end(); } };
}
