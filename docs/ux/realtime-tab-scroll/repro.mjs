// Isolated real-app browser repro. No provider, credentials, or user data.
// Run: CHAT_REALTIME_CHROMIUM=/usr/bin/google-chrome node --import tsx docs/ux/realtime-tab-scroll/repro.mjs
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {build} from 'vite';
import {Store} from '../../../src/store.js';
import {Engine} from '../../../src/engine.js';
import {Scheduler} from '../../../src/scheduler.js';
import {server as appServer} from '../../../src/server.js';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const out=fileURLToPath(new URL('./',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'chat-realtime-'));
const publicDir=join(temp,'public');await mkdir(publicDir);
const playwright=process.env.CHAT_REALTIME_PLAYWRIGHT||join(homedir(),'.cache/ms-playwright-go/1.50.1/package/index.mjs');
const chrome=process.env.CHAT_REALTIME_CHROMIUM||'/usr/bin/google-chrome';
const {chromium}=await import(playwright);
await build({configFile:false,root:join(root,'web'),logLevel:'error',build:{outDir:publicDir,emptyOutDir:true}});

const dir=join(temp,'runtime');await mkdir(dir);const workspace=join(dir,'workspace');await mkdir(workspace);
const store=new Store(join(dir,'demo.db'));
const workspace2=join(dir,'workspace-two');await mkdir(workspace2);
const settings=store.settings();settings.roots=[workspace,workspace2];store.saveSettings(settings);
const engine=new Engine(store,{codex:{run(){throw Error('fake adapter must not run');}},claude:{run(){throw Error('fake adapter must not run');}}},dir,'http://127.0.0.1:0');
const usage={get:async()=>({status:'unavailable',windows:[],updatedAt:null,note:'FIXTURE: disabled'})};
const backend=appServer(engine,new Scheduler(engine),publicDir,usage);
await new Promise(ok=>backend.app.listen(0,'127.0.0.1',ok));
const backendOrigin=`http://127.0.0.1:${backend.app.address().port}`;engine.url=backendOrigin;
const agents=(await import('../../../src/types.js')).workspaceAgents(store.settings(),workspace);
const task=store.createTask({prompt:'Fixture chat',title:'PM',kind:'pm',workspace,provider:agents.coordinatorProvider,model:agents.coordinatorProvider==='claude'?agents.claudeModel:agents.codexModel,workerDefaults:agents,status:'running'});
engine.event(task.id,'created',task);
const secondTask=store.createTask({prompt:'Fixture second workspace',title:'PM 2',kind:'pm',workspace:workspace2,provider:agents.coordinatorProvider,status:'running'});
const secondCreated=engine.event(secondTask.id,'created',secondTask);
const olderFixtureEvents=[];for(let i=0;i<260;i++)olderFixtureEvents.push(engine.event(secondTask.id,'tool',{name:'Read',input:{file_path:'/older/'+i}}));
engine.event(secondTask.id,'user_message',{text:'Workspace two prompt'});
const secondGap=engine.event(secondTask.id,'text',{text:'RT_WORKSPACE_TWO_CATCHUP'});
for(let i=0;i<605;i++)engine.event(secondTask.id,'status',{status:'running',sequence:i});

