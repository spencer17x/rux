import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  ProviderConnectionRef,
  SessionContentPart,
  SessionEngine,
  SessionListParams,
  SessionListResult,
  SessionMessage,
  SessionMetadata,
  SessionReadParams,
  SessionReadResult,
  SessionResumeCheckParams,
  SessionResumeCheckResult,
} from "../shared/protocol.ts";
import {
  sessionListResultSchema,
  sessionReadResultSchema,
  sessionResumeCheckResultSchema,
} from "../shared/protocol.ts";
import { redactSensitiveText } from "./verification-evidence.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function truncatedText(value: unknown, maximum: number): string | undefined {
  return text(value)?.slice(0, maximum);
}

function isoTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(millis).toISOString();
  }
  const raw = text(value);
  if (!raw) return undefined;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function serialized(value: unknown, maximum = 262_144): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length <= maximum ? raw : `${raw.slice(0, maximum - 1)}…`;
}

function checkedSize<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RESPONSE_BYTES) {
    throw new SessionConnectorError("SESSION_RESPONSE_TOO_LARGE", "Session response exceeded the 2 MiB limit");
  }
  return value;
}

export class SessionConnectorError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(redactSensitiveText(message, 2_000).text || "Session Connector failed");
    this.code = code;
    this.name = "SessionConnectorError";
  }
}

export interface SessionConnector {
  readonly engine: SessionEngine;
  list(params: SessionListParams, signal: AbortSignal): Promise<SessionListResult>;
  read(params: SessionReadParams, signal: AbortSignal): Promise<SessionReadResult>;
  readAll?(params: SessionReadParams, signal: AbortSignal, maxMessages: number): Promise<SessionReadResult>;
  checkResume(params: SessionResumeCheckParams, signal: AbortSignal): Promise<SessionResumeCheckResult>;
}

export interface CodexThreadSource {
  listThreads(cursor: string | null | undefined, limit: number, signal?: AbortSignal): Promise<unknown>;
  readThread(threadId: string, signal?: AbortSignal): Promise<unknown>;
}

function codexMetadata(value: unknown, connection: ProviderConnectionRef): SessionMetadata {
  const thread = record(value) ?? {};
  const nativeSessionId = text(thread.id);
  if (!nativeSessionId) throw new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Codex Thread omitted id");
  const turns = Array.isArray(thread.turns) ? thread.turns : undefined;
  return {
    engine: "codex",
    providerConnectionId: connection.id,
    nativeSessionId,
    ...(text(thread.name) || text(thread.title) || text(thread.preview)
      ? { title: truncatedText(text(thread.name) ?? text(thread.title) ?? text(thread.preview), 500) }
      : {}),
    ...(text(thread.cwd) ? { cwd: text(thread.cwd) } : {}),
    ...(text(thread.model) ? { model: text(thread.model) } : {}),
    ...(isoTime(thread.createdAt) ? { createdAt: isoTime(thread.createdAt) } : {}),
    ...(isoTime(thread.updatedAt) ? { updatedAt: isoTime(thread.updatedAt) } : {}),
    ...(turns ? { messageCount: turns.length * 2 } : {}),
    resumeStatus: "available",
  };
}

function contentParts(value: unknown): SessionContentPart[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry): SessionContentPart[] => {
    if (typeof entry === "string") return [{ type: "text", text: entry.slice(0, 262_144) }];
    const part = record(entry);
    if (!part) return [];
    const kind = text(part.type) ?? "unknown";
    const plain = text(part.text) ?? text(part.content);
    if (plain !== undefined) return [{ type: "text", text: plain.slice(0, 262_144) }];
    if (["tool_call", "tool-call", "function_call"].includes(kind)) {
      return [{
        type: "tool-call",
        name: text(part.name) ?? "tool",
        ...(text(part.id) ? { callId: text(part.id) } : {}),
        ...(serialized(part.input ?? part.arguments) ? { input: serialized(part.input ?? part.arguments) } : {}),
      }];
    }
    if (["tool_result", "tool-result", "function_call_output"].includes(kind)) {
      return [{
        type: "tool-result",
        ...(text(part.tool_use_id) || text(part.callId) ? { callId: text(part.tool_use_id) ?? text(part.callId) } : {}),
        ...(serialized(part.output ?? part.content) ? { output: serialized(part.output ?? part.content) } : {}),
        ...(typeof part.is_error === "boolean" ? { isError: part.is_error } : {}),
      }];
    }
    return [{ type: "unsupported", providerType: kind.slice(0, 240) }];
  });
}

