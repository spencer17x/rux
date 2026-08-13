import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { AgentProfileStore } from "./agent-profile-store";
import { AuthManager } from "./auth-manager";
import { ClaudeCodeAdapter } from "./claude-adapter";
import { CodexRuntimeAdapter } from "./codex-runtime-adapter";
import { GitChangesService, type GitRunBaseline } from "./git-service";
import { TaskStore } from "./task-store";
import { ClaudeSessionConnector, CodexSessionConnector, SessionConnectorService } from "./session-connector";
import {
  authorizedWorkspacesFromEnvironment,
  SessionAttributionStore,
  SessionDiscoveryService,
} from "./session-discovery";
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
  sessionCancelParamsSchema,
  sessionDiscoverParamsSchema,
  sessionPreviewParamsSchema,
  sessionListParamsSchema,
  sessionReadParamsSchema,
  sessionResumeCheckParamsSchema,
  runtimeShutdownParamsSchema,
  runtimeRequestSchema,
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
import { awaitAllCleanup } from "./child-process-lifecycle.ts";
import { generateIsolatedHandoffSummary } from "./handoff-summary.ts";

const startedAt = new Date().toISOString();
const configuredRoot = resolve(process.env.RUX_WORKSPACE_ROOT ?? process.cwd());
if (!existsSync(configuredRoot) || !statSync(configuredRoot).isDirectory()) {
  throw new Error(`Rux workspace does not exist: ${configuredRoot}`);
}
const workspaceRoot = realpathSync(configuredRoot);
function defaultStateRoot(): string {
  if (process.platform === "darwin") return resolve(homedir(), "Library/Application Support/RUX");
  if (process.platform === "win32") {
    return resolve(process.env.APPDATA ?? resolve(homedir(), "AppData/Roaming"), "RUX");
  }
  return resolve(process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"), "RUX");
}

const stateRoot = resolve(process.env.RUX_STATE_ROOT ?? defaultStateRoot());
mkdirSync(stateRoot, { recursive: true, mode: 0o700 });

function status(): RuntimeStatus {
  return {
    protocolVersion: RUX_PROTOCOL_VERSION,
    pid: process.pid,
    platform: process.platform,
    workspaceRoot,
    startedAt,
  };
}

function write(message: RuntimeWireMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const runGitBaselines = new Map<string, GitRunBaseline>();
const activeRequests = new Set<Promise<void>>();
const pendingRunFinalizers = new Set<Promise<void>>();
const activeRunIds = new Set<string>();
let gitMutationQueue: Promise<void> = Promise.resolve();
let gitMutationInProgress = false;
let gitMutationPending = 0;
let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let taskStoreClosed = false;

function emitDirect(event: RuntimeEvent): void {
  write({ kind: "event", event });
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
          message: `Unable to create Run-owned Git patch: ${error instanceof Error ? error.message : String(error)}`,
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

function respond(response: RuntimeResponse): void {
  write(response);
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
const codex = new CodexRuntimeAdapter(workspaceRoot, emit);
const sessions = new SessionConnectorService([
  new CodexSessionConnector(codex),
  new ClaudeSessionConnector(workspaceRoot),
]);
const authManager = new AuthManager(workspaceRoot);
const gitChanges = new GitChangesService(workspaceRoot);
const profiles = new AgentProfileStore(resolve(stateRoot, "agent-profiles.json"));
const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
const sessionAttributions = new SessionAttributionStore(resolve(stateRoot, "rux-session-attribution.sqlite3"));
const sessionDiscovery = new SessionDiscoveryService(
  sessions,
  authorizedWorkspacesFromEnvironment({ id: workspaceId, name: workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace", path: workspaceRoot }),
  sessionAttributions,
);
const taskStore = new TaskStore(
  resolve(stateRoot, "rux-task-state.sqlite3"),
  undefined,
  (revisionId) => profiles.getRevision(revisionId),
);

async function contextSnapshot(params: unknown) {
  const adapters = [claudeCode.info(), codex.info()].filter((adapter) => adapter.available);
  return createContextSnapshot(workspaceRoot, params, [
    ...adapters.map((adapter) => adapter.name),
    "Git Changes",
  ]);
}

async function cancelRun(runId: string): Promise<void> {
  if (await permissionGate.cancel(runId)) return;
  await Promise.all([
    claudeCode.cancel(runId),
    codex.cancel(runId),
  ]);
}

type PreparedRun = {
  params: RunStartParams;
  context: ContextSnapshot;
  profile?: AgentRevision;
};

async function prepareRun(params: ReturnType<typeof runStartParamsSchema.parse>): Promise<PreparedRun> {
  if (params.adapter === "mock") {
    throw new Error("The standalone production Runtime does not expose the demo adapter");
  }
  let effectiveParams: RunStartParams = params;
  let profileSnapshot: AgentRevision | undefined;
  const runContextSnapshot = await contextSnapshot({ selectedFiles: params.contextFiles });
  const promptSections: string[] = [];
  if (params.profileId) {
    const profile = profiles.getRevision(params.agentRevisionId);
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
  if (params.adapter === "mock") {
    throw new Error("The standalone production Runtime does not expose the demo adapter");
  }
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
      : codex.start(params));
  } catch (error) {
    runGitBaselines.delete(params.runId);
    throw error;
  }
  if (runGitBaseline) {
    emit({ type: "run.git-baseline", runId: params.runId, baseline: runGitBaseline });
  } else if (runGitBaselineError) {
    emit({ type: "run.log", runId: params.runId, level: "warning", message: `Run Git baseline unavailable: ${runGitBaselineError}` });
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
      case "auth.login":
        result = await authManager.login(authLoginParamsSchema.parse(request.params).provider);
        break;
      case "auth.cancel":
        await authManager.cancel(authLoginParamsSchema.parse(request.params).provider);
        result = { ok: true };
        break;
      case "agent.list": {
        const params = agentListParamsSchema.parse(request.params);
        result = { adapters: [claudeCode.info(params.refresh), codex.info(params.refresh)] };
        break;
      }
      case "agent.model.list":
        result = await codex.listModels(agentModelListParamsSchema.parse(request.params));
        break;
      case "session.list":
        result = await sessions.list(sessionListParamsSchema.parse(request.params));
        break;
      case "session.discover":
        result = await sessionDiscovery.discover(sessionDiscoverParamsSchema.parse(request.params));
        break;
      case "session.preview":
        result = await sessionDiscovery.preview(sessionPreviewParamsSchema.parse(request.params));
        break;
      case "session.read":
        result = await sessions.read(sessionReadParamsSchema.parse(request.params));
        break;
      case "session.resume.check":
        result = await sessions.checkResume(sessionResumeCheckParamsSchema.parse(request.params));
        break;
      case "session.cancel": {
        const params = sessionCancelParamsSchema.parse(request.params);
        sessions.cancel(params.operationId);
        result = { ok: true };
        break;
      }
      case "agent.profile.list":
        result = { profiles: profiles.list() };
        break;
      case "agent.profile.create":
        result = profiles.create(agentProfileInputSchema.parse(request.params));
        break;
      case "agent.profile.update": {
        const params = agentProfileUpdateParamsSchema.parse(request.params);
        result = profiles.update(params.id, params.patch);
        break;
      }
      case "agent.profile.delete": {
        const params = agentProfileDeleteParamsSchema.parse(request.params);
        profiles.delete(params.id);
        result = { ok: true };
        break;
      }
      case "handoff.summary.generate":
        result = await generateIsolatedHandoffSummary(workspaceRoot, request.params, (revisionId) => profiles.getRevision(revisionId));
        break;
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
      case "terminal.create":
      case "terminal.write":
      case "terminal.resize":
      case "terminal.dispose":
        throw new Error("Integrated terminal is available in Desktop only");
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

function dispose(): Promise<void> {
  shutdownPromise ??= (async () => {
    shuttingDown = true;
    permissionGate.dispose();
    sessions.dispose();
    sessionAttributions.close();
    const cleanup = await Promise.allSettled([
      claudeCode.dispose(),
      codex.dispose(),
      authManager.dispose(),
      gitChanges.dispose(),
    ]);
    await Promise.allSettled([...activeRequests]);
    await Promise.allSettled([...pendingRunFinalizers]);
    if (!taskStoreClosed) {
      taskStore.close();
      taskStoreClosed = true;
    }
    await awaitAllCleanup(
      cleanup.map((result) => result.status === "fulfilled" ? Promise.resolve() : Promise.reject(result.reason)),
      "Runtime Host",
    );
  })();
  return shutdownPromise;
}

function forceDispose(): void {
  permissionGate.dispose();
  sessions.dispose();
  try { sessionAttributions.close(); } catch { /* Already closed during graceful shutdown. */ }
  claudeCode.forceDispose();
  codex.forceDispose();
  authManager.forceDispose();
  gitChanges.forceDispose();
  if (!taskStoreClosed) {
    taskStore.close();
    taskStoreClosed = true;
  }
}

async function handleShutdownRequest(input: unknown): Promise<void> {
  let request: RuntimeRequest<"runtime.shutdown"> | undefined;
  try {
    const parsed = runtimeRequestSchema.parse(input) as RuntimeRequest;
    if (parsed.method !== "runtime.shutdown") throw new Error("Expected runtime.shutdown");
    request = parsed;
    runtimeShutdownParamsSchema.parse(request.params);
    await dispose();
    respond({ kind: "response", id: request.id, ok: true, result: { ok: true } });
    setImmediate(() => process.exit(0));
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

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
input.on("line", (line) => {
  if (!line.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    respond({
      kind: "response",
      id: "invalid-request",
      ok: false,
      error: { code: "INVALID_JSONL", message: "Runtime input must be one JSON object per line" },
    });
    return;
  }
  dispatchRequest(parsed);
});
input.on("close", () => {
  void dispose().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  const forceExit = setTimeout(() => {
    forceDispose();
    process.exit(130);
  }, 3_500);
  void dispose().finally(() => {
    clearTimeout(forceExit);
    process.exit(130);
  });
});
process.on("SIGTERM", () => {
  const forceExit = setTimeout(() => {
    forceDispose();
    process.exit(143);
  }, 3_500);
  void dispose().finally(() => {
    clearTimeout(forceExit);
    process.exit(143);
  });
});
process.on("exit", forceDispose);
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

emit({ type: "runtime.ready", status: status() });
