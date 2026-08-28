import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateDatabase, type StoredWorkspace } from "./state-database";
import type { IpcHandler, IpcRegistrar } from "./ipc-types";
import { registerWorkspaceIpc } from "./workspace-ipc";

let temporary = "";
afterEach(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); temporary = ""; });

function harness(initial: StoredWorkspace) {
  temporary = mkdtempSync(join(tmpdir(), "rux-workspace-ipc-")); const database = new StateDatabase(join(temporary, "state.sqlite")); database.saveWorkspace(initial); let workspace = initial;
  const handlers = new Map<string, IpcHandler>(); const ipc: IpcRegistrar = { handle: (channel, listener) => { handlers.set(channel, listener); } };
  registerWorkspaceIpc(ipc, { getWindow: () => null, loadWorkspace: async () => structuredClone(workspace), saveWorkspace: async (next) => { workspace = structuredClone(next); database.saveWorkspace(next); }, stateDatabase: () => database, runProcess: async () => ({ stdout: "", stderr: "", code: 0 }), gitExecutable: () => "git" });
  const invoke = async (channel: string, value?: unknown) => await handlers.get(channel)!({} as any, value);
  return { database, invoke, current: () => workspace };
}

describe("workspace IPC", () => {
  it("adds, updates, and removes project threads", async () => {
    const { database, invoke, current } = harness({ projects: [{ id: "project", name: "Project", path: "/tmp/project", threads: [] }], standaloneThreads: [] });
    const thread = await invoke("projects:add-thread", { projectId: "project", title: "Task" });
    await invoke("projects:add-thread", { projectId: "project", title: "Second" });
    expect(current().projects[0].threads).toHaveLength(2);
    await invoke("threads:update", { type: "project", projectId: "project", threadId: thread.id, title: "Renamed", agentId: "codex" });
    expect(current().projects[0].threads[0]).toMatchObject({ title: "Renamed", agentId: "codex" });
    await invoke("threads:remove", { type: "project", projectId: "project", threadId: thread.id });
    expect(current().projects[0].threads).toMatchObject([{ title: "Second" }]); database.close();
  });

  it("persists messages only for registered threads", async () => {
    const { database, invoke } = harness({ projects: [], standaloneThreads: [{ id: "thread", title: "Chat" }] });
    await invoke("messages:save", { thread: [{ id: "message", role: "user", text: "hello" }] });
    expect(await invoke("messages:list")).toMatchObject({ thread: [{ text: "hello" }] }); database.close();
  });
});
