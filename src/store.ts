import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Approval, Event, Schedule, Settings, Task } from './types.js';

export class Store {
  db: Database.Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT, type TEXT NOT NULL, data TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, text TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS events_task ON events(taskId, id);
    `);
  }
  settings(): Settings {
    const row = this.db.prepare('SELECT body FROM settings WHERE id=1').get() as any;
    return row ? JSON.parse(row.body) : { roots: [], coordinatorProvider: 'codex', workerProvider: 'codex', claudeModel: '', codexModel: '', maxWorkers: 3 };
  }
  saveSettings(value: Settings) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES (1, ?)').run(JSON.stringify(value)); }
  all<T>(table: 'tasks' | 'approvals' | 'schedules'): T[] { return (this.db.prepare(`SELECT body FROM ${table}`).all() as any[]).map(x => JSON.parse(x.body)); }
  tasks() { return this.all<Task>('tasks').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); }
  task(id: string): Task {
    const row = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id) as any;
    if (!row) throw new Error('Task not found');
    return JSON.parse(row.body);
  }
  saveTask(task: Task) { task.updatedAt = new Date().toISOString(); this.db.prepare('INSERT OR REPLACE INTO tasks VALUES (?, ?)').run(task.id, JSON.stringify(task)); return task; }
  createTask(input: Pick<Task, 'prompt'|'provider'|'workspace'> & Partial<Task>) {
    const now = new Date().toISOString();
    return this.saveTask({ id: randomUUID(), parentId: null, title: input.prompt.slice(0,80), model: '', executionPath: null, branch: null, baseCommit: null, sessionId: null, status: 'queued', result: '', error: '', scheduleId: null, createdAt: now, updatedAt: now, prompt: input.prompt, provider: input.provider, workspace: input.workspace, ...Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined)) });
  }
  event(taskId: string | null, type: string, data: unknown): Event {
    const createdAt = new Date().toISOString();
    const info = this.db.prepare('INSERT INTO events(taskId,type,data,createdAt) VALUES (?,?,?,?)').run(taskId, type, JSON.stringify(data), createdAt);
    return { id: Number(info.lastInsertRowid), taskId, type, data, createdAt };
  }
  events(after = 0, taskId?: string, limit = 500): Event[] {
    const rows = taskId ? this.db.prepare('SELECT * FROM events WHERE id>? AND taskId=? ORDER BY id LIMIT ?').all(after, taskId, limit) : this.db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT ?').all(after, limit);
    return (rows as any[]).map(r => ({ ...r, data: JSON.parse(r.data) }));
  }
  recentEvents(taskId: string, limit=300, before?:number): Event[] {
    const rows=(before===undefined
      ?this.db.prepare("SELECT * FROM events WHERE taskId=? AND type!='text' ORDER BY id DESC LIMIT ?").all(taskId,limit)
      :this.db.prepare("SELECT * FROM events WHERE taskId=? AND type!='text' AND id<? ORDER BY id DESC LIMIT ?").all(taskId,before,limit)) as any[];
    return rows.reverse().map(row=>({...row,data:JSON.parse(row.data)}));
  }
  saveApproval(value: Approval) { this.db.prepare('INSERT OR REPLACE INTO approvals VALUES (?, ?)').run(value.id, JSON.stringify(value)); }
  approvals() { return this.all<Approval>('approvals'); }
  saveSchedule(value: Schedule) { this.db.prepare('INSERT OR REPLACE INTO schedules VALUES (?, ?)').run(value.id, JSON.stringify(value)); }
  enqueue(id: string, text: string) { this.db.prepare('INSERT INTO inbox(taskId,text) VALUES (?,?)').run(id, text); }
  pending(id: string): { id: number; text: string }[] { return this.db.prepare('SELECT id,text FROM inbox WHERE taskId=? AND delivered=0 ORDER BY id').all(id) as any; }
  consume(ids: number[]) { const q = this.db.prepare('UPDATE inbox SET delivered=1 WHERE id=?'); this.db.transaction(() => ids.forEach(id=>q.run(id)))(); }
  recover() {
    this.db.transaction(() => {
      for (const task of this.tasks()) if (['running','waiting'].includes(task.status)) { task.status = 'interrupted'; task.error = 'Daemon stopped. Review activity before resuming.'; this.saveTask(task); }
      for (const a of this.approvals()) if (a.status === 'pending') { a.status = 'expired'; this.saveApproval(a); }
    })();
  }
  close() { this.db.close(); }
}
