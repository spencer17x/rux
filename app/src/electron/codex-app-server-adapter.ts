import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, resolve } from "node:path";
import type {
  AgentModelListParams,
  AgentModelListResult,
  AgentAdapterInfo,
  PermissionMode,
  ReasoningEffort,
  RunActivity,
  RuntimeEvent,
} from "../shared/protocol.ts";
import { agentModelListResultSchema } from "../shared/protocol.ts";
import { createVerificationEvidence, redactSensitiveText } from "./verification-evidence.ts";
import {
  forceKillChildProcessGroup,
  ensureChildProcessGroupTerminated,
} from "./child-process-lifecycle.ts";

type JsonRecord = Record<string, unknown>;
type RequestId = string | number;
const MAX_PROVIDER_JSONL_LINE_BYTES = 4 * 1024 * 1024;

type RpcPending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type CodexAppServerRequestedPermissions = {
  network: Record<string, unknown> | null;
  fileSystem: Record<string, unknown> | null;
};

export type CodexAppServerApprovalKind = "command" | "file-change" | "permissions";
export type CodexAppServerApprovalDecision =
  | "approved"
  | "approved-for-session"
  | "denied"
  | "cancelled";

export interface CodexAppServerApprovalRequest {
  /** The exact JSON-RPC id supplied by app-server. Preserve its string/number type. */
  id: RequestId;
  runId: string;
  kind: CodexAppServerApprovalKind;
  threadId: string;
  turnId: string;
  itemId: string;
  requestedAt: string;
  action: "command.execute" | "network.access" | "file.change" | "permissions.grant";
  scope: string;
  impact: string;
  reason?: string;
  command?: string;
  cwd?: string;
  networkHost?: string;
  networkProtocol?: string;
  changedPaths?: string[];
  requestedPermissions?: CodexAppServerRequestedPermissions;
  availableDecisions?: Array<"approved" | "approved-for-session" | "denied" | "cancelled">;
}

export interface CodexAppServerDecisionParams {
  runId: string;
  requestId: RequestId;
  decision: CodexAppServerApprovalDecision;
}

export interface CodexAppServerStartParams {
  runId: string;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: PermissionMode;
  sessionId?: string;
  profileId?: string;
  agentRevisionId?: string;
}

export type CodexAppServerAdapterEvent = RuntimeEvent
  | {
      type: "codex.approval.requested";
      runId: string;
      request: CodexAppServerApprovalRequest;
    }
  | {
      type: "codex.approval.decided";
      runId: string;
      requestId: RequestId;
      decision: CodexAppServerApprovalDecision;
    }
  | {
      type: "assistant.reasoning-summary.delta";
      runId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "activity.output.delta";
      runId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "file.patch.updated";
      runId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      changes: Array<{ path: string; kind: string; diff: string }>;
    }
  | {
      type: "turn.diff.updated";
      runId: string;
      threadId: string;
      turnId: string;
      diff: string;
    }
  | {
      type: "codex.connection.warning";
      message: string;
    };

export type CodexAppServerAdapterOptions = {
  executable?: string;
  requestTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    title: string;
    version: string;
  };
};

type RunRecord = {
  params: CodexAppServerStartParams;
  threadId?: string;
  turnId?: string;
  cancelled: boolean;
  terminal: boolean;
  startedAt: number;
  activityStartedAt: Map<string, string>;
  filePaths: Map<string, string[]>;
  lastError?: string;
};

type PendingApproval = {
  request: CodexAppServerApprovalRequest;
  method: string;
  requestedPermissions?: CodexAppServerRequestedPermissions;
  availableWireDecisions?: unknown[];
};

const defaultRequestTimeoutMs = 30_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function streamTextValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requestIdValue(value: unknown): RequestId | undefined {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value))
    ? value
    : undefined;
}

function requestKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

function redactedText(value: unknown, maximumLength = 20_000): string | undefined {
  const text = stringValue(value);
  return text ? redactSensitiveText(text, maximumLength).text : undefined;
}

