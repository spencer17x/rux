import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type ClaudePermissionRequest = {
  requestId: string;
  runId: string;
  toolName: string;
  input: JsonRecord;
};

export type ClaudePermissionDecision =
  | { behavior: "allow"; updatedInput?: JsonRecord }
  | { behavior: "deny"; message: string };

export type ClaudePermissionHandler = (
  request: ClaudePermissionRequest,
  signal: AbortSignal,
) => Promise<ClaudePermissionDecision> | ClaudePermissionDecision;

export type ClaudePermissionBrokerLaunch = {
  configPath: string;
  toolName: string;
};

type ClaudePermissionBrokerOptions = {
  runId: string;
  onPermissionRequest: ClaudePermissionHandler;
  nodeExecutable?: string;
  timeoutMs?: number;
};

type RelayRequest = {
  secret: string;
  requestId: string;
  toolName: string;
  input: JsonRecord;
};

const MCP_SERVER_NAME = "rux-permission";
const MCP_TOOL_NAME = "request_permission";
const MAX_RELAY_MESSAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1_000;

// Claude launches this generated helper as a stdio MCP server. The helper has
// no access to Renderer state or credentials: it only relays a tool name and
// input to the Runtime-owned local socket, then JSON-stringifies the official
// Claude Code allow/deny payload in the MCP text response.
const MCP_STDIO_SERVER_SOURCE = String.raw`
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";

const endpoint = process.env.RUX_PERMISSION_BROKER_ENDPOINT;
const secret = process.env.RUX_PERMISSION_BROKER_SECRET;
const runId = process.env.RUX_PERMISSION_RUN_ID;
const permissionTimeoutMs = Number(process.env.RUX_PERMISSION_TIMEOUT_MS || 300000);
const toolName = "request_permission";
const maxMessageBytes = 4 * 1024 * 1024;

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function deny(message) {
  return { behavior: "deny", message };
}

function connectOnce() {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    const onError = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      // Keep the process fail-closed during the microtask between connect and
      // installing the request-specific error handler below.
      socket.on("error", () => {});
      resolve(socket);
    });
  });
}

async function connectWithRetry() {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await connectOnce();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError || new Error("Rux permission broker did not start");
}

async function relayPermission(argumentsValue) {
  if (!endpoint || !secret || !runId) {
    return deny("Rux permission broker is not configured");
  }
  const requestedTool = typeof argumentsValue?.tool_name === "string"
    ? argumentsValue.tool_name
    : "unknown";
  const input = argumentsValue?.input && typeof argumentsValue.input === "object" && !Array.isArray(argumentsValue.input)
    ? argumentsValue.input
    : {};
  let socket;
  try {
    socket = await connectWithRetry();
    const requestId = randomUUID();
    socket.write(JSON.stringify({ secret, requestId, toolName: requestedTool, input }) + "\n");
    return await new Promise((resolve) => {
      let settled = false;
      let buffer = "";
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(
        () => finish(deny("Rux permission request timed out")),
        permissionTimeoutMs + 5000,
      );
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > maxMessageBytes) {
          finish(deny("Rux permission response was too large"));
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          const message = JSON.parse(buffer.slice(0, newline));
          const result = message?.result;
          if (result?.behavior === "allow" && result.updatedInput && typeof result.updatedInput === "object") {
            finish({ behavior: "allow", updatedInput: result.updatedInput });
          } else if (result?.behavior === "deny" && typeof result.message === "string") {
            finish({ behavior: "deny", message: result.message });
          } else {
            finish(deny("Rux permission broker returned an invalid decision"));
          }
        } catch {
          finish(deny("Rux permission broker returned invalid JSON"));
        }
      });
      socket.once("error", () => finish(deny("Rux permission broker disconnected")));
      socket.once("close", () => finish(deny("Rux permission broker disconnected")));
    });
  } catch {
    socket?.destroy();
    return deny("Rux permission broker is unavailable");
  }
}

async function handle(message) {
  const id = message?.id;
  const method = message?.method;
  if (method === "initialize") {
    const requestedVersion = typeof message?.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : "2024-11-05";
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "rux-permission-broker", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [{
          name: toolName,
          description: "Ask the Rux host to approve or deny a Claude Code tool call.",
          inputSchema: {
            type: "object",
            properties: {
              tool_name: { type: "string" },
              input: { type: "object", additionalProperties: true },
            },
            required: ["tool_name", "input"],
            additionalProperties: true,
          },
        }],
      },
    });
    return;
  }
  if (method === "tools/call") {
    if (message?.params?.name !== toolName) {
      write({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown permission tool" } });
      return;
    }
    const decision = await relayPermission(message.params.arguments);
    write({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(decision) }] },
    });
    return;
  }
  if (id !== undefined) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const message = JSON.parse(line);
    void handle(message);
  } catch {
    // Invalid notifications do not receive a response.
  }
}
`;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDeny(message: string): ClaudePermissionDecision {
  return { behavior: "deny", message };
}

function normalizeDecision(
  decision: ClaudePermissionDecision,
  originalInput: JsonRecord,
): ClaudePermissionDecision {
  if (decision.behavior === "allow") {
    return {
      behavior: "allow",
      updatedInput: isRecord(decision.updatedInput) ? decision.updatedInput : originalInput,
    };
  }
  const message = typeof decision.message === "string" ? decision.message.trim() : "";
  return safeDeny(message ? message.slice(0, 1_000) : "Permission denied by Rux");
}

