// Local-document opening acceptance: isolated DB/workspace, fake opener, cached Playwright and system Chrome.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Store} from '../../../src/store.js';
import {Engine} from '../../../src/engine.js';
import {Scheduler} from '../../../src/scheduler.js';
import {server} from '../../../src/server.js';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url))),output=fileURLToPath(new URL('./evidence/',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'local-file-open-e2e-')),publicDir=join(scratch,'public'),dataDir=join(scratch,'data'),workspace=join(scratch,'registered-workspace');
await Promise.all([mkdir(publicDir,{recursive:true}),mkdir(dataDir),mkdir(workspace)]);
const doc='docs/ux/realtime-integration/README.md',docPath=join(workspace,doc),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64');
await mkdir(join(workspace,'docs/ux/realtime-integration'),{recursive:true});await writeFile(docPath,'# Local open fixture\nSafe text content.\n');await writeFile(join(workspace,'fixture.png'),png);
const vite=resolve(root,'node_modules/vite/bin/vite.js');execFileSync(process.execPath,[vite,'build','--outDir',publicDir,'--emptyOutDir'],{cwd:root,stdio:'inherit'});
const store=new Store(join(dataDir,'office.db'));store.saveSettings({...store.settings(),roots:[workspace]});
const markdown=[`[README](${docPath})`,'[Image](fixture.png)'].join('\n');
const fake={run(ctx){let finish;const done=new Promise(resolve=>finish=resolve);ctx.session('local-open-e2e-session');ctx.event('message',{text:markdown});return {done,cancel(){finish('fixture stopped');}};}};
const engine=new Engine(store,{claude:fake,codex:fake},dataDir,'http://127.0.0.1:0'),quota={status:'unavailable',windows:[],updatedAt:null,note:'E2E fixture'};
const launches=[];let failLaunch=false;
const {app,closeStreams}=server(engine,new Scheduler(engine),publicDir,{get:async()=>({codex:quota,claude:quota})},{openLocal:async(path,rootPath,roots,tasks)=>{const {openLocalDocument}=await import('../../../src/artifacts.js');return openLocalDocument(path,rootPath,roots,tasks,async argv=>{launches.push(argv);if(failLaunch)throw new Error('Fake desktop opener unavailable');});}});
const {chromium}=await import(process.env.LOCAL_PREVIEW_PLAYWRIGHT||join(homedir(),'.cache/ms-playwright-go/1.50.1/package/index.mjs'));
let browser;
try{
 await engine.messagePM(workspace,'Show the README and image.');for(let i=0;i<100&&!engine.running.size;i++)await new Promise(r=>setTimeout(r,25));assert.equal(engine.running.size,1);
 await new Promise(ok=>app.listen(0,'127.0.0.1',ok));engine.url=`http://127.0.0.1:${app.address().port}`;
 browser=await chromium.launch({executablePath:process.env.LOCAL_PREVIEW_CHROMIUM||'/usr/bin/google-chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1300,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const openedPosts=[];page.on('request',req=>{if(req.url().includes('/api/open-local'))openedPosts.push(req.postDataJSON());});
 await page.goto(engine.url);const docLink=page.getByRole('link',{name:'Buka di aplikasi lokal · README'});await docLink.waitFor();
 await docLink.click();await page.getByRole('heading',{name:'Dokumen dibuka'}).waitFor();assert.equal(launches.length,1);assert.deepEqual(openedPosts[0],{workspace,path:docPath});await page.getByRole('button',{name:'Tutup'}).click();
 failLaunch=true;await docLink.focus();await page.keyboard.press('Enter');await page.getByText('Fake desktop opener unavailable',{exact:false}).waitFor();assert.equal(launches.length,2);assert.equal(openedPosts.length,2);assert.equal(await page.locator('pre.result').innerText(),'# Local open fixture\nSafe text content.\n');await page.getByRole('button',{name:'Tutup'}).click();
 const direct=`${engine.url}/api/previews?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(docPath)}`;const landing=await context.newPage();const getOpenCalls=launches.length;await landing.goto(direct);await landing.getByRole('button',{name:'Buka di aplikasi lokal'}).waitFor();assert.equal(launches.length,getOpenCalls,'GET must not invoke opener');assert.ok((await landing.locator('body').innerText()).includes('laptop tempat backend'));
 failLaunch=true;await landing.getByRole('button',{name:'Buka di aplikasi lokal'}).click();await landing.getByText('Fake desktop opener unavailable',{exact:false}).waitFor();assert.equal(await landing.locator('#text').innerText(),'# Local open fixture\nSafe text content.\n');
 const downloadPromise=landing.waitForEvent('download');await landing.getByRole('link',{name:'Unduh'}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'README.md');
 const imageLink=page.getByRole('link',{name:'Image'}),popupPromise=context.waitForEvent('page');await imageLink.click();const popup=await popupPromise;await popup.waitForLoadState('load');assert.equal(await popup.locator('img').evaluate(img=>document.contentType==='image/png'&&img.naturalWidth>0),true);
 assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:join(output,'chat-open-flow.png'),fullPage:true});await landing.screenshot({path:join(output,'document-landing-fallback.png'),fullPage:true});
 const evidence={fixture:'temporary SQLite/workspace, fake adapter and launcher; no real opener invoked',directUrl:direct,openPostCount:openedPosts.length,fakeLaunchArgv:launches,checks:['click action POST opened local document','Enter on focused link POSTed and showed text fallback','direct preview URL rendered safe landing with explicit action and did not launch on GET','landing fallback showed text and downloaded README.md','image link remained a PNG preview'],browserErrors:errors};
 await writeFile(join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({checks:evidence.checks.length,evidence:join(output,'browser-evidence.json')},null,2));
}finally{await browser?.close();closeStreams();app.closeAllConnections();await new Promise(ok=>app.close(ok));await engine.shutdown();store.close();await rm(scratch,{recursive:true,force:true});}
