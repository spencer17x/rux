import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSendService } from "./agent-send-service";

afterEach(() => vi.unstubAllGlobals());

function service(runProcess: any = vi.fn()) {
  const settings = { provider: "codex", serviceName: "Codex", baseUrl: "https://example.test/v1", encryptedApiKey: "secret", hasApiKey: true, model: "model", reasoning: "medium", sandboxMode: "workspace-write", uiFontSize: 14, allowConversationOverride: true };
  return { instance: new AgentSendService({ load: async () => settings, decryptApiKey: () => "api-key" } as any, { resolve: async () => ({ id: "project", name: "Project", path: process.cwd(), threads: [] }) } as any, runProcess, () => "codex", () => "git", process.cwd()), settings };
}

describe("AgentSendService", () => {
  it("parses buffered Codex JSON output and preserves the thread id", async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => args[0] === "rev-parse" ? { stdout: "true\n", stderr: "", code: 0 } : { stdout: '{"type":"thread.started","thread_id":"thread-1"}\n{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n', stderr: "diagnostic", code: 0 });
    const result = await service(runner).instance.codex({ projectId: "project", prompt: "Reply", model: "model" });
    expect(result).toEqual({ text: "hello", threadId: "thread-1", diagnostics: "diagnostic" });
    expect(runner.mock.calls.some((call) => call[1].includes("--approve-for-me"))).toBe(true);
  });

  it("calls an OpenAI-compatible Responses endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ output_text: "custom" }) })); vi.stubGlobal("fetch", fetchMock);
    const { instance, settings } = service();
    await expect(instance.custom({ prompt: "hello", model: "model" }, settings as any)).resolves.toEqual({ text: "custom" });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/responses", expect.objectContaining({ method: "POST" }));
  });
});
