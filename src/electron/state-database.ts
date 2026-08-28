import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredThread = {
  id: string;
  title: string;
  codexThreadId?: string;
  agentId?: "codex" | "claude-code" | "pi";
  nativeSessionId?: string;
  agentMode?: string;
};

export type StoredProject = {
  id: string;
  name: string;
  path: string;
  threads: StoredThread[];
};

export type StoredWorkspace = {
  projects: StoredProject[];
  standaloneThreads: StoredThread[];
};

type ThreadRow = {
  id: string;
  project_id: string | null;
  title: string;
  codex_thread_id: string | null;
  agent_id: StoredThread["agentId"] | null;
  native_session_id: string | null;
  agent_mode: string | null;
};

export class StateDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        codex_thread_id TEXT,
        agent_id TEXT,
        native_session_id TEXT,
        agent_mode TEXT,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  hasMetadata(key: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM metadata WHERE key = ?").get(key));
  }

  setMetadata(key: string, value: string): void {
    this.database.prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  loadWorkspace(): StoredWorkspace {
    const projects = this.database.prepare("SELECT id, name, path FROM projects ORDER BY sort_order, rowid").all() as Array<{ id: string; name: string; path: string }>;
    const threadRows = this.database.prepare("SELECT id, project_id, title, codex_thread_id, agent_id, native_session_id, agent_mode FROM threads ORDER BY sort_order, rowid").all() as ThreadRow[];
    const threads = threadRows.map((row) => ({
      id: row.id,
      title: row.title,
      ...(row.codex_thread_id ? { codexThreadId: row.codex_thread_id } : {}),
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
      ...(row.native_session_id ? { nativeSessionId: row.native_session_id } : {}),
      ...(row.agent_mode ? { agentMode: row.agent_mode } : {}),
    }));
    return {
      projects: projects.map((project) => ({ ...project, threads: threadRows.flatMap((row, index) => row.project_id === project.id ? [threads[index]] : []) })),
      standaloneThreads: threadRows.flatMap((row, index) => row.project_id === null ? [threads[index]] : []),
    };
  }

  saveWorkspace(workspace: StoredWorkspace): void {
    const upsertProject = this.database.prepare("INSERT INTO projects(id, name, path, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, sort_order = excluded.sort_order");
    const upsertThread = this.database.prepare("INSERT INTO threads(id, project_id, title, codex_thread_id, agent_id, native_session_id, agent_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title, codex_thread_id = excluded.codex_thread_id, agent_id = excluded.agent_id, native_session_id = excluded.native_session_id, agent_mode = excluded.agent_mode, sort_order = excluded.sort_order");
    const deleteThread = this.database.prepare("DELETE FROM threads WHERE id = ?");
    const deleteProject = this.database.prepare("DELETE FROM projects WHERE id = ?");
    const projectIds = new Set(workspace.projects.map((project) => project.id));
    const threadIds = new Set([...workspace.projects.flatMap((project) => project.threads), ...workspace.standaloneThreads].map((thread) => thread.id));
    this.transaction(() => {
      workspace.projects.forEach((project, projectIndex) => {
        upsertProject.run(project.id, project.name, project.path, projectIndex);
        project.threads.forEach((thread, threadIndex) => upsertThread.run(thread.id, project.id, thread.title, thread.codexThreadId || null, thread.agentId || null, thread.nativeSessionId || null, thread.agentMode || null, threadIndex));
      });
      workspace.standaloneThreads.forEach((thread, threadIndex) => upsertThread.run(thread.id, null, thread.title, thread.codexThreadId || null, thread.agentId || null, thread.nativeSessionId || null, thread.agentMode || null, threadIndex));
      for (const row of this.database.prepare("SELECT id FROM threads").all() as Array<{ id: string }>) if (!threadIds.has(row.id)) deleteThread.run(row.id);
      for (const row of this.database.prepare("SELECT id FROM projects").all() as Array<{ id: string }>) if (!projectIds.has(row.id)) deleteProject.run(row.id);
    });
  }

  loadMessages(): Record<string, unknown[]> {
    const result: Record<string, unknown[]> = {};
    for (const row of this.database.prepare("SELECT thread_id, data_json FROM messages").all() as Array<{ thread_id: string; data_json: string }>) {
      try {
        const messages = JSON.parse(row.data_json);
        if (Array.isArray(messages)) result[row.thread_id] = messages;
      } catch {
        // Ignore one damaged transcript without hiding the remaining conversations.
      }
    }
    return result;
  }

  messageThreadIds(): Set<string> {
    return new Set((this.database.prepare("SELECT thread_id FROM messages").all() as Array<{ thread_id: string }>).map((row) => row.thread_id));
  }

  saveMessages(messages: Record<string, unknown[]>): void {
    const existingThreads = new Set((this.database.prepare("SELECT id FROM threads").all() as Array<{ id: string }>).map((row) => row.id));
    const upsert = this.database.prepare("INSERT INTO messages(thread_id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at");
    const remove = this.database.prepare("DELETE FROM messages WHERE thread_id = ?");
    this.transaction(() => {
      for (const [threadId, threadMessages] of Object.entries(messages)) {
        if (existingThreads.has(threadId)) upsert.run(threadId, JSON.stringify(threadMessages), Date.now());
      }
      for (const row of this.database.prepare("SELECT thread_id FROM messages").all() as Array<{ thread_id: string }>) if (!(row.thread_id in messages)) remove.run(row.thread_id);
    });
  }

  close(): void {
    this.database.close();
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
