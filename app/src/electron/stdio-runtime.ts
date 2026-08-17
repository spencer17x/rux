import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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
  handoffCommitParamsSchema,
  handoffPreviewParamsSchema,
  handoffSummaryGenerateParamsSchema,
  localDataExecuteParamsSchema,
  localDataPreviewParamsSchema,
  localDataRuntimeExportParamsSchema,
  permissionDecideParamsSchema,
  runCancelParamsSchema,
  runStartParamsSchema,
  runModelDecisionSchema,
  sessionCancelParamsSchema,
  sessionAttributionMigrateParamsSchema,
  sessionDiscoverParamsSchema,
  sessionImportParamsSchema,
  sessionRefreshParamsSchema,
  sessionRebuildParamsSchema,
  sessionRevisionListParamsSchema,
  sessionRevisionRestoreParamsSchema,
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
  type RunModelDecision,
  type HandoffTarget,
  type HandoffSummaryProvenance,
  defaultProviderConnectionForAdapter,
} from "../shared/protocol";
import { createContextSnapshot, contextSnapshotPrompt } from "./context-snapshot.ts";
import { RunPermissionGate, type PendingPermissionRun } from "./permission-gate.ts";
import { awaitAllCleanup } from "./child-process-lifecycle.ts";
import { generateIsolatedHandoffSummary } from "./handoff-summary.ts";
import { runIsolatedImprovementEvaluation } from "./improvement-evaluation.ts";
import { selectAutoModel } from "../auto-model-routing.ts";

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
const runsWithPossibleWorkspaceChanges = new Set<string>();
const activeRequests = new Set<Promise<void>>();
const pendingRunFinalizers = new Set<Promise<void>>();
const activeRunIds = new Set<string>();
const activeNativeSessionRuns = new Map<string, string>();
const nativeSessionByRun = new Map<string, string>();
const handoffSummaryGenerations = new Map<string, {
  sourceTaskId: string;
  fingerprint: string;
  provenance: HandoffSummaryProvenance;
  expiresAt: number;
}>();
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

function resolveHandoffTarget(targetAgentId: string): HandoffTarget {
  if (targetAgentId === "codex" || targetAgentId === "claude-code") {
    const model = targetAgentId === "codex" ? "Rux default" : "Claude default";
    return {
      agentId: targetAgentId,
      agentName: targetAgentId === "codex" ? "Rux" : "Claude Code",
      adapter: targetAgentId,
      agentRevisionId: `builtin:${targetAgentId}@1`,
      providerConnection: defaultProviderConnectionForAdapter(targetAgentId),
      model,
      modelSource: "engine-default",
      modelVerificationStatus: "not-required",
      permissionMode: "acceptEdits",
    };
  }
  const profile = profiles.get(targetAgentId);
  if (!profile) throw new Error("Handoff target Agent was not found");
  const model = profile.model || (profile.backend === "codex" ? "Rux default" : "Claude default");
  return { agentId: profile.id, agentName: profile.name, adapter: profile.backend, agentProfileId: profile.id, agentRevisionId: profile.latestRevisionId, providerConnection: profile.providerConnection, model, modelSource: profile.modelSource, modelVerificationStatus: profile.modelVerificationStatus, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}), permissionMode: profile.permissionMode };
}

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
  modelDecision: RunModelDecision;
};

function verifiedModelsForConnection(adapter: RunStartParams["adapter"], providerConnectionId: string): Set<string> {
  const verified = new Set<string>();
  for (const task of taskStore.load(workspaceId).tasks) {
    for (const run of task.runs) {
      if (run.adapter === adapter && run.providerConnection.id === providerConnectionId && run.status === "completed" && run.model
        && (run.modelVerificationStatus === "verified" || run.modelSource === "verified-history")) verified.add(run.model);
    }
  }
  return verified;
}

