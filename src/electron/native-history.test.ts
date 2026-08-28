import { describe, expect, it } from "vitest";
import { NativeHistoryService } from "./native-history";
import type { StoredWorkspace } from "./state-database";

const workspace: StoredWorkspace = {
  projects: [{ id: "project", name: "Project", path: "/tmp/project", threads: [{ id: "native", title: "Native", agentId: "codex", nativeSessionId: "thr-1" }, { id: "fallback", title: "Fallback" }] }],
  standaloneThreads: [],
};

describe("NativeHistoryService", () => {
  it("loads a bound thread from its native transcript", async () => {
    const codex = { readThread: async () => ({ turns: [{ id: "turn-1", status: "completed", items: [{ type: "userMessage", id: "user-1", content: [{ type: "text", text: "hello" }] }, { type: "agentMessage", id: "agent-1", text: "world" }] }] }) };
    const service = new NativeHistoryService(codex as any, { readSession: async () => [] } as any, { readSession: async () => [] } as any);
    const loaded = await service.load(workspace, { native: [{ id: "duplicate" }], fallback: [{ id: "only-copy" }] });
    expect(loaded.native).toMatchObject([{ role: "user", text: "hello" }, { role: "assistant" }]);
    expect(loaded.fallback).toEqual([{ id: "only-copy" }]);
    expect(service.filterFallback(workspace, loaded, new Set(["native", "fallback"]))).toEqual({ fallback: [{ id: "only-copy" }] });
  });

  it("keeps the SQLite fallback when native history cannot be read", async () => {
    const service = new NativeHistoryService({ readThread: async () => { throw new Error("missing"); } } as any, {} as any, {} as any);
    const fallback = { native: [{ id: "safe-copy" }] };
    expect(await service.load(workspace, fallback)).toEqual(fallback);
    expect(service.filterFallback(workspace, fallback, new Set(["native"]))).toEqual(fallback);
  });
});
