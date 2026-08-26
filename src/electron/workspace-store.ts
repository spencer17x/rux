import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { StateDatabase, StoredProject, StoredThread, StoredWorkspace } from "./state-database";

export class WorkspaceStore {
  constructor(private readonly database: StateDatabase, private readonly legacyPath: string) {}
  async load(): Promise<StoredWorkspace> {
    if (this.database.hasMetadata("workspace-migrated")) return this.database.loadWorkspace();
    let stored: Partial<StoredWorkspace> = {}; try { stored = JSON.parse(await readFile(this.legacyPath, "utf8")); } catch {}
    const normalizeThread = (value: unknown): StoredThread | null => { if (!value || typeof value !== "object") return null; const thread = value as Partial<StoredThread>; if (!thread.id || !thread.title) return null; return { id: String(thread.id).slice(0, 500), title: String(thread.title).slice(0, 100), ...(thread.codexThreadId ? { codexThreadId: String(thread.codexThreadId).slice(0, 500) } : {}), ...(["codex", "claude-code", "pi"].includes(String(thread.agentId)) ? { agentId: thread.agentId } : {}), ...(thread.nativeSessionId ? { nativeSessionId: String(thread.nativeSessionId).slice(0, 500) } : {}), ...(thread.agentMode ? { agentMode: String(thread.agentMode).slice(0, 80) } : {}) }; };
    const workspace: StoredWorkspace = { projects: (Array.isArray(stored.projects) ? stored.projects : []).flatMap((project) => !project?.id || !project.name || !project.path ? [] : [{ id: String(project.id).slice(0, 200), name: String(project.name).slice(0, 100), path: String(project.path), threads: (Array.isArray(project.threads) ? project.threads : []).map(normalizeThread).filter((thread): thread is StoredThread => Boolean(thread)) }]), standaloneThreads: (Array.isArray(stored.standaloneThreads) ? stored.standaloneThreads : []).map(normalizeThread).filter((thread): thread is StoredThread => Boolean(thread) && !["compare", "logs"].includes(thread!.id)) };
    this.save(workspace); return workspace;
  }
  async save(workspace: StoredWorkspace): Promise<void> { this.database.saveWorkspace(workspace); this.database.setMetadata("workspace-migrated", new Date().toISOString()); }
  async resolve(projectId: string): Promise<StoredProject> { const project = (await this.load()).projects.find((item) => item.id === projectId || item.path === projectId); if (!project) throw new Error("项目不存在或未授权"); const path = await realpath(resolve(project.path)); if (!(await stat(path)).isDirectory()) throw new Error("项目目录不可用"); return { ...project, path }; }
}
