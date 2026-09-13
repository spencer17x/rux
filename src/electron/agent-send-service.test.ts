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

  it("reads standard Responses output and retains actual model and token usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ model: "gpt-6-astra", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000, input_tokens_details: { cached_tokens: 500 }, output_tokens_details: { reasoning_tokens: 40 } } }) })));
    const { instance, settings } = service();
    await expect(instance.custom({ prompt: "hello" }, settings as any)).resolves.toMatchObject({ text: "done", model: "gpt-6-astra", usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1000, cachedInputTokens: 500, reasoningOutputTokens: 40 } });
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

  it("sends previous user and assistant messages and resets plan instructions on the next call", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ output_text: "OK" }) })); vi.stubGlobal("fetch", fetchMock);
    const { instance, settings } = service();
    await instance.custom({ prompt: "先给计划", mode: "plan" }, settings as any);
    await instance.custom({ prompt: "继续", mode: "default", conversation: [{ role: "user", text: "项目叫 Rux" }, { role: "assistant", text: "已了解" }] }, settings as any);
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)), second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.instructions).toContain("计划模式"); expect(second.instructions).toContain("默认模式");
    expect(second.input.map((item: any) => item.role)).toEqual(["user", "assistant", "user"]);
    expect(second.input[0].content[0].text).toBe("项目叫 Rux"); expect(second.input[1].content).toBe("已了解"); expect(second.store).toBe(false);
  });

  it("fails visibly instead of silently omitting missing or unsupported attachments", async () => {
    const { instance, settings } = service(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(instance.custom({ prompt: "读文件", images: [join(tmpdir(), "rux-nonexistent-attachment.txt")] }, settings as any)).rejects.toThrow("无法读取附件");
    await expect(instance.custom({ prompt: "看图片", images: ["/image.png"] }, settings as any)).rejects.toThrow("未启用图片输入");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes enabled document inputs and preserves historical attachments", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rux-doc-input-")); temporary.push(directory); const path = join(directory, "brief.pdf"); writeFileSync(path, "%PDF-1.4\nfixture");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ output_text: "OK" }) })); vi.stubGlobal("fetch", fetchMock);
    const { instance, settings } = service();
    await instance.custom({ prompt: "刚才文档的标题是什么", conversation: [{ role: "user", text: "读这份文档", attachments: [path] }, { role: "assistant", text: "收到" }] }, { ...settings, customImageInput: true, customFileInput: true } as any);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input[0].content[1]).toMatchObject({ type: "input_file", filename: "brief.pdf", file_data: expect.stringContaining("data:application/pdf;base64,") });
  });
});