function codexMessages(threadValue: unknown): SessionMessage[] {
  const thread = record(threadValue) ?? {};
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages: SessionMessage[] = [];
  for (const [turnIndex, rawTurn] of turns.entries()) {
    const turn = record(rawTurn) ?? {};
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const [itemIndex, rawItem] of items.entries()) {
      const item = record(rawItem) ?? {};
      const kind = text(item.type) ?? "unknown";
      const role = kind === "userMessage" || kind === "user_message"
        ? "user"
        : kind === "agentMessage" || kind === "assistant_message"
          ? "assistant"
          : "tool";
      const content = contentParts(item.content ?? item.text ?? item);
      messages.push({
        id: text(item.id) ?? `codex-${turnIndex}-${itemIndex}`,
        role,
        ...(isoTime(item.createdAt) ? { createdAt: isoTime(item.createdAt) } : {}),
        content,
      });
    }
  }
  return messages;
}

export class CodexSessionConnector implements SessionConnector {
  readonly engine = "codex" as const;
  private readonly source: CodexThreadSource;
  constructor(source: CodexThreadSource) { this.source = source; }

  async list(params: SessionListParams, signal: AbortSignal): Promise<SessionListResult> {
    const raw = record(await this.source.listThreads(params.cursor, params.limit ?? 50, signal));
    if (!raw || !Array.isArray(raw.data)) {
      throw new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Codex thread/list returned invalid data");
    }
    return checkedSize(sessionListResultSchema.parse({
      engine: this.engine,
      sessions: raw.data.map((item) => codexMetadata(item, params.providerConnection)),
      ...(Object.hasOwn(raw, "nextCursor") ? { nextCursor: raw.nextCursor } : {}),
    }));
  }

