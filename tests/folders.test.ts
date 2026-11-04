import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {browseFolders} from '../src/workspace.js';

test('folder picker lists directories and directory links, filters files/hidden entries, and canonicalizes selection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'office-folder-picker-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const name of ['project 10','project 2','.hidden'])await mkdir(join(root,name));
  await writeFile(join(root,'README.md'),'not a directory');
  await symlink(join(root,'project 2'),join(root,'linked project'));
  await symlink(join(root,'missing'),join(root,'broken link'));
  await symlink(join(root,'README.md'),join(root,'linked file'));
  const listing=await browseFolders(root);
  assert.deepEqual(listing.directories.map(e=>e.name),['linked project','project 2','project 10']);
  assert.equal(listing.path,root);assert.equal(listing.parent,dirname(root));assert.equal(listing.home,homedir());
  assert.equal((await browseFolders(join(root,'linked project'))).path,join(root,'project 2'));
  assert.ok((await browseFolders(root,true)).directories.some(e=>e.name==='.hidden'));
  assert.deepEqual((await browseFolders(join(root,'project 2'))).directories,[]);
  await assert.rejects(()=>browseFolders(join(root,'README.md')),/bukan file/);
  await assert.rejects(()=>browseFolders('relative/path'),/path lengkap/);
  await assert.rejects(()=>browseFolders(join(root,'missing')));
});
