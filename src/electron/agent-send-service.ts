import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunProcess } from "./ipc-types";
import type { ReasoningEffort, RuxSettings, SandboxMode, SettingsStore } from "./settings-store";
import type { WorkspaceStore } from "./workspace-store";

export type BufferedSendInput = { projectId?: string; prompt: string; model?: string; reasoning?: ReasoningEffort; sandboxMode?: SandboxMode; images?: string[]; webSearch?: boolean; threadId?: string };
export type CustomSendInput = { prompt: string; model?: string; reasoning?: ReasoningEffort };

export class AgentSendService {
  constructor(private readonly settingsStore: SettingsStore, private readonly workspaceStore: WorkspaceStore, private readonly runProcess: RunProcess, private readonly codexExecutable: () => string, private readonly gitExecutable: () => string, private readonly userDataRoot: string, private readonly codexEnvironment: () => Record<string, string> = () => ({})) {}

  async codex(input: BufferedSendInput): Promise<{ text: string; threadId?: string; diagnostics: string }> {
    const project = input.projectId ? await this.workspaceStore.resolve(input.projectId) : null; const cwd = project?.path ?? join(this.userDataRoot, "standalone-workspace"); await mkdir(cwd, { recursive: true }); let prompt = input.prompt.trim(); if (!prompt) throw new Error("消息不能为空");
    const settings = await this.settingsStore.load(); const model = (input.model ?? settings.model).trim(); const reasoning = input.reasoning ?? settings.reasoning; const sandbox = input.sandboxMode ?? settings.sandboxMode; const fullAccess = sandbox === "danger-full-access"; const autoApprove = sandbox === "workspace-write"; const args = input.threadId ? ["exec", "resume", "--json"] : ["exec", "--json", "-C", cwd];
    if (fullAccess) args.push("--dangerously-bypass-approvals-and-sandbox"); else if (!input.threadId && autoApprove) args.push("--approve-for-me"); else if (!input.threadId) args.push("-s", "workspace-write");
    if (!await this.isGitWorkTree(cwd)) args.push("--skip-git-repo-check"); if (input.threadId && !fullAccess) { args.push("-c", 'sandbox_mode="workspace-write"'); args.push("-c", `approval_policy=\"${autoApprove ? "never" : "on-request"}\"`); }
    if (input.webSearch) input.threadId ? args.push("-c", 'web_search="live"') : args.push("--search"); if (model && model !== "default") args.push("-m", model); args.push("-c", `model_reasoning_effort=\"${reasoning}\"`);
    const contextFiles: string[] = []; for (const image of (input.images ?? []).slice(0, 8)) { const path = resolve(image); if (!await this.exists(path)) continue; /\.(png|jpe?g|gif|webp)$/i.test(path) ? args.push("-i", path) : contextFiles.push(path); }
    if (contextFiles.length) prompt += `\n\n用户选择的上下文文件：\n${contextFiles.map((path) => `- ${path}`).join("\n")}`; if (input.threadId) args.push(input.threadId); args.push(prompt);
    const result = await this.runProcess(this.codexExecutable(), args, { cwd, timeoutMs: 10 * 60_000, env: this.codexEnvironment() }); if (result.code !== 0) throw new Error(result.stderr.trim() || "Codex 执行失败"); const parsed = this.parseOutput(result.stdout); if (!parsed.text) throw new Error("Codex 未返回可显示的消息"); return { ...parsed, diagnostics: result.stderr.trim() };
  }

  async custom(input: CustomSendInput, override?: RuxSettings): Promise<{ text: string }> {
    const settings = override ?? await this.settingsStore.load(); const apiKey = this.settingsStore.decryptApiKey(settings); if (!apiKey) throw new Error("请先保存 API key"); const model = (input.model || settings.model).trim(); if (!model || model === "default") throw new Error("请选择模型");
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: input.prompt, reasoning: { effort: input.reasoning ?? settings.reasoning }, store: false }), signal: AbortSignal.timeout(120_000) }); const body = await response.json() as { output_text?: string; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message || `服务返回 ${response.status}`); if (!body.output_text) throw new Error("服务未返回文本"); return { text: body.output_text };
  }

  private async exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
  private async isGitWorkTree(path: string): Promise<boolean> { const result = await this.runProcess(this.gitExecutable(), ["rev-parse", "--is-inside-work-tree"], { cwd: path, timeoutMs: 20_000 }); return result.code === 0 && result.stdout.trim() === "true"; }
  private parseOutput(stdout: string): { text: string; threadId?: string } { let text = ""; let threadId: string | undefined; for (const line of stdout.split(/\r?\n/)) { if (!line.trim().startsWith("{")) continue; try { const event = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } }; if (event.type === "thread.started") threadId = event.thread_id; if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) text = event.item.text; } catch {} } return { text, threadId }; }
}