  async read(params: SessionReadParams, signal: AbortSignal): Promise<SessionReadResult> {
    const raw = record(await this.source.readThread(params.nativeSessionId, signal));
    const thread = raw && record(raw.thread) ? raw.thread : raw;
    if (!thread) throw new SessionConnectorError("SESSION_NOT_FOUND", "Codex Thread was not found");
    const allMessages = codexMessages(thread);
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new SessionConnectorError("SESSION_INVALID_CURSOR", "Session cursor is invalid");
    }
    const limit = params.limit ?? 50;
    const messages = allMessages.slice(offset, offset + limit);
    const nextOffset = offset + messages.length;
    return checkedSize(sessionReadResultSchema.parse({
      metadata: codexMetadata(thread, params.providerConnection),
      messages,
      ...(nextOffset < allMessages.length ? { nextCursor: String(nextOffset) } : {}),
      truncated: nextOffset < allMessages.length,
    }));
  }

  async readAll(params: SessionReadParams, signal: AbortSignal, maxMessages: number): Promise<SessionReadResult> {
    const raw = record(await this.source.readThread(params.nativeSessionId, signal));
    const thread = raw && record(raw.thread) ? raw.thread : raw;
    if (!thread) throw new SessionConnectorError("SESSION_NOT_FOUND", "Codex Thread was not found");
    const allMessages = codexMessages(thread);
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new SessionConnectorError("SESSION_INVALID_CURSOR", "Session cursor is invalid");
    }
    const messages = allMessages.slice(offset, offset + maxMessages);
    const nextOffset = offset + messages.length;
    return {
      metadata: codexMetadata(thread, params.providerConnection),
      messages,
      ...(nextOffset < allMessages.length ? { nextCursor: String(nextOffset) } : {}),
      truncated: nextOffset < allMessages.length,
    };
  }

  async checkResume(params: SessionResumeCheckParams, signal: AbortSignal): Promise<SessionResumeCheckResult> {
    try {
      await this.source.readThread(params.nativeSessionId, signal);
      return sessionResumeCheckResultSchema.parse({
        engine: this.engine,
        providerConnectionId: params.providerConnection.id,
        nativeSessionId: params.nativeSessionId,
        status: "available",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      return sessionResumeCheckResultSchema.parse({
        engine: this.engine,
        providerConnectionId: params.providerConnection.id,
        nativeSessionId: params.nativeSessionId,
        status: "unavailable",
        reason: redactSensitiveText(error instanceof Error ? error.message : String(error), 2_000).text,
      });
    }
  }
}

export interface ClaudeSessionSdkBridge {
  invoke(request: RecordValue, signal: AbortSignal): Promise<unknown>;
}

const CLAUDE_SESSION_BRIDGE = String.raw`
import dataclasses, json, sys
try:
    from claude_agent_sdk import list_sessions, get_session_info, get_session_messages
except Exception:
    print(json.dumps({"error":{"code":"SESSION_CAPABILITY_UNAVAILABLE","message":"Claude Agent SDK session APIs are unavailable"}}))
    raise SystemExit(0)
def plain(value):
    if dataclasses.is_dataclass(value): return {k: plain(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, dict): return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [plain(v) for v in value]
    if hasattr(value, "value"): return plain(value.value)
    if hasattr(value, "__dict__"): return {k: plain(v) for k, v in vars(value).items() if not k.startswith("_")}
    return value
req=json.loads(sys.stdin.read())
action=req["action"]
if action == "list": result=list_sessions(directory=req["directory"], limit=req["limit"], offset=req["offset"])
elif action == "read": result=get_session_messages(req["sessionId"], directory=req["directory"], limit=req["limit"], offset=req["offset"])
elif action == "info": result=get_session_info(req["sessionId"], directory=req["directory"])
else: raise ValueError("Unsupported Claude session bridge action")
print(json.dumps({"result":plain(result)}, separators=(",",":")))
`;

export class PythonClaudeSessionSdkBridge implements ClaudeSessionSdkBridge {
  private readonly pythonExecutable: string;
  private readonly timeoutMs: number;
  constructor(
    pythonExecutable = process.env.RUX_PYTHON_PATH ?? "python3",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.pythonExecutable = pythonExecutable;
    this.timeoutMs = timeoutMs;
  }

  invoke(request: RecordValue, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolvePromise, rejectPromise) => {
      if (signal.aborted) return rejectPromise(new SessionConnectorError("SESSION_CANCELLED", "Session request was cancelled"));
      const child = spawn(this.pythonExecutable, ["-c", CLAUDE_SESSION_BRIDGE], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        callback();
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(() => rejectPromise(new SessionConnectorError("SESSION_CANCELLED", "Session request was cancelled")));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => rejectPromise(new SessionConnectorError("SESSION_TIMEOUT", "Claude session request timed out")));
      }, this.timeoutMs);
      timer.unref();
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout) > MAX_RESPONSE_BYTES) {
          child.kill("SIGKILL");
          finish(() => rejectPromise(new SessionConnectorError("SESSION_RESPONSE_TOO_LARGE", "Claude session response exceeded the 2 MiB limit")));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); });
      child.on("error", (error) => finish(() => rejectPromise(new SessionConnectorError("SESSION_CAPABILITY_UNAVAILABLE", error.message))));
      child.on("close", (code) => finish(() => {
        if (code !== 0) return rejectPromise(new SessionConnectorError("SESSION_PROVIDER_FAILED", stderr || `Claude session bridge exited with ${code}`));
        try {
          const envelope = record(JSON.parse(stdout));
          const bridgeError = envelope && record(envelope.error);
          if (bridgeError) {
            return rejectPromise(new SessionConnectorError(text(bridgeError.code) ?? "SESSION_PROVIDER_FAILED", text(bridgeError.message) ?? "Claude session bridge failed"));
          }
          resolvePromise(envelope?.result);
        } catch {
          rejectPromise(new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Claude Agent SDK returned invalid JSON"));
        }
      }));
      child.stdin.end(JSON.stringify(request));
    });
  }
}

