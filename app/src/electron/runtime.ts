import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import * as pty from "node-pty";
import { AgentProfileStore } from "./agent-profile-store";
import { AuthManager } from "./auth-manager";
import { ClaudeCodeAdapter } from "./claude-adapter";
import { CodexRuntimeAdapter } from "./codex-runtime-adapter";
import { GitChangesService, type GitRunBaseline } from "./git-service";
import { TaskStore } from "./task-store";
import {
  agentListParamsSchema,
  agentModelListParamsSchema,
  agentProfileDeleteParamsSchema,
  agentProfileInputSchema,
  agentProfileUpdateParamsSchema,
  authLoginParamsSchema,
  gitChangeSelectionSchema,
  gitBranchesListResultSchema,
  gitBranchSwitchParamsSchema,
  gitCommitParamsSchema,
  gitCommitResultSchema,
  gitCompareParamsSchema,
  gitCompareResultSchema,
  gitDiffParamsSchema,
  gitEmptyParamsSchema,
  gitPushParamsSchema,
  gitPushResultSchema,
  gitRestoreRequestSchema,
  gitRunChangeSelectionSchema,
  gitRunDiffParamsSchema,
  gitRunReviewAcceptanceSchema,
  gitRunRestoreRequestSchema,
  gitRunRestoreSelectionSchema,
  permissionDecideParamsSchema,
  runCancelParamsSchema,
  runStartParamsSchema,
  runtimeShutdownParamsSchema,
  runtimeRequestSchema,
  terminalCreateParamsSchema,
  terminalDisposeParamsSchema,
  terminalResizeParamsSchema,
  terminalWriteParamsSchema,
  taskStateLoadParamsSchema,
  workspaceTaskStateSchema,
  RUX_PROTOCOL_VERSION,
  type RuntimeEvent,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeStatus,
  type RuntimeWireMessage,
  type AgentRevision,
  type ContextSnapshot,
  type RunStartParams,
} from "../shared/protocol";
import { createContextSnapshot, contextSnapshotPrompt } from "./context-snapshot.ts";
import { RunPermissionGate, type PendingPermissionRun } from "./permission-gate.ts";
import { awaitAllCleanup, forceKillProcessTree, processGroupExists } from "./child-process-lifecycle.ts";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error("Rux Runtime must be launched as an Electron utility process");
}

const startedAt = new Date().toISOString();
const configuredRoot = resolve(process.env.RUX_WORKSPACE_ROOT ?? process.cwd());
const workspaceRoot = existsSync(configuredRoot) ? realpathSync(configuredRoot) : process.cwd();
const terminals = new Map<string, pty.IPty>();
const mockRunTimers = new Map<string, NodeJS.Timeout[]>();
const mockEnabled = process.env.RUX_ENABLE_MOCK === "1";
let controlPort: Electron.MessagePortMain | null = null;
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let taskStoreClosed = false;
const activeRequests = new Set<Promise<void>>();
const pendingRunFinalizers = new Set<Promise<void>>();
const activeRunIds = new Set<string>();
let gitMutationQueue: Promise<void> = Promise.resolve();
let gitMutationInProgress = false;
let gitMutationPending = 0;

function status(): RuntimeStatus {
  return {
    protocolVersion: RUX_PROTOCOL_VERSION,
    pid: process.pid,
    platform: process.platform,
    workspaceRoot,
    startedAt,
  };
}

function post(message: RuntimeWireMessage): void {
  controlPort?.postMessage(message);
}

const runGitBaselines = new Map<string, GitRunBaseline>();

function emitDirect(event: RuntimeEvent): void {
  post({ kind: "event", event });
}

