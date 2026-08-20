import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import * as pty from "node-pty";
import { AgentProfileStore } from "./agent-profile-store";
import { AuthManager } from "./auth-manager";
import { ClaudeCodeAdapter } from "./claude-adapter";
import { CodexRuntimeAdapter } from "./codex-runtime-adapter";
import { NativeProviderAdapter, type NativeRunStartParams } from "./native-provider-adapter.ts";
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
  nativeProviderRuntimeSyncSchema,
  authLoginParamsSchema,
  gitChangeSelectionSchema,
  gitBranchesListResultSchema,
  gitBranchSwitchParamsSchema,
  gitWorktreeCreateParamsSchema,
  gitWorktreeCreateResultSchema,
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
  runModelDecisionSchema,
  sessionCancelParamsSchema,
  sessionAttributionMigrateParamsSchema,
  sessionDiscoverParamsSchema,
  sessionPreviewParamsSchema,
  sessionListParamsSchema,
  sessionReadParamsSchema,
  sessionResumeCheckParamsSchema,
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
  type RunModelDecision,
  defaultProviderConnectionForAdapter,
} from "../shared/protocol";
import { createContextSnapshot, contextSnapshotPrompt } from "./context-snapshot.ts";
import { RunPermissionGate, type PendingPermissionRun } from "./permission-gate.ts";
import { awaitAllCleanup, forceKillProcessTree, processGroupExists } from "./child-process-lifecycle.ts";
import { generateIsolatedHandoffSummary } from "./handoff-summary.ts";
import { runIsolatedImprovementEvaluation } from "./improvement-evaluation.ts";
import { assertNativeSessionModelCompatibility, selectAutoModel } from "../auto-model-routing.ts";

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
const runsWithPossibleWorkspaceChanges = new Set<string>();
const activeNativeSessionRuns = new Map<string, string>();
const nativeSessionByRun = new Map<string, string>();

function emitDirect(event: RuntimeEvent): void {
  post({ kind: "event", event });
}

function emit(event: RuntimeEvent): void {
  if ("runId" in event && (event.type === "run.workspace-changed" || ((event.type === "activity.started" || event.type === "activity.completed") && ["edit", "command"].includes(event.activity.kind)))) {
    runsWithPossibleWorkspaceChanges.add(event.runId);
  }
  if (
    "runId" in event
    && ["run.completed", "run.cancelled", "run.failed"].includes(event.type)
  ) {
    const nativeSessionId = nativeSessionByRun.get(event.runId);
    if (nativeSessionId) {
      activeNativeSessionRuns.delete(nativeSessionId);
      nativeSessionByRun.delete(event.runId);
    }
    const baseline = runGitBaselines.get(event.runId);
    runGitBaselines.delete(event.runId);
    const mayHaveWorkspaceChanges = runsWithPossibleWorkspaceChanges.delete(event.runId);
    if (baseline) {
      if (shuttingDown) {
        activeRunIds.delete(event.runId);
        emitDirect(event);
        return;
      }
      const finalizer = Promise.resolve(mayHaveWorkspaceChanges ? gitChanges.compareRunChanges(baseline) : gitChanges.unchangedRunPatch(baseline)).then((patch) => {
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
const nativeProvider = new NativeProviderAdapter(workspaceRoot, emit);
const sessions = new SessionConnectorService([
  new CodexSessionConnector(codex),
  new ClaudeSessionConnector(workspaceRoot),
]);
const gitChanges = new GitChangesService(workspaceRoot);
const authManager = new AuthManager(workspaceRoot);
const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
const clipboardImageRoot = resolve(
  process.env.RUX_STATE_ROOT ?? workspaceRoot,
  "clipboard-images",
  createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 24),
);

function validateClipboardImagePaths(paths: string[]): string[] {
  if (!paths.length) return [];
  if (!existsSync(clipboardImageRoot)) throw new Error("粘贴图片目录不可用，请重新粘贴图片");
  const root = realpathSync(clipboardImageRoot);
  return paths.map((path) => {
    if (!isAbsolute(path) || !existsSync(path)) throw new Error("粘贴图片路径无效，请重新粘贴图片");
    const resolvedPath = realpathSync(path);
    const child = relative(root, resolvedPath);
    if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error("粘贴图片不属于当前 Rux 工作区会话");
    }
    const stat = statSync(resolvedPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 20 * 1024 * 1024) throw new Error("粘贴图片文件无效或超过 20 MB");
    return resolvedPath;
  });
}
const sessionAttributions = new SessionAttributionStore(resolve(
  process.env.RUX_STATE_ROOT ?? workspaceRoot,
  "rux-session-attribution.sqlite3",
));
const sessionDiscovery = new SessionDiscoveryService(
  sessions,
  authorizedWorkspacesFromEnvironment({ id: workspaceId, name: basename(workspaceRoot), path: workspaceRoot }),
  sessionAttributions,
);
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
    nativeProvider.cancel(runId),
  ]);
}

