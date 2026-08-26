import { app } from "electron";
import { spawn } from "node:child_process";
import type { RunProcess } from "./ipc-types";
import type { RuntimeManager } from "./runtime-manager";
import type { ReasoningEffort } from "./settings-store";

type CodexModel = { id: string; model: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; defaultReasoningEffort: ReasoningEffort; supportedReasoningEfforts: Array<{ reasoningEffort: ReasoningEffort; description: string }> };
type CodexAccount = { type: string; email?: string | null; planType?: string };

export class CodexCatalogClient {
  constructor(private readonly runtimeManager: RuntimeManager, private readonly executable: () => string, private readonly runProcess: RunProcess) {}
  async models(): Promise<{ models: CodexModel[] }> { const result = await this.request<{ data?: CodexModel[] }>("model/list", { includeHidden: false, limit: 100 }); return { models: (result.data ?? []).filter((model) => !model.hidden) }; }
  async account(): Promise<{ connected: boolean; account: CodexAccount | null; message: string }> { try { const result = await this.request<{ account?: CodexAccount | null }>("account/read", { refreshToken: false }); const account = result.account ?? null; return { connected: Boolean(account), account, message: account?.email || account?.type || "" }; } catch (error) { const status = await this.runProcess(this.executable(), ["login", "status"], { timeoutMs: 20_000 }); return { connected: status.code === 0, account: null, message: (status.stdout || status.stderr || String(error)).trim() }; } }
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.runtimeManager.ensure("codex");
    return await new Promise((resolve, reject) => {
      const child = spawn(this.executable(), ["app-server", "--stdio"], { env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let settled = false;
      const finish = (error?: Error, result?: T) => { if (settled) return; settled = true; clearTimeout(timeout); child.kill("SIGTERM"); error ? reject(error) : resolve(result as T); };
      const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
      const handle = (line: string) => { if (!line.trim().startsWith("{")) return; try { const message = JSON.parse(line) as { id?: number; error?: { message?: string }; result?: T }; if (message.id === 1) { send({ method: "initialized", params: {} }); send({ id: 2, method, params }); } if (message.id === 2) message.error ? finish(new Error(message.error.message || `Codex ${method} 请求失败`)) : finish(undefined, message.result); } catch {} };
      child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { stdout += chunk; const lines = stdout.split(/\r?\n/); stdout = lines.pop() ?? ""; for (const line of lines) handle(line); }); child.on("error", (error) => finish(error)); child.on("close", (code) => { if (!settled) finish(new Error(`Codex 服务已退出（${code ?? 1}）`)); });
      const timeout = setTimeout(() => finish(new Error(`Codex ${method} 请求超时`)), 20_000); send({ id: 1, method: "initialize", params: { clientInfo: { name: "rux", title: "Rux", version: app.getVersion() }, capabilities: {} } });
    });
  }
}
