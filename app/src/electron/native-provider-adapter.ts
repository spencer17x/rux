import { access, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type {
  AgentAdapterInfo,
  NativeProviderConnectionTestResult,
  NativeProviderRuntimeCredential,
  RunActivity,
  RunStartParams,
  RuntimeEvent,
} from "../shared/protocol.ts";
import { ensureChildProcessGroupTerminated } from "./child-process-lifecycle.ts";
import { createVerificationEvidence, redactSensitiveText } from "./verification-evidence.ts";
import { secretContentReason, sensitivePathReason } from "./context-snapshot.ts";

const MAX_TOOL_TURNS = 24;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT_CHARS = 80_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const MAX_COMMAND_ARGS = 200;
const MAX_COMMAND_ARG_CHARS = 20_000;

type JsonRecord = Record<string, unknown>;
type ResponseOutput = JsonRecord & { type?: string; id?: string; call_id?: string; name?: string; arguments?: string; content?: unknown[] };
export type NativeRunStartParams = RunStartParams & { allowedToolIds?: string[] };

type NativeCommandResult = {
  command: string;
  cwd: string;
  output: string;
  exitCode?: number;
  timedOut: boolean;
  startedAt: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message, 2_000).text || "Native Provider request failed";
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function reportedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 120)))).slice(0, 100);
}

function extractText(output: ResponseOutput[]): string {
  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if ((content.type === "output_text" || content.type === "text") && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_COMMAND_ARGS) throw new Error(`args must contain at most ${MAX_COMMAND_ARGS} strings`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error("args must contain strings only");
    if (item.length > MAX_COMMAND_ARG_CHARS) throw new Error("One command argument is too long");
    if (item.includes("\0")) throw new Error("Command arguments cannot contain NUL bytes");
    return item;
  });
}

function safeExecutable(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("executable is required");
  const executable = value.trim();
  if (executable.includes("\0") || executable.includes("/") || executable.includes("\\")) {
    throw new Error("executable must be a command name resolved from the restricted PATH");
  }
  return executable;
}

function commandEnvironment(workspaceRoot: string, sandboxTemp: string): NodeJS.ProcessEnv {
  const allowedKeys = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "SystemRoot", "WINDIR", "PATHEXT"];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.CI = "1";
  environment.NO_COLOR = "1";
  environment.RUX_WORKSPACE_ROOT = workspaceRoot;
  environment.HOME = sandboxTemp;
  environment.TMPDIR = sandboxTemp;
  return environment;
}

function sandboxPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function commonAncestorPath(left: string, right: string): string {
  let ancestor = left;
  while (relative(ancestor, right).startsWith("..") || isAbsolute(relative(ancestor, right))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return left;
    ancestor = parent;
  }
  return ancestor;
}

async function resolveCommandExecutable(executable: string): Promise<{ path: string; toolchainRoot: string }> {
  const searchPath = process.env.PATH?.split(":").filter(Boolean) ?? [];
  for (const directory of searchPath) {
    const candidate = resolve(directory, executable);
    try {
      await access(candidate, fsConstants.X_OK);
      const path = await realpath(candidate);
      const searchDirectory = await realpath(directory);
      return { path, toolchainRoot: commonAncestorPath(searchDirectory, path) };
    } catch {
      // Continue through the restricted PATH.
    }
  }
  throw new Error(`Executable is unavailable in PATH: ${executable}`);
}

function macSandboxProfile(workspaceRoot: string, sandboxTemp: string, toolchainRoot: string): string {
  const escapedWorkspace = workspaceRoot.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const escapedTemp = sandboxTemp.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const escapedToolchain = sandboxPath(toolchainRoot);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow file-read*)",
    `(deny file-read-data (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp") (subpath "/tmp"))`,
    `(allow file-read-data (subpath "${escapedWorkspace}") (subpath "${escapedTemp}") (subpath "${escapedToolchain}"))`,
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix*)",
    `(allow file-write* (subpath "${escapedWorkspace}") (subpath "${escapedTemp}"))`,
    "(deny network*)",
  ].join(" ");
}