async function contextSnapshot(params: unknown) {
  const adapters = [claudeCode.info(), codex.info(), nativeProvider.info()].filter((adapter) => adapter.available);
  return createContextSnapshot(workspaceRoot, params, [
    ...adapters.map((adapter) => adapter.name),
    "Git Changes",
    "Integrated terminal",
  ]);
}

type PreparedRun = {
  params: NativeRunStartParams;
  context: ContextSnapshot;
  profile?: AgentRevision;
  modelDecision: RunModelDecision;
};

function verifiedModelsForConnection(adapter: RunStartParams["adapter"], providerConnectionId: string): Set<string> {
  const verified = new Set<string>();
  for (const task of taskStore.load(workspaceId).tasks) {
    for (const run of task.runs) {
      if (run.adapter !== adapter || run.providerConnection.id !== providerConnectionId || run.status !== "completed" || !run.model) continue;
      if (run.modelVerificationStatus === "verified" || run.modelSource === "verified-history") verified.add(run.model);
    }
  }
  return verified;
}

async function availableAutoModels(profile: Pick<AgentRevision, "backend" | "providerConnection" | "autoModelPolicy">): Promise<Set<string>> {
  const verified = verifiedModelsForConnection(profile.backend, profile.providerConnection.id);
  let catalog = new Set<string>();
  if (profile.backend === "rux-native") catalog = new Set(nativeProvider.catalogModels(profile.providerConnection.id));
  if (profile.backend === "codex" && profile.autoModelPolicy?.allowlist.some((candidate) => candidate.source === "engine-catalog")) {
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await codex.listModels({ adapter: "codex", limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      result.models.forEach((model) => { catalog.add(model.id); catalog.add(model.model); });
      cursor = result.nextCursor;
      if (!cursor) break;
    }
  }
  return new Set((profile.autoModelPolicy?.allowlist ?? []).filter((candidate) => (
    candidate.source === "engine-catalog" ? catalog.has(candidate.model) : verified.has(candidate.model)
  )).map((candidate) => candidate.model));
}

async function validateAutoPolicyForSave(profile: Pick<AgentRevision, "backend" | "providerConnection" | "autoModelPolicy">): Promise<void> {
  if (!profile.autoModelPolicy) return;
  const available = await availableAutoModels(profile);
  const invalid = profile.autoModelPolicy.allowlist.filter((candidate) => !available.has(candidate.model));
  if (invalid.length) {
    throw new Error(`Auto 白名单只接受当前 Engine 目录或这个 Connection 的已验证模型：${invalid.map((candidate) => candidate.model).join("、")}`);
  }
}

function previousSessionModel(sessionId: string, adapter: RunStartParams["adapter"], providerConnectionId: string): string | undefined {
  let latest: { model: string; updatedAt: string } | undefined;
  for (const task of taskStore.load(workspaceId).tasks) {
    for (const run of task.runs) {
      if (run.adapter !== adapter || run.providerConnection.id !== providerConnectionId || !run.model) continue;
      if (run.sessionId !== sessionId && run.sessionLink?.nativeSessionId !== sessionId) continue;
      if (!latest || run.updatedAt > latest.updatedAt) latest = { model: run.model, updatedAt: run.updatedAt };
    }
  }
  return latest?.model;
}

function assertSessionModelSelection(params: RunStartParams, actualModel: string): void {
  if (!params.sessionId) return;
  const previousModel = previousSessionModel(params.sessionId, params.adapter, params.providerConnectionId ?? "");
  if (!previousModel || previousModel === actualModel) return;
  assertNativeSessionModelCompatibility(
    params.adapter,
    previousModel,
    actualModel,
    params.adapter === "rux-native" && nativeProvider.supportsPerRunModelSelection(params.providerConnectionId ?? ""),
  );
}

function fixedModelDecision(params: RunStartParams, profile?: AgentRevision): RunModelDecision {
  const providerConnectionId = params.providerConnectionId ?? profile?.providerConnection.id ?? defaultProviderConnectionForAdapter(params.adapter).id;
  return runModelDecisionSchema.parse({
    id: `model-decision:${params.runId}`,
    runId: params.runId,
    mode: "fixed",
    classification: "fixed",
    actualModel: params.model ?? profile?.model ?? "engine-default",
    modelSource: params.modelSource ?? profile?.modelSource ?? (params.model ? "manual" : "engine-default"),
    reasonCodes: ["user-selected"],
    rationale: "本次 Run 使用 Task 固定模型或 Engine 默认模型，未执行 Auto 分类。",
    allowlist: [],
    engine: params.adapter,
    providerConnectionId,
    agentRevisionId: params.agentRevisionId,
    decidedAt: new Date().toISOString(),
  });
}

async function prepareRun(params: ReturnType<typeof runStartParamsSchema.parse>): Promise<PreparedRun> {
  if (params.adapter === "mock" && !mockEnabled) {
    throw new Error("Rux Demo Agent is disabled in production builds");
  }
  let effectiveParams: RunStartParams = params;
  let profileSnapshot: AgentRevision | undefined;
  let modelDecision: RunModelDecision | undefined;
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
    if (params.providerConnectionId && params.providerConnectionId !== profile.providerConnection.id) {
      throw new Error("Custom Agent Connection does not match its immutable Revision");
    }
    promptSections.push(`Custom Agent instructions:\n${profile.instructions}`);
    if (params.modelMode === "auto") {
      if (!profile.autoModelPolicy) throw new Error("这个 Agent Revision 未配置 Auto Model Policy，请保存新 Revision 或改用固定模型。");
      const available = await availableAutoModels(profile);
      const selection = selectAutoModel(profile.autoModelPolicy, params.prompt);
      let actualModel = selection.model;
      let fallback;
      if (!available.has(actualModel)) {
        const alternate = selection.classification === "complex"
          ? profile.autoModelPolicy.simpleModel.model
          : profile.autoModelPolicy.complexModel.model;
        if (!profile.autoModelPolicy.fallbackEnabled || alternate === actualModel || !available.has(alternate)) {
          throw new Error(`Auto 选择的模型「${actualModel}」已不在当前目录或验证历史中；本次 Run 未启动。请更新 Agent Revision。`);
        }
        fallback = { fromModel: actualModel, toModel: alternate, reason: "原选择模型已不在当前 Engine 目录或 Connection 验证历史中" };
        actualModel = alternate;
      }
      assertSessionModelSelection({ ...params, providerConnectionId: profile.providerConnection.id }, actualModel);
      modelDecision = runModelDecisionSchema.parse({
        id: `model-decision:${params.runId}`,
        runId: params.runId,
        mode: "auto",
        classification: selection.classification,
        actualModel,
        modelSource: profile.autoModelPolicy.allowlist.find((candidate) => candidate.model === actualModel)?.source ?? "verified-history",
        strategy: profile.autoModelPolicy.strategy,
        score: selection.score,
        threshold: selection.threshold,
        reasonCodes: selection.reasonCodes,
        rationale: selection.rationale,
        allowlist: profile.autoModelPolicy.allowlist.map((candidate) => candidate.model),
        engine: params.adapter,
        providerConnectionId: profile.providerConnection.id,
        agentRevisionId: profile.id,
        ...(fallback ? { fallback } : {}),
        decidedAt: new Date().toISOString(),
      });
      effectiveParams = { ...effectiveParams, model: actualModel, modelMode: "auto" };
    }
    effectiveParams = {
      ...effectiveParams,
      model: effectiveParams.model ?? profile.model,
      reasoningEffort: params.reasoningEffort ?? profile.reasoningEffort,
      providerConnectionId: profile.providerConnection.id,
      ...(profile.backend === "rux-native" ? { allowedToolIds: [...profile.toolIds] } : {}),
    };
  }
  promptSections.push(contextSnapshotPrompt(runContextSnapshot));
  promptSections.push(`User request:\n${params.prompt}`);
  modelDecision ??= fixedModelDecision(effectiveParams, profileSnapshot);
  return {
    params: { ...effectiveParams, prompt: promptSections.join("\n\n") },
    context: runContextSnapshot,
    modelDecision,
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
        : params.adapter === "rux-native"
          ? nativeProvider.start(nativeRunParamsForLaunch(params))
        : startMockRun({ ...params, modelMode: params.modelMode ?? "fixed", contextFiles: params.contextFiles ?? [], imagePaths: params.imagePaths ?? [] }));
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

function nativeRunParamsForLaunch(params: RunStartParams): NativeRunStartParams {
  if (!params.profileId) return params;
  const revision = profiles().getRevision(params.agentRevisionId);
  if (!revision || revision.profileId !== params.profileId || revision.backend !== "rux-native") {
    throw new Error("Rux Native Agent Revision is unavailable at launch");
  }
  return { ...params, allowedToolIds: [...revision.toolIds] };
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
        modelSource: run.modelSource,
        modelVerificationStatus: run.modelVerificationStatus,
        ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
        ...(run.sessionId ? { sessionId: run.sessionId } : {}),
        ...(run.profileId ? { profileId: run.profileId } : {}),
        agentRevisionId: run.agentRevisionId,
        providerConnectionId: run.providerConnection.id,
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
      case "auth.chatgpt.sync":
        result = await codex.syncChatGptAccount();
        break;
      case "auth.login": {
        const params = authLoginParamsSchema.parse(request.params);
        result = await authManager.login(params.provider);
        break;
      }
      case "auth.logout": {
        const params = authLoginParamsSchema.parse(request.params);
        result = await authManager.logout(params.provider);
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
            nativeProvider.info(),
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
      case "session.list":
        result = await sessions.list(sessionListParamsSchema.parse(request.params));
        break;
      case "session.discover":
        result = await sessionDiscovery.discover(sessionDiscoverParamsSchema.parse(request.params));
        break;
      case "session.attribution.migrate":
        result = sessionDiscovery.migrateAttribution(sessionAttributionMigrateParamsSchema.parse(request.params));
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
        result = { profiles: profiles().list() };
        break;
      case "agent.profile.create": {
        const input = agentProfileInputSchema.parse(request.params);
        await validateAutoPolicyForSave({
          backend: input.backend,
          providerConnection: input.providerConnection ?? defaultProviderConnectionForAdapter(input.backend),
          autoModelPolicy: input.autoModelPolicy,
        });
        result = profiles().create(input);
        break;
      }
      case "agent.profile.update": {
        const params = agentProfileUpdateParamsSchema.parse(request.params);
        const current = profiles().get(params.id);
        if (!current) throw new Error(`Agent profile not found: ${params.id}`);
        const backend = params.patch.backend ?? current.backend;
        await validateAutoPolicyForSave({
          backend,
          providerConnection: params.patch.providerConnection
            ?? (backend === current.backend ? current.providerConnection : defaultProviderConnectionForAdapter(backend)),
          autoModelPolicy: params.patch.autoModelPolicy === null ? undefined : params.patch.autoModelPolicy ?? current.autoModelPolicy,
        });
        result = profiles().update(params.id, params.patch);
        break;
      }
      case "agent.profile.delete": {
        const params = agentProfileDeleteParamsSchema.parse(request.params);
        profiles().delete(params.id);
        result = { ok: true };
        break;
      }
      case "provider.connection.sync": {
        const params = nativeProviderRuntimeSyncSchema.parse(request.params);
        nativeProvider.sync(params.connections);
        result = { ok: true, count: params.connections.length };
        break;
      }
      case "provider.connection.test": {
        const params = request.params as { id?: unknown };
        if (!params || typeof params.id !== "string") throw new Error("Native Provider Connection id is required");
        result = await nativeProvider.test(params.id);
        break;
      }
      case "handoff.summary.generate":
        result = await generateIsolatedHandoffSummary(workspaceRoot, request.params, (revisionId) => profiles().getRevision(revisionId));
        break;
      case "improvement.evaluation.run":
        result = await runIsolatedImprovementEvaluation(workspaceRoot, request.params, (revisionId) => profiles().getRevision(revisionId));
        break;
      case "run.start": {
        const parsed = runStartParamsSchema.parse(request.params);
        const params = { ...parsed, imagePaths: validateClipboardImagePaths(parsed.imagePaths) };
        if (gitMutationInProgress || gitMutationPending > 0) {
          throw new GitMutationBusyError("Agent Run start is blocked during a Git mutation");
        }
        if (activeRunIds.has(params.runId)) {
          throw new Error("Run ID is already active or awaiting permission");
        }
        if (params.sessionId && activeNativeSessionRuns.has(params.sessionId)) {
          throw Object.assign(new Error("该 Native Session 已有活动 Run；请等待或停止现有 Run，也可刷新后复制为新任务"), { code: "NATIVE_SESSION_WRITE_CONFLICT" });
        }
        activeRunIds.add(params.runId);
        if (params.sessionId) {
          activeNativeSessionRuns.set(params.sessionId, params.runId);
          nativeSessionByRun.set(params.runId, params.sessionId);
        }
        try {
          const prepared = await prepareRun(params);
          emit({ type: "run.model-decision", runId: params.runId, decision: prepared.modelDecision });
          result = await permissionGate.start({ ...prepared.params, modelMode: prepared.params.modelMode ?? "fixed" });
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
          if (params.sessionId) {
            activeNativeSessionRuns.delete(params.sessionId);
            nativeSessionByRun.delete(params.runId);
          }
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
      case "git.worktree.create": {
        const params = gitWorktreeCreateParamsSchema.parse(request.params);
        result = gitWorktreeCreateResultSchema.parse(await enqueueGitMutation(() => gitChanges.createWorktree(params)));
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
  sessions.dispose();
  sessionAttributions.close();
  permissionGate.dispose();
  await awaitAllCleanup([
    claudeCode.dispose(),
    codex.dispose(),
    authManager.dispose(),
    gitChanges.dispose(),
  ], "Runtime resource");
  nativeProvider.dispose();
}

function forceDisposeAllRuns(): void {
  for (const timers of mockRunTimers.values()) {
    for (const timer of timers) clearTimeout(timer);
  }
  mockRunTimers.clear();
  sessions.dispose();
  try { sessionAttributions.close(); } catch { /* Already closed during graceful shutdown. */ }
  permissionGate.dispose();
  claudeCode.forceDispose();
  codex.forceDispose();
  nativeProvider.dispose();
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
