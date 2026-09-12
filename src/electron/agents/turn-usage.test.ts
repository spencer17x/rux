import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./codex-app-server";
import { ClaudeCodeClient } from "./claude-code";
import { PiRuntimeClient } from "./pi-runtime";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

describe("native adapter turn accounting", () => {
  it("counts all Codex calls in this turn, not thread history or duplicate events", () => {
    const emit = vi.fn(); const client = new CodexAppServerClient(() => "codex", emit) as any;
    const usage = (total: number, last: number, turnId = "turn-1") => client.handleNotification("thread/tokenUsage/updated", { threadId: "thread", turnId, tokenUsage: { total: { totalTokens: total }, last: { totalTokens: last } } });
    usage(1000, 200, "history");
    const run = { runId: "run", threadId: "thread", turnId: "turn-1" };
    client.runsByThread.set("thread", run); client.runsByTurn.set("turn-1", run);
    usage(1500, 500); usage(1800, 300); usage(1800, 300);
    expect(emit.mock.lastCall?.[0].turnInfo.usage.totalTokens).toBe(800);
    usage(1000, 200, "history"); // A late old turn must not poison the current baseline.
    usage(1900, 100);
    expect(emit.mock.lastCall?.[0].turnInfo.usage.totalTokens).toBe(900);
    client.handleNotification("model/rerouted", { threadId: "thread", turnId: "turn-1", fromModel: "original", toModel: "actual-model" });
    expect(emit.mock.lastCall?.[0]).toMatchObject({ type: "turn-metadata", turnInfo: { model: "actual-model" } });
    client.handleNotification("turn/completed", { threadId: "thread", turn: { id: "turn-1", status: "completed", durationMs: 42600 } });
    expect(emit.mock.lastCall?.[0]).toMatchObject({ type: "turn-completed", turnInfo: { usage: { totalTokens: 900 }, elapsedMs: 42600 } });
  });

  it("uses the first reported call when a resumed Codex baseline is unavailable", () => {
    const emit = vi.fn(); const client = new CodexAppServerClient(() => "codex", emit) as any;
    client.runsByThread.set("thread", { runId: "run", threadId: "thread", turnId: "turn" });
    client.handleNotification("thread/tokenUsage/updated", { threadId: "thread", turnId: "turn", tokenUsage: { total: { totalTokens: 7800 }, last: { totalTokens: 800 } } });
    expect(emit.mock.lastCall?.[0].turnInfo.usage.totalTokens).toBe(800);
  });

  it("takes Claude query totals once, including cache and secondary calls", () => {
    const emit = vi.fn(); const client = new ClaudeCodeClient(() => "claude", emit) as any;
    const run = { input: { runId: "run" }, sessionId: "session", usageByMessage: new Map(), toolItems: new Map() };
    client.handleAssistant(run, { uuid: "native-a", message: { id: "a", model: "claude-model", usage: { input_tokens: 10, output_tokens: 2 }, content: [] } });
    client.handleAssistant(run, { uuid: "native-a", message: { id: "a", model: "claude-model", usage: { input_tokens: 10, output_tokens: 2 }, content: [] } });
    expect(emit.mock.lastCall?.[0].turnInfo.usage.totalTokens).toBe(12);
    client.handleMessage(run, { type: "result", subtype: "success", duration_ms: 18000, modelUsage: { main: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 200, cacheCreationInputTokens: 50 }, helper: { inputTokens: 10, outputTokens: 5 } } });
    expect(emit.mock.lastCall?.[0].turnInfo).toMatchObject({ elapsedMs: 18000, usage: { inputTokens: 360, outputTokens: 25, totalTokens: 385 } });
  });

  it("replaces Pi streaming usage snapshots and sums distinct provider messages", () => {
    const emit = vi.fn(); const client = new PiRuntimeClient(() => ({ command: "pi", argsPrefix: [], env: {} }), emit) as any;
    const run = { runId: "run", sessionFile: "file", messageSequence: 0, messageKey: "run:0", textItems: new Map(), thinkingItems: new Map(), usageByMessage: new Map() };
    for (const timestamp of [1000, 2000]) {
      client.handleEvent(run, { type: "message_start", message: { role: "assistant" } });
      client.handleEvent(run, { type: "message_update", usage: { input: 100, output: 10, totalTokens: 110 }, assistantMessageEvent: {} });
      client.handleEvent(run, { type: "message_update", usage: { input: 100, output: 20, totalTokens: 120 }, assistantMessageEvent: {} });
      client.handleEvent(run, { type: "message_end", message: { role: "assistant", timestamp, model: "model", provider: "provider", usage: { input: 100, output: 20, totalTokens: 120 } } });
    }
    expect(emit.mock.lastCall?.[0].turnInfo).toMatchObject({ model: "provider/model", nativeMessageIds: ["pi:2000"], usage: { totalTokens: 240 } });
  });
});
