import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSendService } from "./agent-send-service";

const temporary: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function service(runProcess: any = vi.fn(), sandboxMode = "workspace-write") {
  const settings = { provider: "codex", serviceName: "Codex", baseUrl: "https://example.test/v1", encryptedApiKey: "secret", hasApiKey: true, model: "model", reasoning: "medium", sandboxMode, uiFontSize: 14, allowConversationOverride: true };
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
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ output_text: "custom" }) })); vi.stubGlobal("fetch", fetchMock);
    const { instance, settings } = service();
    await expect(instance.custom({ prompt: "hello", model: "model" }, settings as any)).resolves.toEqual({ text: "custom" });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/responses", expect.objectContaining({ method: "POST" }));
  });

  it("includes explicitly selected text files in custom-provider context", async () => {
    const root = mkdtempSync(join(tmpdir(), "rux-custom-context-")); temporary.push(root); const file = join(root, "context.txt"); writeFileSync(file, "selected context");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ output_text: "custom" }) })); vi.stubGlobal("fetch", fetchMock);
    const { instance, settings } = service(); await instance.custom({ prompt: "hello", model: "model", images: [file] }, settings as any);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(JSON.stringify(body.input)).toContain("selected context");
  });

  it("does not widen read-only side conversations to workspace write", async () => {
    const runner = vi.fn(async (_command: string, args: string[]) => args[0] === "rev-parse" ? { stdout: "true\n", stderr: "", code: 0 } : { stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"safe"}}\n', stderr: "", code: 0 });
    await service(runner, "read-only").instance.codex({ projectId: "project", prompt: "Inspect" });
    const args = runner.mock.calls.find((call) => call[1][0] === "exec")?.[1] as string[];
    expect(args).toContain("read-only");
    expect(args).not.toContain("workspace-write");
  });
});