let streamMode='healthy',dropNextType='',dropEventId=secondGap.id,streamSeq=0,maxActiveStreams=0;const dropEventIds=new Set([...olderFixtureEvents.map(e=>e.id),secondCreated.id]);
const activeStreams=new Set(),catchupRequests=[];let credentialsSeen=false,delayTailTask='',delayAfterTask='';
const proxy=httpServer((req,res)=>{
  const u=new URL(req.url,'http://fixture');
  if(req.headers.authorization||req.headers.cookie)credentialsSeen=true;
  if(/^\/api\/tasks\/[^/]+\/events\?/.test(req.url||''))catchupRequests.push(req.url);
  if(u.pathname==='/api/providers'){
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({codex:{available:false,message:'FIXTURE'},claude:{available:false,message:'FIXTURE'}}));return;
  }
  if(u.pathname==='/api/events'){
    let cursor=Number(u.searchParams.get('after')||0),closed=false;
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.flushHeaders();
    const send=(e,replay=false)=>{
      if(closed||e.id<=cursor)return;
      cursor=e.id;
      const shouldDrop=e.type===dropNextType||e.id===dropEventId||dropEventIds.has(e.id);
      if(shouldDrop){dropNextType='';return;}
      if(streamMode==='hold'&&e.type==='text')return;
      res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
      logs.push({kind:'sse-write',id:e.id,type:e.type,replay,at:Date.now(),connection:streamSeq});
    };
    const conn=++streamSeq;activeStreams.add(res);maxActiveStreams=Math.max(maxActiveStreams,activeStreams.size);
    const flush=()=>{for(const e of store.events(cursor))send(e,true);};
    const onEvent=e=>send(e,false);engine.on('event',onEvent);flush();
    const heartbeat=setInterval(()=>{if(!closed)res.write(': heartbeat\n\n');},3000);
    const cleanup=()=>{if(closed)return;closed=true;clearInterval(heartbeat);engine.off('event',onEvent);activeStreams.delete(res);};
    res.on('close',cleanup);return;
  }
  const forward=()=>{const headers={...req.headers,host:new URL(backendOrigin).host};if(req.headers.origin)headers.origin=backendOrigin;
    const upstream=httpRequest(new URL(req.url,backendOrigin),{method:req.method,headers},up=>{res.writeHead(up.statusCode||502,up.headers);up.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);};
  if(delayTailTask&&u.pathname.includes('/tasks/'+delayTailTask+'/events')&&u.searchParams.get('tail')==='1'){const delayed=delayTailTask;delayTailTask='';setTimeout(forward,300);return;}
  if(delayAfterTask&&u.pathname.includes('/tasks/'+delayAfterTask+'/events')&&u.searchParams.has('after')){delayAfterTask='';const headers={...req.headers,host:new URL(backendOrigin).host};const upstream=httpRequest(new URL(req.url,backendOrigin),{method:'GET',headers},up=>{const chunks=[];up.on('data',chunk=>chunks.push(chunk));up.on('end',()=>setTimeout(()=>{res.writeHead(up.statusCode||502,up.headers);res.end(Buffer.concat(chunks));},350));});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});upstream.end();return;}
  forward();
});
await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${proxy.address().port}`;
const logs=[];
let browser;
const evidence={baseCommit:process.env.CHAT_REALTIME_BASE||'5caecdb49f385911ab83328977426f5e25a8ec9e',fixture:true,providerInvoked:false,origin,scenarios:[],events:logs};
const record=(scenario,detail)=>evidence.scenarios.push({scenario,...detail});
const capture=async(page,name)=>{const session=await page.context().newCDPSession(page);const shot=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name),Buffer.from(shot.data,'base64'));await session.detach();};
const waitFor=async(predicate,timeout=5000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Fixture condition timed out');};
const emit=(type,text)=>{const e=engine.event(task.id,type,{text});logs.push({kind:'server-emit',id:e.id,type,text,at:Date.now()});return e;};
const emitFor=(taskId,type,text)=>{const e=engine.event(taskId,type,{text});logs.push({kind:'server-emit',id:e.id,type,text,at:Date.now()});return e;};
const taskStatus=status=>{const current=store.task(task.id);current.status=status;store.saveTask(current);const e=engine.event(task.id,'status',{status,error:''});logs.push({kind:'server-emit',id:e.id,type:'status',status,at:Date.now()});return e;};
try{
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},bypassCSP:true});const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.addInitScript(()=>{
    (window).__rt={receive:[],dom:[],activeReaders:0,maxReaders:0};
    const Original=ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read=function(...args){return Original.apply(this,args).then(value=>{
      if(value?.value){try{const chunk=new TextDecoder().decode(value.value);for(const line of chunk.split('\n'))if(line.startsWith('data: ')){const e=JSON.parse(line.slice(6));(window).__rt.receive.push({id:e.id,type:e.type,at:Date.now(),performance:performance.now()});}}catch{}}
      return value;
    });};
    const getReader=ReadableStream.prototype.getReader;
    ReadableStream.prototype.getReader=function(...args){const reader=getReader.apply(this,args);let active=false;
      const read=reader.read.bind(reader);reader.read=(...readArgs)=>{if(!active){active=true;(window).__rt.activeReaders++;(window).__rt.maxReaders=Math.max((window).__rt.maxReaders,(window).__rt.activeReaders);}
        return read(...readArgs).then(value=>{if(value.done&&active){active=false;(window).__rt.activeReaders--;}return value;},error=>{if(active){active=false;(window).__rt.activeReaders--;}throw error;});};return reader;};
    new MutationObserver(()=>{const marker=(window).__rtMarker;if(marker&&document.querySelector('#conversation')?.innerText.includes(marker)&&!(window).__rt.dom.some(x=>x.marker===marker))(window).__rt.dom.push({marker,at:Date.now(),performance:performance.now()});}).observe(document,{subtree:true,childList:true,characterData:true});
  });
  await page.goto(origin);await page.locator('#conversation').waitFor();
  await page.waitForFunction(()=>document.querySelector('.connection')?.textContent==='Terhubung',undefined,{timeout:8000});
  const send=(marker,type='text')=>page.evaluate(({marker,type})=>{(window).__rtMarker=marker;return window.__emitFixture(marker,type);},{marker,type});
  await page.exposeFunction('__emitFixture',(marker,type)=>emit(type,marker));

  // Healthy end-to-end: engine emit -> real app fetch reader -> rendered DOM.
  const healthy='RT_HEALTHY_'+Date.now();const healthyEmit=await send(healthy);
  await page.getByText(healthy,{exact:true}).waitFor({timeout:5000});
  const healthyProof=await page.evaluate(id=>({receive:(window).__rt.receive.find(x=>x.id===id),dom:(window).__rt.dom.find(x=>x.marker===window.__rtMarker)}),healthyEmit.id);
  assert(healthyProof.receive&&healthyProof.dom,'healthy event must be received and rendered');
  record('healthy SSE emit-receive-DOM',{id:healthyEmit.id,emitAt:logs.find(x=>x.kind==='server-emit'&&x.id===healthyEmit.id).at,receiveAt:healthyProof.receive.at,domAt:healthyProof.dom.at,emitToReceiveMs:healthyProof.receive.at-logs.find(x=>x.kind==='server-emit'&&x.id===healthyEmit.id).at,receiveToDomMs:healthyProof.dom.at-healthyProof.receive.at,passed:true});
  await capture(page,'healthy-stream.png');

  // Drop one text frame while preserving status; state polling must not repair transcript.
  streamMode='healthy';dropNextType='text';const missed='RT_MISSED_'+Date.now();await page.evaluate(marker=>(window).__rtMarker=marker,missed);
  const missedEmit=await send(missed);const status=taskStatus('waiting');
  await page.waitForFunction(()=>document.querySelector('.thinking')?.textContent.includes('menunggu'),undefined,{timeout:9000}).catch(()=>{});
  await page.waitForTimeout(5600);
  const missedState=await page.evaluate(()=>({status:document.querySelector('.thinking')?.textContent||'',transcript:document.querySelector('#conversation')?.innerText||''}));
  assert(missedState.status.includes('menunggu'),'polling/state refresh should update task status');
  assert(missedState.transcript.includes(missed),'periodic per-task catch-up should restore dropped text');
  record('dropped text repaired by task catch-up',{textId:missedEmit.id,statusId:status.id,statusVisible:missedState.status.includes('menunggu'),textVisible:missedState.transcript.includes(missed),waitMs:5600,passed:true});
  await capture(page,'dropped-text-recovered.png');

  // A full reload replays from cursor zero, but loadEvents first caches a later non-text
  // event. cacheEvent then rejects older replayed text by comparing against that high ID.
  const reloadStarted=Date.now();await page.reload();await page.waitForTimeout(1400);
  const reloadView=await page.evaluate(marker=>({text:document.querySelector('#conversation')?.innerText.includes(marker),receive:(window).__rt.receive,connection:document.querySelector('.connection')?.textContent}),missed);
  assert.equal(reloadView.text,true,'lower-ID replay missing from cache must be inserted');
  record('lower-ID replay inserted after non-text tail',{textId:missedEmit.id,latestNonTextId:status.id,receivedOnReplay:reloadView.receive.some(x=>x.id===missedEmit.id),textVisible:reloadView.text,reloadStarted,waitAfterReloadMs:1400,passed:true});
  await capture(page,'lower-id-replay-recovered.png');

  // Half-open simulation keeps SSE response open but swallows text; hidden/visible only refreshes state.
  streamMode='hold';const half='RT_HALFOPEN_'+Date.now();await page.evaluate(marker=>(window).__rtMarker=marker,half);const halfEmit=await send(half);
  const cdp=await page.context().newCDPSession(page);let browserHidden=false;
  try{await cdp.send('Emulation.setPageVisibilityState',{visibilityState:'hidden'});await page.waitForFunction(()=>document.hidden,undefined,{timeout:1500});browserHidden=true;}catch{await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});}
  taskStatus('running');await page.waitForTimeout(800);
  if(browserHidden){await cdp.send('Emulation.setPageVisibilityState',{visibilityState:'visible'});await page.waitForFunction(()=>!document.hidden,undefined,{timeout:1500});}
  else await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(5600);
  const halfView=await page.evaluate(marker=>({text:document.querySelector('#conversation')?.innerText.includes(marker),connection:document.querySelector('.connection')?.textContent}),half);
  assert.equal(halfView.text,true,'visible transition catch-up should recover held event');
  const readerStats=await page.evaluate(()=>({max:(window).__rt.maxReaders,active:(window).__rt.activeReaders}));assert.equal(readerStats.max,1,'aborting/restarting must serialize SSE readers');
  record('half-open plus visible transition catch-up',{textId:halfEmit.id,browserHidden,textVisible:halfView.text,connectionLabel:halfView.connection,waitAfterVisibleMs:5600,maxActiveStreams,readerStats,passed:true});
  await capture(page,'half-open-recovered.png');

  // A real close causes reconnect and cursor replay; this is distinct from a half-open reader.
  streamMode='healthy';const reconnect='RT_RECONNECT_'+Date.now();await page.evaluate(marker=>(window).__rtMarker=marker,reconnect);
  for(const res of [...activeStreams])res.destroy();
  await page.waitForTimeout(300);const reconnectEmit=await send(reconnect);
  await page.waitForTimeout(2600);
  const reconnectProof=await page.evaluate(marker=>({dom:(window).__rt.dom.find(x=>x.marker===marker),receives:(window).__rt.receive.filter(x=>x.type==='text')}),reconnect);
  assert(reconnectProof.dom||await page.locator('#conversation').innerText().then(text=>text.includes(reconnect)),'closed stream should reconnect and replay');
  record('closed stream reconnect replay',{textId:reconnectEmit.id,domAt:reconnectProof.dom.at,passed:true});
  await capture(page,'reconnect-replay.png');
  const workspace2Button=page.locator('.projects button').filter({hasText:workspace2});
  await workspace2Button.click();
  await page.getByText('RT_WORKSPACE_TWO_CATCHUP',{exact:true}).waitFor({timeout:8000});
  let transcript=await page.locator('#conversation').innerText();
  assert(transcript.includes('RT_WORKSPACE_TWO_CATCHUP'),'sync boundary must fetch a dropped delta below sparse non-text tail');
  assert(!transcript.includes(reconnect),'workspace/task switch must not mix the prior task transcript');
  const syncCalls=logs.filter(x=>x.kind==='sse-write'&&x.id===secondGap.id).length;
  assert.equal(syncCalls,0,'fixture deliberately drops the workspace-two text frame from SSE');
  record('sparse tail catch-up on workspace switch',{workspace2,taskId:secondTask.id,textId:secondGap.id,nonTextTailId:store.recentEvents(secondTask.id).at(-1).id,textVisible:transcript.includes('RT_WORKSPACE_TWO_CATCHUP'),droppedFromSSE:true,passed:true});
  const selectedTaskId=await page.locator('#conversation').getAttribute('data-chat-id');
  // A second visible event during a delayed catch-up must queue exactly one follow-up.
  streamMode='hold';await page.waitForTimeout(250);const coalesceStart=catchupRequests.length;delayAfterTask=selectedTaskId;
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(()=>catchupRequests.slice(coalesceStart).some(url=>url.includes('/events?after=')));
  const queuedMarker='RT_CATCHUP_QUEUED_'+Date.now();const queuedEmit=emitFor(selectedTaskId,'text',queuedMarker);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#conversation').getByText(queuedMarker).waitFor({timeout:5000});
  const queuedRequests=catchupRequests.slice(coalesceStart).filter(url=>url.includes('/events?after=')).length;
  assert(queuedRequests>=2,'request while catch-up is in flight should cause one follow-up page request');
  record('catch-up request is coalesced and retried',{textId:queuedEmit.id,requests:queuedRequests,visibilityState:'visible (synthetic event)',passed:true});streamMode='healthy';
  // Actual second browser tab: verify the original document's native visibility state.
  streamMode='hold';const hiddenMarker='RT_REAL_TAB_'+Date.now();const hiddenEmit=emitFor(selectedTaskId,'text',hiddenMarker);
  const popupWait=context.waitForEvent('page');await page.evaluate(()=>window.open('about:blank','_blank'));const background=await popupWait;await background.bringToFront();
  let nativeTabTransition=false;
  try{await page.waitForFunction(()=>document.visibilityState==='hidden',undefined,{timeout:1200});nativeTabTransition=true;}catch{}
  const hiddenState=await page.evaluate(()=>({visibilityState:document.visibilityState,hidden:document.hidden}));
  nativeTabTransition=hiddenState.hidden;
  await page.bringToFront();await page.waitForFunction(()=>document.visibilityState==='visible',undefined,{timeout:3000});
  if(!nativeTabTransition)await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  const returnedState=await page.evaluate(()=>({visibilityState:document.visibilityState,hidden:document.hidden}));
  if(nativeTabTransition)assert.equal(returnedState.visibilityState,'visible');
  record('native tab visibility observation',{textId:hiddenEmit.id,hiddenState,returnedState,transition:nativeTabTransition?'native browser tab':'Chromium did not change the original page visibility when another page was opened',nativeTabTransition,passed:true});
  await background.close();streamMode='healthy';
  for(let i=0;i<60;i++)emitFor(selectedTaskId,'tool',{name:'Read',input:{file_path:'/fixture/'+i}});
  await page.waitForTimeout(700);
  // New catch-up content follows a reader already at bottom.
  const conversation=page.locator('#conversation');await conversation.evaluate(node=>node.scrollTop=node.scrollHeight);
  const bottomMarker='RT_BOTTOM_CATCHUP_'+Date.now();const bottomEmit=emitFor(selectedTaskId,'text',bottomMarker);
  await conversation.getByText(bottomMarker).waitFor({timeout:7000});
  const bottomState=await conversation.evaluate(node=>({top:node.scrollTop,height:node.scrollHeight,client:node.clientHeight,nearBottom:node.scrollHeight-node.scrollTop-node.clientHeight<5}));
  assert(bottomState.nearBottom,'catch-up content should keep a near-bottom reader pinned');
  record('catch-up follows near-bottom reader',{textId:bottomEmit.id,...bottomState,passed:true});await capture(page,'near-bottom.png');
  // New content while reading older messages keeps position and exposes a jump action.
  const oldTop=await conversation.evaluate(node=>{node.scrollTop=0;return node.scrollTop;});
  const olderMarker='RT_OLDER_CATCHUP_'+Date.now();const olderEmit=emitFor(selectedTaskId,'text',olderMarker);
  await conversation.getByText(olderMarker).waitFor({timeout:7000});
  await page.waitForTimeout(100);
  const olderState=await conversation.evaluate((node,oldTop)=>({top:node.scrollTop,oldTop,button:!!node.querySelector('.new-messages')}),oldTop);
  const scrollTrace=await page.evaluate(()=>{const c=document.querySelector('#conversation'),p=c?.parentElement;const box=(e)=>e&&{top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight};return{document:{scrollY,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight},conversation:box(c),parent:box(p)}});
  record('scrolled-up position geometry trace',{...scrollTrace,expectedTop:oldTop,actualTop:olderState.top});
  console.log('scrolled-up geometry',JSON.stringify({olderState,scrollTrace}));
  assert.equal(olderState.top,oldTop);
  record('scrolled-up content preserves position and shows jump',{textId:olderEmit.id,...olderState,passed:olderState.button});await capture(page,'scrolled-up.png');
  // Clicking the jump action moves to the latest message and clears unread state.
  await page.getByRole('button',{name:'Pesan baru'}).click();
  await page.waitForTimeout(50);
  const jumpState=await conversation.evaluate(node=>({nearBottom:node.scrollHeight-node.scrollTop-node.clientHeight<5,button:!!node.querySelector('.new-messages')}));
  console.log('jump trace',await conversation.evaluate(node=>({top:node.scrollTop,height:node.scrollHeight,client:node.clientHeight,button:!!node.querySelector('.new-messages')})));
  assert(jumpState.nearBottom&&!jumpState.button);record('new-message action jumps to bottom',{...jumpState,passed:true});
  const historyAnchor=conversation.getByText(bottomMarker);const anchorTopBefore=await historyAnchor.evaluate(node=>node.getBoundingClientRect().top);
  const heightBeforeHistory=await conversation.evaluate(node=>node.scrollHeight);
  await page.evaluate(()=>document.querySelector('#conversation .load-older')?.click());
  await page.waitForTimeout(1000);
  const afterHistory={...await conversation.evaluate(node=>({height:node.scrollHeight,button:node.querySelector('.load-older')?.textContent||null})),requests:catchupRequests.slice(-5)};
  console.log('history prepend trace',{heightBeforeHistory,...afterHistory});
  assert(afterHistory.height>heightBeforeHistory,'history prepend should add earlier content');
  const historyState=await historyAnchor.evaluate(node=>({anchorTop:node.getBoundingClientRect().top,height:document.querySelector('#conversation')?.scrollHeight}));
  assert(Math.abs(historyState.anchorTop-anchorTopBefore)<2,'history prepend should preserve visible message anchor');
  record('history prepend preserves message anchor',{anchorTopBefore, ...historyState,passed:true});
  const input=page.locator('#pm-message');await input.fill('keep draft selection');await input.evaluate((node)=>{node.focus();node.setSelectionRange(5,10);});
  const beforePoll=catchupRequests.length,scrollBefore=await page.locator('#conversation').evaluate(node=>{node.scrollTop=0;return node.scrollTop;});
  await page.waitForTimeout(5200);
  const afterPoll=await page.evaluate(()=>({focused:(document.activeElement)?.id,selection:[(document.activeElement)?.selectionStart,(document.activeElement)?.selectionEnd],scroll:document.querySelector('#conversation').scrollTop}));
  const pollDelta=catchupRequests.length-beforePoll;
  assert(pollDelta<=2,'idle selected-task catch-up stays bounded to the five-second poll');
  assert.equal(afterPoll.focused,'pm-message');assert.deepEqual(afterPoll.selection,[5,10]);assert.equal(afterPoll.scroll,scrollBefore);
  record('idle catch-up preserves scroll focus selection',{requestDelta:pollDelta,focus:afterPoll.focused,selection:afterPoll.selection,scrollTop:afterPoll.scroll,passed:true});
  // Own-message UI send should reveal the latest transcript even from a scrolled-up position.
  await conversation.evaluate(node=>node.scrollTop=0);const own='RT_OWN_SEND_'+Date.now();await page.locator('#pm-message').fill(own);await page.getByRole('button',{name:'Kirim',exact:true}).click();
  await page.getByText(own,{exact:true}).waitFor({timeout:8000});
  const ownState=await conversation.evaluate(node=>({nearBottom:node.scrollHeight-node.scrollTop-node.clientHeight<5,focus:document.activeElement?.id}));
  assert(ownState.nearBottom,'own send should reveal latest message');record('own send follows latest message',{...ownState,passed:true});await capture(page,'own-send.png');
  delayTailTask=task.id;
  await page.locator('.projects button').nth(0).click();await page.waitForTimeout(40);
  await page.locator('.projects button').nth(1).click();await page.waitForTimeout(500);
  transcript=await page.locator('#conversation').innerText();
  assert(transcript.includes('RT_WORKSPACE_TWO_CATCHUP')&&!transcript.includes(reconnect),'late transcript fetch for another workspace must not contaminate the selected transcript');
  assert(!credentialsSeen,'fixture requests must not carry credentials');
  record('concurrent workspace switch and delayed transcript fetch',{lateTaskId:task.id,selectedTaskId:secondTask.id,transcriptTaskScoped:true,credentialsSeen,passed:true});
  evidence.pageErrors=pageErrors;evidence.pass=pageErrors.length===0&&evidence.scenarios.every(s=>s.passed!==false);
  assert.equal(pageErrors.length,0,'no app runtime exceptions');
  await writeFile(join(out,'runtime-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({pass:evidence.pass,scenarios:evidence.scenarios.map(({scenario,passed,...rest})=>({scenario,passed,...rest})),artifacts:out},null,2));
}finally{
  if(browser)await browser.close();
  for(const res of activeStreams)res.destroy();
  await new Promise(ok=>proxy.close(ok));backend.closeStreams();await new Promise(ok=>backend.app.close(()=>ok()));await engine.shutdown();store.close();await rm(temp,{recursive:true,force:true});
}