async function availableAutoModels(profile: Pick<AgentRevision, "backend" | "providerConnection" | "autoModelPolicy">): Promise<Set<string>> {
  const verified = verifiedModelsForConnection(profile.backend, profile.providerConnection.id);
  let catalog = new Set<string>();
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

async function validateAutoPolicy(profile: Pick<AgentRevision, "backend" | "providerConnection" | "autoModelPolicy">): Promise<void> {
  if (!profile.autoModelPolicy) return;
  const available = await availableAutoModels(profile);
  const invalid = profile.autoModelPolicy.allowlist.filter((candidate) => !available.has(candidate.model));
  if (invalid.length) throw new Error(`Auto model ${invalid.map((candidate) => candidate.model).join(", ")} is not in the current Engine catalog or verified Connection history`);
}

function modelDecision(params: RunStartParams, profile?: AgentRevision): RunModelDecision {
  return runModelDecisionSchema.parse({
    id: `model-decision:${params.runId}`,
    runId: params.runId,
    mode: "fixed",
    classification: "fixed",
    actualModel: params.model ?? profile?.model ?? "engine-default",
    modelSource: params.modelSource ?? profile?.modelSource ?? (params.model ? "manual" : "engine-default"),
    reasonCodes: ["user-selected"],
    rationale: "This Run uses its fixed Task model or the Engine default.",
    allowlist: [],
    engine: params.adapter,
    providerConnectionId: params.providerConnectionId ?? profile?.providerConnection.id ?? `cli:${params.adapter}:default`,
    agentRevisionId: params.agentRevisionId,
    decidedAt: new Date().toISOString(),
  });
}

async function prepareRun(params: ReturnType<typeof runStartParamsSchema.parse>): Promise<PreparedRun> {
  if (params.adapter === "mock") {
    throw new Error("The standalone production Runtime does not expose the demo adapter");
  }
  let effectiveParams: RunStartParams = params;
  let profileSnapshot: AgentRevision | undefined;
  let decision: RunModelDecision | undefined;
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
    if (params.modelMode === "auto") {
      if (!profile.autoModelPolicy) throw new Error("This Agent Revision has no Auto Model Policy");
      const available = await availableAutoModels(profile);
      const selection = selectAutoModel(profile.autoModelPolicy, params.prompt);
      let actualModel = selection.model;
      let fallback;
      if (!available.has(actualModel)) {
        const alternate = selection.classification === "complex" ? profile.autoModelPolicy.simpleModel.model : profile.autoModelPolicy.complexModel.model;
        if (!profile.autoModelPolicy.fallbackEnabled || alternate === actualModel || !available.has(alternate)) {
          throw new Error(`Auto selected model ${actualModel} is no longer available; update the Agent Revision`);
        }
        fallback = { fromModel: actualModel, toModel: alternate, reason: "原选择模型已不在当前 Engine 目录或 Connection 验证历史中" };
        actualModel = alternate;
      }
      decision = runModelDecisionSchema.parse({
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
    };
  }
  promptSections.push(contextSnapshotPrompt(runContextSnapshot));
  promptSections.push(`User request:\n${params.prompt}`);
  decision ??= modelDecision(effectiveParams, profileSnapshot);
  return {
    params: { ...effectiveParams, prompt: promptSections.join("\n\n") },
    context: runContextSnapshot,
    modelDecision: decision,
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
      case "auth.login":
        result = await authManager.login(authLoginParamsSchema.parse(request.params).provider);
        break;
      case "auth.logout":
        result = await authManager.logout(authLoginParamsSchema.parse(request.params).provider);
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
      case "session.attribution.migrate":
        result = sessionDiscovery.migrateAttribution(sessionAttributionMigrateParamsSchema.parse(request.params));
        break;
      case "session.preview":
        result = await sessionDiscovery.preview(sessionPreviewParamsSchema.parse(request.params));
        break;
      case "session.import": {
        const params = sessionImportParamsSchema.parse(request.params);
        if (params.activeWorkspaceId !== workspaceId) throw new Error("Session import requires the active stdio Workspace");
        const { mode, ...previewInput } = params;
        const preview = await sessionDiscovery.preview(sessionPreviewParamsSchema.parse(previewInput));
        const branches = await gitChanges.listBranches();
        result = taskStore.importExternalSession({ workspaceId, workspaceBranch: branches.currentBranch ?? "—", preview, mode });
        break;
      }
      case "session.refresh": {
        const params = sessionRefreshParamsSchema.parse(request.params);
        const task = taskStore.load(workspaceId).tasks.find((candidate) => candidate.id === params.taskId);
        const link = task?.importedSession?.sessionLink;
        if (!task || !link || task.importedSession?.status === "unlinked") throw new Error("A linked imported Session Task is required");
        const preview = await sessionDiscovery.preview(sessionPreviewParamsSchema.parse({ operationId: params.operationId, engine: link.engine, providerConnection: task.providerConnection, activeWorkspaceId: workspaceId, nativeSessionId: link.nativeSessionId, limit: 100 }));
        result = taskStore.refreshExternalSession({ workspaceId, taskId: task.id, preview });
        break;
      }
      case "session.rebuild": {
        const params = sessionRebuildParamsSchema.parse(request.params);
        result = taskStore.activateSessionRevision(workspaceId, params.taskId, params.candidateRevisionId, "rebuild");
        break;
      }
      case "session.revision.list": {
        const params = sessionRevisionListParamsSchema.parse(request.params);
        result = taskStore.listSessionRevisions(workspaceId, params.taskId);
        break;
      }
      case "session.revision.restore": {
        const params = sessionRevisionRestoreParamsSchema.parse(request.params);
        result = taskStore.activateSessionRevision(workspaceId, params.taskId, params.revisionId, "restore");
        break;
      }
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
      case "agent.profile.create": {
        const input = agentProfileInputSchema.parse(request.params);
        await validateAutoPolicy({
          backend: input.backend,
          providerConnection: input.providerConnection ?? defaultProviderConnectionForAdapter(input.backend),
          autoModelPolicy: input.autoModelPolicy,
        });
        result = profiles.create(input);
        break;
      }
      case "agent.profile.update": {
        const params = agentProfileUpdateParamsSchema.parse(request.params);
        const current = profiles.get(params.id);
        if (!current) throw new Error(`Agent profile not found: ${params.id}`);
        const backend = params.patch.backend ?? current.backend;
        await validateAutoPolicy({
          backend,
          providerConnection: params.patch.providerConnection
            ?? (backend === current.backend ? current.providerConnection : defaultProviderConnectionForAdapter(backend)),
          autoModelPolicy: params.patch.autoModelPolicy === null ? undefined : params.patch.autoModelPolicy ?? current.autoModelPolicy,
        });
        result = profiles.update(params.id, params.patch);
        break;
      }
      case "agent.profile.delete": {
        const params = agentProfileDeleteParamsSchema.parse(request.params);
        profiles.delete(params.id);
        result = { ok: true };
        break;
      }
      case "handoff.summary.generate": {
        const params = handoffSummaryGenerateParamsSchema.parse(request.params);
        const source = taskStore.load(workspaceId).tasks.find((task) => task.id === params.sourceTaskId);
        if (!source) throw new Error("Handoff source Task was not found");
        if (source.adapter !== "codex" && source.adapter !== "claude-code") throw new Error("The source Agent cannot generate a handoff summary");
        const preview = taskStore.previewContextHandoff({ workspaceId, sourceTaskId: source.id, target: resolveHandoffTarget(params.targetAgentId), messageIds: params.messageIds, filePaths: params.filePaths, sourceAgentAvailable: source.status !== "interrupted" });
        if (preview.fingerprint !== params.fingerprint) throw new Error("Handoff source facts changed; review the preview again");
        const prompt = [
          "Generate an optional narrative Context Handoff summary from the deterministic facts below.",
          "Use only these facts. Do not inspect the workspace, invoke tools, or add assumptions.",
          "Cover the goal, confirmed decisions, current progress, blockers, and recommended next steps when present.",
          "Return concise plain text only. The user will review and may edit or remove it before confirmation.",
          `Deterministic facts:\n${JSON.stringify(preview.facts, null, 2)}`,
        ].join("\n\n");
        if (prompt.length > 100_000) throw new Error("Selected handoff facts are too large for summary generation; deselect some messages");
        const operationId = `handoff-summary-generation-${randomUUID()}`;
        const generated = await generateIsolatedHandoffSummary(workspaceRoot, {
          operationId,
          adapter: source.adapter,
          prompt,
          ...(!source.model.toLowerCase().includes("default") ? { model: source.model } : {}),
          ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
          ...(source.agentProfileId ? { profileId: source.agentProfileId } : {}),
          agentRevisionId: source.agentRevisionId,
          providerConnection: source.providerConnection,
        }, (revisionId) => profiles.getRevision(revisionId));
        handoffSummaryGenerations.set(generated.generationId, {
          sourceTaskId: source.id,
          fingerprint: params.fingerprint,
          provenance: generated.provenance,
          expiresAt: Date.now() + 15 * 60_000,
        });
        result = generated;
        break;
      }
      case "improvement.evaluation.run":
        result = await runIsolatedImprovementEvaluation(workspaceRoot, request.params, (revisionId) => profiles.getRevision(revisionId));
        break;
      case "handoff.preview": {
        const params = handoffPreviewParamsSchema.parse(request.params);
        const source = taskStore.load(workspaceId).tasks.find((task) => task.id === params.sourceTaskId);
        if (!source) throw new Error("Handoff source Task was not found");
        result = taskStore.previewContextHandoff({ workspaceId, sourceTaskId: source.id, target: resolveHandoffTarget(params.targetAgentId), messageIds: params.messageIds, filePaths: params.filePaths, sourceAgentAvailable: source.status !== "interrupted" });
        break;
      }
      case "handoff.commit": {
        const params = handoffCommitParamsSchema.parse(request.params);
        let agentSummaryProvenance: HandoffSummaryProvenance | undefined;
        if (params.agentSummaryGenerationId) {
          const generation = handoffSummaryGenerations.get(params.agentSummaryGenerationId);
          if (!generation || generation.expiresAt < Date.now() || generation.sourceTaskId !== params.sourceTaskId || generation.fingerprint !== params.fingerprint) {
            throw new Error("Handoff Agent summary is stale; generate it again or remove it before confirming");
          }
          agentSummaryProvenance = generation.provenance;
        }
        result = taskStore.commitContextHandoff({ workspaceId, sourceTaskId: params.sourceTaskId, target: resolveHandoffTarget(params.targetAgentId), messageIds: params.messageIds, filePaths: params.filePaths, sourceAgentAvailable: true, fingerprint: params.fingerprint, ...(params.agentSummary ? { agentSummary: params.agentSummary } : {}), ...(agentSummaryProvenance ? { agentSummaryProvenance } : {}), ...(params.constraints ? { constraints: params.constraints } : {}) });
        if (params.agentSummaryGenerationId) handoffSummaryGenerations.delete(params.agentSummaryGenerationId);
        break;
      }
      case "local.data.summary":
        result = taskStore.getLocalDataSummary(workspaceId);
        break;
      case "local.data.preview":
        result = taskStore.previewLocalDataAction(workspaceId, localDataPreviewParamsSchema.parse(request.params));
        break;
      case "local.data.execute":
        result = taskStore.executeLocalDataAction(workspaceId, localDataExecuteParamsSchema.parse(request.params));
        break;
      case "local.data.export": {
        const params = localDataRuntimeExportParamsSchema.parse(request.params);
        if (isAbsolute(params.destination) || params.destination.split(/[\\/]/).includes("..")) throw new Error("Export destination must be a Workspace-relative new file");
        const target = resolve(workspaceRoot, params.destination);
        const targetRelative = relative(workspaceRoot, target);
        if (!targetRelative || targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) throw new Error("Export destination escapes the Workspace");
        if (existsSync(target)) throw new Error("Export destination already exists; refusing to overwrite it");
        const parent = realpathSync(dirname(target));
        const parentRelative = relative(workspaceRoot, parent);
        if (parentRelative === ".." || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)) throw new Error("Export parent escapes the Workspace");
        const artifact = taskStore.buildLocalDataExport(workspaceId, params.scope, params.taskId, params.format, params.revisions);
        writeFileSync(target, artifact.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        result = { saved: true, filePath: target, bytes: Buffer.byteLength(artifact.content, "utf8") };
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
        if (params.sessionId && activeNativeSessionRuns.has(params.sessionId)) {
          throw Object.assign(new Error("Native Session already has an active writer; wait, stop it, refresh, or branch"), { code: "NATIVE_SESSION_WRITE_CONFLICT" });
        }
        activeRunIds.add(params.runId);
        if (params.sessionId) {
          activeNativeSessionRuns.set(params.sessionId, params.runId);
          nativeSessionByRun.set(params.runId, params.sessionId);
        }
        try {
          const prepared = await prepareRun(params);
          emit({ type: "run.model-decision", runId: params.runId, decision: prepared.modelDecision });
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