function emit(event: RuntimeEvent): void {
  if (
    "runId" in event
    && ["run.completed", "run.cancelled", "run.failed"].includes(event.type)
  ) {
    const baseline = runGitBaselines.get(event.runId);
    runGitBaselines.delete(event.runId);
    if (baseline) {
      if (shuttingDown) {
        activeRunIds.delete(event.runId);
        emitDirect(event);
        return;
      }
      const finalizer = gitChanges.compareRunChanges(baseline).then((patch) => {
        emitDirect({ type: "run.git-patch", runId: event.runId, patch });
      }).catch((error) => {
        emitDirect({
          type: "run.log",
          runId: event.runId,
          level: "warning",
          message: `无法生成 Run-owned Git patch：${error instanceof Error ? error.message : String(error)}`,
        });
      }).finally(() => {
        activeRunIds.delete(event.runId);
        emitDirect(event);
      });
      pendingRunFinalizers.add(finalizer);
      void finalizer.finally(() => pendingRunFinalizers.delete(finalizer));
      return;
    }
    activeRunIds.delete(event.runId);
  }
  emitDirect(event);
}

class GitMutationBusyError extends Error {
  readonly code = "GIT_MUTATION_BUSY";

  constructor(message: string) {
    super(message);
    this.name = "GitMutationBusyError";
  }
}

function enqueueGitMutation<T>(operation: () => Promise<T>): Promise<T> {
  gitMutationPending += 1;
  const queued = gitMutationQueue.catch(() => undefined).then(async () => {
    try {
      if (activeRunIds.size > 0) {
        throw new GitMutationBusyError("Git mutation is blocked while an Agent Run is active or awaiting permission");
      }
      if (terminals.size > 0) {
        throw new GitMutationBusyError("Git mutation is blocked while an integrated terminal session is open");
      }
      gitMutationInProgress = true;
      return await operation();
    } finally {
      gitMutationInProgress = false;
      gitMutationPending -= 1;
    }
  });
  gitMutationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

let permissionGate: RunPermissionGate;
const claudeCode = new ClaudeCodeAdapter(workspaceRoot, emit, {
  onPermissionRequest: (request, signal) => permissionGate.requestProviderTool({
    provider: "claude-code",
    providerRequestId: request.requestId,
    runId: request.runId,
    toolName: request.toolName,
    input: request.input,
  }, signal),
});
const codex = new CodexRuntimeAdapter(workspaceRoot, emit, {
  forwardAssistantMessageDeltas: true,
});
const gitChanges = new GitChangesService(workspaceRoot);
const authManager = new AuthManager(workspaceRoot);
const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
let agentProfileStore: AgentProfileStore | undefined;

function profiles(): AgentProfileStore {
  agentProfileStore ??= new AgentProfileStore(resolve(
    process.env.RUX_STATE_ROOT ?? workspaceRoot,
    "agent-profiles.json",
  ));
  return agentProfileStore;
}

const taskStore = new TaskStore(
  resolve(process.env.RUX_STATE_ROOT ?? workspaceRoot, "rux-task-state.sqlite3"),
  undefined,
  (revisionId) => profiles().getRevision(revisionId),
);

function respond(response: RuntimeResponse): void {
  post(response);
}

function cleanEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function resolveWorkingDirectory(requested?: string): string {
  const candidate = requested ? resolve(workspaceRoot, requested) : workspaceRoot;
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`Working directory does not exist: ${candidate}`);
  }

  const realCandidate = realpathSync(candidate);
  const relativePath = relative(workspaceRoot, realCandidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Working directory is outside the active Rux workspace");
  }
  return realCandidate;
}

function shellConfiguration(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: process.env.ComSpec ?? "powershell.exe",
      args: [],
    };
  }

  return {
    shell: process.env.SHELL ?? "/bin/zsh",
    args: ["-l"],
  };
}