function claudeMetadata(value: unknown, connection: ProviderConnectionRef): SessionMetadata {
  const info = record(value) ?? {};
  const nativeSessionId = text(info.session_id) ?? text(info.sessionId) ?? text(info.id);
  if (!nativeSessionId) throw new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Claude Session omitted session_id");
  const createdAt = isoTime(info.created_at ?? info.createdAt);
  const updatedAt = isoTime(info.modified_at ?? info.updated_at ?? info.updatedAt);
  const summary = truncatedText(info.summary, 4_000);
  const firstPrompt = truncatedText(info.first_prompt ?? info.firstPrompt, 4_000);
  return {
    engine: "claude-code",
    providerConnectionId: connection.id,
    nativeSessionId,
    ...(summary ? { title: summary.slice(0, 500), summary } : {}),
    ...(firstPrompt ? { summary: firstPrompt } : {}),
    ...(text(info.cwd) || text(info.directory) ? { cwd: text(info.cwd) ?? text(info.directory) } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    resumeStatus: "available",
  };
}

function claudeMessage(value: unknown, index: number): SessionMessage {
  const entry = record(value) ?? {};
  const message = record(entry.message) ?? entry;
  const rawRole = text(entry.type) ?? text(message.role) ?? "system";
  const role = rawRole === "user" || rawRole === "assistant" ? rawRole : rawRole.includes("tool") ? "tool" : "system";
  return {
    id: text(entry.uuid) ?? text(entry.id) ?? `claude-${index}-${randomUUID()}`,
    role,
    ...(isoTime(entry.timestamp ?? entry.created_at) ? { createdAt: isoTime(entry.timestamp ?? entry.created_at) } : {}),
    content: contentParts(message.content),
  };
}

function offset(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new SessionConnectorError("SESSION_INVALID_CURSOR", "Session cursor is invalid");
  return parsed;
}

export class ClaudeSessionConnector implements SessionConnector {
  readonly engine = "claude-code" as const;
  private readonly workspaceRoot: string;
  private readonly bridge: ClaudeSessionSdkBridge;
  constructor(workspaceRoot: string, bridge: ClaudeSessionSdkBridge = new PythonClaudeSessionSdkBridge()) {
    this.workspaceRoot = workspaceRoot;
    this.bridge = bridge;
  }

  async list(params: SessionListParams, signal: AbortSignal): Promise<SessionListResult> {
    const start = offset(params.cursor);
    const limit = params.limit ?? 50;
    const raw = await this.bridge.invoke({ action: "list", directory: this.workspaceRoot, limit, offset: start }, signal);
    if (!Array.isArray(raw)) throw new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Claude Agent SDK list_sessions returned invalid data");
    return checkedSize(sessionListResultSchema.parse({
      engine: this.engine,
      sessions: raw.map((item) => claudeMetadata(item, params.providerConnection)),
      ...(raw.length === limit ? { nextCursor: String(start + raw.length) } : {}),
    }));
  }

  async read(params: SessionReadParams, signal: AbortSignal): Promise<SessionReadResult> {
    const start = offset(params.cursor);
    const limit = params.limit ?? 50;
    const [info, rawMessages] = await Promise.all([
      this.bridge.invoke({ action: "info", directory: this.workspaceRoot, sessionId: params.nativeSessionId }, signal),
      this.bridge.invoke({ action: "read", directory: this.workspaceRoot, sessionId: params.nativeSessionId, limit, offset: start }, signal),
    ]);
    if (!Array.isArray(rawMessages)) throw new SessionConnectorError("SESSION_INVALID_PROVIDER_RESPONSE", "Claude Agent SDK get_session_messages returned invalid data");
    return checkedSize(sessionReadResultSchema.parse({
      metadata: claudeMetadata(info, params.providerConnection),
      messages: rawMessages.map(claudeMessage),
      ...(rawMessages.length === limit ? { nextCursor: String(start + rawMessages.length) } : {}),
      truncated: rawMessages.length === limit,
    }));
  }

  async checkResume(params: SessionResumeCheckParams, signal: AbortSignal): Promise<SessionResumeCheckResult> {
    try {
      const info = await this.bridge.invoke({ action: "info", directory: this.workspaceRoot, sessionId: params.nativeSessionId }, signal);
      return sessionResumeCheckResultSchema.parse({
        engine: this.engine,
        providerConnectionId: params.providerConnection.id,
        nativeSessionId: claudeMetadata(info, params.providerConnection).nativeSessionId,
        status: "available",
      });
    } catch (error) {
      if (signal.aborted || error instanceof SessionConnectorError && error.code === "SESSION_CAPABILITY_UNAVAILABLE") throw error;
      return sessionResumeCheckResultSchema.parse({
        engine: this.engine,
        providerConnectionId: params.providerConnection.id,
        nativeSessionId: params.nativeSessionId,
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class SessionConnectorService {
  private readonly operations = new Map<string, AbortController>();
  private readonly connectors: Map<SessionEngine, SessionConnector>;
  private readonly timeoutMs: number;

  constructor(connectors: SessionConnector[], timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.connectors = new Map(connectors.map((connector) => [connector.engine, connector]));
    this.timeoutMs = timeoutMs;
  }

  list(params: SessionListParams): Promise<SessionListResult> {
    return this.execute(params.operationId, params.engine, (connector, signal) => connector.list(params, signal));
  }

  read(params: SessionReadParams): Promise<SessionReadResult> {
    return this.execute(params.operationId, params.engine, (connector, signal) => connector.read(params, signal));
  }

  readAll(params: SessionReadParams, maxMessages = 20_000): Promise<SessionReadResult> {
    return this.execute(params.operationId, params.engine, async (connector, signal) => {
      if (connector.readAll) {
        const result = await connector.readAll(params, signal, maxMessages);
        if (Buffer.byteLength(JSON.stringify(result.messages), "utf8") > MAX_PREVIEW_BYTES) {
          throw new SessionConnectorError("SESSION_RESPONSE_TOO_LARGE", "Session preview exceeded the 8 MiB limit");
        }
        return result;
      }
      const messages: SessionMessage[] = [];
      let cursor = params.cursor;
      let metadata: SessionMetadata | undefined;
      let truncated = false;
      for (let pageIndex = 0; pageIndex < 200; pageIndex += 1) {
        const page = await connector.read({ ...params, cursor, limit: 100 }, signal);
        metadata = page.metadata;
        messages.push(...page.messages);
        cursor = page.nextCursor;
        truncated = page.truncated;
        if (Buffer.byteLength(JSON.stringify(messages), "utf8") > MAX_PREVIEW_BYTES) {
          throw new SessionConnectorError("SESSION_RESPONSE_TOO_LARGE", "Session preview exceeded the 8 MiB limit");
        }
        if (!cursor || !truncated || messages.length >= maxMessages) break;
      }
      if (!metadata) throw new SessionConnectorError("SESSION_NOT_FOUND", "Session was not found");
      return {
        metadata,
        messages: messages.slice(0, maxMessages),
        ...(cursor && truncated ? { nextCursor: cursor } : {}),
        truncated: Boolean(cursor && truncated),
      };
    });
  }

  checkResume(params: SessionResumeCheckParams): Promise<SessionResumeCheckResult> {
    return this.execute(params.operationId, params.engine, (connector, signal) => connector.checkResume(params, signal));
  }

  cancel(operationId: string): void {
    this.operations.get(operationId)?.abort("cancelled");
  }

  dispose(): void {
    for (const controller of this.operations.values()) controller.abort();
    this.operations.clear();
  }

  private async execute<T>(operationId: string, engine: SessionEngine, operation: (connector: SessionConnector, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.operations.has(operationId)) throw new SessionConnectorError("SESSION_OPERATION_CONFLICT", "Session operation id is already active");
    const connector = this.connectors.get(engine);
    if (!connector) throw new SessionConnectorError("SESSION_CAPABILITY_UNAVAILABLE", `Session Connector is unavailable for ${engine}`);
    const controller = new AbortController();
    this.operations.set(operationId, controller);
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    timer.unref();
    try {
      return await operation(connector, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "timeout";
        throw new SessionConnectorError(
          timedOut ? "SESSION_TIMEOUT" : "SESSION_CANCELLED",
          timedOut ? "Session request timed out" : "Session request was cancelled",
        );
      }
      if (error instanceof SessionConnectorError) throw error;
      throw new SessionConnectorError("SESSION_PROVIDER_FAILED", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      this.operations.delete(operationId);
    }
  }
}
