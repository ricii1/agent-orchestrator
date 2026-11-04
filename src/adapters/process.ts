import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
export function child(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): ChildProcessWithoutNullStreams {
  const safe = { ...process.env, ...env };
  // Use existing CLI login rather than inheriting API billing credentials.
  for (const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN']) delete safe[key];
  delete safe.CLAUDECODE;
  return spawn(command, args, { cwd, env: safe, detached: process.platform !== 'win32', stdio: ['pipe','pipe','pipe'] });
}
export function stop(p: ChildProcessWithoutNullStreams) {
  if (!p.pid) return;
  const kill = (signal: NodeJS.Signals) => { try { process.kill(process.platform === 'win32' ? p.pid! : -p.pid!, signal); } catch {} };
  kill('SIGTERM');
  const timer = setTimeout(() => kill('SIGKILL'), 3000); timer.unref();
  p.once('close',()=>clearTimeout(timer));
}
export function lines(p: ChildProcessWithoutNullStreams, onMessage: (v: any)=>void, log: (text: string)=>void) {
  createInterface({ input: p.stdout }).on('line', line => {
    try { onMessage(JSON.parse(line)); } catch (e) { log(`Protocol error: ${String(e).slice(0,400)}`); }
  });
  p.stderr.on('data', b => log(String(b).slice(0,8000)));
}
export class Rpc {
  sequence = 0;
  pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  constructor(public process: ChildProcessWithoutNullStreams) {
    const fail = (error: Error) => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    process.on('error', fail); process.on('close', code => fail(new Error(`Provider exited (${code})`)));
  }
  write(value: any) { if (!this.process.stdin.destroyed) this.process.stdin.write(JSON.stringify(value)+'\n'); }
  request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(()=> { this.pending.delete(id); reject(new Error(`Provider request timed out: ${method}`)); }, 90000); timer.unref();
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params });
    });
  }
  response(msg: any) {
    const pending = this.pending.get(msg.id);
    if (!pending || msg.method) return false;
    clearTimeout(pending.timer); this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message)); else pending.resolve(msg.result);
    return true;
  }
}
