import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchDocument,openLocalDocument,readDocument,readPreview} from '../src/artifacts.js';
import type {Task} from '../src/types.js';
const png=()=>{const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(2,16);b.writeUInt32BE(3,20);return b;};
test('preview serves only bounded raster bytes under registered roots and blocks private/traversal/symlink paths',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'preview-test-')),root=join(temp,'workspace'),outside=join(temp,'outside');await mkdir(root);await mkdir(outside);
 t.after(()=>rm(temp,{recursive:true,force:true}));
 await writeFile(join(root,'image.png'),png());await writeFile(join(root,'fake.png'),'<html>not an image</html>');await writeFile(join(root,'large.png'),Buffer.alloc(12*1024*1024+1));await writeFile(join(outside,'image.png'),png());await symlink(outside,join(root,'escape'));
 const execution=join(root,'execution');await mkdir(execution);await writeFile(join(execution,'worker.png'),png());
 const runtimeExecution=join(root,'.data','worktrees','task');await mkdir(runtimeExecution,{recursive:true});await writeFile(join(runtimeExecution,'runtime.png'),png());
 await symlink(execution,join(root,'execution-link'));
 const outsideExecution=join(temp,'outside-execution');await mkdir(outsideExecution);await writeFile(join(outsideExecution,'escape.png'),png());
 const task={id:'t',workspace:root,executionPath:execution} as Task;
 const got=await readPreview('image.png',root,[root],[task]);assert.equal(got.mime,'image/png');assert.deepEqual(got.bytes,png());
 assert.equal((await readPreview(join(execution,'worker.png'),root,[root],[task])).mime,'image/png');
 await assert.rejects(()=>readPreview(join(runtimeExecution,'runtime.png'),root,[root],[{...task,executionPath:runtimeExecution}]),/private or forbidden/);
 await assert.rejects(()=>readPreview(join(outsideExecution,'escape.png'),root,[root],[{...task,executionPath:outsideExecution}]));
 for(const path of ['../outside/image.png','.env','nested/.git/image.png','escape/image.png','../execution/worker.png','fake.png','large.png'])await assert.rejects(()=>readPreview(path,root,[root],[task]));
 await assert.rejects(()=>readPreview('image.png',outside,[root],[task]),/not registered/);
});
test('revoked current root denies preview despite retained task history',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'preview-revoked-')),root=join(temp,'workspace'),execution=join(temp,'execution');await mkdir(root);await mkdir(execution);t.after(()=>rm(temp,{recursive:true,force:true}));
 await writeFile(join(root,'image.png'),png());await writeFile(join(execution,'worker.png'),png());
 const staleTask={id:'old-task',workspace:root,executionPath:execution} as Task;
 await assert.rejects(()=>readPreview('image.png',root,[],[staleTask]),/not registered/);
 await assert.rejects(()=>readPreview(join(execution,'worker.png'),root,[],[staleTask]),/not registered/);
});

test('local opener accepts bounded text documents with fake launcher and rejects active or private files',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'open-document-')),root=join(temp,'workspace'),outside=join(temp,'outside');await mkdir(root);await mkdir(outside);t.after(()=>rm(temp,{recursive:true,force:true}));
 const doc='docs/ux/realtime-integration/README.md';await mkdir(join(root,'docs/ux/realtime-integration'),{recursive:true});await writeFile(join(root,doc),'# Safe\n');await writeFile(join(root,'page.html'),'<script>bad()</script>');await mkdir(join(root,'.data'));await writeFile(join(root,'.data','x.md'),'private');await writeFile(join(outside,'x.md'),'escape');await symlink(outside,join(root,'escape'));
 const args:string[][]=[];const fake=async(argv:string[])=>{args.push(argv);};
 const opened=await openLocalDocument(doc,root,[root],[],fake);assert.equal(opened.opened,true);assert.deepEqual(args,[[process.platform==='linux'?'xdg-open':process.platform==='darwin'?'open':'gio',...(process.platform==='win32'?['open']:[]),join(root,doc)]]);
 assert.equal((await readDocument(doc,root,[root],[])).text,'# Safe\n');
 for(const path of ['page.html','.data/x.md','../outside/x.md','escape/x.md'])await assert.rejects(()=>openLocalDocument(path,root,[root],[],fake));
 await assert.rejects(()=>openLocalDocument(doc,root,[],[],fake),/not registered/);
});
test('launcher reports nonzero exit and terminates a hung opener within its timeout',async()=>{
 await assert.rejects(()=>launchDocument(['/bin/false']),/exit code 1/);
 await assert.rejects(()=>launchDocument(['/bin/sleep','10'],25),/timed out/);
});
