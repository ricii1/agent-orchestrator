import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Terminals} from '../src/terminal.js';
const delay=()=>new Promise(r=>setTimeout(r,30));
test('PTY supports interactive input, hidden input, resize, interrupt, reconnect and explicit close',async()=>{
 const old=process.env.SHELL;process.env.SHELL='/bin/bash';const terminals=new Terminals(()=>['/tmp']);
 try{
  await assert.rejects(()=>terminals.open('/etc'),/outside/);
  const {id}=await terminals.open('/tmp');
  const output=()=>terminals.read(id,0).chunks.map(c=>Buffer.from(c.data,'base64').toString()).join('');
  const until=async(check:()=>boolean)=>{for(let n=0;n<150;n++){if(check())return;const state=terminals.read(id,0);if(state.error)throw new Error(state.error);await delay();}throw new Error('PTY timed out: '+output());};
  terminals.resize(id,93,24);terminals.input(id,"test -t 0 && printf 'TTY_%s\\n' yes; stty size\n");
  await until(()=>output().includes('TTY_yes')&&output().includes('24 93'));
  assert.equal((await terminals.open('/tmp')).id,id);
  assert.throws(()=>terminals.resize(id,1,24),/Ukuran/);
  // Wait until terminal echo is disabled before sending a mock password.
  terminals.input(id,"stty -echo; printf 'INPUT_%s\\n' ready; read -r secret; stty echo; printf '\\nREAD_%s\\n' done\n");
  await until(()=>output().includes('INPUT_ready'));terminals.input(id,'fixture-secret-not-logged\n');
  await until(()=>output().includes('READ_done'));assert.ok(!output().includes('fixture-secret-not-logged'));
  terminals.input(id,"sleep 60\n");await new Promise(r=>setTimeout(r,80));terminals.input(id,'\x03');terminals.input(id,"printf 'AFTER_%s\\n' interrupt\n");
  await until(()=>output().includes('AFTER_interrupt'));
  const cursor=terminals.read(id,0).cursor;assert.deepEqual(terminals.read(id,cursor).chunks,[]);
  terminals.close(id);await until(()=>terminals.read(id,0).exitCode!==null);
 }finally{terminals.shutdown();if(old===undefined)delete process.env.SHELL;else process.env.SHELL=old;}
});
