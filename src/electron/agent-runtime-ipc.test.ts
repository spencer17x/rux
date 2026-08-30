import { describe, expect, it, vi } from "vitest";
import { registerAgentRuntimeIpc } from "./agent-runtime-ipc";
import type { IpcHandler, IpcRegistrar } from "./ipc-types";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/rux-test" } }));

function harness(provider: "codex" | "custom" = "codex", customSend: (input: any) => Promise<any> = async () => ({ text: "custom" })) {
  const handlers = new Map<string, IpcHandler>(); const ipc: IpcRegistrar = { handle: (channel, handler) => { handlers.set(channel, handler); } }; const emitted: any[] = [];
  const runtimeManager = { ensure: vi.fn(async () => ({ command: "agent" })) }; const codexClient = { startTurn: vi.fn(async () => ({ threadId: "codex-thread", turnId: "turn" })), interrupt: vi.fn(), respondToApproval: vi.fn() }; const claudeClient = { startTurn: vi.fn(() => ({ sessionId: "claude-session", turnId: "turn" })), interrupt: vi.fn(), respondToApproval: vi.fn() }; const piClient = { startTurn: vi.fn(async () => ({ sessionId: "pi-session" })), interrupt: vi.fn() };
  registerAgentRuntimeIpc(ipc, { getWindow: () => ({ webContents: { send: (_channel: string, event: any) => emitted.push(event) } }) as any, settingsStore: { load: async () => ({ provider, model: "model", reasoning: "medium", sandboxMode: "workspace-write" }) } as any, runtimeManager: runtimeManager as any, providerStore: { materializePiRuntime: async () => ({ agentDir: "/tmp", env: {}, providerId: "provider" }) } as any, codexClient: codexClient as any, claudeClient: claudeClient as any, piClient: piClient as any, resolveProject: async () => ({ id: "project", name: "project", path: process.cwd(), threads: [] }), sendWithCodex: vi.fn(async () => ({ text: "codex" })), sendWithCustomProvider: vi.fn(customSend) });
  return { invoke: async (channel: string, value: unknown) => await handlers.get(channel)!({} as any, value), emitted, runtimeManager, codexClient, claudeClient, piClient };
}

describe("agent runtime IPC", () => {
  it("routes Claude turns and interrupts to the Claude adapter", async () => {
    const test = harness(); await test.invoke("agent:start", { runId: "run", agentId: "claude-code", projectId: "project", prompt: "hello", images: ["/tmp/context.txt"] }); await test.invoke("agent:interrupt", { agentId: "claude-code", runId: "run", threadId: "thread", turnId: "turn" });
    expect(test.claudeClient.startTurn).toHaveBeenCalledWith(expect.objectContaining({ images: ["/tmp/context.txt"] })); expect(test.claudeClient.interrupt).toHaveBeenCalledWith("run");
  });

  it("passes the requested sandbox mode to the Pi runtime", async () => {
    const test = harness();
    await test.invoke("agent:start", { runId: "run", agentId: "pi", projectId: "project", prompt: "hello", sandboxMode: "read-only", images: ["/tmp/context.png"] });
    expect(test.piClient.startTurn).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode: "read-only", images: ["/tmp/context.png"] }));
  });

  it("normalizes custom-provider responses into stream events", async () => {
    const test = harness("custom"); await test.invoke("agent:start", { runId: "run", agentId: "codex", prompt: "hello" }); await Promise.resolve();
    expect(test.emitted.map((event) => event.type)).toEqual(["text-delta", "turn-completed"]);
  });

  it("can interrupt an in-flight custom-provider request", async () => {
    const test = harness("custom", async (input) => await new Promise((_resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
    const starting = test.invoke("agent:start", { runId: "custom-run", agentId: "codex", prompt: "hello" }); await Promise.resolve();
    await test.invoke("agent:interrupt", { agentId: "codex", runId: "custom-run", threadId: "custom-run", turnId: "custom-run" }); await starting; await Promise.resolve();
    expect(test.emitted).toContainEqual(expect.objectContaining({ runId: "custom-run", type: "turn-completed", status: "interrupted" }));
  });
});
