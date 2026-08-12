import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";
import {
  awaitAllCleanup,
  forceKillChildProcessGroup,
  ensureChildProcessGroupTerminated,
} from "./child-process-lifecycle.ts";
import {
  officialCliProviderConnection,
  type AgentBackend,
  type AuthConnectionStatus,
  type AuthMethod,
  type AuthProviderId,
  type AuthProviderInfo,
  type AuthState,
} from "../shared/protocol.ts";

type JsonRecord = Record<string, unknown>;

type ParsedStatus = {
  status: AuthConnectionStatus;
  authMethod?: AuthMethod;
  detail: string;
};

type CliDefinition = {
  id: AuthProviderId;
  name: string;
  cliName: string;
  commandName: string;
  overridePath?: string;
  extraPaths: string[];
  loginArgs: string[];
  statusArgs: string[];
};

const LOGIN_TIMEOUT_MS = 10 * 60_000;

type AuthManagerOptions = {
  loginTimeoutMs?: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(text: string): JsonRecord | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Some CLI versions print a warning before the JSON payload.
    }
  }
  return undefined;
}

function normalizedClaudeMethod(record: JsonRecord): AuthMethod {
  const authMethod = typeof record.authMethod === "string" ? record.authMethod.toLowerCase() : "";
  const apiProvider = typeof record.apiProvider === "string" ? record.apiProvider.toLowerCase() : "";
  if (authMethod.includes("oauth")) return "oauth";
  if (["bedrock", "vertex", "foundry"].some((provider) => apiProvider.includes(provider))) return "cloud";
  if (authMethod.includes("api") || authMethod.includes("key")) return "api-key";
  return "unknown";
}

export function parseClaudeAuthStatus(output: string, exitCode: number | null): ParsedStatus {
  const record = jsonRecord(output);
  if (record?.loggedIn === true) {
    return {
      status: "connected",
      authMethod: normalizedClaudeMethod(record),
      detail: "Claude Code 已通过官方 CLI 连接",
    };
  }
  if (record?.loggedIn === false || exitCode === 1) {
    return { status: "signed-out", detail: "Claude Code CLI 已安装但尚未连接" };
  }
  return { status: "error", detail: "无法读取 Claude Code 登录状态" };
}

export function parseCodexAuthStatus(output: string, exitCode: number | null): ParsedStatus {
  const normalized = output.trim().toLowerCase();
  if (exitCode === 0) {
    const authMethod: AuthMethod = normalized.includes("chatgpt")
      ? "chatgpt"
      : normalized.includes("api key") || normalized.includes("access token")
        ? "api-key"
        : "unknown";
    return {
      status: "connected",
      authMethod,
      detail: authMethod === "chatgpt"
        ? "Rux 已通过 ChatGPT 连接"
        : authMethod === "api-key"
          ? "Rux 已通过官方 CLI 的 API Key 配置连接"
          : "Rux 已通过官方 CLI 连接",
    };
  }
  if (normalized.includes("not logged") || normalized.includes("not signed") || exitCode === 1) {
    return { status: "signed-out", detail: "Rux 尚未连接" };
  }
  return { status: "error", detail: "无法读取 Rux 连接状态" };
}

function definitions(): CliDefinition[] {
  const home = homedir();
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      cliName: "claude",
      commandName: process.platform === "win32" ? "claude.exe" : "claude",
      overridePath: process.env.CLAUDE_CODE_PATH,
      extraPaths: [
        resolve(home, ".local/bin/claude"),
        resolve(home, ".claude/local/claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
      ],
      loginArgs: ["auth", "login"],
      statusArgs: ["auth", "status", "--json"],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      cliName: "codex",
      commandName: process.platform === "win32" ? "codex.exe" : "codex",
      overridePath: process.env.CODEX_CLI_PATH,
      extraPaths: [
        resolve(home, ".local/bin/codex"),
        resolve(home, ".cargo/bin/codex"),
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
      ],
      loginArgs: ["login"],
      statusArgs: ["login", "status"],
    },
  ];
}

function executableCandidates(definition: CliDefinition): string[] {
  if (definition.overridePath) return [definition.overridePath];
  const fromPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => resolve(directory, definition.commandName));
  return [...fromPath, ...definition.extraPaths];
}

