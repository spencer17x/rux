import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunProcess } from "./ipc-types";
import type { ReasoningEffort, RuxSettings, SandboxMode, SettingsStore } from "./settings-store";
import type { WorkspaceStore } from "./workspace-store";
import { codexBufferedPermissionArgs } from "./agents/codex-permissions";
import { responsesUsage, type TokenUsage } from "../shared/turn-info";
import type { ConversationMessage } from "../shared/conversation";
import { responseAttachment } from "./context-attachments";

export type BufferedSendInput = { projectId?: string; prompt: string; model?: string; reasoning?: ReasoningEffort; sandboxMode?: SandboxMode; images?: string[]; webSearch?: boolean; threadId?: string };
export type CustomSendInput = { prompt: string; model?: string; reasoning?: ReasoningEffort; images?: string[]; signal?: AbortSignal; mode?: string; conversation?: ConversationMessage[] };

export class AgentSendService {
  constructor(private readonly settingsStore: SettingsStore, private readonly workspaceStore: WorkspaceStore, private readonly runProcess: RunProcess, private readonly codexExecutable: () => string, private readonly gitExecutable: () => string, private readonly userDataRoot: string, private readonly codexEnvironment: () => Record<string, string> = () => ({})) {}

  async codex(input: BufferedSendInput): Promise<{ text: string; threadId?: string; diagnostics: string }> {
    const project = input.projectId ? await this.workspaceStore.resolve(input.projectId) : null; const cwd = project?.path ?? join(this.userDataRoot, "standalone-workspace"); await mkdir(cwd, { recursive: true }); let prompt = input.prompt.trim(); if (!prompt) throw new Error("消息不能为空");
    const settings = await this.settingsStore.load(); const model = (input.model ?? settings.model).trim(); const reasoning = input.reasoning ?? settings.reasoning; const sandbox = input.sandboxMode ?? settings.sandboxMode; const args = input.threadId ? ["exec", "resume", "--json"] : ["exec", "--json", "-C", cwd];
    args.push(...codexBufferedPermissionArgs(sandbox, Boolean(input.threadId)));
    if (!await this.isGitWorkTree(cwd)) args.push("--skip-git-repo-check");
    args.push("-c", `web_search="${input.webSearch ? "live" : "disabled"}"`); if (model && model !== "default") args.push("-m", model); args.push("-c", `model_reasoning_effort=\"${reasoning}\"`);
    const contextFiles: string[] = []; for (const image of (input.images ?? []).slice(0, 8)) { const path = resolve(image); if (!await this.exists(path)) continue; /\.(png|jpe?g|gif|webp)$/i.test(path) ? args.push("-i", path) : contextFiles.push(path); }
    if (contextFiles.length) prompt += `\n\n用户选择的上下文文件：\n${contextFiles.map((path) => `- ${path}`).join("\n")}`; if (input.threadId) args.push(input.threadId); args.push(prompt);
    const result = await this.runProcess(this.codexExecutable(), args, { cwd, timeoutMs: 10 * 60_000, env: this.codexEnvironment() }); if (result.code !== 0) throw new Error(result.stderr.trim() || "Codex 执行失败"); const parsed = this.parseOutput(result.stdout); if (!parsed.text) throw new Error("Codex 未返回可显示的消息"); return { ...parsed, diagnostics: result.stderr.trim() };
  }

  async custom(input: CustomSendInput, override?: RuxSettings): Promise<{ text: string; model?: string; usage?: TokenUsage }> {
    const settings = override ?? await this.settingsStore.load(); const apiKey = this.settingsStore.decryptApiKey(settings); if (!apiKey) throw new Error("请先保存 API key"); const model = (input.model || settings.model).trim(); if (!model || model === "default") throw new Error("请选择模型");
    if (input.mode && !["default", "plan"].includes(input.mode)) throw new Error("自定义 API 仅支持默认或计划模式");
    const requestInput: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, string>> }> = [];
    let contextBytes = 0;
    for (const message of [...(input.conversation || []), { role: "user" as const, text: input.prompt, attachments: input.images }]) {
      if (message.role === "assistant") { requestInput.push({ role: "assistant", content: message.text }); contextBytes += Buffer.byteLength(message.text); continue; }
      const content: Array<Record<string, string>> = [{ type: "input_text", text: message.text }];
      for (const path of message.attachments || []) content.push(await responseAttachment(path, { images: Boolean(settings.customImageInput), documents: Boolean(settings.customFileInput) }));
      contextBytes += Buffer.byteLength(JSON.stringify(content));
      if (contextBytes > 30 * 1024 * 1024) throw new Error("对话和附件超过 30 MB，请新建会话后重试");
      requestInput.push({ role: "user", content });
    }
    const instructions = input.mode === "plan" ? "当前为计划模式。分析需求并给出可执行计划；不要执行或声称已执行命令、文件修改或外部操作。需要信息时先询问。" : "当前为默认模式。根据对话提供帮助和代码；你没有本地执行工具，不要声称已运行命令、修改文件或完成外部操作。";
    const timeoutSignal = AbortSignal.timeout(120_000); const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    const effort = input.reasoning ?? settings.reasoning;
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: requestInput, instructions, reasoning: { effort: effort === "off" ? "none" : effort }, store: false }), signal });
    const body = await response.json() as { model?: string; usage?: unknown; output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `服务返回 ${response.status}`);
    const text = body.output_text || (body.output || []).filter((item) => item.type === "message").flatMap((item) => (item.content || []).filter((part) => part.type === "output_text").map((part) => part.text || "")).join("\n");
    if (!text) throw new Error("服务未返回文本");
    const usage = responsesUsage(body.usage);
    return { text, ...(body.model ? { model: body.model } : {}), ...(usage ? { usage } : {}) };
  }

  private async exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
  private async isGitWorkTree(path: string): Promise<boolean> { const result = await this.runProcess(this.gitExecutable(), ["rev-parse", "--is-inside-work-tree"], { cwd: path, timeoutMs: 20_000 }); return result.code === 0 && result.stdout.trim() === "true"; }
  private parseOutput(stdout: string): { text: string; threadId?: string } { let text = ""; let threadId: string | undefined; for (const line of stdout.split(/\r?\n/)) { if (!line.trim().startsWith("{")) continue; try { const event = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } }; if (event.type === "thread.started") threadId = event.thread_id; if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) text = event.item.text; } catch {} } return { text, threadId }; }
}
