// Small stdio MCP bridge. Stdout is reserved for JSON-RPC, never application logs.
import { createInterface } from 'node:readline';
import { permissionTool, toolDefinitions } from './tools.js';
const url = process.env.ORCHESTRATOR_URL;
const capability = process.env.ORCHESTRATOR_CAPABILITY;
const role = process.env.ORCHESTRATOR_ROLE;
const reply = (id: unknown, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result })+'\n');
const tools = [...toolDefinitions.filter(t => role === 'coordinator' || ['get_status','ask_user'].includes(t.name)), permissionTool];
createInterface({ input: process.stdin }).on('line', async line => {
  let req: any;
  try {
    req = JSON.parse(line);
    if (req.id === undefined) return;
    if (req.method === 'initialize') return void reply(req.id, { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'orchestrator', version: '0.1.0' } });
    if (req.method === 'ping') return void reply(req.id, {});
    if (req.method === 'tools/list') return void reply(req.id, { tools });
    if (req.method !== 'tools/call') throw new Error('Unknown MCP method');
    if (!tools.some(t=>t.name===req.params.name)) throw new Error('Tool not available');
    const response = await fetch(`${url}/internal/tool`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${capability}` }, body: JSON.stringify({ name: req.params.name, arguments: req.params.arguments || {} }) });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    reply(req.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
  } catch (error) {
    if (req?.id !== undefined) reply(req.id, { isError: true, content: [{ type: 'text', text: String(error) }] });
  }
});
