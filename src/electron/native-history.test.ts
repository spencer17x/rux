import { describe, expect, it } from "vitest";
import { NativeHistoryService } from "./native-history";
import type { StoredWorkspace } from "./state-database";

const workspace: StoredWorkspace = {
  projects: [{ id: "project", name: "Project", path: "/tmp/project", threads: [{ id: "native", title: "Native", agentId: "codex", nativeSessionId: "thr-1" }, { id: "fallback", title: "Fallback" }] }],
  standaloneThreads: [],
};

describe("NativeHistoryService", () => {
  it("rehydrates per-turn metadata without applying the thread's latest model to old turns", async () => {
    const codex = { readThread: async () => ({ model: "gpt-6-astra", reasoningEffort: "xhigh", turns: ["old", "new"].map((id) => ({ id, status: "completed", durationMs: 1000, items: [{ type: "agentMessage", id: `${id}-text`, text: `native ${id}` }] })) }) };
    const service = new NativeHistoryService(codex as any, {} as any, {} as any);
    const loaded = await service.load(workspace, {}, { native: [{ recordId: "local-a", nativeTurnId: "old", model: "gpt-5.6-sol", reasoning: "high", elapsedMs: 18400, usage: { totalTokens: 6320 } }] });
    const messages = loaded.native as any[];
    expect(messages[0]).toMatchObject({ parts: [{ text: "native old" }], turnInfo: { model: "gpt-5.6-sol", reasoning: "high", elapsedMs: 18400, usage: { totalTokens: 6320 } } });
    expect(messages[1].turnInfo.model).toBeUndefined();
    expect(messages[1].turnInfo.elapsedMs).toBe(1000);
  });
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

  it("does not report an interrupted Codex turn as completed after restart", async () => {
    const interrupted: StoredWorkspace = { projects: [], standaloneThreads: [{ id: "codex", title: "Codex", agentId: "codex", nativeSessionId: "thr" }] };
    const codex = { readThread: async () => ({ turns: [{ id: "turn", status: "interrupted", items: [{ type: "userMessage", id: "user", content: [{ type: "text", text: "stop" }] }, { type: "agentMessage", id: "agent", text: "partial" }] }] }) };
    const service = new NativeHistoryService(codex as any, { readSession: async () => [] } as any, { readSession: async () => [] } as any);
    expect((await service.load(interrupted, {})).codex[1]).toMatchObject({ role: "assistant", status: "incomplete" });
  });

  it("rebuilds Claude tool results and final status", async () => {
    const state: StoredWorkspace = { projects: [], standaloneThreads: [{ id: "claude", title: "Claude", agentId: "claude-code", nativeSessionId: "session" }] };
    const entries = [
      { type: "user", uuid: "u", message: { role: "user", content: [{ type: "text", text: "list" }] } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool", name: "Bash", input: { command: "pwd" } }] } },
      { type: "user", uuid: "result", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool", content: "project", is_error: false }] } },
      { type: "assistant", uuid: "a2", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } },
      { type: "result", subtype: "success", is_error: false },
    ];
    const service = new NativeHistoryService({} as any, { readSession: async () => entries } as any, {} as any);
    const assistant = (await service.load(state, {})).claude[1] as any;
    expect(assistant).toMatchObject({ role: "assistant", status: "complete" });
    expect(assistant.parts).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: "commandExecution", result: expect.objectContaining({ output: "project" }) }), expect.objectContaining({ type: "text", text: "done" })]));
  });

  it("restores only Pi's active branch with reasoning, tools, and results", async () => {
    const state: StoredWorkspace = { projects: [], standaloneThreads: [{ id: "pi", title: "Pi", agentId: "pi", nativeSessionId: "/session.jsonl" }] };
    const entries = [
      { type: "message", id: "u", parentId: null, message: { role: "user", content: "inspect" } },
      { type: "message", id: "abandoned", parentId: "u", message: { role: "user", content: "abandoned branch" } },
      { type: "message", id: "a1", parentId: "u", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", id: "tool", name: "read", arguments: { path: "a.ts" } }] } },
      { type: "message", id: "r", parentId: "a1", message: { role: "toolResult", toolCallId: "tool", toolName: "read", content: [{ type: "text", text: "source" }], isError: false } },
      { type: "message", id: "a2", parentId: "r", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] } },
    ];
    const service = new NativeHistoryService({} as any, {} as any, { readSession: async () => entries } as any);
    const loaded = (await service.load(state, {})).pi as any[];
    expect(loaded.some((message) => message.text === "abandoned branch")).toBe(false);
    expect(loaded[1]).toMatchObject({ role: "assistant", status: "complete" });
    expect(loaded[1].parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "reasoning", text: "checking" }), expect.objectContaining({ toolCallId: "tool", result: expect.objectContaining({ output: "source" }) }), expect.objectContaining({ type: "text", text: "done" })]));
  });
});
