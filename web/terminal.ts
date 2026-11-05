import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
// ANSI 0–15 are terminal palette colors. Leave ANSI 16–255 and RGB colors
// supplied by the shell untouched (autosuggestions may explicitly use fg=240).
const terminalTheme={
 background:'#161d19',foreground:'#e4efdc',cursor:'#e4efdc',cursorAccent:'#161d19',
 selectionBackground:'#425b4c',selectionInactiveBackground:'#34463b',
 black:'#29332e',red:'#ed7f78',green:'#a5cc8c',yellow:'#e5c784',
 blue:'#8fb8e8',magenta:'#c8a0db',cyan:'#82c6c2',white:'#d8e1d6',
 brightBlack:'#8a948d',brightRed:'#ff9b93',brightGreen:'#bde6a3',brightYellow:'#f5dfa0',
 brightBlue:'#b1d2ff',brightMagenta:'#e0bbf0',brightCyan:'#a4e1db',brightWhite:'#f3f7ef'
};
export class TerminalPanel {
 node=document.createElement('section');
 // Raising minimumContrastRatio can brighten ghost text toward actual input.
 private term=new Terminal({screenReaderMode:true,cursorBlink:true,fontSize:13,fontFamily:'monospace',scrollback:3000,minimumContrastRatio:1,theme:terminalTheme});
 private fit=new FitAddon();private id='';private cursor=0;private pendingInput:Promise<unknown>=Promise.resolve();private observer:ResizeObserver;private timer:number|undefined;private inputReady=false;private disposed=false;private ended=false;private missing=false;private polling:Promise<void>|undefined;private trigger:HTMLElement|null=null;private status=document.createElement('p');private retry=document.createElement('button');private opening:Promise<void>|undefined;
 constructor(private workspace:string,private api:(path:string,method?:string,body?:unknown)=>Promise<any>,private notify:(e:unknown)=>void,sessionId?:string){
  this.id=sessionId||'';
  this.node.style.setProperty('--terminal-background',terminalTheme.background);this.node.style.setProperty('--terminal-foreground',terminalTheme.foreground);
  this.node.className='terminal-panel';this.node.hidden=true;this.node.setAttribute('role','region');this.node.setAttribute('aria-label','Terminal · '+workspace);this.status.className='terminal-status';this.status.setAttribute('role','status');this.retry.className='terminal-retry';this.retry.textContent='Coba hubungkan kembali';this.retry.hidden=true;this.retry.onclick=()=>void(this.missing||this.ended?this.newSession():this.reconnect()).catch(e=>this.fail(e));
  const header=document.createElement('div');header.className='terminal-header';
  const label=document.createElement('span');label.textContent='Terminal · '+workspace;
  const hide=document.createElement('button');hide.textContent='Sembunyikan';hide.onclick=()=>{this.node.hidden=true;if(this.trigger?.isConnected)this.trigger.focus({preventScroll:true});else document.querySelector<HTMLElement>('.toolbar button')?.focus();};
  const close=document.createElement('button');close.textContent='Hentikan terminal';close.onclick=()=>void this.end().catch(e=>this.fail(e));
  header.append(label,hide,close);
  const host=document.createElement('div');host.className='terminal-screen';
  const hint=document.createElement('small');hint.textContent='Shell laptop · input langsung, bukan pesan ke PM. Saran dari plugin shell biasanya redup dan belum menjadi input. Menutup panel tidak menghentikan shell.';
  this.node.append(header,this.status,this.retry,host,hint);document.body.append(this.node);
  this.term.loadAddon(this.fit);this.term.open(host);
  this.term.onData(data=>{if(this.inputReady)void this.send(data).catch(()=>{});});
  this.term.onResize(({cols,rows})=>{if(this.id&&this.inputReady)void api('terminals/'+this.id,'POST',{action:'resize',cols,rows}).catch(notify);});
  this.observer=new ResizeObserver(()=>{if(!this.node.hidden)this.fit.fit();});this.observer.observe(host);
 }
 private send(data:string){
  // Capture the session: queued input must never move to a newly opened shell.
  const id=this.id;
  const sent=this.pendingInput.then(async()=>{for(let i=0;i<data.length;i+=16000){if(this.disposed||this.id!==id||!this.inputReady)throw new Error('Input terminal belum dikirim: sesi tidak terhubung.');await this.api('terminals/'+id,'POST',{action:'input',data:data.slice(i,i+16000)});}});
  this.pendingInput=sent.catch(e=>this.fail(e));return sent;
 }
 get sessionId(){return this.id;}
 get context(){return this.workspace;}
 private fail(e:unknown){this.inputReady=false;this.missing=(e as {status?:number})?.status===404||/not found|unknown terminal|tidak ditemukan/i.test(String(e));this.status.textContent=this.missing?'Sesi terminal tidak tersedia. Output lama tidak dapat dipulihkan.':'Koneksi terminal terputus. Shell mungkin masih hidup. '+String(e);this.retry.textContent=this.missing?'Buka terminal baru':'Coba hubungkan kembali';this.retry.hidden=false;}
 private async newSession(){this.id='';this.cursor=0;this.ended=false;this.missing=false;this.term.reset();await this.show();}
 private async reconnect(){if(this.timer)clearTimeout(this.timer);this.retry.hidden=true;await this.read();if(this.inputReady)this.term.focus();}
 async show(command?:string){
  if(!this.node.contains(document.activeElement))this.trigger=document.activeElement as HTMLElement|null;
  this.node.hidden=false;
  if(this.opening)await this.opening;
  else if(!this.id){this.status.textContent='Membuka terminal…';this.opening=(async()=>{try{const session=await this.api('terminals','POST',{workspace:this.workspace});this.id=session.id;await this.read();}catch(e){this.fail(e);throw e;}})().finally(()=>this.opening=undefined);await this.opening;}
  else if(!this.inputReady&&!this.ended&&!this.missing)await this.reconnect();
  this.fit.fit();if(this.inputReady)this.term.focus();if(command){if(!this.inputReady)throw new Error('Terminal belum terhubung. Perintah belum dikirim.');await this.send(command+'\n');}
 }
 private read(){if(this.polling)return this.polling;this.polling=this.poll().finally(()=>this.polling=undefined);return this.polling;}
 private async poll(){
  if(this.disposed)return;
  try{
    const data=await this.api('terminals/'+this.id+'?after='+this.cursor);
    if(this.disposed)return;
    if(data.truncated)this.term.writeln('\r\n[Output lama dipangkas dari buffer]\r\n');
    for(const chunk of data.chunks)this.term.write(Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0)));
    this.cursor=data.cursor;this.inputReady=true;this.status.textContent='Terminal aktif · '+this.workspace;this.retry.hidden=true;
    if(data.error||data.exitCode!==null){this.inputReady=false;this.ended=true;this.status.textContent=data.error||'Terminal berakhir · exit '+data.exitCode;this.term.writeln('\r\n'+this.status.textContent);this.retry.textContent='Buka terminal baru';this.retry.hidden=false;return;}
  }catch(e){this.fail(e);return;}
  if(this.disposed)return;
  this.timer=window.setTimeout(()=>void this.read(),this.node.hidden?1000:200);
 }
 async end(){if(this.id&&!this.ended&&!this.missing)await this.api('terminals/'+this.id,'POST',{action:'close'});this.dispose();}
 dispose(){this.disposed=true;if(this.timer)clearTimeout(this.timer);this.observer.disconnect();this.term.dispose();this.node.remove();}
}
