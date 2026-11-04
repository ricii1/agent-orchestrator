export type Provider = 'claude' | 'codex';
export type Status = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface Task {
  id: string; kind?: 'pm'; role?: string; parentId: string | null; title: string; prompt: string; provider: Provider;
  model: string; workspace: string; executionPath: string | null; branch: string | null; baseCommit: string | null;
  sessionId: string | null; status: Status; result: string; error: string;
  scheduleId: string | null; createdAt: string; updatedAt: string;
}
export interface Settings { roots: string[]; coordinatorProvider: Provider; workerProvider: Provider; claudeModel: string; codexModel: string; maxWorkers: number; }
export interface Event { id: number; taskId: string | null; type: string; data: unknown; createdAt: string; }
export interface Approval { id: string; taskId: string; kind: string; details: unknown; status: 'pending' | 'approved' | 'denied' | 'expired'; answer: string; createdAt: string; }
export interface Schedule { id: string; title: string; prompt: string; workspace: string; provider: Provider; model: string; cron: string; timezone: string; enabled: boolean; lastRun: string | null; }
export interface RunContext {
  task: Task; prompt: string; url: string; capability: string; bridge: string;
  event(type: string, data: unknown): void;
  session(id: string): void;
  approve(kind: string, details: unknown): Promise<{ approved: boolean; answer: string }>;
}
export interface AgentRun { done: Promise<string>; cancel(): void; }
export interface Adapter { run(context: RunContext): AgentRun; }
export const active = (s: Status) => ['queued', 'running', 'waiting'].includes(s);
