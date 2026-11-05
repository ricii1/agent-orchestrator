// End-to-end Markdown image-preview acceptance. Uses temporary DB/workspace,
// fake adapter, isolated Vite output, and the preinstalled Playwright cache.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Store} from '../../../src/store.js';
import {Engine} from '../../../src/engine.js';
import {Scheduler} from '../../../src/scheduler.js';
import {server} from '../../../src/server.js';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const output=fileURLToPath(new URL('.',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'local-preview-e2e-'));
const publicDir=join(scratch,'public'),dataDir=join(scratch,'data'),workspace=join(scratch,'registered-workspace'),outside=join(scratch,'outside');
await Promise.all([mkdir(publicDir,{recursive:true}),mkdir(dataDir),mkdir(workspace),mkdir(outside)]);
const screenshot=await (await import('node:fs/promises')).readFile(join(root,'docs/ux/office-expanded/evidence/desktop-expanded.png'));
const target=join(workspace,'docs/ux/office-expanded/evidence');await mkdir(target,{recursive:true});await writeFile(join(target,'desktop-expanded.png'),screenshot);
await writeFile(join(workspace,'relative.png'),screenshot);await writeFile(join(outside,'desktop-expanded.png'),screenshot);
await symlink(outside,join(workspace,'escape'));
execFileSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--outDir',publicDir,'--emptyOutDir'],{cwd:root,stdio:'inherit'});

const store=new Store(join(dataDir,'office.db'));
store.saveSettings({...store.settings(),roots:[workspace]});
const markdown=[
 `[Preview kantor besar](${join(workspace,'docs/ux/office-expanded/evidence/desktop-expanded.png')})`,
 '[Gambar relatif](relative.png)',
 '[Gambar hilang](missing.png)',
 '[Gambar terlarang](escape/desktop-expanded.png)',
 '[Situs aman](https://example.invalid/docs)',
 '[Skema berbahaya](javascript:alert(1))',
 `[Worktree runtime](${join(dataDir,'.data/worktrees/task/image.png')})`,
 '`[Kode](relative.png)`',
 '```md\n[Blok kode](relative.png)\n```',
].join('\n');
const fake={run(ctx){let finish;const done=new Promise(resolve=>finish=resolve);ctx.session('preview-e2e-session');ctx.event('message',{text:markdown});return {done,cancel(){finish('fixture stopped');}};}};
const engine=new Engine(store,{claude:fake,codex:fake},dataDir,'http://127.0.0.1:0');
const quota={status:'unavailable',windows:[],updatedAt:null,note:'E2E fixture; no provider access.'};
const {app,closeStreams}=server(engine,new Scheduler(engine),publicDir,{get:async()=>({codex:quota,claude:quota})});
const {chromium}=await import(process.env.LOCAL_PREVIEW_PLAYWRIGHT||join(homedir(),'.cache/ms-playwright-go/1.50.1/package/index.mjs'));
let browser;
const checks=[];const record=name=>checks.push({name,status:'pass'});
try{
  await engine.messagePM(workspace,'Fixture request: show the desktop office preview.');
  for(let i=0;i<100&&!engine.running.size;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(engine.running.size,1,'fake adapter should be running');
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  engine.url=`http://127.0.0.1:${app.address().port}`;
  browser=await chromium.launch({executablePath:process.env.LOCAL_PREVIEW_CHROMIUM||'/usr/bin/google-chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(engine.url);await page.getByText('Preview kantor besar',{exact:true}).waitFor();
  const links=page.locator('.bubble.assistant a');
  assert.equal(await links.filter({hasText:'Preview kantor besar'}).getAttribute('target'),'_blank');
  assert.equal(await links.filter({hasText:'Preview kantor besar'}).getAttribute('rel'),'noopener noreferrer');
  const unsafe=await page.evaluate(()=>[...document.querySelectorAll('.bubble.assistant a')].map(a=>a.textContent));
  assert.ok(!unsafe.includes('Skema berbahaya'));assert.ok(!unsafe.includes('Worktree runtime'));assert.ok(!unsafe.includes('Kode'));assert.ok(!unsafe.includes('Blok kode'));
  assert.ok((await page.locator('.bubble.assistant').innerText()).includes('[Kode](relative.png)'));
  assert.ok((await page.locator('.bubble.assistant').innerText()).includes('[Blok kode](relative.png)'));
  await page.screenshot({path:join(output,'chat-links.png'),fullPage:true});
  record('unsafe schemes rejected; inline and fenced code remain literal text');

  const openAndCheck=async locator=>{
    const popupPromise=page.waitForEvent('popup');await locator.click();const popup=await popupPromise;
    await popup.waitForLoadState('load');
    const image=await popup.locator('img').evaluate(img=>({complete:img.complete,width:img.naturalWidth,height:img.naturalHeight,mime:document.contentType}));
    assert.equal(image.complete,true);assert.ok(image.width>0&&image.height>0,JSON.stringify(image));assert.equal(image.mime,'image/png');
    assert.ok(popup.url().startsWith(engine.url+'/api/previews?'));
    await popup.screenshot({path:join(output,'preview-tab.png')});
    await popup.close();return {naturalWidth:image.width,naturalHeight:image.height,contentType:image.mime,status:200};
  };
  const absolute=await openAndCheck(links.filter({hasText:'Preview kantor besar'}));record('absolute workspace screenshot link opens loaded PNG in new browser tab');
  const relative=await openAndCheck(links.filter({hasText:'Gambar relatif'}));record('relative image resolves against selected workspace');

  await links.filter({hasText:'Gambar relatif'}).focus();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Gambar relatif');
  const keyboardPopup=page.waitForEvent('popup');await page.keyboard.press('Enter');const keyboard=await keyboardPopup;await keyboard.waitForLoadState('load');
  const keyboardNaturalWidth=await keyboard.locator('img').evaluate(img=>img.naturalWidth);assert.ok(keyboardNaturalWidth>0);await keyboard.close();record('keyboard focus and Enter open the image in a new tab');

  const failureTabs=[];
  for(const label of ['Gambar hilang','Gambar terlarang']){
    const popupPromise=page.waitForEvent('popup');await links.filter({hasText:label}).click();const popup=await popupPromise;await popup.waitForLoadState('load');
    const body=await popup.locator('body').innerText();assert.match(body,/Preview file not found|outside this workspace/);failureTabs.push({label,text:body.trim()});await popup.close();
  }
  record('missing and symlink-escape tabs show readable backend errors');
  assert.equal(pageErrors.length,0,pageErrors.join('\n'));record('no browser runtime errors');
  const evidence={fixture:'temporary registered workspace + temporary SQLite DB + fake adapter; no provider calls',sourceScreenshot:'docs/ux/office-expanded/evidence/desktop-expanded.png (copied into temp workspace)',checks,absolute,relative,keyboardNaturalWidth,failureTabs,pageErrors};
  await writeFile(join(output,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,absolute,relative,keyboardNaturalWidth,failureTabs,pageErrors,artifacts:output},null,2));
}finally{
  await browser?.close();closeStreams();app.closeAllConnections();await new Promise(ok=>app.close(ok));await engine.shutdown();store.close();await rm(scratch,{recursive:true,force:true});
}
