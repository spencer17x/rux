import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, resolve } from "node:path";
import {
  type AgentAdapterInfo,
  type RunActivity,
  type RunStartParams,
  type RuntimeEvent,
} from "../shared/protocol.ts";
import {
  ClaudePermissionBroker,
  type ClaudePermissionHandler,
} from "./claude-permission-broker.ts";
import {
  awaitAllCleanup,
  forceKillChildProcessGroup,
  ensureChildProcessGroupTerminated,
} from "./child-process-lifecycle.ts";
import { createVerificationEvidence, redactSensitiveText } from "./verification-evidence.ts";

type JsonRecord = Record<string, unknown>;
const MAX_PROVIDER_JSONL_LINE_BYTES = 4 * 1024 * 1024;

type RunRecord = {
  child: ChildProcess;
  permissionBroker?: ClaudePermissionBroker;
  cancelled: boolean;
  emittedTerminalEvent: boolean;
  stdoutBuffer: string;
  stderrBuffer: string;
  sessionId?: string;
  toolActivities: Map<string, RunActivity>;
  toolCommands: Map<string, { command: string; startedAt: string }>;
  termination?: Promise<void>;
};

export type ClaudeCodeAdapterOptions = {
  executable?: string;
  onPermissionRequest?: ClaudePermissionHandler;
  permissionRequestTimeoutMs?: number;
  permissionBrokerNodeExecutable?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function executableCandidates(): string[] {
  const fromPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => resolve(directory, process.platform === "win32" ? "claude.exe" : "claude"));

  return [
    process.env.CLAUDE_CODE_PATH,
    ...fromPath,
    resolve(homedir(), ".local/bin/claude"),
    resolve(homedir(), ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function inspectClaudeCode(override?: string): AgentAdapterInfo {
  const seen = new Set<string>();
  const candidates = override ? [override] : executableCandidates();
  for (const candidate of candidates) {
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
          id: "claude-code",
          name: "Claude Code",
          available: true,
          version: result.stdout.trim().replace(/\s*\(Claude Code\)\s*$/, ""),
          executable: candidate,
          detail: "stream-json adapter",
        };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return {
    id: "claude-code",
    name: "Claude Code",
    available: false,
    detail: "未找到 Claude Code CLI。可通过 CLAUDE_CODE_PATH 指定位置。",
  };
}

export function supportsClaudePermissionPromptTool(executable: string): boolean {
  try {
    // Newer Claude Code releases keep this SDK/host flag hidden from --help,
    // so probe the parser without starting a session or touching auth state.
    const result = spawnSync(executable, [
      "--permission-prompt-tool",
      "mcp__rux-permission-probe__request_permission",
      "--version",
    ], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function toolKind(name: string): RunActivity["kind"] {
  if (["Read", "Glob", "Grep", "WebFetch", "WebSearch"].includes(name)) return "read";
  if (["Edit", "Write", "NotebookEdit"].includes(name)) return "edit";
  if (name === "Bash") return "command";
  return "tool";
}

function toolDetail(name: string, input: JsonRecord): string {
  const detail = stringValue(input.description)
    ?? stringValue(input.file_path)
    ?? stringValue(input.path)
    ?? stringValue(input.pattern)
    ?? stringValue(input.command)
    ?? stringValue(input.query)
    ?? `${name} tool call`;
  return detail.length > 220 ? `${detail.slice(0, 217)}…` : detail;
}

function toolTitle(name: string, input: JsonRecord): string {
  const target = stringValue(input.file_path) ?? stringValue(input.path);
  if (name === "Read") return target ? `读取 ${basename(target)}` : "读取文件";
  if (name === "Edit" || name === "Write") return target ? `编辑 ${basename(target)}` : "编辑文件";
  if (name === "Bash") return "运行命令";
  if (name === "Glob" || name === "Grep") return "搜索代码库";
  return `调用 ${name}`;
}

function resultError(event: JsonRecord): string {
  const errors = Array.isArray(event.errors)
    ? event.errors.filter((value): value is string => typeof value === "string")
    : [];
  return errors.join("\n")
    || stringValue(event.result)
    || stringValue(event.subtype)
    || "Claude Code run failed";
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (isRecord(item) && typeof item.text === "string") return [item.text];
    return [];
  }).join("\n");
}

export class ClaudeCodeAdapter {
  private readonly runs = new Map<string, RunRecord>();
  private readonly workspaceRoot: string;
  private readonly emit: (event: RuntimeEvent) => void;
  private readonly options: ClaudeCodeAdapterOptions;
  private adapterInfo: AgentAdapterInfo | undefined;
  private permissionPromptToolSupported: boolean | undefined;
  private disposed = false;

  constructor(
    workspaceRoot: string,
    emit: (event: RuntimeEvent) => void,
    options: ClaudeCodeAdapterOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
    this.emit = emit;
    this.options = options;
  }

  info(): AgentAdapterInfo {
    this.adapterInfo ??= inspectClaudeCode(this.options.executable);
    return this.adapterInfo;
  }

  start(params: RunStartParams): { runId: string; adapter: "claude-code" } {
    if (this.disposed) throw new Error("Claude Code adapter is disposed");
    if (this.runs.has(params.runId)) throw new Error("Run ID is already active");
    const adapter = this.info();
    if (!adapter.available || !adapter.executable) {
      throw new Error(adapter.detail ?? "Claude Code CLI is unavailable");
    }

    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      params.permissionMode,
      "--prompt-suggestions",
      "false",
      "--name",
      `Rux ${params.runId.slice(0, 12)}`,
    ];
    if (params.sessionId) args.push("--resume", params.sessionId);
    let permissionBroker: ClaudePermissionBroker | undefined;
    if (params.permissionMode === "acceptEdits" && this.options.onPermissionRequest) {
      this.permissionPromptToolSupported ??= supportsClaudePermissionPromptTool(adapter.executable);
      if (!this.permissionPromptToolSupported) {
        throw new Error("当前 Claude Code CLI 不支持 provider-native 权限回调，请升级官方 CLI");
      }
      permissionBroker = new ClaudePermissionBroker({
        runId: params.runId,
        onPermissionRequest: this.options.onPermissionRequest,
        nodeExecutable: this.options.permissionBrokerNodeExecutable,
        timeoutMs: this.options.permissionRequestTimeoutMs,
      });
      const launch = permissionBroker.start();
      args.push(
        "--permission-prompt-tool",
        launch.toolName,
        "--mcp-config",
        launch.configPath,
      );
    }
    if (params.model) args.push("--model", params.model);
    args.push(params.prompt);

    const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };
    delete environment.CLAUDECODE;

    let child: ChildProcess;
    try {
      child = spawn(adapter.executable, args, {
        cwd: this.workspaceRoot,
        env: environment,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      permissionBroker?.dispose();
      throw error;
    }
    const record: RunRecord = {
      child,
      permissionBroker,
      cancelled: false,
      emittedTerminalEvent: false,
      stdoutBuffer: "",
      stderrBuffer: "",
      sessionId: params.sessionId,
      toolActivities: new Map(),
      toolCommands: new Map(),
    };
    this.runs.set(params.runId, record);
    this.emit({
      type: "run.started",
      runId: params.runId,
      adapter: "claude-code",
      prompt: params.prompt,
      permissionMode: params.permissionMode,
      model: params.model,
      profileId: params.profileId,
      agentRevisionId: params.agentRevisionId,
    });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consumeStdout(params.runId, record, chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => this.consumeStderr(params.runId, record, chunk));
    child.on("error", (error) => {
      record.permissionBroker?.dispose();
      record.permissionBroker = undefined;
      if (record.emittedTerminalEvent || record.cancelled) return;
      record.emittedTerminalEvent = true;
      this.emit({ type: "run.failed", runId: params.runId, error: error.message });
    });
    child.on("close", (code, signal) => {
      this.flushBuffers(params.runId, record);
      this.runs.delete(params.runId);
      record.permissionBroker?.dispose();
      record.permissionBroker = undefined;

      if (record.cancelled) {
        if (!record.emittedTerminalEvent) {
          record.emittedTerminalEvent = true;
          this.emit({ type: "run.cancelled", runId: params.runId });
        }
        return;
      }

      if (!record.emittedTerminalEvent) {
        record.emittedTerminalEvent = true;
        if (code === 0) {
          this.emit({ type: "run.completed", runId: params.runId });
        } else {
          this.emit({
            type: "run.failed",
            runId: params.runId,
            error: `Claude Code exited with ${code ?? signal ?? "an unknown status"}`,
          });
        }
      }
    });

    return { runId: params.runId, adapter: "claude-code" };
  }

  cancel(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return Promise.resolve();
    record.cancelled = true;
    record.permissionBroker?.dispose();
    record.permissionBroker = undefined;
    record.termination ??= ensureChildProcessGroupTerminated(record.child);
    return record.termination;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await awaitAllCleanup([...this.runs.keys()].map((runId) => this.cancel(runId)), "Claude Code");
  }

  forceDispose(): void {
    this.disposed = true;
    for (const record of this.runs.values()) {
      record.cancelled = true;
      record.permissionBroker?.dispose();
      record.permissionBroker = undefined;
      forceKillChildProcessGroup(record.child);
    }
  }

  private consumeStdout(runId: string, record: RunRecord, chunk: string): void {
    record.stdoutBuffer += chunk;
    if (Buffer.byteLength(record.stdoutBuffer, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES && !record.stdoutBuffer.includes("\n")) {
      this.failOversizedProviderLine(runId, record, "stdout");
      return;
    }
    let newline = record.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = record.stdoutBuffer.slice(0, newline).trim();
      record.stdoutBuffer = record.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES) {
        this.failOversizedProviderLine(runId, record, "stdout");
        return;
      }
      if (line) this.handleLine(runId, record, line);
      newline = record.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeStderr(runId: string, record: RunRecord, chunk: string): void {
    record.stderrBuffer += chunk;
    if (Buffer.byteLength(record.stderrBuffer, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES && !record.stderrBuffer.includes("\n")) {
      this.failOversizedProviderLine(runId, record, "stderr");
      return;
    }
    let newline = record.stderrBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = record.stderrBuffer.slice(0, newline).trim();
      record.stderrBuffer = record.stderrBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_PROVIDER_JSONL_LINE_BYTES) {
        this.failOversizedProviderLine(runId, record, "stderr");
        return;
      }
      if (line) this.emit({ type: "run.log", runId, level: "error", message: redactSensitiveText(line, 2_000).text });
      newline = record.stderrBuffer.indexOf("\n");
    }
  }

  private failOversizedProviderLine(runId: string, record: RunRecord, stream: "stdout" | "stderr"): void {
    record.stdoutBuffer = "";
    record.stderrBuffer = "";
    if (!record.emittedTerminalEvent) {
      record.emittedTerminalEvent = true;
      this.emit({ type: "run.failed", runId, error: `Claude Code ${stream} exceeded the 4 MB line limit` });
    }
    this.cancel(runId);
  }

  private flushBuffers(runId: string, record: RunRecord): void {
    const stdout = record.stdoutBuffer.trim();
    const stderr = record.stderrBuffer.trim();
    record.stdoutBuffer = "";
    record.stderrBuffer = "";
    if (stdout) this.handleLine(runId, record, stdout);
    if (stderr) this.emit({ type: "run.log", runId, level: "error", message: redactSensitiveText(stderr, 2_000).text });
  }

  private handleLine(runId: string, record: RunRecord, line: string): void {
    let event: JsonRecord;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) return;
      event = parsed;
    } catch {
      this.emit({ type: "run.log", runId, level: "info", message: redactSensitiveText(line, 2_000).text });
      return;
    }

    const type = stringValue(event.type);
    if (type === "system") {
      this.handleSystemEvent(runId, record, event);
      return;
    }
    if (type === "assistant") {
      this.handleAssistantEvent(runId, record, event);
      return;
    }
    if (type === "user") {
      this.handleToolResults(runId, record, event);
      return;
    }
    if (type === "result") this.handleResult(runId, record, event);
  }

  private handleSystemEvent(runId: string, record: RunRecord, event: JsonRecord): void {
    const subtype = stringValue(event.subtype);
    if (subtype === "init") {
      record.sessionId = stringValue(event.session_id) ?? record.sessionId;
      this.emit({
        type: "run.metadata",
        runId,
        sessionId: record.sessionId,
        model: stringValue(event.model),
        permissionMode: stringValue(event.permissionMode),
        cwd: stringValue(event.cwd),
        version: stringValue(event.claude_code_version),
      });
      return;
    }

    if (subtype === "api_retry") {
      const attempt = numberValue(event.attempt) ?? 1;
      const maximum = numberValue(event.max_retries) ?? 1;
      const status = numberValue(event.error_status);
      const activity: RunActivity = {
        id: `retry-${attempt}`,
        kind: "retry",
        title: `Claude API 重试 ${attempt}/${maximum}`,
        detail: status ? `服务返回 ${status}` : stringValue(event.error) ?? "暂时无法连接模型服务",
        state: "active",
      };
      this.emit({ type: "activity.started", runId, activity });
    }
  }

  private handleAssistantEvent(runId: string, record: RunRecord, event: JsonRecord): void {
    const message = isRecord(event.message) ? event.message : undefined;
    const content = message && Array.isArray(message.content) ? message.content : [];
    const text: string[] = [];

    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") text.push(block.text);
      if (block.type !== "tool_use") continue;

      const id = stringValue(block.id) ?? `tool-${Date.now()}`;
      const name = stringValue(block.name) ?? "Tool";
      const input = isRecord(block.input) ? block.input : {};
      const activity: RunActivity = {
        id,
        kind: toolKind(name),
        title: toolTitle(name, input),
        detail: toolDetail(name, input),
        state: "active",
      };
      record.toolActivities.set(id, activity);
      if (name === "Bash") {
        const command = stringValue(input.command);
        if (command) record.toolCommands.set(id, { command, startedAt: new Date().toISOString() });
      }
      this.emit({ type: "activity.started", runId, activity });
    }

    const assistantText = text.join("\n\n").trim();
    if (assistantText) this.emit({ type: "assistant.message", runId, text: assistantText });
  }

  private handleToolResults(runId: string, record: RunRecord, event: JsonRecord): void {
    const message = isRecord(event.message) ? event.message : undefined;
    const content = message && Array.isArray(message.content) ? message.content : [];

    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      const toolUseId = stringValue(block.tool_use_id);
      if (!toolUseId) continue;
      const existing = record.toolActivities.get(toolUseId);
      if (!existing) continue;
      const failed = block.is_error === true;
      const activity: RunActivity = {
        ...existing,
        state: failed ? "error" : "done",
        detail: failed ? `${existing.detail} · 执行失败` : existing.detail,
      };
      record.toolActivities.set(toolUseId, activity);
      this.emit({ type: "activity.completed", runId, activity });
      const command = record.toolCommands.get(toolUseId);
      if (command) {
        const metadata = isRecord(block.metadata) ? block.metadata : undefined;
        const exitCode = numberValue(block.exit_code)
          ?? numberValue(block.exitCode)
          ?? (metadata ? numberValue(metadata.exit_code) ?? numberValue(metadata.exitCode) : undefined);
        this.emit({
          type: "verification.recorded",
          runId,
          verification: createVerificationEvidence({
            id: toolUseId,
            runId,
            command: command.command,
            cwd: this.workspaceRoot,
            output: toolResultText(block.content),
            exitCode,
            failed,
            startedAt: command.startedAt,
          }),
        });
        record.toolCommands.delete(toolUseId);
      }
    }
  }

  private handleResult(runId: string, record: RunRecord, event: JsonRecord): void {
    if (record.cancelled || record.emittedTerminalEvent) return;
    record.emittedTerminalEvent = true;
    const failed = event.is_error === true || stringValue(event.subtype) !== "success";
    if (failed) {
      this.emit({ type: "run.failed", runId, error: resultError(event) });
      return;
    }

    this.emit({
      type: "run.completed",
      runId,
      durationMs: numberValue(event.duration_ms),
      costUsd: numberValue(event.total_cost_usd),
      turns: numberValue(event.num_turns),
    });
  }
}
