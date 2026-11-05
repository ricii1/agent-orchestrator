import {selectedChoice} from '../approval-options.js';
import type { Adapter, RunContext } from '../types.js';
import { child, lines, Rpc, stop } from './process.js';
import { instructions } from './claude.js';
import { isEmptyFormRequest } from '../elicitation.js';
export class CodexAdapter implements Adapter {
  run(ctx: RunContext) {
    const coordinator = !ctx.task.parentId;
    const config = {
      features: { multi_agent: false },
      'mcp_servers': { orchestrator: { enabled: true, command: process.execPath, args: [ctx.bridge], env: { ORCHESTRATOR_URL: ctx.url, ORCHESTRATOR_CAPABILITY: ctx.capability, ORCHESTRATOR_ROLE: coordinator ? 'coordinator' : 'worker' }, required: true } },
      sandbox_workspace_write: { network_access: false, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
    };
    const p = child(process.env.CODEX_BIN || 'codex', ['app-server','--listen','stdio://','--disable','multi_agent'], ctx.task.executionPath!);
    const rpc = new Rpc(p);
    let settled = false, result = '', turnId = '', threadId = '';
    let resolve!: (v: string)=>void, reject!: (e: Error)=>void;
    const finished = new Promise<void>(ok=>p.once('close',()=>ok()));
    const resultPromise = new Promise<string>((ok,no)=> { resolve=ok; reject=no; });
    const done = resultPromise.finally(async()=> { stop(p); await finished; });
    const fail = (e: Error) => { if (!settled) { settled=true; reject(e); } };
    lines(p, msg => {
      if (rpc.response(msg)) return;
      if (msg.id !== undefined && msg.method) {
        void this.serverRequest(ctx, msg.method, msg.params).then(value=>rpc.write({ id: msg.id, result: value })).catch(e=>rpc.write({ id: msg.id, error: { code: -32000, message: String(e) } }));
        return;
      }
      const v = msg.params || {};
      if(msg.method==='turn/started')turnId=v.turn?.id||turnId;
      if (msg.method === 'item/agentMessage/delta') ctx.event('text', { text: v.delta });
      if (msg.method === 'item/completed' && v.item?.type === 'agentMessage') { result += (result ? '\n' : '') + v.item.text; ctx.event('message', { text: v.item.text }); }
      if (msg.method === 'item/started' && !['agentMessage','reasoning'].includes(v.item?.type)) ctx.event('tool', v.item);
      if(msg.method==='item/commandExecution/outputDelta'&&typeof v.delta==='string')ctx.event('tool_output',{itemId:v.itemId,text:v.delta});
      if(msg.method==='item/completed'&&['commandExecution','fileChange','mcpToolCall'].includes(v.item?.type))ctx.event('tool_result',v.item);
      if (msg.method === 'thread/tokenUsage/updated') ctx.event('usage', v.tokenUsage);
      if (msg.method === 'turn/diff/updated') ctx.event('diff', v);
      if (msg.method === 'error') ctx.event('provider_error', v);
      if (msg.method === 'turn/completed' && !settled) {
        settled = true;
        if (v.turn.status === 'completed') resolve(ctx.compact?'Konteks Codex berhasil diringkas.':result); else reject(new Error(v.turn.error?.message || `Codex turn ${v.turn.status}`));
        stop(p);
      }
    }, text => ctx.event('log', { text }));
    p.on('error', fail); p.on('close', code => fail(new Error(`Codex exited (${code}) before turn completion`)));
    void (async()=> {
      await rpc.request('initialize', { clientInfo: { name: 'local_agent_office', title: 'Local Agent Office', version: '0.1.0' }, capabilities: {} });
      rpc.write({ method: 'initialized' });
      // Disable inherited MCP servers so task tools only use scoped capabilities.
      const current = await rpc.request('config/read', { includeLayers: false });
      const inherited = current.config?.mcp_servers || {};
      config.mcp_servers = { ...Object.fromEntries(Object.keys(inherited).map(name=>[name,{enabled:false}])), ...config.mcp_servers };
      const params = { cwd: ctx.task.executionPath, model: ctx.task.model || null, approvalPolicy: ctx.permissionMode==='full'?'never':'untrusted', sandbox: ctx.permissionMode==='full'?'danger-full-access':coordinator ? 'read-only' : 'workspace-write', developerInstructions: instructions(coordinator), config };
      const response = ctx.task.sessionId
        ? await rpc.request('thread/resume', { ...params, threadId: ctx.task.sessionId, excludeTurns: true })
        : await rpc.request('thread/start', params);
      threadId = response.thread.id; ctx.session(threadId); ctx.event('model', { model: response.model });
      if(ctx.compact){await rpc.request('thread/compact/start',{threadId});return;}
      const turn = await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: ctx.prompt }] });
      turnId = turn.turn.id;
    })().catch(e=> { fail(e); stop(p); });
    return { done, cancel: () => { if (turnId) rpc.write({ id: ++rpc.sequence, method:'turn/interrupt', params:{ threadId, turnId } }); stop(p); } };
  }
  async serverRequest(ctx: RunContext, method: string, params: any): Promise<any> {
    if (['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method)) {
      const answer = await ctx.approve(method, params);
      const denied=Array.isArray(params.availableDecisions)&&!params.availableDecisions.includes('decline')&&params.availableDecisions.includes('cancel')?'cancel':'decline';
      return { decision: answer.choice?selectedChoice(method,params,answer.choice,answer.approved).value:answer.approved?'accept':denied };
    }
    if (method === 'item/permissions/requestApproval') {
      // The daemon never grants a session-wide sandbox expansion.
      await ctx.approve('unsupported_permissions', { ...params, notice: 'Sandbox expansion is not supported. This request will be denied; use a registered workspace.' });
      return { permissions: {}, scope: 'turn' };
    }
    if (method === 'item/tool/requestUserInput') {
      const answer = await ctx.approve('question', params);
      return { answers: Object.fromEntries((params.questions || []).map((q: any) => [q.id, { answers: [answer.answer || (answer.approved ? 'Approved' : 'Declined')] }])) };
    }
    if (method === 'mcpServer/elicitation/request') {
      const answer = await ctx.approve('elicitation', params);
      if (!answer.approved) return { action:'decline', content:null };
      let content = null;
      if(isEmptyFormRequest(params))content={};
      else if (params.requestedSchema) { try { content = JSON.parse(answer.answer); } catch { return { action:'decline', content:null }; } }
      return { action:'accept', content };
    }
    throw new Error(`Unsupported provider request: ${method}`);
  }
}
