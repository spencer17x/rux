import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";
import { normalizeCodexJsonLine, type CodexNormalizedEvent } from "./codex-event-parser.ts";
import {
  awaitAllCleanup,
  forceKillChildProcessGroup,
  ensureChildProcessGroupTerminated,
} from "./child-process-lifecycle.ts";
import { redactSensitiveText } from "./verification-evidence.ts";

export type CodexPermissionMode = "plan" | "acceptEdits" | "dontAsk";

export type CodexAdapterEvent = CodexNormalizedEvent
  | {
      type: "run.started";
      runId: string;
      adapter: "codex";
      prompt: string;
      permissionMode?: CodexPermissionMode;
      model?: string;
      profileId?: string;
      agentRevisionId?: string;
    }
  | { type: "run.cancelled"; runId: string };

export type CodexStartParams = {
  runId: string;
  prompt: string;
  model?: string;
  permissionMode: CodexPermissionMode;
  sessionId?: string;
  profileId?: string;
  agentRevisionId?: string;
};

export type CodexAdapterInfo = {
  id: "codex";
  name: "Codex";
  available: boolean;
  version?: string;
  executable?: string;
  detail: string;
};

type RunRecord = {
  child: ChildProcess;
  cancelled: boolean;
  emittedTerminalEvent: boolean;
  stdoutBuffer: string;
  stderrBuffer: string;
  termination?: Promise<void>;
};

type CodexAdapterOptions = {
  executable?: string;
};

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

function inspectCodex(override?: string): CodexAdapterInfo {
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
          id: "codex",
          name: "Codex",
          available: true,
          version: result.stdout.trim().replace(/^codex-cli\s+/i, ""),
          executable: candidate,
          detail: "Codex local exec adapter",
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return {
    id: "codex",
    name: "Codex",
    available: false,
    detail: "未找到可用的 Codex 本机组件。",
  };
}

export function codexPolicy(permissionMode: CodexPermissionMode): {
  sandbox: "read-only" | "workspace-write";
  approvalPolicy: "never";
} {
  // `codex exec` has no bidirectional approval channel. RUX blocks
  // acceptEdits Runs at its own Workspace-scoped preflight before spawning;
  // the non-interactive child must therefore never wait for an invisible TTY
  // prompt. Provider-native per-command approvals require codex app-server.
  if (permissionMode === "plan") return { sandbox: "read-only", approvalPolicy: "never" };
  return { sandbox: "workspace-write", approvalPolicy: "never" };
}

export class CodexAdapter {
  private readonly runs = new Map<string, RunRecord>();
  private readonly workspaceRoot: string;
  private readonly emit: (event: CodexAdapterEvent) => void;
  private readonly executableOverride?: string;
  private adapterInfo: CodexAdapterInfo | undefined;
  private disposed = false;

  constructor(
    workspaceRoot: string,
    emit: (event: CodexAdapterEvent) => void,
    options: CodexAdapterOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot;
    this.emit = emit;
    this.executableOverride = options.executable;
  }

  info(refresh = false): CodexAdapterInfo {
    if (refresh) this.adapterInfo = undefined;
    this.adapterInfo ??= inspectCodex(this.executableOverride);
    return this.adapterInfo;
  }

  start(params: CodexStartParams): { runId: string; adapter: "codex" } {
    if (this.disposed) throw new Error("Rux adapter is disposed");
    if (this.runs.has(params.runId)) throw new Error("Run ID is already active");
    const adapter = this.info();
    if (!adapter.available || !adapter.executable) {
      throw new Error(adapter.detail);
    }

    const policy = codexPolicy(params.permissionMode);
    const args = [
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      policy.sandbox,
      "--cd",
      this.workspaceRoot,
      "--config",
      `approval_policy=\"${policy.approvalPolicy}\"`,
    ];
    if (params.model) args.push("--model", params.model);
    if (params.sessionId) args.push("resume", params.sessionId, "-");
    else args.push("-");

    const child = spawn(adapter.executable, args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const record: RunRecord = {
      child,
      cancelled: false,
      emittedTerminalEvent: false,
      stdoutBuffer: "",
      stderrBuffer: "",
    };
    this.runs.set(params.runId, record);
    this.emit({
      type: "run.started",
      runId: params.runId,
      adapter: "codex",
      prompt: params.prompt,
      permissionMode: params.permissionMode,
      model: params.model,
      profileId: params.profileId,
      agentRevisionId: params.agentRevisionId,
    });
    child.stdin?.end(params.prompt);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consumeStdout(params.runId, record, chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      record.stderrBuffer = `${record.stderrBuffer}${chunk}`.slice(-16_000);
    });
    child.on("error", (error) => {
      if (record.cancelled || record.emittedTerminalEvent) return;
      record.emittedTerminalEvent = true;
      this.emit({ type: "run.failed", runId: params.runId, error: error.message });
    });
    child.on("close", (code, signal) => {
      this.flushStdout(params.runId, record);
      this.runs.delete(params.runId);
      if (record.cancelled) {
        if (!record.emittedTerminalEvent) {
          record.emittedTerminalEvent = true;
          this.emit({ type: "run.cancelled", runId: params.runId });
        }
        return;
      }
      if (record.emittedTerminalEvent) return;
      record.emittedTerminalEvent = true;
      const stderr = redactSensitiveText(record.stderrBuffer.trim(), 16_000).text;
      const suffix = stderr ? `: ${stderr}` : "";
      if (code === 0) {
        // Older CLI versions may exit cleanly without a turn.completed record.
        this.emit({ type: "run.completed", runId: params.runId });
      } else {
        this.emit({
          type: "run.failed",
          runId: params.runId,
          error: `Rux exited with ${code ?? signal ?? "an unknown status"}${suffix}`,
        });
      }
    });

    return { runId: params.runId, adapter: "codex" };
  }

  cancel(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return Promise.resolve();
    record.cancelled = true;
    record.termination ??= ensureChildProcessGroupTerminated(record.child);
    return record.termination;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await awaitAllCleanup([...this.runs.keys()].map((runId) => this.cancel(runId)), "Rux");
  }

  forceDispose(): void {
    this.disposed = true;
    for (const record of this.runs.values()) {
      record.cancelled = true;
      forceKillChildProcessGroup(record.child);
    }
  }

  private consumeStdout(runId: string, record: RunRecord, chunk: string): void {
    record.stdoutBuffer += chunk;
    let newline = record.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = record.stdoutBuffer.slice(0, newline).trim();
      record.stdoutBuffer = record.stdoutBuffer.slice(newline + 1);
      if (line) this.handleLine(runId, record, line);
      newline = record.stdoutBuffer.indexOf("\n");
    }
  }

  private flushStdout(runId: string, record: RunRecord): void {
    const line = record.stdoutBuffer.trim();
    record.stdoutBuffer = "";
    if (line) this.handleLine(runId, record, line);
  }

  private handleLine(runId: string, record: RunRecord, line: string): void {
    for (const event of normalizeCodexJsonLine(runId, line, { cwd: this.workspaceRoot })) {
      if (["run.completed", "run.failed"].includes(event.type)) record.emittedTerminalEvent = true;
      this.emit(event);
    }
  }
}
