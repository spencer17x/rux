import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type {
  AgentAdapterInfo,
  NativeProviderConnectionTestResult,
  NativeProviderRuntimeCredential,
  RunActivity,
  RunStartParams,
  RuntimeEvent,
} from "../shared/protocol.ts";
import { redactSensitiveText } from "./verification-evidence.ts";
import { secretContentReason, sensitivePathReason } from "./context-snapshot.ts";

const MAX_TOOL_TURNS = 24;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT_CHARS = 80_000;

type JsonRecord = Record<string, unknown>;
type ResponseOutput = JsonRecord & { type?: string; id?: string; call_id?: string; name?: string; arguments?: string; content?: unknown[] };

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

function usageFromResponse(response: JsonRecord) {
  const usage = isRecord(response.usage) ? response.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    cachedInputTokens: typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    reasoningOutputTokens: typeof outputDetails.reasoning_tokens === "number" ? outputDetails.reasoning_tokens : 0,
  };
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

  async test(id: string): Promise<NativeProviderConnectionTestResult> {
    const connection = this.requireConnection(id);
    const testedAt = new Date().toISOString();
    try {
      const response = await fetch(endpoint(connection.baseUrl, "models"), {
        headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      return { id, ok: true, testedAt, detail: "连接成功；Provider 可访问。" };
    } catch (error) {
      return { id, ok: false, testedAt, detail: safeError(error) };
    }
  }

  start(params: RunStartParams): { runId: string; adapter: "rux-native" } {
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

  private async execute(params: RunStartParams, connection: NativeProviderRuntimeCredential, controller: AbortController): Promise<void> {
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
          tools: this.tools(params.permissionMode),
          parallel_tool_calls: false,
          store: true,
        };
        if (previousResponseId) body.previous_response_id = previousResponseId;
        const response = await fetch(endpoint(connection.baseUrl, "responses"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
        const payload = await response.json() as JsonRecord;
        const responseId = typeof payload.id === "string" ? payload.id : undefined;
        if (responseId) {
          previousResponseId = responseId;
          this.emit({ type: "run.metadata", runId: params.runId, sessionId: responseId, model });
        }
        const usage = usageFromResponse(payload);
        this.emit({ type: "run.usage", runId: params.runId, usage });
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

  private tools(permissionMode: RunStartParams["permissionMode"]): JsonRecord[] {
    const tools: JsonRecord[] = [
      { type: "function", name: "read_file", description: "Read a UTF-8 text file inside the active workspace.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
      { type: "function", name: "list_files", description: "List files in a workspace directory.", strict: true, parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    ];
    if (permissionMode !== "plan") {
      tools.push(
        { type: "function", name: "write_file", description: "Create or replace one UTF-8 file inside the active workspace.", strict: true, parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } },
      );
    }
    return tools;
  }

  private async runTool(params: RunStartParams, callId: string, name: string, args: JsonRecord, signal: AbortSignal): Promise<string> {
    const kind: RunActivity["kind"] = name === "write_file" ? "edit" : "read";
    const activity: RunActivity = { id: callId, kind, title: name, detail: String(args.path ?? args.command ?? "Workspace"), state: "active" };
    this.emit({ type: "activity.started", runId: params.runId, activity });
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
      } else {
        throw new Error(`Unsupported or disallowed tool: ${name}`);
      }
      this.emit({ type: "activity.completed", runId: params.runId, activity: { ...activity, state: "done" } });
      return result.slice(0, MAX_TOOL_OUTPUT_CHARS);
    } catch (error) {
      const message = safeError(error);
      this.emit({ type: "activity.completed", runId: params.runId, activity: { ...activity, detail: message, state: "error" } });
      return `Tool error: ${message}`;
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