function executableCandidates(): string[] {
  const fromPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => resolve(directory, process.platform === "win32" ? "codex.exe" : "codex"));
  return [
    process.env.CODEX_CLI_PATH,
    ...fromPath,
    resolve(homedir(), ".local/bin/codex"),
    resolve(homedir(), ".cargo/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function inspectCodex(override?: string): AgentAdapterInfo {
  const seen = new Set<string>();
  for (const candidate of override ? [override] : executableCandidates()) {
    if (seen.has(candidate) || !existsSync(candidate)) continue;
    seen.add(candidate);
    try {
      accessSync(candidate, constants.X_OK);
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
      });
      if (result.status === 0) {
        return {
          id: "codex",
          name: "Rux",
          available: true,
          version: result.stdout.trim().replace(/^codex-cli\s+/i, ""),
          executable: candidate,
          detail: "Rux 本机 Agent 服务",
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return {
    id: "codex",
    name: "Rux",
    available: false,
    detail: "未找到可用的 Rux 本机 Agent 组件。",
  };
}

function appServerPolicy(permissionMode: PermissionMode): {
  approvalPolicy: "on-request" | "never";
  sandbox: "read-only" | "workspace-write";
} {
  if (permissionMode === "plan") return { approvalPolicy: "never", sandbox: "read-only" };
  if (permissionMode === "dontAsk") return { approvalPolicy: "never", sandbox: "workspace-write" };
  return { approvalPolicy: "on-request", sandbox: "workspace-write" };
}

function itemActivity(item: JsonRecord, lifecycle: "started" | "completed"): RunActivity | undefined {
  const id = stringValue(item.id);
  const type = stringValue(item.type);
  if (!id || !type) return undefined;
  const state = lifecycle === "started"
    ? "active"
    : ["failed", "declined"].includes(stringValue(item.status) ?? "") ? "error" : "done";

  if (type === "commandExecution") {
    return {
      id,
      kind: "command",
      title: "运行命令",
      detail: redactedText(item.command, 20_000) ?? "Rux command",
      state,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.flatMap((change) => {
      if (!isRecord(change)) return [];
      const path = stringValue(change.path);
      return path ? [path] : [];
    }) : [];
    return {
      id,
      kind: "edit",
      title: changes.length === 1 ? `修改 ${basename(changes[0])}` : `修改 ${changes.length} 个文件`,
      detail: changes.join(", ") || "Rux file change",
      state,
    };
  }
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    const server = stringValue(item.server) ?? stringValue(item.namespace) ?? "Rux";
    const tool = stringValue(item.tool) ?? "tool";
    return { id, kind: "tool", title: `调用 ${server}`, detail: tool, state };
  }
  if (type === "webSearch") {
    return { id, kind: "read", title: "搜索网络", detail: "Rux web search", state };
  }
  return undefined;
}

function fileChangeKind(value: unknown): string {
  if (!isRecord(value)) return "update";
  return stringValue(value.type) ?? "update";
}

function permissionsSummary(permissions: CodexAppServerRequestedPermissions): string {
  const parts: string[] = [];
  if (permissions.network && permissions.network.enabled === true) parts.push("network access");
  if (permissions.fileSystem) {
    const read = Array.isArray(permissions.fileSystem.read)
      ? permissions.fileSystem.read.filter((value): value is string => typeof value === "string")
      : [];
    const write = Array.isArray(permissions.fileSystem.write)
      ? permissions.fileSystem.write.filter((value): value is string => typeof value === "string")
      : [];
    if (read.length) parts.push(`read: ${read.join(", ")}`);
    if (write.length) parts.push(`write: ${write.join(", ")}`);
    if (Array.isArray(permissions.fileSystem.entries) && permissions.fileSystem.entries.length) {
      parts.push(`${permissions.fileSystem.entries.length} filesystem rule(s)`);
    }
  }
  return parts.join("; ") || "additional network or filesystem access";
}

function normalizedAvailableDecisions(values: unknown): CodexAppServerApprovalRequest["availableDecisions"] {
  if (!Array.isArray(values)) return undefined;
  const result = values.flatMap((value) => {
    if (value === "accept") return ["approved" as const];
    if (value === "acceptForSession") return ["approved-for-session" as const];
    if (value === "decline") return ["denied" as const];
    if (value === "cancel") return ["cancelled" as const];
    return [];
  });
  return result.length ? result : undefined;
}

export class CodexAppServerRpcError extends Error {
  public readonly method: string;
  public readonly code: number;
  public readonly data?: unknown;

  constructor(
    method: string,
    code: number,
    message: string,
    data?: unknown,
  ) {
    super(`${method}: ${message}`);
    this.name = "CodexAppServerRpcError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

/**
 * Bidirectional Codex rich-client adapter.
 *
 * The wire contract intentionally follows the schema generated by local
 * `codex-cli 0.144.6 app-server generate-ts --experimental`: JSON-RPC messages
 * omit the `jsonrpc` member, and stdio carries one JSON object per line. Unknown
 * notifications are ignored; unsupported server requests receive -32601 rather
 * than being left pending invisibly.
 */
export class CodexAppServerAdapter {
  private readonly runs = new Map<string, RunRecord>();
  private readonly threadToRun = new Map<string, string>();
  private readonly pendingRpc = new Map<string, RpcPending>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly workspaceRoot: string;
  private readonly emit: (event: CodexAppServerAdapterEvent) => void;
  private readonly options: CodexAppServerAdapterOptions;
  private child: ChildProcess | undefined;
  private initialization: Promise<void> | undefined;
  private adapterInfo: AgentAdapterInfo | undefined;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private nextRequestId = 1;
  private disposed = false;
  private expectedShutdown = false;

  constructor(
    workspaceRoot: string,
    emit: (event: CodexAppServerAdapterEvent) => void,
    options: CodexAppServerAdapterOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
    this.emit = emit;
    this.options = options;
  }

  info(): AgentAdapterInfo {
    this.adapterInfo ??= inspectCodex(this.options.executable);
    return this.adapterInfo;
  }

  async listModels(params: AgentModelListParams): Promise<AgentModelListResult> {
    if (this.disposed) throw new Error("Rux Agent service is disposed");
    await this.ensureInitialized();
    const rawResult = await this.request("model/list", {
      ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.includeHidden !== undefined ? { includeHidden: params.includeHidden } : {}),
    });
    if (!isRecord(rawResult) || !Array.isArray(rawResult.data)) {
      throw new Error("Rux Agent service model/list returned an invalid response");
    }
    const models = rawResult.data.map((value, index) => {
      if (!isRecord(value)) {
        throw new Error(`Rux Agent service model/list returned an invalid model at index ${index}`);
      }
      const supportedReasoningEfforts = Array.isArray(value.supportedReasoningEfforts)
        ? value.supportedReasoningEfforts.map((option, optionIndex) => {
            if (!isRecord(option)) {
              throw new Error(
                `Rux Agent service model/list returned an invalid reasoning option at ${index}:${optionIndex}`,
              );
            }
            return {
              reasoningEffort: option.reasoningEffort,
              description: option.description,
            };
          })
        : value.supportedReasoningEfforts;
      return {
        id: value.id,
        model: value.model,
        displayName: value.displayName,
        description: value.description,
        isDefault: value.isDefault,
        defaultReasoningEffort: value.defaultReasoningEffort,
        supportedReasoningEfforts,
      };
    });
    return agentModelListResultSchema.parse({
      adapter: "codex",
      models,
      ...(Object.hasOwn(rawResult, "nextCursor") ? { nextCursor: rawResult.nextCursor } : {}),
    });
  }

  async start(params: CodexAppServerStartParams): Promise<{
    runId: string;
    adapter: "codex";
    threadId: string;
    turnId: string;
  }> {
    if (this.disposed) throw new Error("Rux Agent service is disposed");
    if (this.runs.has(params.runId)) throw new Error("Run ID is already active");
    const run: RunRecord = {
      params,
      cancelled: false,
      terminal: false,
      startedAt: Date.now(),
      activityStartedAt: new Map(),
      filePaths: new Map(),
    };
    this.runs.set(params.runId, run);

    try {
      await this.ensureInitialized();
      if (run.cancelled) throw new Error("Run was cancelled before thread start");
      const policy = appServerPolicy(params.permissionMode);
      const rawThreadResult = await this.request(
        params.sessionId ? "thread/resume" : "thread/start",
        params.sessionId
          ? {
              threadId: params.sessionId,
              cwd: this.workspaceRoot,
              model: params.model ?? null,
              approvalPolicy: policy.approvalPolicy,
              approvalsReviewer: "user",
              sandbox: policy.sandbox,
            }
          : {
              cwd: this.workspaceRoot,
              model: params.model ?? null,
              approvalPolicy: policy.approvalPolicy,
              approvalsReviewer: "user",
              sandbox: policy.sandbox,
              serviceName: "rux",
            },
      );
      const threadResult = isRecord(rawThreadResult) ? rawThreadResult : {};
      const thread = isRecord(threadResult.thread) ? threadResult.thread : {};
      const threadId = stringValue(thread.id);
      if (!threadId) throw new Error("Rux Agent service thread response omitted thread.id");
      run.threadId = threadId;
      this.threadToRun.set(threadId, params.runId);
      this.emit({
        type: "run.started",
        runId: params.runId,
        adapter: "codex",
        prompt: params.prompt,
        permissionMode: params.permissionMode,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        profileId: params.profileId,
        agentRevisionId: params.agentRevisionId,
      });
      this.emit({
        type: "run.metadata",
        runId: params.runId,
        sessionId: threadId,
        model: stringValue(threadResult.model) ?? params.model,
        reasoningEffort: params.reasoningEffort,
        permissionMode: params.permissionMode,
        cwd: stringValue(threadResult.cwd) ?? this.workspaceRoot,
        version: this.info().version,
      });
      if (run.cancelled) throw new Error("Run was cancelled before turn start");

      const rawTurnResult = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: params.prompt, text_elements: [] }],
        ...(params.model ? { model: params.model } : {}),
        ...(params.reasoningEffort ? { effort: params.reasoningEffort } : {}),
      });
      const turnResult = isRecord(rawTurnResult) ? rawTurnResult : {};
      const turn = isRecord(turnResult.turn) ? turnResult.turn : {};
      const turnId = stringValue(turn.id);
      if (!turnId) throw new Error("Rux Agent service turn response omitted turn.id");
      run.turnId = turnId;
      if (run.cancelled) void this.cancel(params.runId);
      return { runId: params.runId, adapter: "codex", threadId, turnId };
    } catch (error) {
      if (!run.terminal) {
        if (run.cancelled) this.finishRun(run, "cancelled");
        else this.finishRun(run, "failed", error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  /** Respond to a provider-native approval with the exact server request id. */
  decide(params: CodexAppServerDecisionParams): void {
    const key = requestKey(params.requestId);
    const approval = this.approvals.get(key);
    if (!approval || approval.request.runId !== params.runId) {
      throw new Error("Rux approval request is not pending for this Run");
    }
    this.respondToApproval(approval, params.decision);
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.terminal) return;
    run.cancelled = true;
    this.cancelPendingApprovals(runId);
    if (!run.threadId || !run.turnId) return;
    try {
      await this.request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId });
    } catch (error) {
      if (!run.terminal) this.finishRun(run, "cancelled");
      if (!this.expectedShutdown) {
        this.emit({
          type: "codex.connection.warning",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed && !this.child) return;
    this.disposed = true;
    this.expectedShutdown = true;
    for (const run of [...this.runs.values()]) {
      run.cancelled = true;
      this.cancelPendingApprovals(run.params.runId);
      this.finishRun(run, "cancelled");
    }
    const child = this.child;
    if (!child) return;
    await ensureChildProcessGroupTerminated(child);
  }

  forceDispose(): void {
    this.disposed = true;
    this.expectedShutdown = true;
    const child = this.child;
    if (child) forceKillChildProcessGroup(child);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialization) return this.initialization;
    const adapter = this.info();
    if (!adapter.available || !adapter.executable) throw new Error(adapter.detail);
    this.initialization = (async () => {
      this.spawnServer(adapter.executable!);
      await this.request("initialize", {
        clientInfo: this.options.clientInfo ?? {
          name: "rux",
          title: "Rux Desktop Workbench",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      });
      this.write({ method: "initialized" });
    })();
    try {
      await this.initialization;
    } catch (error) {
      this.initialization = undefined;
      throw error;
    }
  }

  private spawnServer(executable: string): void {
    if (this.child) return;
    this.expectedShutdown = false;
    const child = spawn(executable, ["app-server", "--stdio"], {
      cwd: this.workspaceRoot,
      env: {
        ...process.env,
        ...this.options.environment,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-32_000);
    });
    child.stdin?.on("error", () => {
      // Process error/close owns failure reporting and RPC rejection.
    });
    child.on("error", (error) => this.handleProcessEnd(child, error));
    child.on("close", (code, signal) => {
      const status = code ?? signal ?? "unknown";
      const detail = redactedText(this.stderrBuffer, 16_000);
      this.handleProcessEnd(
        child,
        this.expectedShutdown
          ? undefined
          : new Error(`Rux Agent service exited with ${status}${detail ? `: ${detail}` : ""}`),
      );
    });
  }

  private request(method: string, params: JsonRecord): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeoutMs = this.options.requestTimeoutMs ?? defaultRequestTimeoutMs;
      const timer = setTimeout(() => {
        this.pendingRpc.delete(requestKey(id));
        rejectPromise(new Error(`Rux Agent service ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
      this.pendingRpc.set(requestKey(id), {
        method,
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRpc.delete(requestKey(id));
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: JsonRecord): void {
    if (!this.child?.stdin?.writable) throw new Error("Rux Agent service stdin is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES && !this.stdoutBuffer.includes("\n")) {
      this.failProtocol("Rux Agent service exceeded the 4 MB JSONL line limit");
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES) {
        this.failProtocol("Rux Agent service exceeded the 4 MB JSONL line limit");
        return;
      }
      if (line) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private failProtocol(message: string): void {
    const child = this.child;
    if (!child) return;
    const error = new Error(message);
    this.emit({ type: "codex.connection.warning", message });
    this.handleProcessEnd(child, error);
    forceKillChildProcessGroup(child);
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit({
        type: "codex.connection.warning",
        message: "Rux Agent service returned an invalid JSONL message",
      });
      return;
    }
    if (!isRecord(message)) return;
    const id = requestIdValue(message.id);
    const method = stringValue(message.method);

    if (method && id !== undefined) {
      this.handleServerRequest(id, method, isRecord(message.params) ? message.params : {});
      return;
    }
    if (id !== undefined && ("result" in message || "error" in message)) {
      this.handleResponse(id, message);
      return;
    }
    if (method) this.handleNotification(method, isRecord(message.params) ? message.params : {});
  }

  private handleResponse(id: RequestId, message: JsonRecord): void {
    const pending = this.pendingRpc.get(requestKey(id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRpc.delete(requestKey(id));
    if (isRecord(message.error)) {
      const code = numberValue(message.error.code) ?? -32_000;
      const rawMessage = stringValue(message.error.message) ?? "Unknown JSON-RPC error";
      pending.reject(new CodexAppServerRpcError(
        pending.method,
        code,
        redactSensitiveText(rawMessage, 16_000).text,
        message.error.data,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  private handleServerRequest(id: RequestId, method: string, params: JsonRecord): void {
    const run = this.runFor(params);
    if (!run || ![
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
    ].includes(method)) {
      this.write({
        id,
        error: {
          code: -32601,
          message: `Rux does not support server request: ${method}`,
        },
      });
      this.emit({
        type: "codex.connection.warning",
        message: `Unsupported Rux Agent service request: ${method}`,
      });
      return;
    }

    if (this.approvals.has(requestKey(id))) {
      this.write({
        id,
        error: { code: -32600, message: "Duplicate outstanding Rux approval request id" },
      });
      this.failProtocol("Rux Agent service reused an outstanding approval request id");
      return;
    }

    const request = this.normalizeApproval(id, method, params, run);
    const rawPermissions = isRecord(params.permissions) ? params.permissions : {};
    const requestedPermissions = method === "item/permissions/requestApproval"
      ? {
          network: isRecord(rawPermissions.network) ? rawPermissions.network : null,
          fileSystem: isRecord(rawPermissions.fileSystem) ? rawPermissions.fileSystem : null,
        }
      : undefined;
    this.approvals.set(requestKey(id), {
      request,
      method,
      requestedPermissions,
      availableWireDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : undefined,
    });
    this.emit({ type: "codex.approval.requested", runId: run.params.runId, request });
  }

  private normalizeApproval(
    id: RequestId,
    method: string,
    params: JsonRecord,
    run: RunRecord,
  ): CodexAppServerApprovalRequest {
    const threadId = stringValue(params.threadId) ?? run.threadId ?? "unknown-thread";
    const turnId = stringValue(params.turnId) ?? run.turnId ?? "unknown-turn";
    const itemId = stringValue(params.itemId) ?? "unknown-item";
    const reason = redactedText(params.reason, 4_000);
    const startedAtMs = numberValue(params.startedAtMs) ?? Date.now();
    const requestedAt = new Date(startedAtMs).toISOString();

    if (method === "item/commandExecution/requestApproval") {
      const network = isRecord(params.networkApprovalContext) ? params.networkApprovalContext : undefined;
      const command = redactedText(params.command, 20_000);
      const cwd = stringValue(params.cwd) ?? this.workspaceRoot;
      const host = network ? stringValue(network.host) : undefined;
      const protocol = network ? stringValue(network.protocol) : undefined;
      const networkTarget = host ? `${protocol ?? "network"}://${host}` : undefined;
      return {
        id,
        runId: run.params.runId,
        kind: "command",
        threadId,
        turnId,
        itemId,
        requestedAt,
        action: networkTarget ? "network.access" : "command.execute",
        scope: networkTarget ?? cwd,
        impact: reason ?? command ?? (networkTarget
          ? `Allow managed network access to ${networkTarget}`
          : "Run a command outside the current sandbox allowance"),
        ...(reason ? { reason } : {}),
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
        ...(host ? { networkHost: host } : {}),
        ...(protocol ? { networkProtocol: protocol } : {}),
        ...(normalizedAvailableDecisions(params.availableDecisions)
          ? { availableDecisions: normalizedAvailableDecisions(params.availableDecisions) }
          : {}),
      };
    }

    if (method === "item/fileChange/requestApproval") {
      const scope = stringValue(params.grantRoot) ?? this.workspaceRoot;
      return {
        id,
        runId: run.params.runId,
        kind: "file-change",
        threadId,
        turnId,
        itemId,
        requestedAt,
        action: "file.change",
        scope,
        impact: reason ?? `Allow Rux to apply the pending file change under ${scope}`,
        ...(reason ? { reason } : {}),
        cwd: this.workspaceRoot,
        changedPaths: this.changedPathsForItem(run, itemId),
      };
    }

    const rawPermissions = isRecord(params.permissions) ? params.permissions : {};
    const requestedPermissions: CodexAppServerRequestedPermissions = {
      network: isRecord(rawPermissions.network) ? rawPermissions.network : null,
      fileSystem: isRecord(rawPermissions.fileSystem) ? rawPermissions.fileSystem : null,
    };
    const cwd = stringValue(params.cwd) ?? this.workspaceRoot;
    return {
      id,
      runId: run.params.runId,
      kind: "permissions",
      threadId,
      turnId,
      itemId,
      requestedAt,
      action: "permissions.grant",
      scope: cwd,
      impact: reason ?? permissionsSummary(requestedPermissions),
      ...(reason ? { reason } : {}),
      cwd,
      requestedPermissions,
      availableDecisions: ["approved", "approved-for-session", "denied", "cancelled"],
    };
  }

  private respondToApproval(
    approval: PendingApproval,
    decision: CodexAppServerApprovalDecision,
  ): void {
    let result: JsonRecord;
    if (approval.method === "item/permissions/requestApproval") {
      // 0.144.6 has no separate decline variant for request_permissions. The
      // official protocol defines the response as the granted subset, so an
      // empty profile is the representable denial/cancellation.
      result = decision === "approved" || decision === "approved-for-session"
        ? {
            permissions: {
              ...(approval.requestedPermissions?.network
                ? { network: approval.requestedPermissions.network }
                : {}),
              ...(approval.requestedPermissions?.fileSystem
                ? { fileSystem: approval.requestedPermissions.fileSystem }
                : {}),
            },
            scope: decision === "approved-for-session" ? "session" : "turn",
          }
        : { permissions: {}, scope: "turn" };
    } else {
      result = {
        decision: this.wireApprovalDecision(approval, decision),
      };
    }
    this.write({ id: approval.request.id, result });
    this.approvals.delete(requestKey(approval.request.id));
    this.emit({
      type: "codex.approval.decided",
      runId: approval.request.runId,
      requestId: approval.request.id,
      decision,
    });
  }

  private cancelPendingApprovals(runId: string): void {
    for (const approval of [...this.approvals.values()]) {
      if (approval.request.runId !== runId) continue;
      try {
        this.respondToApproval(approval, "cancelled");
      } catch {
        const key = requestKey(approval.request.id);
        if (!this.approvals.has(key)) continue;
        this.approvals.delete(key);
        this.emit({
          type: "codex.approval.decided",
          runId,
          requestId: approval.request.id,
          decision: "cancelled",
        });
      }
    }
  }

  private wireApprovalDecision(
    approval: PendingApproval,
    decision: CodexAppServerApprovalDecision,
  ): "accept" | "acceptForSession" | "decline" | "cancel" {
    if (decision === "denied") return "decline";
    if (decision === "cancelled") return "cancel";
    const available = approval.availableWireDecisions?.filter((value): value is string => typeof value === "string");
    if (decision === "approved-for-session") {
      if (available && !available.includes("acceptForSession")) {
        throw new Error("Rux did not offer a session-scoped approval for this request");
      }
      return "acceptForSession";
    }
    if (available && !available.includes("accept")) {
      throw new Error("Rux did not offer a single-request approval; refusing to expand this decision to the session");
    }
    return "accept";
  }

  private handleNotification(method: string, params: JsonRecord): void {
    if (method === "thread/started") {
      const thread = isRecord(params.thread) ? params.thread : {};
      const threadId = stringValue(thread.id);
      const parentThreadId = stringValue(thread.parentThreadId);
      const parentRunId = parentThreadId ? this.threadToRun.get(parentThreadId) : undefined;
      if (threadId && parentRunId) this.threadToRun.set(threadId, parentRunId);
      return;
    }
    if (method === "thread/closed") {
      const threadId = stringValue(params.threadId);
      if (threadId) this.threadToRun.delete(threadId);
      return;
    }
    const run = this.runFor(params);
    if (method === "serverRequest/resolved") {
      const id = requestIdValue(params.requestId);
      if (id === undefined) return;
      const approval = this.approvals.get(requestKey(id));
      if (!approval) return;
      this.approvals.delete(requestKey(id));
      this.emit({
        type: "codex.approval.decided",
        runId: approval.request.runId,
        requestId: id,
        decision: "cancelled",
      });
      return;
    }
    if (!run) {
      if (method === "warning" || method === "configWarning") {
        this.emit({
          type: "codex.connection.warning",
          message: redactedText(params.message ?? params.summary, 16_000) ?? method,
        });
      }
      return;
    }

    if (method === "turn/started") {
      const turn = isRecord(params.turn) ? params.turn : {};
      const turnId = stringValue(turn.id);
      if (turnId) run.turnId = turnId;
      return;
    }
    if (method === "turn/completed") {
      this.handleTurnCompleted(run, isRecord(params.turn) ? params.turn : {});
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      this.handleItem(run, method === "item/started" ? "started" : "completed", params);
      return;
    }
    if (method === "item/agentMessage/delta" || method === "item/reasoning/summaryTextDelta") {
      const text = streamTextValue(params.delta);
      const threadId = stringValue(params.threadId);
      const turnId = stringValue(params.turnId);
      const itemId = stringValue(params.itemId);
      if (text && threadId && turnId && itemId) {
        this.emit({
          type: method === "item/agentMessage/delta"
            ? "assistant.message.delta"
            : "assistant.reasoning-summary.delta",
          runId: run.params.runId,
          threadId,
          turnId,
          itemId,
          text,
        });
      }
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      const rawText = streamTextValue(params.delta);
      const text = rawText ? redactSensitiveText(rawText, 100_000).text : undefined;
      const threadId = stringValue(params.threadId);
      const turnId = stringValue(params.turnId);
      const itemId = stringValue(params.itemId);
      if (text && threadId && turnId && itemId) {
        this.emit({
          type: "activity.output.delta",
          runId: run.params.runId,
          threadId,
          turnId,
          itemId,
          text,
        });
      }
      return;
    }
    if (method === "item/fileChange/patchUpdated") {
      const threadId = stringValue(params.threadId);
      const turnId = stringValue(params.turnId);
      const itemId = stringValue(params.itemId);
      const changes = Array.isArray(params.changes) ? params.changes.flatMap((change) => {
        if (!isRecord(change)) return [];
        const path = stringValue(change.path);
        if (!path) return [];
        return [{
          path,
          kind: fileChangeKind(change.kind),
          diff: redactSensitiveText(stringValue(change.diff) ?? "", 100_000).text,
        }];
      }) : [];
      if (threadId && turnId && itemId) {
        this.emit({
          type: "file.patch.updated",
          runId: run.params.runId,
          threadId,
          turnId,
          itemId,
          changes,
        });
      }
      return;
    }
    if (method === "turn/diff/updated") {
      const threadId = stringValue(params.threadId);
      const turnId = stringValue(params.turnId);
      const diff = stringValue(params.diff);
      if (threadId && turnId && diff) {
        this.emit({
          type: "turn.diff.updated",
          runId: run.params.runId,
          threadId,
          turnId,
          diff: redactSensitiveText(diff, 200_000).text,
        });
      }
      return;
    }
    if (method === "turn/plan/updated") {
      const items = Array.isArray(params.plan) ? params.plan.flatMap((item) => {
        if (!isRecord(item)) return [];
        const text = stringValue(item.step);
        return text ? [{ text, completed: item.status === "completed" }] : [];
      }) : [];
      this.emit({ type: "plan.updated", runId: run.params.runId, items });
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
      const total = isRecord(tokenUsage.total) ? tokenUsage.total : {};
      this.emit({
        type: "run.usage",
        runId: run.params.runId,
        usage: {
          inputTokens: numberValue(total.inputTokens) ?? 0,
          cachedInputTokens: numberValue(total.cachedInputTokens) ?? 0,
          outputTokens: numberValue(total.outputTokens) ?? 0,
          reasoningOutputTokens: numberValue(total.reasoningOutputTokens) ?? 0,
        },
      });
      return;
    }
    if (method === "error") {
      const error = isRecord(params.error) ? params.error : {};
      const message = redactedText(error.message, 16_000) ?? "Rux turn error";
      run.lastError = message;
      this.emit({
        type: "run.log",
        runId: run.params.runId,
        level: "error",
        message,
      });
      return;
    }
    if (method === "warning") {
      this.emit({
        type: "run.log",
        runId: run.params.runId,
        level: "warning",
        message: redactedText(params.message, 16_000) ?? "Rux warning",
      });
    }
  }

  private handleItem(
    run: RunRecord,
    lifecycle: "started" | "completed",
    params: JsonRecord,
  ): void {
    const item = isRecord(params.item) ? params.item : {};
    const itemId = stringValue(item.id);
    if (itemId && lifecycle === "started") {
      const startedAtMs = numberValue(params.startedAtMs);
      run.activityStartedAt.set(itemId, new Date(startedAtMs ?? Date.now()).toISOString());
      if (item.type === "fileChange") {
        const paths = Array.isArray(item.changes) ? item.changes.flatMap((change) => {
          if (!isRecord(change)) return [];
          const path = stringValue(change.path);
          return path ? [path] : [];
        }) : [];
        run.filePaths.set(itemId, paths);
      }
    }
    const activity = itemActivity(item, lifecycle);
    if (activity) {
      this.emit({
        type: lifecycle === "started" ? "activity.started" : "activity.completed",
        runId: run.params.runId,
        activity,
      });
    }
    const type = stringValue(item.type);
    if (lifecycle !== "completed") return;
    if (type === "agentMessage") {
      const text = stringValue(item.text);
      if (text) this.emit({
        type: "assistant.message",
        runId: run.params.runId,
        ...(itemId ? { itemId } : {}),
        text,
      });
      return;
    }
    if (type === "reasoning") {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((value): value is string => typeof value === "string").join("\n")
        : "";
      if (summary) {
        this.emit({ type: "assistant.reasoning-summary", runId: run.params.runId, text: summary });
      }
      return;
    }
    if (type === "commandExecution" && itemId) {
      const command = redactedText(item.command, 20_000) ?? "Rux command";
      const output = redactedText(item.aggregatedOutput, 100_000) ?? "";
      const exitCode = numberValue(item.exitCode);
      const completedAtMs = numberValue(params.completedAtMs);
      this.emit({
        type: "verification.recorded",
        runId: run.params.runId,
        verification: createVerificationEvidence({
          id: itemId,
          runId: run.params.runId,
          command,
          cwd: stringValue(item.cwd) ?? this.workspaceRoot,
          output,
          exitCode,
          failed: item.status === "failed" || item.status === "declined",
          startedAt: run.activityStartedAt.get(itemId),
          finishedAt: new Date(completedAtMs ?? Date.now()).toISOString(),
        }),
      });
      if (exitCode !== undefined) {
        this.emit({
          type: "run.log",
          runId: run.params.runId,
          level: exitCode === 0 ? "info" : "error",
          message: `命令退出码 ${exitCode}: ${command}`,
        });
      }
    }
  }

  private handleTurnCompleted(run: RunRecord, turn: JsonRecord): void {
    for (const approval of [...this.approvals.values()]) {
      if (approval.request.runId !== run.params.runId) continue;
      this.approvals.delete(requestKey(approval.request.id));
      this.emit({
        type: "codex.approval.decided",
        runId: run.params.runId,
        requestId: approval.request.id,
        decision: "cancelled",
      });
    }
    const status = stringValue(turn.status);
    if (status === "interrupted" || run.cancelled) {
      this.finishRun(run, "cancelled");
      return;
    }
    if (status === "completed") {
      this.finishRun(run, "completed", undefined, numberValue(turn.durationMs));
      return;
    }
    const error = isRecord(turn.error) ? turn.error : {};
    this.finishRun(
      run,
      "failed",
      redactedText(error.message, 16_000) ?? run.lastError ?? `Rux turn finished with ${status ?? "an unknown status"}`,
    );
  }

  private finishRun(
    run: RunRecord,
    status: "completed" | "cancelled" | "failed",
    error?: string,
    durationMs?: number,
  ): void {
    if (run.terminal) return;
    run.terminal = true;
    const runId = run.params.runId;
    this.runs.delete(runId);
    for (const [threadId, mappedRunId] of this.threadToRun) {
      if (mappedRunId === runId) this.threadToRun.delete(threadId);
    }
    for (const approval of [...this.approvals.values()]) {
      if (approval.request.runId === runId) this.approvals.delete(requestKey(approval.request.id));
    }
    if (status === "completed") {
      this.emit({
        type: "run.completed",
        runId,
        durationMs: durationMs ?? Math.max(0, Date.now() - run.startedAt),
      });
    } else if (status === "cancelled") {
      this.emit({ type: "run.cancelled", runId });
    } else {
      this.emit({
        type: "run.failed",
        runId,
        error: redactSensitiveText(error ?? "Rux Agent service run failed", 16_000).text,
      });
    }
  }

  private runFor(params: JsonRecord): RunRecord | undefined {
    const threadId = stringValue(params.threadId);
    if (threadId) {
      const runId = this.threadToRun.get(threadId);
      if (runId) return this.runs.get(runId);
    }
    const turnId = stringValue(params.turnId);
    if (turnId) {
      for (const run of this.runs.values()) if (run.turnId === turnId) return run;
    }
    return undefined;
  }

  private changedPathsForItem(run: RunRecord, itemId: string): string[] {
    return run.filePaths.get(itemId) ?? [];
  }

  private handleProcessEnd(child: ChildProcess, error?: Error): void {
    if (this.child !== child) return;
    const hadActiveRuns = this.runs.size > 0;
    this.child = undefined;
    this.initialization = undefined;
    for (const pending of this.pendingRpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(error ?? new Error("Rux Agent service stopped"));
    }
    this.pendingRpc.clear();
    for (const run of [...this.runs.values()]) {
      if (run.cancelled || this.expectedShutdown) this.finishRun(run, "cancelled");
      else this.finishRun(run, "failed", error?.message ?? "Rux Agent service stopped unexpectedly");
    }
    this.approvals.clear();
    if (error && !hadActiveRuns && !this.expectedShutdown) {
      this.emit({ type: "codex.connection.warning", message: error.message });
    }
  }
}
