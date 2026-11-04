const string = { type: 'string' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const toolDefinitions = [
  { name: 'spawn_task', description: 'PM only: hire a temporary freelancer for a focused task. Set a short role such as Frontend, Researcher, or Reviewer. The freelancer leaves the office when the task ends; its work remains in history. Returns immediately. Worker completion will wake the coordinator. Workers cannot spawn.', inputSchema: object({ prompt: string, title: string, role: string, provider: { enum: ['claude','codex'] }, workspace: string, model: string }, ['prompt']) },
  { name: 'send_message', description: 'Coordinator only: send follow-up instructions to one of your workers. Delivered at the next turn boundary.', inputSchema: object({ taskId: string, message: string }, ['taskId','message']) },
  { name: 'get_status', description: 'Get your task and its children, including results. No polling needed: completions wake the coordinator.', inputSchema: object({}) },
  { name: 'cancel_task', description: 'Coordinator only: cancel your worker and its subprocesses.', inputSchema: object({ taskId: string }, ['taskId']) },
  { name: 'ask_user', description: 'Ask the user for missing information. Waits for their response in the dashboard.', inputSchema: object({ question: string }, ['question']) },
];
export const permissionTool = { name: 'approve', description: 'Permission host for Claude Code. The daemon displays this request for the user.', inputSchema: { type: 'object', additionalProperties: true } };
