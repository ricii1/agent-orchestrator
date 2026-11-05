// Lokal saja. Tidak menjalankan backend, model, shell aplikasi, atau mengambil data produksi.
// Jalankan: node docs/ux/previews/capture.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=dirname(fileURLToPath(import.meta.url)),root=resolve(out,'..'),profile=await mkdtemp(join(tmpdir(),'kantor-design-'));
const browser=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;let seq=0;const pending=new Map(),errors=[];
try{
 let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await new Promise(r=>setTimeout(r,100))}}if(!port)throw Error('Chrome tidak siap');
 const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no});
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+JSON.stringify(m.params.exceptionDetails.exception));};
 function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})}
 async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
 await call('Page.enable');await call('Runtime.enable');await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const checks=[];for(const [name,width,height,view,dialog] of [['desktop',1440,1100,'chat'],['tablet',768,1100,'chat'],['mobile',390,1100,'chat'],['reflow',320,1100,'chat'],['settings',1440,1100,'settings'],['settings-mobile',390,1100,'settings'],['recovery',1440,1100,'recovery'],['states',1440,1100,'states'],['permission-full',768,1100,'settings','full'],['terminal-mobile',390,900,'chat','terminal'],['tablet-office',768,1100,'chat','office'],['mobile-office',390,1100,'chat','office'],['settings-reflow',320,1100,'settings'],['recovery-reflow',320,1100,'recovery']]){
 await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:pathToFileURL(join(root,'prototype.html')).href+'?view='+view});
 await new Promise(r=>setTimeout(r,300));await evaluate('document.fonts.ready.then(()=>true)');
 if(dialog==='office'){await evaluate(`document.querySelector('#office-toggle').click()`)}else if(dialog){if(dialog==='full')await evaluate(`document.querySelector('input[value="full"]').checked=true;document.querySelector('input[value="full"]').dispatchEvent(new Event('change'))`);await evaluate(`openDialog('${dialog}')`)}
 const metrics=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,canvas:document.querySelector('canvas')?.width,focus:document.activeElement?.id})`);
 if(metrics.scrollWidth>width)throw Error(name+' horizontal overflow '+JSON.stringify(metrics));
 const snap=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:!dialog||dialog==='office',clip:{x:0,y:0,width,height:!dialog||dialog==='office'?metrics.height:height,scale:1}});await writeFile(join(out,name+'.png'),Buffer.from(snap.data,'base64'));checks.push({name,...metrics});
 if(dialog&&dialog!=='office'){await evaluate(`document.querySelector('#dialog-close').click()`);const closed=await evaluate(`!document.querySelector('dialog').open`);if(!closed)throw Error('Dialog tidak tertutup')}
 }
 // Checks meaningful to this static artifact: filling is not submitting; JSON failure; focus restore.
 await call('Page.navigate',{url:pathToFileURL(join(root,'prototype.html')).href+'?view=states'});await new Promise(r=>setTimeout(r,200));
 const interactions=await evaluate(`(()=>{document.querySelector('[data-fill]').click();const fills=document.querySelector('#answer').value==='Pengguna baru'&&!document.querySelector('#feedback').textContent;document.querySelector('#json-submit').click();const invalid=document.activeElement.id==='json-answer'&&document.querySelector('#json-answer').getAttribute('aria-invalid')==='true';const trigger=document.querySelector('#states-view [data-dialog="folder"]');trigger.focus();trigger.click();const initial=document.activeElement.id==='dialog-close';document.querySelector('#dialog-close').click();return {fillsWithoutSubmit:fills,invalidJsonRetained:invalid,dialogInitialFocus:initial,focusReturned:document.activeElement===trigger}})()`);
 if(Object.values(interactions).some(x=>!x))throw Error('Interaksi gagal '+JSON.stringify(interactions));if(errors.length)throw Error(errors.join('\n'));
 await writeFile(join(out,'render-checks.json'),JSON.stringify({capturedAt:new Date().toISOString(),browser:'Local Google Chrome headless via CDP',source:'Standalone prototype.html, file://; CSP connect-src none',checks,interactions,pageErrors:errors},null,2)+'\n');console.log(JSON.stringify({screenshots:checks.length,interactions,pageErrors:errors},null,2));
}finally{socket?.close();browser.kill();await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true})}