export class ClaudePermissionBroker {
  private readonly runId: string;
  private readonly onPermissionRequest: ClaudePermissionHandler;
  private readonly nodeExecutable: string;
  private readonly timeoutMs: number;
  private readonly sockets = new Set<Socket>();
  private readonly pending = new Set<AbortController>();
  private server?: Server;
  private tempDirectory?: string;
  private endpoint?: string;
  private secret?: string;
  private launch?: ClaudePermissionBrokerLaunch;
  private disposed = false;

  constructor(options: ClaudePermissionBrokerOptions) {
    this.runId = options.runId;
    this.onPermissionRequest = options.onPermissionRequest;
    this.nodeExecutable = options.nodeExecutable ?? process.execPath;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS);
  }

  start(): ClaudePermissionBrokerLaunch {
    if (this.disposed) throw new Error("Claude permission broker has been disposed");
    if (this.launch) return this.launch;

    try {
      this.tempDirectory = mkdtempSync(join(tmpdir(), "ruxp-"));
      chmodSync(this.tempDirectory, 0o700);
      this.endpoint = process.platform === "win32"
        ? `\\\\.\\pipe\\rux-permission-${randomUUID()}`
        : join(this.tempDirectory, "broker.sock");
      this.secret = randomBytes(32).toString("hex");

      this.server = createServer((socket) => this.accept(socket));
      this.server.on("error", () => {
        // The MCP helper will fail closed with an unavailable denial if the
        // private endpoint cannot be opened. Keep the Runtime process alive.
      });
      // A unique Runtime-owned Unix socket/named pipe avoids opening a network
      // port. The generated MCP child retries briefly while listen() settles.
      this.server.listen(this.endpoint);

      const serverPath = join(this.tempDirectory, "permission-server.mjs");
      const configPath = join(this.tempDirectory, "mcp.json");
      writeFileSync(serverPath, MCP_STDIO_SERVER_SOURCE, { encoding: "utf8", mode: 0o600 });
      const serverEnvironment: Record<string, string> = {
        RUX_PERMISSION_BROKER_ENDPOINT: this.endpoint,
        RUX_PERMISSION_BROKER_SECRET: this.secret,
        RUX_PERMISSION_RUN_ID: this.runId,
        RUX_PERMISSION_TIMEOUT_MS: String(this.timeoutMs),
      };
      if (process.versions.electron) serverEnvironment.ELECTRON_RUN_AS_NODE = "1";
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "stdio",
            command: this.nodeExecutable,
            args: [serverPath],
            env: serverEnvironment,
          },
        },
      }), { encoding: "utf8", mode: 0o600 });

      this.launch = {
        configPath,
        toolName: `mcp__${MCP_SERVER_NAME}__${MCP_TOOL_NAME}`,
      };
      return this.launch;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.pending) controller.abort("disposed");
    this.pending.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    try {
      this.server?.close();
    } catch {
      // The server may not have reached the listening state yet.
    }
    this.server = undefined;
    if (this.tempDirectory) {
      rmSync(this.tempDirectory, { recursive: true, force: true });
      this.tempDirectory = undefined;
    }
    this.endpoint = undefined;
    this.secret = undefined;
    this.launch = undefined;
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RELAY_MESSAGE_BYTES) {
        handled = true;
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      let request: RelayRequest | undefined;
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as unknown;
        if (
          isRecord(parsed)
          && parsed.secret === this.secret
          && typeof parsed.requestId === "string"
          && parsed.requestId.length > 0
          && typeof parsed.toolName === "string"
          && parsed.toolName.length > 0
          && isRecord(parsed.input)
        ) {
          request = parsed as RelayRequest;
        }
      } catch {
        // Invalid or unauthenticated local relay requests are dropped.
      }
      if (!request) {
        socket.destroy();
        return;
      }
      void this.resolve(request).then((decision) => {
        if (socket.destroyed) return;
        socket.end(JSON.stringify({ requestId: request.requestId, result: decision }) + "\n");
      });
    });
    socket.once("close", () => this.sockets.delete(socket));
    socket.once("error", () => this.sockets.delete(socket));
  }

  private async resolve(request: RelayRequest): Promise<ClaudePermissionDecision> {
    if (this.disposed) return safeDeny("Rux permission broker was stopped");
    const controller = new AbortController();
    this.pending.add(controller);
    const timer = setTimeout(() => controller.abort("timeout"), this.timeoutMs);
    timer.unref();
    const aborted = new Promise<ClaudePermissionDecision>((resolve) => {
      controller.signal.addEventListener("abort", () => {
        resolve(safeDeny(
          controller.signal.reason === "timeout"
            ? "Rux permission request timed out"
            : "Rux permission request was cancelled",
        ));
      }, { once: true });
    });

    try {
      const decision = await Promise.race([
        Promise.resolve(this.onPermissionRequest({
          requestId: request.requestId,
          runId: this.runId,
          toolName: request.toolName,
          input: request.input,
        }, controller.signal)),
        aborted,
      ]);
      return normalizeDecision(decision, request.input);
    } catch {
      return safeDeny("Rux could not resolve this permission request");
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
    }
  }
}
