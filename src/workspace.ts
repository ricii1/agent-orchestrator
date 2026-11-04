import { realpath, mkdir, readFile, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, resolve, join, dirname } from 'node:path';
import type { Task } from './types.js';
const exec = promisify(execFile);
export const git = async (cwd: string, ...args: string[]) => (await exec('git', ['-C', cwd, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
export function contains(root: string, target: string) { const rel = relative(root, target); return rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel)); }
export interface FolderListing {
  path: string; parent: string | null; home: string;
  directories: { name: string; path: string }[];
}
export async function browseFolders(location=homedir(), hidden=false): Promise<FolderListing> {
  const expanded=location==='~'?homedir():location.startsWith('~/')?join(homedir(),location.slice(2)):location;
  if(!isAbsolute(expanded)) throw new Error('Lokasi folder harus berupa path lengkap.');
  const actual=await realpath(expanded);
  if(!(await stat(actual)).isDirectory()) throw new Error('Pilih folder, bukan file.');
  const entries=await readdir(actual,{withFileTypes:true});
  const directories=await Promise.all(entries.filter(entry=>hidden||!entry.name.startsWith('.')).map(async entry=>{
    const path=join(actual,entry.name);
    if(entry.isDirectory()) return {name:entry.name,path};
    if(entry.isSymbolicLink()) {
      try { if((await stat(path)).isDirectory()) return {name:entry.name,path}; } catch {}
    }
    return null;
  }));
  const sort=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  return {path:actual,parent:dirname(actual)===actual?null:dirname(actual),home:homedir(),directories:directories.filter(entry=>entry!==null).sort((a,b)=>sort.compare(a.name,b.name))};
}
export async function allowedWorkspace(path: string, roots: string[]) {
  if (!isAbsolute(path)) throw new Error('Workspace must be an absolute directory');
  const actual = await realpath(path);
  const canonical = await Promise.all(roots.map(p => realpath(p)));
  if (!canonical.some(root => contains(root, actual))) throw new Error('Workspace is outside registered directories. Add it in Settings first.');
  if (!(await stat(actual)).isDirectory()) throw new Error('Workspace must be a directory');
  return actual;
}
export async function repoRoot(path: string): Promise<string | null> {
  try { return await git(path, 'rev-parse', '--show-toplevel'); } catch { return null; }
}
export async function prepareWorkspace(task: Task, dataDir: string) {
  if (task.executionPath) return;
  const root = await repoRoot(task.workspace);
  if (!root || !task.parentId) { task.executionPath = task.workspace; return; }
  try { task.baseCommit = await git(root, 'rev-parse', '--verify', 'HEAD'); } catch { throw new Error('Repository has no initial commit. Create it before starting a coding worker.'); }
  const target = join(dataDir, 'worktrees', task.id);
  await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
  const branch = `orchestrator/${task.id}`;
  await git(root, 'worktree', 'add', '-b', branch, target, task.baseCommit!);
  task.executionPath = join(target, relative(root, task.workspace)); task.branch = branch;
}
export async function diff(task: Task) {
  if (!task.branch || !task.executionPath) return { diff: '', untracked: '', previews: [] };
  const root=(await repoRoot(task.executionPath))!;
  const untracked=await git(root,'ls-files','--others','--exclude-standard','-z');
  const previews: { path: string; content: string }[]=[];
  let budget=256000;
  for(const path of untracked.split('\0').filter(Boolean).slice(0,50)) {
    try {
      const actual=await realpath(join(root,path));
      if(!contains(root,actual)) { previews.push({path,content:'[Symlink outside worktree; preview omitted]'}); continue; }
      const info=await stat(actual);
      if(!info.isFile() || info.size>64000 || info.size>budget) { previews.push({path,content:'[Preview omitted: not a small text file]'}); continue; }
      budget-=info.size;
      const bytes=await readFile(actual);previews.push({path,content:bytes.includes(0)?'[Binary file]':bytes.toString('utf8')});
    } catch { previews.push({path,content:'[File unavailable]'}); }
  }
  return { diff: await git(root,'diff',task.baseCommit || 'HEAD','--'), untracked:untracked.split('\0').filter(Boolean).join('\n'), previews };
}
export async function merge(task: Task) {
  if (!task.branch || !task.executionPath) throw new Error('Task has no worktree');
  const root = await repoRoot(task.workspace);
  if (!root) throw new Error('Repository not found');
  if (await git(root, 'status', '--porcelain')) throw new Error('Main checkout must be clean before merging');
  await git(task.executionPath, 'add', '--all');
  if (await git(task.executionPath, 'diff', '--cached', '--name-only')) await git(task.executionPath, 'commit', '-m', `Agent task: ${task.title}`);
  // --no-commit keeps the integration reviewable; never discard work on conflict.
  await git(root, 'merge', '--no-ff', '--no-commit', task.branch);
  return { message: 'Merged into checkout without committing. Review and commit, or use git merge --abort.' };
}