function findExecutable(definition: CliDefinition): string | undefined {
  const seen = new Set<string>();
  for (const candidate of executableCandidates(definition)) {
    if (seen.has(candidate) || !existsSync(candidate)) continue;
    seen.add(candidate);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  delete environment.CLAUDECODE;
  return environment;
}

function readVersion(executable: string, provider: AuthProviderId): string | undefined {
  try {
    const result = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      env: commandEnvironment(),
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    if (result.status !== 0) return undefined;
    const line = result.stdout.trim().split(/\r?\n/, 1)[0];
    if (!line) return undefined;
    const normalized = provider === "claude-code"
      ? line.replace(/\s*\(Claude Code\)\s*$/, "")
      : line.replace(/^codex-cli\s+/i, "");
    // Renderer receives a version, never arbitrary CLI stdout.
    return normalized.match(/\b\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?\b/i)?.[0];
  } catch {
    return undefined;
  }
}

function inspectProvider(definition: CliDefinition): AuthProviderInfo {
  const providerConnection = officialCliProviderConnection(
    (definition.id === "chatgpt" ? "codex" : "claude-code") satisfies AgentBackend,
  );
  const executable = findExecutable(definition);
  if (!executable) {
    return {
      id: definition.id,
      name: definition.name,
      cliName: definition.cliName,
      status: "not-installed",
      installed: false,
      canLogin: false,
      providerConnection,
      detail: `未找到 ${definition.cliName} CLI`,
    };
  }

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(executable, definition.statusArgs, {
      encoding: "utf8",
      env: commandEnvironment(),
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
  } catch {
    result = { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  }

  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
  const parsed = definition.id === "claude-code"
    ? parseClaudeAuthStatus(output, result.status)
    : parseCodexAuthStatus(output, result.status);

  return {
    id: definition.id,
    name: definition.name,
    cliName: definition.cliName,
    status: parsed.status,
    installed: true,
    canLogin: true,
    providerConnection,
    authMethod: parsed.authMethod,
    version: readVersion(executable, definition.id),
    executable,
    detail: parsed.detail,
  };
}

export class AuthManager {
  private readonly activeLogins = new Map<AuthProviderId, ChildProcess>();
  private readonly cancelledLogins = new Set<AuthProviderId>();
  private readonly workspaceRoot: string;
  private readonly loginTimeoutMs: number;
  private disposed = false;

  constructor(workspaceRoot: string, options: AuthManagerOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
  }

  status(): AuthState {
    return {
      providers: definitions().map(inspectProvider),
      checkedAt: new Date().toISOString(),
    };
  }

  async login(providerId: AuthProviderId): Promise<AuthState> {
    if (this.disposed) throw new Error("Rux authentication manager is stopped");
    if (this.activeLogins.has(providerId)) {
      throw new Error("该账户的授权流程已在进行中");
    }

    const definition = definitions().find((item) => item.id === providerId);
    if (!definition) throw new Error("不支持的登录服务");
    const loginDisplayName = definition.id === "chatgpt" ? "Rux" : definition.cliName;
    const executable = findExecutable(definition);
    if (!executable) throw new Error(`未找到 ${loginDisplayName} 本机组件，无法开始授权`);
    this.cancelledLogins.delete(providerId);

    await new Promise<void>((resolveLogin, rejectLogin) => {
      const child = spawn(executable, definition.loginArgs, {
        cwd: this.workspaceRoot,
        env: commandEnvironment(),
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      this.activeLogins.set(providerId, child);

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void ensureChildProcessGroupTerminated(child).then(() => {
          rejectLogin(new Error(`${loginDisplayName} 登录等待超时；本次官方 CLI 登录已停止`));
        });
      }, this.loginTimeoutMs);

      const finish = (): void => {
        clearTimeout(timeout);
        if (this.activeLogins.get(providerId) === child) this.activeLogins.delete(providerId);
      };

      child.once("error", (error) => {
        finish();
        if (timedOut) return;
        rejectLogin(new Error(`无法启动 ${loginDisplayName} 本机组件：${error.message}`));
      });
      child.once("close", (code, signal) => {
        finish();
        if (timedOut) return;
        if (this.cancelledLogins.delete(providerId)) {
          rejectLogin(new Error(`${loginDisplayName} 登录已取消`));
          return;
        }
        if (code === 0) resolveLogin();
        else {
          const termination = code === null && signal ? `信号 ${signal}` : `退出码 ${code ?? "unknown"}`;
          rejectLogin(new Error(`${loginDisplayName} 登录未完成（官方 CLI ${termination}）`));
        }
      });
    });

    // The explicitly launched official CLI is the authority for this action.
    // Do not inspect a different Engine or emit a second status command after a
    // successful login; the user can explicitly run detection again if desired.
    const engine = providerId === "chatgpt" ? "codex" : "claude-code";
    return {
      providers: [{
        id: definition.id,
        name: definition.name,
        cliName: definition.cliName,
        status: "connected",
        installed: true,
        canLogin: true,
        authMethod: providerId === "chatgpt" ? "chatgpt" : "oauth",
        executable,
        providerConnection: officialCliProviderConnection(engine),
        detail: providerId === "chatgpt"
          ? "已通过官方 codex CLI 完成 ChatGPT 登录"
          : "已通过官方 Claude Code CLI 完成登录",
      }],
      checkedAt: new Date().toISOString(),
    };
  }

  async cancel(providerId: AuthProviderId): Promise<void> {
    const child = this.activeLogins.get(providerId);
    if (!child) return;
    this.cancelledLogins.add(providerId);
    await ensureChildProcessGroupTerminated(child);
    if (this.activeLogins.get(providerId) === child) this.activeLogins.delete(providerId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await awaitAllCleanup(
      [...this.activeLogins.values()].map((child) => ensureChildProcessGroupTerminated(child)),
      "OAuth",
    );
    this.activeLogins.clear();
    this.cancelledLogins.clear();
  }

  forceDispose(): void {
    this.disposed = true;
    for (const child of this.activeLogins.values()) forceKillChildProcessGroup(child);
    this.activeLogins.clear();
    this.cancelledLogins.clear();
  }
}
