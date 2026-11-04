import { mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { CodexAdapter } from './adapters/codex.js';
import { Scheduler } from './scheduler.js';
import { server } from './server.js';
process.umask(0o077);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(process.env.ORCHESTRATOR_DATA_DIR || join(root,'.data'));
mkdirSync(dataDir,{recursive:true,mode:0o700}); chmodSync(dataDir,0o700);
const port=Number(process.env.PORT || 4317);
if(!Number.isInteger(port) || port<1 || port>65535) throw new Error('Invalid PORT');
const url=`http://127.0.0.1:${port}`;
const lock=join(dataDir,'daemon.pid');
try { const fd=openSync(lock,'wx',0o600); writeFileSync(fd,String(process.pid)); closeSync(fd); }
catch {
  const old=Number(readFileSync(lock,'utf8'));
  try { process.kill(old,0); throw new Error('Another daemon is using this data directory'); }
  catch(e:any) { if(e.code!=='ESRCH') throw e; unlinkSync(lock); writeFileSync(lock,String(process.pid),{mode:0o600,flag:'wx'}); }
}
process.on('exit',()=> { try { unlinkSync(lock); } catch {} });
const store=new Store(join(dataDir,'office.db')); store.recover();
const engine=new Engine(store,{claude:new ClaudeAdapter(),codex:new CodexAdapter()},dataDir,url);
engine.bridge=join(root,'dist','mcp.js');
const scheduler=new Scheduler(engine);
const {app,closeStreams}=server(engine,scheduler,join(root,'public'));
app.listen(port,'127.0.0.1',()=> { console.log(`Agent Office: ${url}`); scheduler.start(); void engine.drain(); });
app.on('error',e=> { console.error(e.message); process.exit(1); });
let stopping=false;
async function shutdown() {
  if(stopping) return; stopping=true; scheduler.stop(); closeStreams();
  const closed=new Promise<void>(resolve=>app.close(()=>resolve()));
  await engine.shutdown(); app.closeAllConnections(); await closed; store.close();
}
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>void shutdown().catch(e=> { console.error(e); process.exit(1); }));