function usageFromResponse(response: JsonRecord) {
  const usage = isRecord(response.usage) ? response.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const cachedInputTokens = typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const reasoningOutputTokens = typeof outputDetails.reasoning_tokens === "number" ? outputDetails.reasoning_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
  if ([inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens].every((value) => value === undefined)) return undefined;
  return {
    source: "provider" as const,
    scope: "task" as const,
    aggregation: "incremental" as const,
    isEstimate: false,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    reportedAt: new Date().toISOString(),
  };
}

function responseEventFailure(event: JsonRecord): string | undefined {
  if (event.type !== "response.failed" && event.type !== "error" && event.type !== "response.incomplete") return undefined;
  const response = isRecord(event.response) ? event.response : undefined;
  const error = isRecord(event.error) ? event.error : response && isRecord(response.error) ? response.error : undefined;
  const message = error && typeof error.message === "string" ? error.message : undefined;
  return message ?? `Provider stream ended with ${String(event.type)}`;
}

export class NativeProviderAdapter {
  private readonly workspaceRoot: string;
  private readonly emit: (event: RuntimeEvent) => void;
  private readonly connections = new Map<string, NativeProviderRuntimeCredential>();
  private readonly runs = new Map<string, AbortController>();
  private disposed = false;

  constructor(workspaceRoot: string, emit: (event: RuntimeEvent) => void) {
    this.workspaceRoot = realpathSync(workspaceRoot);
    this.emit = emit;
  }

  sync(connections: NativeProviderRuntimeCredential[]): void {
    this.connections.clear();
    for (const connection of connections) this.connections.set(connection.id, { ...connection });
  }

  info(): AgentAdapterInfo {
    return {
      id: "rux-native",
      name: "Rux Native",
      available: this.connections.size > 0,
      version: "responses-v1",
      detail: this.connections.size > 0
        ? `${this.connections.size} 个原生 Provider Connection，无需安装 Agent CLI`
        : "添加一个原生 Provider Connection 后即可使用，无需安装 Agent CLI",
    };
  }

  supportsPerRunModelSelection(id: string): boolean {
    return this.connections.get(id)?.capabilities?.perRunModelSelection === true;
  }

  catalogModels(id: string): string[] {
    return this.connections.get(id)?.modelCatalog?.models.map((model) => model.id) ?? [];
  }

  async test(id: string): Promise<NativeProviderConnectionTestResult> {
    const connection = this.requireConnection(id);
    const testedAt = new Date().toISOString();
    try {
      const response = await fetch(endpoint(connection.baseUrl, "models"), {
        headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error("Provider model catalog response is not structured data");
      const catalogEntries = payload.data.filter(isRecord).flatMap((item) => {
        const modelId = typeof item.id === "string" ? item.id.trim() : "";
        if (!modelId || modelId.length > 160) return [];
        const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 160) : undefined;
        return [[modelId, { id: modelId, ...(name ? { name } : {}) }] as const];
      });
      const catalogById = new Map<string, { id: string; name?: string }>();
      for (const [modelId, model] of catalogEntries) if (!catalogById.has(modelId)) catalogById.set(modelId, model);
      const models = Array.from(catalogById.values()).slice(0, 500);
      const capabilityRecord = isRecord(payload.capabilities) ? payload.capabilities : undefined;
      const reported = capabilityRecord ? reportedStringList(capabilityRecord.reported ?? capabilityRecord.features) : [];
      const perRunModelSelection = capabilityRecord && typeof capabilityRecord.per_run_model_selection === "boolean"
        ? capabilityRecord.per_run_model_selection
        : undefined;
      return {
        id,
        ok: true,
        testedAt,
        detail: `连接成功；Provider 返回 ${models.length} 个模型${perRunModelSelection === undefined ? "，逐 Run 换模能力未报告" : perRunModelSelection ? "，声明支持逐 Run 换模" : "，声明不支持逐 Run 换模"}。`,
        modelCatalog: { source: "provider-models", refreshedAt: testedAt, models },
        capabilities: { source: "provider-report", refreshedAt: testedAt, ...(perRunModelSelection === undefined ? {} : { perRunModelSelection }), reported },
      };
    } catch (error) {
      return { id, ok: false, testedAt, detail: safeError(error) };
    }
  }

  start(params: NativeRunStartParams): { runId: string; adapter: "rux-native" } {
    if (this.disposed) throw new Error("Rux Native adapter is disposed");
    if (this.runs.has(params.runId)) throw new Error("Run ID is already active");
    const connection = this.requireConnection(params.providerConnectionId ?? "");
    const controller = new AbortController();
    this.runs.set(params.runId, controller);
    void this.execute(params, connection, controller).finally(() => this.runs.delete(params.runId));
    return { runId: params.runId, adapter: "rux-native" };
  }

  async cancel(runId: string): Promise<void> {
    const controller = this.runs.get(runId);
    if (!controller) return;
    controller.abort();
    this.runs.delete(runId);
    this.emit({ type: "run.cancelled", runId });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.runs.values()) controller.abort();
    this.runs.clear();
    this.connections.clear();
  }