function createTerminal(params: unknown): { terminalId: string; shell: string; cwd: string } {
  const input = terminalCreateParamsSchema.parse(params);
  const cwd = resolveWorkingDirectory(input.cwd);
  const configuration = shellConfiguration();
  const terminalId = randomUUID();
  const terminal = pty.spawn(configuration.shell, configuration.args, {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd,
    env: {
      ...cleanEnvironment(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });

  terminals.set(terminalId, terminal);
  terminal.onData((data) => {
    emit({ type: "terminal.data", terminalId, data });
  });
  terminal.onExit(({ exitCode, signal }) => {
    terminals.delete(terminalId);
    emit({ type: "terminal.exit", terminalId, exitCode, signal });
  });

  return {
    terminalId,
    shell: basename(configuration.shell),
    cwd,
  };
}

function startMockRun(params: ReturnType<typeof runStartParamsSchema.parse>): {
  runId: string;
  adapter: "mock";
} {
  if (mockRunTimers.has(params.runId)) throw new Error("Run ID is already active");
  const timers: NodeJS.Timeout[] = [];
  mockRunTimers.set(params.runId, timers);
  emit({
    type: "run.started",
    runId: params.runId,
    adapter: "mock",
    prompt: params.prompt,
    permissionMode: params.permissionMode,
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    profileId: params.profileId,
    agentRevisionId: params.agentRevisionId,
    ...(params.sessionId ? { resumeSessionId: params.sessionId } : {}),
  });

  timers.push(setTimeout(() => {
    emit({
      type: "activity.started",
      runId: params.runId,
      activity: {
        id: `${params.runId}-inspect`,
        kind: "read",
        title: "理解新的任务要求",
        detail: "正在检查 Workspace context 与相关文件",
        state: "active",
      },
    });
  }, 350));
  timers.push(setTimeout(() => {
    emit({
      type: "assistant.message",
      runId: params.runId,
      text: "Rux 演示 Agent 尚未接入模型服务；当前运行的是桌面事件协议演示。请选择 Rux 执行真实任务。",
    });
    emit({ type: "run.completed", runId: params.runId, durationMs: 1_200, turns: 1 });
    mockRunTimers.delete(params.runId);
  }, 1_200));

  return { runId: params.runId, adapter: "mock" };
}

async function cancelRun(runId: string): Promise<void> {
  if (await permissionGate.cancel(runId)) return;
  const timers = mockRunTimers.get(runId);
  if (timers) {
    for (const timer of timers) clearTimeout(timer);
    mockRunTimers.delete(runId);
    emit({ type: "run.cancelled", runId });
    return;
  }
  await Promise.all([
    claudeCode.cancel(runId),
    codex.cancel(runId),
  ]);
}

async function contextSnapshot(params: unknown) {
  const adapters = [claudeCode.info(), codex.info()].filter((adapter) => adapter.available);
  return createContextSnapshot(workspaceRoot, params, [
    ...adapters.map((adapter) => adapter.name),
    "Git Changes",
    "Integrated terminal",
  ]);
}

type PreparedRun = {
  params: RunStartParams;
  context: ContextSnapshot;
  profile?: AgentRevision;
};

async function prepareRun(params: ReturnType<typeof runStartParamsSchema.parse>): Promise<PreparedRun> {
  if (params.adapter === "mock" && !mockEnabled) {
    throw new Error("Rux Demo Agent is disabled in production builds");
  }
  let effectiveParams: RunStartParams = params;
  let profileSnapshot: AgentRevision | undefined;
  const runContextSnapshot = await contextSnapshot({ selectedFiles: params.contextFiles });
  const promptSections: string[] = [];
  if (params.profileId) {
    const profile = profiles().getRevision(params.agentRevisionId);
    if (!profile || profile.profileId !== params.profileId || !profile.enabled) {
      throw new Error("Custom Agent Revision is unavailable");
    }
    if (profile.backend !== params.adapter) {
      throw new Error("Custom Agent backend does not match the requested adapter");
    }
    profileSnapshot = profile;
    promptSections.push(`Custom Agent instructions:\n${profile.instructions}`);
    effectiveParams = {
      ...params,
      model: params.model ?? profile.model,
      reasoningEffort: params.reasoningEffort ?? profile.reasoningEffort,
    };
  }
  promptSections.push(contextSnapshotPrompt(runContextSnapshot));
  promptSections.push(`User request:\n${params.prompt}`);
  return {
    params: { ...effectiveParams, prompt: promptSections.join("\n\n") },
    context: runContextSnapshot,
    ...(profileSnapshot ? { profile: profileSnapshot } : {}),
  };
}

async function launchPreparedRun(params: RunStartParams): Promise<{
  runId: string;
  adapter: typeof params.adapter;
}> {
  let runGitBaseline: GitRunBaseline | undefined;
  let runGitBaselineError: string | undefined;
  try {
    runGitBaseline = await gitChanges.captureRunBaseline(params.runId);
    runGitBaselines.set(params.runId, runGitBaseline);
  } catch (error) {
    runGitBaselineError = error instanceof Error ? error.message : String(error);
  }

  let result: { runId: string; adapter: typeof params.adapter };
  try {
    result = await (params.adapter === "claude-code"
      ? claudeCode.start(params)
      : params.adapter === "codex"
        ? codex.start(params)
        : startMockRun({ ...params, contextFiles: params.contextFiles ?? [] }));
  } catch (error) {
    runGitBaselines.delete(params.runId);
    throw error;
  }
  if (runGitBaseline) {
    emit({ type: "run.git-baseline", runId: params.runId, baseline: runGitBaseline });
  } else if (runGitBaselineError) {
    emit({ type: "run.log", runId: params.runId, level: "warning", message: `未创建 Run Git baseline：${runGitBaselineError}` });
  }
  return result;
}

function recoverPendingRun(runId: string, requestId: string): PendingPermissionRun | undefined {
  const state = taskStore.load(workspaceId);
  for (const task of state.tasks) {
    const run = task.runs.find((candidate) => candidate.id === runId);
    if (!run || run.status !== "waiting-permission") continue;
    const request = run.permissionRequests.find((candidate) =>
      candidate.status === "pending"
      && candidate.scope.appliesTo === "this-run"
      && (!requestId || candidate.id === requestId));
    if (!request) continue;
    return {
      request,
      params: {
        runId: run.id,
        adapter: run.adapter,
        prompt: run.prompt,
        permissionMode: "acceptEdits",
        ...(run.model ? { model: run.model } : {}),
        ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
        ...(run.sessionId ? { sessionId: run.sessionId } : {}),
        ...(run.profileId ? { profileId: run.profileId } : {}),
        agentRevisionId: run.agentRevisionId,
        contextFiles: run.contextFiles,
      },
    };
  }
  return undefined;
}

for (const task of taskStore.load(workspaceId).tasks) {
  for (const run of task.runs) {
    if (
      run.status === "waiting-permission"
      && run.permissionRequests.some((request) =>
        request.status === "pending" && request.scope.appliesTo === "this-run")
    ) {
      activeRunIds.add(run.id);
    }
  }
}

permissionGate = new RunPermissionGate(
  workspaceRoot,
  emit,
  launchPreparedRun,
  recoverPendingRun,
);

async function handleRequest(input: unknown): Promise<void> {
  let request: RuntimeRequest | undefined;

  try {
    request = runtimeRequestSchema.parse(input) as RuntimeRequest;
    let result: unknown;

    switch (request.method) {
      case "runtime.ping":
        result = status();
        break;
      case "runtime.shutdown":
        throw new Error("Runtime shutdown must use the lifecycle dispatcher");
      case "auth.status":
        result = authManager.status();
        break;
      case "auth.login": {
        const params = authLoginParamsSchema.parse(request.params);
        result = await authManager.login(params.provider);
        break;
      }
      case "auth.cancel": {
        const params = authLoginParamsSchema.parse(request.params);
        await authManager.cancel(params.provider);
        result = { ok: true };
        break;
      }
      case "terminal.create":
        if (gitMutationInProgress || gitMutationPending > 0) {
          throw new GitMutationBusyError("Integrated terminal creation is blocked during a Git mutation");
        }
        result = createTerminal(request.params);
        break;
      case "terminal.write": {
        const params = terminalWriteParamsSchema.parse(request.params);
        const terminal = terminals.get(params.terminalId);
        if (!terminal) throw new Error("Terminal session not found");
        terminal.write(params.data);
        result = { ok: true };
        break;
      }
      case "terminal.resize": {
        const params = terminalResizeParamsSchema.parse(request.params);
        const terminal = terminals.get(params.terminalId);
        if (!terminal) throw new Error("Terminal session not found");
        terminal.resize(params.cols, params.rows);
        result = { ok: true };
        break;
      }
      case "terminal.dispose": {
        const params = terminalDisposeParamsSchema.parse(request.params);
        const terminal = terminals.get(params.terminalId);
        if (terminal) {
          terminal.kill();
          terminals.delete(params.terminalId);
        }
        result = { ok: true };
        break;
      }
      case "agent.list": {
        const params = agentListParamsSchema.parse(request.params);
        result = {
          adapters: [
            claudeCode.info(params.refresh),
            codex.info(params.refresh),
            ...(mockEnabled ? [{
              id: "mock",
              name: "Rux Demo",
              available: true,
              version: "prototype",
              detail: "本地事件协议演示",
            } as const] : []),
          ],
        };
        break;
      }
      case "agent.model.list": {
        const params = agentModelListParamsSchema.parse(request.params);
        result = await codex.listModels(params);
        break;
      }
      case "agent.profile.list":
        result = { profiles: profiles().list() };
        break;
      case "agent.profile.create":
        result = profiles().create(agentProfileInputSchema.parse(request.params));
        break;
      case "agent.profile.update": {
        const params = agentProfileUpdateParamsSchema.parse(request.params);
        result = profiles().update(params.id, params.patch);
        break;
      }
      case "agent.profile.delete": {
        const params = agentProfileDeleteParamsSchema.parse(request.params);
        profiles().delete(params.id);
        result = { ok: true };
        break;
      }
      case "run.start": {
        const params = runStartParamsSchema.parse(request.params);
        if (gitMutationInProgress || gitMutationPending > 0) {
          throw new GitMutationBusyError("Agent Run start is blocked during a Git mutation");
        }
        if (activeRunIds.has(params.runId)) {
          throw new Error("Run ID is already active or awaiting permission");
        }
        activeRunIds.add(params.runId);
        try {
          const prepared = await prepareRun(params);
          result = await permissionGate.start(prepared.params);
          emit({
            type: "run.context-snapshot",
            runId: params.runId,
            snapshot: prepared.context,
          });
          if (prepared.profile) {
            emit({
              type: "run.agent-snapshot",
              runId: params.runId,
              profile: prepared.profile,
            });
          }
        } catch (error) {
          activeRunIds.delete(params.runId);
          throw error;
        }
        break;
      }
      case "run.cancel": {
        const params = runCancelParamsSchema.parse(request.params);
        await cancelRun(params.runId);
        activeRunIds.delete(params.runId);
        result = { ok: true };
        break;
      }
      case "permission.decide": {
        const params = permissionDecideParamsSchema.parse(request.params);
        if (params.decision === "approved" && (gitMutationInProgress || gitMutationPending > 0)) {
          throw new GitMutationBusyError("Permission approval is blocked during a Git mutation");
        }
        const wasActive = activeRunIds.has(params.runId);
        if (params.decision === "approved") activeRunIds.add(params.runId);
        try {
          result = codex.decide(params)
            ? { ok: true, state: "running" }
            : await permissionGate.decide(params);
        } catch (error) {
          if (!wasActive) activeRunIds.delete(params.runId);
          throw error;
        }
        break;
      }
      case "run.changes.diff":
        result = await gitChanges.getRunFileDiff(gitRunDiffParamsSchema.parse(request.params));
        break;
      case "run.changes.accept":
        result = gitRunReviewAcceptanceSchema.parse(
          await gitChanges.recordRunReviewAcceptance(
            gitRunChangeSelectionSchema.parse(request.params),
          ),
        );
        break;
      case "run.changes.previewRestore":
        result = await gitChanges.previewRunRestore(gitRunRestoreSelectionSchema.parse(request.params));
        break;
      case "run.changes.restore": {
        const params = gitRunRestoreRequestSchema.parse(request.params);
        const restored = await enqueueGitMutation(() => gitChanges.restoreRunChanges(params));
        result = {
          id: `run-restore-${randomUUID()}`,
          runId: params.patch.runId,
          restoredAt: new Date().toISOString(),
          selectedPaths: params.paths ?? params.patch.files.map((file) => file.path),
          result: restored,
        };
        break;
      }
      case "changes.list":
        result = await gitChanges.listChanges();
        break;
      case "changes.diff": {
        const params = gitDiffParamsSchema.parse(request.params);
        result = await gitChanges.getFileDiff(params.path, params.expectedSnapshotId);
        break;
      }
      case "changes.previewRestore":
        result = await gitChanges.previewRestore(gitChangeSelectionSchema.parse(request.params));
        break;
      case "changes.restore": {
        const params = gitRestoreRequestSchema.parse(request.params);
        result = await enqueueGitMutation(() => gitChanges.restore(params));
        break;
      }
      case "changes.accept":
        result = await gitChanges.recordReviewAcceptance(gitChangeSelectionSchema.parse(request.params));
        break;
      case "git.branches.list":
        gitEmptyParamsSchema.parse(request.params);
        result = gitBranchesListResultSchema.parse(await gitChanges.listBranches());
        break;
      case "git.branch.switch": {
        const params = gitBranchSwitchParamsSchema.parse(request.params);
        result = gitBranchesListResultSchema.parse(await enqueueGitMutation(() => gitChanges.switchBranch(params)));
        break;
      }
      case "git.commit": {
        const params = gitCommitParamsSchema.parse(request.params);
        result = gitCommitResultSchema.parse(await enqueueGitMutation(() => gitChanges.commitStaged(params)));
        break;
      }
      case "git.push": {
        const params = gitPushParamsSchema.parse(request.params);
        result = gitPushResultSchema.parse(await enqueueGitMutation(() => gitChanges.pushCurrent(params)));
        break;
      }
      case "git.compare":
        result = gitCompareResultSchema.parse(await gitChanges.compareBranch(
          gitCompareParamsSchema.parse(request.params),
        ));
        break;
      case "context.snapshot":
        result = await contextSnapshot(request.params);
        break;
      case "task.state.load": {
        const params = taskStateLoadParamsSchema.parse(request.params);
        if (params.workspaceId && params.workspaceId !== workspaceId) {
          throw new Error("Task state request does not match the active workspace");
        }
        result = taskStore.load(workspaceId);
        break;
      }
      case "task.state.save": {
        const state = workspaceTaskStateSchema.parse(request.params);
        if (state.workspaceId !== workspaceId) {
          throw new Error("Task state save does not match the active workspace");
        }
        result = taskStore.save(state);
        break;
      }
      default:
        throw new Error("Unsupported Rux Runtime method");
    }

    respond({ kind: "response", id: request.id, ok: true, result });
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "RUNTIME_REQUEST_FAILED";
    respond({
      kind: "response",
      id: request?.id ?? "invalid-request",
      ok: false,
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function signalTerminalProcessGroup(terminal: pty.IPty, signal: NodeJS.Signals): void {
  if (terminal.pid && signal === "SIGKILL") {
    forceKillProcessTree(terminal.pid, () => {
      try {
        terminal.kill(signal);
      } catch {
        // The PTY has already exited.
      }
    });
    return;
  }
  if (process.platform !== "win32" && terminal.pid) {
    try {
      process.kill(-terminal.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  try {
    terminal.kill(signal);
  } catch {
    // The PTY has already exited.
  }
}

async function waitForTerminalExit(terminal: pty.IPty, timeoutMs: number): Promise<boolean> {
  let exited = false;
  const subscription = terminal.onExit(() => {
    exited = true;
  });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (
        exited
        || (process.platform !== "win32" && terminal.pid && !processGroupExists(terminal.pid))
      ) return true;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
    return exited
      || (process.platform !== "win32" && Boolean(terminal.pid) && !processGroupExists(terminal.pid));
  } finally {
    subscription.dispose();
  }
}

async function disposeAllTerminals(): Promise<void> {
  const active = [...terminals.values()];
  terminals.clear();
  for (const terminal of active) signalTerminalProcessGroup(terminal, "SIGTERM");
  await Promise.all(active.map(async (terminal) => {
    if (await waitForTerminalExit(terminal, 1_500)) return;
    signalTerminalProcessGroup(terminal, "SIGKILL");
    await waitForTerminalExit(terminal, 500);
  }));
}

function forceDisposeAllTerminals(): void {
  for (const terminal of terminals.values()) signalTerminalProcessGroup(terminal, "SIGKILL");
  terminals.clear();
}

async function disposeAllRuns(): Promise<void> {
  for (const timers of mockRunTimers.values()) {
    for (const timer of timers) clearTimeout(timer);
  }
  mockRunTimers.clear();
  permissionGate.dispose();
  await awaitAllCleanup([
    claudeCode.dispose(),
    codex.dispose(),
    authManager.dispose(),
    gitChanges.dispose(),
  ], "Runtime resource");
}

function forceDisposeAllRuns(): void {
  for (const timers of mockRunTimers.values()) {
    for (const timer of timers) clearTimeout(timer);
  }
  mockRunTimers.clear();
  permissionGate.dispose();
  claudeCode.forceDispose();
  codex.forceDispose();
  authManager.forceDispose();
  gitChanges.forceDispose();
}

function shutdownRuntime(): Promise<void> {
  shutdownPromise ??= (async () => {
    shuttingDown = true;
    permissionGate.dispose();
    const cleanup = await Promise.allSettled([
      disposeAllTerminals(),
      disposeAllRuns(),
    ]);
    await Promise.allSettled([...activeRequests]);
    await Promise.allSettled([...pendingRunFinalizers]);
    if (!taskStoreClosed) {
      taskStore.close();
      taskStoreClosed = true;
    }
    await awaitAllCleanup(
      cleanup.map((result) => result.status === "fulfilled" ? Promise.resolve() : Promise.reject(result.reason)),
      "Runtime",
    );
  })();
  return shutdownPromise;
}

async function handleShutdownRequest(input: unknown): Promise<void> {
  let request: RuntimeRequest<"runtime.shutdown"> | undefined;
  try {
    const parsed = runtimeRequestSchema.parse(input) as RuntimeRequest;
    if (parsed.method !== "runtime.shutdown") throw new Error("Expected runtime.shutdown");
    request = parsed;
    runtimeShutdownParamsSchema.parse(request.params);
    await shutdownRuntime();
    respond({ kind: "response", id: request.id, ok: true, result: { ok: true } });
    setImmediate(() => {
      controlPort?.close();
      controlPort = null;
      process.exit(0);
    });
  } catch (error) {
    respond({
      kind: "response",
      id: request?.id ?? "invalid-request",
      ok: false,
      error: {
        code: "RUNTIME_SHUTDOWN_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function dispatchRequest(input: unknown): void {
  const parsed = runtimeRequestSchema.safeParse(input);
  if (parsed.success && parsed.data.method === "runtime.shutdown") {
    void handleShutdownRequest(parsed.data);
    return;
  }
  if (shuttingDown) {
    respond({
      kind: "response",
      id: parsed.success ? parsed.data.id : "invalid-request",
      ok: false,
      error: { code: "RUNTIME_SHUTTING_DOWN", message: "Rux Runtime is shutting down" },
    });
    return;
  }
  const operation = handleRequest(input);
  activeRequests.add(operation);
  void operation.finally(() => activeRequests.delete(operation));
}

parentPort.on("message", (event) => {
  const [port] = event.ports;
  if (!port || controlPort) return;

  controlPort = port;
  controlPort.on("message", (messageEvent) => {
    dispatchRequest(messageEvent.data);
  });
  controlPort.on("close", () => {
    controlPort = null;
    void shutdownRuntime().finally(() => process.exit(0));
  });
  controlPort.start();
  emit({ type: "runtime.ready", status: status() });
});

process.on("exit", () => {
  forceDisposeAllTerminals();
  forceDisposeAllRuns();
  if (!taskStoreClosed) {
    taskStore.close();
    taskStoreClosed = true;
  }
});

process.on("SIGTERM", () => {
  const forceExit = setTimeout(() => {
    forceDisposeAllTerminals();
    forceDisposeAllRuns();
    process.exit(143);
  }, 3_500);
  void shutdownRuntime().finally(() => {
    clearTimeout(forceExit);
    process.exit(143);
  });
});
