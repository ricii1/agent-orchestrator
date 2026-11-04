import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Store } from './store.js';
import { active, type Adapter, type AgentRun, type Approval, type Provider, type Task } from './types.js';
import { allowedWorkspace, contains, prepareWorkspace } from './workspace.js';
export class Engine extends EventEmitter {
  running = new Map<string, { run?: AgentRun; done?: Promise<void>; capability: string }>();
  approvals = new Map<string, (value: { approved: boolean; answer: string })=>void>();
  draining = false; closing = false; lockedTasks = new Set<string>();
  constructor(public store: Store, public adapters: Record<Provider, Adapter>, public dataDir: string, public url: string) { super(); }
  event(taskId: string | null, type: string, data: unknown) { const event = this.store.event(taskId,type,data); this.emit('event',event); return event; }
  changed(task: Task) { this.store.saveTask(task); this.event(task.id,'status', { status: task.status, error: task.error }); }
  async create(input: { prompt: string; workspace: string; provider?: Provider; model?: string; title?: string; parentId?: string; scheduleId?: string; kind?: 'pm'; role?: string }) {
    if (this.closing) throw new Error('Daemon is shutting down');
    if (!input.prompt?.trim() || input.prompt.length > 100000) throw new Error('Prompt must contain 1–100000 characters');
    if (input.provider && !['claude','codex'].includes(input.provider)) throw new Error('Invalid provider');
    const settings = this.store.settings();
    const workspace = await allowedWorkspace(input.workspace, settings.roots);
    if(input.role!==undefined&&(typeof input.role!=='string'||input.role.length>80)) throw new Error('Freelancer role must be at most 80 characters');
    if(input.kind==='pm'&&input.parentId) throw new Error('PM cannot be a worker');
    if (input.parentId && this.store.task(input.parentId).parentId) throw new Error('Workers cannot spawn');
    const provider = input.provider || (input.parentId ? settings.workerProvider : settings.coordinatorProvider);
    const task = this.store.createTask({ ...input, workspace, provider, model: input.model || (provider === 'claude' ? settings.claudeModel : settings.codexModel) });
    this.store.enqueue(task.id, input.prompt); this.event(task.id,'created',task); void this.drain(); return task;
  }
  private pmMessages: Promise<unknown> = Promise.resolve();
  async messagePM(workspace: string, text: string): Promise<Task> {
    // Serialize creation so two first messages cannot create two PMs for one workspace/provider.
    const result=this.pmMessages.then(async()=> {
      const settings=this.store.settings();
      const actual=await allowedWorkspace(workspace,settings.roots);
      const pm=this.store.tasks().find(t=>t.kind==='pm'&&t.workspace===actual&&t.provider===settings.coordinatorProvider);
      if(pm) { await this.message(pm.id,text);return this.store.task(pm.id); }
      return this.create({prompt:text,title:'PM',workspace:actual,kind:'pm',provider:settings.coordinatorProvider});
    });
    this.pmMessages=result.catch(()=>{});return result;
  }
  async message(id: string, text: string) {
    const task = this.store.task(id);
    if(this.lockedTasks.has(id)) throw new Error('Task is being merged');
    if (!text?.trim() || text.length > 100000) throw new Error('Message must contain 1–100000 characters');
    if (['cancelled','interrupted','failed'].includes(task.status)) throw new Error('Resume this task explicitly before sending messages');
    this.store.enqueue(id,text); this.event(id,'user_message',{ text });
    if (!this.running.has(id)) { task.status='queued'; this.changed(task); }
    void this.drain();
  }
  async resume(id: string, prompt = 'Resume after interruption. Review the activity log and current files before continuing; avoid repeating external side effects.') {
    const task = this.store.task(id);
    if(this.lockedTasks.has(id)) throw new Error('Task is being merged');
    if (active(task.status) || this.running.has(id)) throw new Error('Task is already active');
    task.status='queued'; task.error=''; this.store.enqueue(id,prompt); this.changed(task); void this.drain();
  }
  async drain() {
    if (this.draining || this.closing) return;
    this.draining=true;
    try {
      for (const task of this.store.tasks().filter(t=>t.status==='queued')) {
        if (this.running.has(task.id) || this.lockedTasks.has(task.id)) continue;
        const inFlight = [...this.running.keys()].map(id=>this.store.task(id));
        if (!task.parentId && inFlight.some(t=>!t.parentId)) continue;
        if (task.parentId && inFlight.filter(t=>t.parentId).length >= this.store.settings().maxWorkers) continue;
        // Git workers get independent worktrees. Non-Git writers lock overlapping directories.
        const workspace = task.executionPath || task.workspace;
        if (task.parentId && !task.branch && inFlight.some(t=>t.parentId && !t.branch && (contains(t.executionPath || t.workspace, workspace) || contains(workspace,t.executionPath || t.workspace)))) continue;
        this.running.set(task.id, { capability: randomBytes(32).toString('hex') });
        task.status='running'; this.changed(task);
        this.running.get(task.id)!.done=this.execute(task.id);
      }
    } finally { this.draining=false; }
  }
  async execute(id: string) {
    try {
      let task = this.store.task(id);
      await allowedWorkspace(task.workspace,this.store.settings().roots);
      await prepareWorkspace(task,this.dataDir);
      const current=this.store.task(id);
      current.executionPath=task.executionPath; current.branch=task.branch; current.baseCommit=task.baseCommit;
      this.store.saveTask(current); task=current;
      if (this.closing || task.status === 'cancelled') return;
      void this.drain();
      const queued = this.store.pending(id);
      const prompt = queued.map(m=>m.text).join('\n\n');
      this.store.consume(queued.map(m=>m.id)); this.event(id,'turn_started',{ text: prompt });
      const entry = this.running.get(id)!;
      const run = this.adapters[task.provider].run({ task, prompt: prompt || 'Continue the assigned task.', url: this.url, capability: entry.capability, bridge: this.bridge,
        event: (type,data)=>this.event(id,type,data),
        session: sessionId=> { const current=this.store.task(id); current.sessionId=sessionId; this.store.saveTask(current); },
        approve: (kind,details)=>this.approve(id,kind,details),
      });
      entry.run=run;
      const result = await run.done;
      task=this.store.task(id);
      if (task.status==='cancelled' || this.closing) return;
      task.result=result; task.error='';
      const children=this.store.tasks().filter(t=>t.parentId===id);
      task.status=this.store.pending(id).length ? 'queued' : children.some(t=>active(t.status)) ? 'waiting' : 'completed';
      this.changed(task); this.event(id,'result',{ text:result });
      if (task.parentId) this.wakeParent(task);
    } catch(error) {
      const task=this.store.task(id);
      if (task.status!=='cancelled' && !this.closing) { task.status='failed'; task.error=String(error); this.changed(task); if(task.parentId) this.wakeParent(task); }
    } finally {
      this.expireApprovals(id); this.running.delete(id); void this.drain();
    }
  }
  bridge = '';
  wakeParent(task: Task) {
    if (!task.parentId) return;
    const parent=this.store.task(task.parentId);
    this.store.enqueue(parent.id, `Worker ${task.id} (${task.provider}) ${task.status}. Workspace: ${task.executionPath}. Branch: ${task.branch || 'none'}. Result:\n${task.result.slice(-16000)}\nError: ${task.error}`);
    if (['cancelled','interrupted','failed'].includes(parent.status)) return;
    if (!this.running.has(parent.id)) { parent.status='queued'; this.changed(parent); }
  }
  approve(taskId: string, kind: string, details: unknown): Promise<{ approved: boolean; answer: string }> {
    if (this.closing || !this.running.has(taskId)) return Promise.resolve({ approved:false,answer:'Task is no longer running' });
    const approval: Approval={ id:randomUUID(),taskId,kind,details,status:'pending',answer:'',createdAt:new Date().toISOString() };
    this.store.saveApproval(approval); const task=this.store.task(taskId); task.status='waiting'; this.changed(task); this.event(taskId,'approval',approval);
    return new Promise(resolve=>this.approvals.set(approval.id,resolve));
  }
  answer(id: string, approved: boolean, answer: string) {
    const a=this.store.approvals().find(a=>a.id===id);
    const resolve=this.approvals.get(id);
    if (!a || a.status!=='pending' || !resolve) throw new Error('Approval has expired or was already answered');
    a.status=approved ? 'approved':'denied'; a.answer=answer; this.store.saveApproval(a); this.approvals.delete(id);
    const task=this.store.task(a.taskId);
    if (this.running.has(task.id) && !this.store.approvals().some(x=>x.taskId===task.id && x.status==='pending')) { task.status='running'; this.changed(task); }
    this.event(task.id,'approval_resolved',a); resolve({approved,answer});
  }
  expireApprovals(taskId: string) {
    for (const a of this.store.approvals().filter(a=>a.taskId===taskId && a.status==='pending')) {
      a.status='expired'; this.store.saveApproval(a); this.approvals.get(a.id)?.({ approved:false,answer:'Task stopped' }); this.approvals.delete(a.id); this.event(taskId,'approval_resolved',a);
    }
  }
  cancel(id: string) {
    if(this.lockedTasks.has(id)) throw new Error('Task is being merged');
    const task=this.store.task(id); task.status='cancelled'; this.changed(task);
    for(const child of this.store.tasks().filter(t=>t.parentId===id && active(t.status))) this.cancel(child.id);
    this.expireApprovals(id); this.running.get(id)?.run?.cancel();
    if(task.parentId) this.wakeParent(task);
  }
  async tool(capability: string, name: string, args: any) {
    const entry=[...this.running.entries()].find(([,value])=>value.capability===capability);
    if(!entry) throw new Error('Invalid or expired task capability');
    const task=this.store.task(entry[0]);
    if(task.status==='cancelled') throw new Error('Task cancelled');
    const assertChild=(id: string)=> { if(this.store.task(id).parentId!==task.id) throw new Error('Worker does not belong to this coordinator'); };
    if(name==='get_status') return { task, children:this.store.tasks().filter(t=>t.parentId===task.id) };
    if(name==='ask_user') {
      if(typeof args.question!=='string' || !args.question.trim()) throw new Error('Question is required');
      return this.approve(task.id,'question',{ question:args.question });
    }
    if(name==='approve') {
      const response=await this.approve(task.id,'permission',args);
      const input=args.input || args.tool_input || {};
      return response.approved ? { behavior:'allow', updatedInput:input } : { behavior:'deny', message:response.answer || 'Denied by user' };
    }
    if(task.parentId) throw new Error('Workers cannot delegate or control other agents');
    if(name==='spawn_task') return this.create({ prompt:args.prompt,title:args.title,workspace:args.workspace || task.workspace,provider:args.provider,model:args.model,role:args.role,parentId:task.id });
    if(name==='send_message') { assertChild(args.taskId); await this.message(args.taskId,args.message); return {ok:true}; }
    if(name==='cancel_task') { assertChild(args.taskId); this.cancel(args.taskId); return {ok:true}; }
    throw new Error('Unknown tool');
  }
  async shutdown() {
    this.closing=true;
    const runs=[...this.running.entries()];
    for(const [id,entry] of runs) { const t=this.store.task(id); if(t.status!=='cancelled') { t.status='interrupted'; this.changed(t); } this.expireApprovals(id); entry.run?.cancel(); }
    await Promise.allSettled(runs.map(([,e])=>e.done));
  }
}
