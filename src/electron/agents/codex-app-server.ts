import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { codexApprovalPolicy, codexSandboxPolicy, type CodexSandboxMode } from "./codex-permissions";

export type CodexStreamInput = {
  runId: string;
  threadId?: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  mode?: "default" | "plan";
  sandboxMode: CodexSandboxMode;
  images?: string[];
  webSearch?: boolean;
};

export type CodexStreamEvent = {
  runId: string;
  type: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  item?: Record<string, unknown>;
  delta?: string;
  status?: string;
  error?: string;
  approval?: Record<string, unknown>;
};

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message?: string };
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ActiveRun = {
  runId: string;
  threadId: string;
  turnId?: string;
};

type PendingApproval = {
  rpcId: number | string;
  method: string;
  runId: string;
};

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private initialized: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly requests = new Map<number | string, PendingRequest>();
  private readonly runsByThread = new Map<string, ActiveRun>();
  private readonly runsByTurn = new Map<string, ActiveRun>();
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(
    private readonly executable: () => string,
    private readonly emit: (event: CodexStreamEvent) => void,
    private readonly environment: () => Record<string, string> = () => ({}),
  ) {}

  async readThread(threadId: string): Promise<Record<string, any> | null> {
    if (!threadId) return null;
    await this.ensureStarted();
    try {
      const result = await this.request("thread/read", { threadId, includeTurns: true });
      return result?.thread || null;
    } catch {
      // A newly isolated CODEX_HOME starts without Codex's metadata database.
      // Listing once scans rollout JSONL files and repairs the local index.
      await this.request("thread/list", { limit: 100, sourceKinds: ["appServer", "exec", "cli", "vscode"] });
      const result = await this.request("thread/read", { threadId, includeTurns: true });
      return result?.thread || null;
    }
  }

  async startTurn(input: CodexStreamInput): Promise<{ threadId: string; turnId: string }> {
    await this.ensureStarted();
    const threadParams = this.threadParams(input);
    const threadResponse = input.threadId
      ? await this.request("thread/resume", { threadId: input.threadId, ...threadParams })
      : await this.request("thread/start", threadParams);
    const threadId = String(threadResponse?.thread?.id || input.threadId || "");
    if (!threadId) throw new Error("Codex 未返回 thread id");

    const run: ActiveRun = { runId: input.runId, threadId };
    this.runsByThread.set(threadId, run);
    this.emit({ runId: input.runId, type: "thread-started", threadId });

    const userInput: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt, text_elements: [] },
    ];
    for (const path of input.images ?? []) {
      if (/\.(png|jpe?g|gif|webp)$/i.test(path)) userInput.push({ type: "localImage", path });
      else userInput[0].text = `${String(userInput[0].text)}\n\n用户选择的上下文文件：${path}`;
    }

    if (input.mode === "plan" && !input.model) throw new Error("计划模式需要先选择一个明确的 Codex 模型");
    const turnResponse = await this.request("turn/start", {
      threadId,
      input: userInput,
      cwd: input.cwd,
      model: input.model || null,
      effort: input.reasoning || null,
      approvalPolicy: codexApprovalPolicy(input.sandboxMode),
      sandboxPolicy: codexSandboxPolicy(input),
      collaborationMode: input.mode === "plan" ? {
        mode: "plan",
        settings: {
          model: input.model,
          reasoning_effort: input.reasoning || null,
          developer_instructions: null,
        },
      } : null,
    });
    const turnId = String(turnResponse?.turn?.id || "");
    if (!turnId) throw new Error("Codex 未返回 turn id");
    run.turnId = turnId;
    this.runsByTurn.set(turnId, run);
    return { threadId, turnId };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.ensureStarted();
    await this.request("turn/interrupt", { threadId, turnId });
  }

  respondToApproval(approvalId: string, decision: "accept" | "acceptForSession" | "decline"): void {
    const approval = this.approvals.get(approvalId);
    if (!approval || !this.process) throw new Error("审批请求已失效");
    this.approvals.delete(approvalId);
    this.write({ id: approval.rpcId, result: { decision } });
  }

  stop(): void {
    const process = this.process;
    this.process = null;
    this.initialized = null;
    process?.kill("SIGTERM");
    for (const request of this.requests.values()) { clearTimeout(request.timeout); request.reject(new Error("Codex App Server 已停止")); }
    this.requests.clear();
    this.runsByThread.clear();
    this.runsByTurn.clear();
    this.approvals.clear();
  }

  private threadParams(input: CodexStreamInput): Record<string, unknown> {
    return {
      cwd: input.cwd,
      model: input.model || null,
      approvalPolicy: codexApprovalPolicy(input.sandboxMode),
      sandbox: input.sandboxMode,
      serviceName: "rux",
      config: input.webSearch ? { web_search: "live" } : null,
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = this.initialize();
    try {
      await this.initialized;
    } catch (error) {
      this.initialized = null;
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    const child = spawn(this.executable(), ["app-server", "--stdio"], {
      env: { ...process.env, ...this.environment(), NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (/panic|fatal/i.test(chunk)) this.emit({ runId: "system", type: "error", error: chunk.trim() });
    });
    child.on("error", (error) => this.handleExit(error));
    child.on("close", (code) => this.handleExit(new Error(`Codex App Server 已退出（${code ?? 1}）`)));

    await this.request("initialize", {
      clientInfo: { name: "rux", title: "Rux", version: app.getVersion() },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: "initialized", params: {} });
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`Codex ${method} 请求超时`));
      }, 120_000);
      this.requests.set(id, { resolve, reject, timeout });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.requests.delete(id);
        reject(error as Error);
      }
    });
  }

  private write(message: unknown): void {
    if (!this.process || this.process.stdin.destroyed) throw new Error("Codex App Server 未运行");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim().startsWith("{")) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.requests.get(message.id);
      if (!pending) return;
      this.requests.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message || "Codex 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (message.method) this.handleNotification(message.method, message.params ?? {});
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    const params = message.params ?? {};
    const run = this.findRun(params);
    if (!run || message.id === undefined || !message.method) {
      if (message.id !== undefined) this.write({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
      return;
    }
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      const approvalId = String(params.approvalId || `${run.runId}:${message.id}`);
      this.approvals.set(approvalId, { rpcId: message.id, method: message.method, runId: run.runId });
      this.emit({
        runId: run.runId,
        type: "approval-request",
        threadId: run.threadId,
        turnId: run.turnId,
        itemId: String(params.itemId || approvalId),
        approval: { id: approvalId, method: message.method, ...params },
      });
      return;
    }
    this.write({ id: message.id, error: { code: -32601, message: `Rux 暂不支持 ${message.method}` } });
  }

  private handleNotification(method: string, params: Record<string, any>): void {
    const run = this.findRun(params);
    if (!run) return;
    const base = { runId: run.runId, threadId: run.threadId, turnId: String(params.turnId || run.turnId || "") || undefined };
    if (method === "turn/started") {
      const turnId = String(params.turn?.id || params.turnId || "");
      if (turnId) {
        run.turnId = turnId;
        this.runsByTurn.set(turnId, run);
      }
      this.emit({ ...base, type: "turn-started", turnId });
      return;
    }
    if (method === "item/started") {
      this.emit({ ...base, type: "item-started", itemId: String(params.item?.id || ""), item: params.item });
      return;
    }
    if (method === "item/completed") {
      this.emit({ ...base, type: "item-completed", itemId: String(params.item?.id || ""), item: params.item });
      return;
    }
    const deltaTypes: Record<string, string> = {
      "item/agentMessage/delta": "text-delta",
      "item/plan/delta": "reasoning-delta",
      "item/reasoning/summaryTextDelta": "reasoning-delta",
      "item/reasoning/textDelta": "reasoning-delta",
      "item/commandExecution/outputDelta": "tool-output-delta",
      "item/fileChange/outputDelta": "tool-output-delta",
    };
    if (deltaTypes[method]) {
      this.emit({ ...base, type: deltaTypes[method], itemId: String(params.itemId || ""), delta: String(params.delta || "") });
      return;
    }
    if (method === "turn/completed") {
      const status = String(params.turn?.status || "completed");
      this.emit({ ...base, type: "turn-completed", status, error: params.turn?.error?.message });
      this.runsByThread.delete(run.threadId);
      if (run.turnId) this.runsByTurn.delete(run.turnId);
      return;
    }
    if (method === "error") {
      this.emit({ ...base, type: "error", error: String(params.error?.message || params.message || "Codex 执行失败") });
    }
  }

  private findRun(params: Record<string, any>): ActiveRun | undefined {
    const turnId = String(params.turnId || params.turn?.id || "");
    const threadId = String(params.threadId || params.thread?.id || "");
    return (turnId ? this.runsByTurn.get(turnId) : undefined)
      ?? (threadId ? this.runsByThread.get(threadId) : undefined);
  }

  private handleExit(error: Error): void {
    if (!this.process) return;
    this.process = null;
    this.initialized = null;
    for (const request of this.requests.values()) { clearTimeout(request.timeout); request.reject(error); }
    this.requests.clear();
    for (const run of this.runsByThread.values()) this.emit({ runId: run.runId, type: "error", threadId: run.threadId, turnId: run.turnId, error: error.message });
    this.runsByThread.clear();
    this.runsByTurn.clear();
  }
}