  private requireConnection(id: string): NativeProviderRuntimeCredential {
    const connection = this.connections.get(id);
    if (!connection) throw new Error("Rux Native Provider Connection is unavailable; reopen Agent & Provider and check the connection");
    return connection;
  }

  private async execute(params: NativeRunStartParams, connection: NativeProviderRuntimeCredential, controller: AbortController): Promise<void> {
    const startedAt = Date.now();
    const model = params.model ?? connection.defaultModel;
    this.emit({
      type: "run.started",
      runId: params.runId,
      adapter: "rux-native",
      prompt: params.prompt,
      permissionMode: params.permissionMode,
      model,
      profileId: params.profileId,
      agentRevisionId: params.agentRevisionId,
      providerConnection: { id: connection.id, kind: "rux-native", engine: "rux-native", label: connection.label },
      modelSource: params.model ? "manual" : "engine-default",
      modelVerificationStatus: params.model ? "unverified" : "not-required",
      ...(params.sessionId ? { resumeSessionId: params.sessionId } : {}),
    });

    try {
      let previousResponseId = params.sessionId;
      let input: unknown = [{ role: "user", content: params.prompt }];
      let turns = 0;
      while (turns < MAX_TOOL_TURNS) {
        turns += 1;
        const body: JsonRecord = {
          model,
          input,
          tools: this.tools(params.permissionMode, params.allowedToolIds),
          parallel_tool_calls: false,
          store: true,
          stream: true,
        };
        if (previousResponseId) body.previous_response_id = previousResponseId;
        const response = await fetch(endpoint(connection.baseUrl, "responses"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
        const payload = await this.readResponsePayload(response, params.runId, previousResponseId ?? params.runId, turns, controller.signal);
        const responseId = typeof payload.id === "string" ? payload.id : undefined;
        if (responseId) {
          previousResponseId = responseId;
          this.emit({ type: "run.metadata", runId: params.runId, sessionId: responseId, model });
        }
        const usage = usageFromResponse(payload);
        if (usage) this.emit({ type: "run.usage", runId: params.runId, usage });
        const output = Array.isArray(payload.output) ? payload.output.filter(isRecord) as ResponseOutput[] : [];
        const calls = output.filter((item) => item.type === "function_call" && item.call_id && item.name);
        const text = extractText(output);
        if (text) this.emit({ type: "assistant.message", runId: params.runId, text });
        if (!calls.length) {
          this.emit({ type: "run.completed", runId: params.runId, durationMs: Date.now() - startedAt, turns });
          return;
        }
        const toolOutputs = [];
        for (const call of calls) {
          const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) as JsonRecord : {};
          const outputText = await this.runTool(params, String(call.call_id), String(call.name), args, controller.signal);
          toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: outputText });
        }
        input = toolOutputs;
      }
      throw new Error(`Rux Native stopped after ${MAX_TOOL_TURNS} tool turns`);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.emit({ type: "run.failed", runId: params.runId, error: safeError(error), ...(params.sessionId ? { resumeSessionId: params.sessionId } : {}) });
    }
  }

  private async readResponsePayload(
    response: Response,
    runId: string,
    threadId: string,
    turn: number,
    signal: AbortSignal,
  ): Promise<JsonRecord> {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) return await response.json() as JsonRecord;
    if (!response.body) throw new Error("Provider returned an empty event stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const completedItems: ResponseOutput[] = [];
    const textByItem = new Map<string, string>();
    let completedResponse: JsonRecord | undefined;
    let buffer = "";

    const consume = (block: string) => {
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      let event: JsonRecord;
      try {
        const parsed = JSON.parse(data);
        if (!isRecord(parsed)) return;
        event = parsed;
      } catch {
        throw new Error("Provider returned malformed Responses stream data");
      }
      const failure = responseEventFailure(event);
      if (failure) throw new Error(failure);
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        const itemId = typeof event.item_id === "string" ? event.item_id : `native-message-${turn}`;
        textByItem.set(itemId, `${textByItem.get(itemId) ?? ""}${event.delta}`);
        this.emit({
          type: "assistant.message.delta",
          runId,
          threadId,
          turnId: `native-turn-${turn}`,
          itemId,
          text: event.delta,
        });
      } else if (event.type === "response.output_item.done" && isRecord(event.item)) {
        completedItems.push(event.item as ResponseOutput);
      } else if (event.type === "response.completed" && isRecord(event.response)) {
        completedResponse = event.response;
      }
    };

    while (true) {
      if (signal.aborted) throw new DOMException("Run cancelled", "AbortError");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) consume(block);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (completedResponse) return completedResponse;
    if (!completedItems.length && !textByItem.size) throw new Error("Provider stream ended without a completed response");
    const output: ResponseOutput[] = [...completedItems];
    for (const [itemId, text] of textByItem) {
      if (output.some((item) => item.id === itemId)) continue;
      output.push({ type: "message", id: itemId, content: [{ type: "output_text", text }] });
    }
    return { output };
  }

  private tools(permissionMode: RunStartParams["permissionMode"], configuredToolIds?: string[]): JsonRecord[] {
    const allowed = configuredToolIds ? new Set(configuredToolIds) : undefined;
    const tools: JsonRecord[] = [];
    if (!allowed || allowed.has("read_file")) {
      tools.push({ type: "function", name: "read_file", description: "Read a UTF-8 text file inside the active workspace.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } });
    }
    if (!allowed || allowed.has("list_files")) {
      tools.push({ type: "function", name: "list_files", description: "List files in a workspace directory.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } });
    }
    if (permissionMode !== "plan" && (!allowed || allowed.has("write_file"))) {
      tools.push(
        { type: "function", name: "write_file", description: "Create or replace one UTF-8 file inside the active workspace.", strict: true, parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
      );
    }
    if (permissionMode !== "plan" && process.platform === "darwin" && (!allowed || allowed.has("run_command"))) {
      tools.push(
        { type: "function", name: "run_command", description: "Run one executable without a shell inside the active workspace. Arguments are passed as a structured array. The command has a sanitized environment, bounded output and timeout; network access is denied by the macOS sandbox.", strict: true, parameters: { type: "object", properties: { executable: { type: "string", description: "Command name such as npm, git, node, cargo, python3 or go. Paths and shell syntax are not accepted." }, args: { type: "array", items: { type: "string" }, maxItems: MAX_COMMAND_ARGS }, cwd: { type: "string", description: "Optional workspace-relative working directory." }, timeout_ms: { type: "integer", minimum: 1_000, maximum: MAX_COMMAND_TIMEOUT_MS } }, required: ["executable", "args"], additionalProperties: false } },
      );
    }
    return tools;
  }

  private async runTool(params: NativeRunStartParams, callId: string, name: string, args: JsonRecord, signal: AbortSignal): Promise<string> {
    const kind: RunActivity["kind"] = name === "write_file" ? "edit" : name === "run_command" ? "command" : "read";
    const activityDetail = name === "run_command"
      ? [String(args.executable ?? ""), ...stringArray(args.args ?? [])].map(shellQuote).join(" ")
      : String(args.path ?? "Workspace");
    const activity: RunActivity = { id: callId, kind, title: name, detail: activityDetail, state: "active" };
    this.emit({ type: "activity.started", runId: params.runId, activity });
    if (params.allowedToolIds && !params.allowedToolIds.includes(name)) {
      const message = `${name} is not enabled by this immutable Agent Revision`;
      this.emit({ type: "activity.completed", runId: params.runId, activity: { ...activity, detail: message, state: "error" } });
      return `Tool error: ${message}`;
    }
    try {
      let result: string;
      if (name === "read_file") {
        const file = await this.resolveWorkspacePath(String(args.path ?? ""), true);
        const protectedReason = sensitivePathReason(relative(this.workspaceRoot, file));
        if (protectedReason) throw new Error(`File is blocked because it is a protected ${protectedReason}`);
        const metadata = await stat(file);
        if (metadata.size > MAX_FILE_BYTES) throw new Error("File is too large for the native Agent tool");
        result = await readFile(file, "utf8");
        const secretReason = secretContentReason(result);
        if (secretReason) throw new Error(`File is blocked because it contains ${secretReason}`);
      } else if (name === "list_files") {
        const directory = await this.resolveWorkspacePath(String(args.path ?? "."), true);
        const entries = await readdir(directory, { withFileTypes: true });
        result = entries.slice(0, 500).map((entry) => `${entry.isDirectory() ? "directory" : "file"}\t${entry.name}`).join("\n");
      } else if (name === "write_file" && params.permissionMode !== "plan") {
        const file = await this.resolveWorkspacePath(String(args.path ?? ""), false);
        const content = String(args.content ?? "");
        const protectedReason = sensitivePathReason(relative(this.workspaceRoot, file));
        if (protectedReason) throw new Error(`File is blocked because it is a protected ${protectedReason}`);
        const secretReason = secretContentReason(content);
        if (secretReason) throw new Error(`Write is blocked because it contains ${secretReason}`);
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("File content is too large for one write");
        await writeFile(file, content, { encoding: "utf8", flag: "w" });
        result = `Wrote ${Buffer.byteLength(content)} bytes to ${relative(this.workspaceRoot, file)}`;
      } else if (name === "run_command" && params.permissionMode !== "plan") {
        const commandResult = await this.runCommand(params.runId, callId, args, signal);
        this.emit({
          type: "verification.recorded",
          runId: params.runId,
          verification: createVerificationEvidence({
            id: callId,
            runId: params.runId,
            command: commandResult.command,
            cwd: commandResult.cwd,
            output: commandResult.output,
            exitCode: commandResult.exitCode,
            failed: commandResult.timedOut || commandResult.exitCode !== 0,
            startedAt: commandResult.startedAt,
          }),
        });
        result = [
          `Command: ${commandResult.command}`,
          `CWD: ${relative(this.workspaceRoot, commandResult.cwd) || "."}`,
          commandResult.timedOut ? "Result: timed out" : `Exit code: ${commandResult.exitCode ?? "unknown"}`,
          commandResult.output,
        ].filter(Boolean).join("\n");
      } else {
        throw new Error(`Unsupported or disallowed tool: ${name}`);
      }
      if (name === "write_file") {
        this.emit({ type: "run.workspace-changed", runId: params.runId, source: "file-tool", paths: [relative(this.workspaceRoot, await this.resolveWorkspacePath(String(args.path ?? ""), true))] });
      } else if (name === "run_command") {
        this.emit({ type: "run.workspace-changed", runId: params.runId, source: "command-tool", paths: [] });
      }
      this.emit({ type: "activity.completed", runId: params.runId, activity: { ...activity, state: "done" } });
      return result.slice(0, MAX_TOOL_OUTPUT_CHARS);
    } catch (error) {
      const message = safeError(error);
      this.emit({ type: "activity.completed", runId: params.runId, activity: { ...activity, detail: message, state: "error" } });
      return `Tool error: ${message}`;
    }
  }

  private async runCommand(runId: string, callId: string, args: JsonRecord, signal: AbortSignal): Promise<NativeCommandResult> {
    if (process.platform !== "darwin") throw new Error("Rux Native command sandbox is unavailable on this platform");
    const executable = safeExecutable(args.executable);
    const resolvedExecutable = await resolveCommandExecutable(executable);
    const commandArgs = stringArray(args.args ?? []);
    const cwd = await this.resolveWorkspacePath(String(args.cwd ?? "."), true);
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) throw new Error("Command cwd must be a workspace directory");
    const timeoutValue = typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
      ? Math.trunc(args.timeout_ms)
      : DEFAULT_COMMAND_TIMEOUT_MS;
    const timeoutMs = Math.min(MAX_COMMAND_TIMEOUT_MS, Math.max(1_000, timeoutValue));
    const command = [executable, ...commandArgs].map(shellQuote).join(" ");
    const sandboxTemp = await mkdtemp(resolve(realpathSync(tmpdir()), "rux-native-command-"));
    const environment = commandEnvironment(this.workspaceRoot, sandboxTemp);
    const spawnExecutable = "/usr/bin/sandbox-exec";
    const spawnArgs = ["-p", macSandboxProfile(this.workspaceRoot, sandboxTemp, resolvedExecutable.toolchainRoot), resolvedExecutable.path, ...commandArgs];
    const startedAt = new Date().toISOString();

    try {
      return await new Promise<NativeCommandResult>((resolveCommand, rejectCommand) => {
      const child = spawn(spawnExecutable, spawnArgs, {
        cwd,
        env: environment,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let settled = false;
      let timedOut = false;
      let output = "";
      let outputTruncated = false;
      const appendOutput = (chunk: Buffer) => {
        if (output.length >= MAX_TOOL_OUTPUT_CHARS) {
          outputTruncated = true;
          return;
        }
        const text = chunk.toString("utf8");
        const remaining = MAX_TOOL_OUTPUT_CHARS - output.length;
        output += text.slice(0, remaining);
        if (text.length > remaining) outputTruncated = true;
      };
      child.stdout?.on("data", appendOutput);
      child.stderr?.on("data", appendOutput);

      const stop = async () => {
        try {
          await ensureChildProcessGroupTerminated(child, { gracePeriodMs: 1_000, forceKillWaitMs: 1_000 });
        } catch {
          // The exit/error listener below remains the terminal source of truth.
        }
      };
      const onAbort = () => { void stop(); };
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        this.emit({ type: "run.log", runId, level: "warning", message: `${command} 超过 ${timeoutMs} ms，Rux 正在终止其进程树。` });
        void stop();
      }, timeoutMs);

      const finish = (error?: Error, exitCode?: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) {
          rejectCommand(error);
          return;
        }
        const safeOutput = redactSensitiveText(`${output}${outputTruncated ? "\n… [Rux command output truncated]" : ""}`, MAX_TOOL_OUTPUT_CHARS);
        resolveCommand({
          command,
          cwd,
          output: safeOutput.text,
          ...(typeof exitCode === "number" ? { exitCode } : {}),
          timedOut,
          startedAt,
        });
      };
      child.once("error", (error) => finish(error));
      child.once("close", (code) => finish(undefined, code));
      });
    } finally {
      await rm(sandboxTemp, { recursive: true, force: true });
    }
  }

  private async resolveWorkspacePath(input: string, mustExist: boolean): Promise<string> {
    const candidate = resolve(this.workspaceRoot, input || ".");
    const relativePath = relative(this.workspaceRoot, candidate);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("Path is outside the active workspace");
    if (!mustExist) {
      const parent = await realpath(dirname(candidate));
      const parentRelative = relative(this.workspaceRoot, parent);
      if (parentRelative.startsWith("..") || isAbsolute(parentRelative)) throw new Error("Parent path is outside the active workspace");
      try {
        const existing = await realpath(candidate);
        const existingRelative = relative(this.workspaceRoot, existing);
        if (existingRelative.startsWith("..") || isAbsolute(existingRelative)) throw new Error("Existing path resolves outside the active workspace");
        return existing;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return candidate;
      }
    }
    const resolved = await realpath(candidate);
    const realRelative = relative(this.workspaceRoot, resolved);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) throw new Error("Resolved path is outside the active workspace");
    return resolved;
  }
}
