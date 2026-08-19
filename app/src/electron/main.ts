import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  MessageChannelMain,
  powerMonitor,
  safeStorage,
  type MessagePortMain,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import updaterPackage from "electron-updater";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import runtimePath from "./runtime?modulePath";
import { AgentProfileStore } from "./agent-profile-store";
import { TaskStore } from "./task-store";
import { BoardStore } from "./board-store.ts";
import { ImprovementStore } from "./improvement-store.ts";
import { assertImprovementExportPath, improvementAssetContent, improvementExportDiff, improvementFileHash } from "./improvement-export.ts";
import { publishAgentInstructionCandidate, rollbackAgentInstructionCandidate } from "./improvement-agent-publication.ts";
import { NativeProviderStore } from "./native-provider-store.ts";
import { LocalProductEventStore, type LocalProductEventKind } from "./local-product-event-store.ts";
import { UpdateManager } from "./update-manager.ts";
import {
  IPC_CHANNELS,
  runtimeRequestSchema,
  sessionImportParamsSchema,
  sessionAttributionMigrateParamsSchema,
  sessionAttributionMigrateResultSchema,
  sessionPreviewParamsSchema,
  sessionPreviewResultSchema,
  sessionRebuildParamsSchema,
  sessionRefreshParamsSchema,
  sessionRevisionListParamsSchema,
  sessionRevisionRestoreParamsSchema,
  handoffPreviewParamsSchema,
  handoffSummaryGenerateParamsSchema,
  handoffSummaryGenerateResultSchema,
  handoffCommitParamsSchema,
  localDataExecuteParamsSchema,
  localDataExportParamsSchema,
  localDataPreviewParamsSchema,
  nativeProviderConnectionDeleteParamsSchema,
  nativeProviderConnectionImpactPreviewParamsSchema,
  nativeProviderConnectionInputSchema,
  nativeProviderConnectionTestParamsSchema,
  nativeProviderCredentialMigrationParamsSchema,
  builtInAgentRevisionId,
  defaultModelState,
  defaultProviderConnectionForAdapter,
  taskStateLoadParamsSchema,
  workspaceActivateParamsSchema,
  workspaceOpenParamsSchema,
  workspaceTaskStateSchema,
  boardLoadParamsSchema,
  boardMutationParamsSchema,
  projectWorkingCopiesParamsSchema,
  projectWorkingCopyAuthorizeParamsSchema,
  projectWorkingCopyCreateParamsSchema,
  gitWorktreeCreateResultSchema,
  improvementSummaryParamsSchema,
  improvementAnalyzeParamsSchema,
  improvementDecideParamsSchema,
  improvementSettingsUpdateParamsSchema,
  improvementProposeParamsSchema,
  improvementExportPreviewParamsSchema,
  improvementExportCommitParamsSchema,
  improvementEvaluateParamsSchema,
  improvementEvaluationRecordSchema,
  clipboardImageSaveParamsSchema,
  type DesktopInfo,
  type NativeProviderConnectionImpactPreview,
  type NativeProviderConnectionImpactPreviewParams,
  type RuntimeEvent,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeWireMessage,
  type WorkspaceState,
  type WorkspaceOpenResult,
  type WorkspaceSummary,
  type WorkspaceTaskState,
  type HandoffTarget,
  type HandoffSummaryProvenance,
  type BoardSnapshot,
  type ProjectWorkingCopy,
  type ImprovementSummary,
  type ImprovementExportPreview,
  type ImprovementExportResult,
  type ImprovementExportTarget,
  type ImprovementEvaluationRecord,
  type ImprovementEvaluateParams,
  type LocalImageAttachment,
} from "../shared/protocol";
import { failClosedTimeout, runtimeRequestPolicy } from "./runtime-request-policy.ts";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

const RUNTIME_SHUTDOWN_TIMEOUT_MS = 8_000;
const RUNTIME_EXIT_TIMEOUT_MS = 1_500;
const RUNTIME_SIGTERM_EXIT_TIMEOUT_MS = 4_000;
const RUNTIME_SIGKILL_EXIT_TIMEOUT_MS = 1_000;
const WORKSPACE_STATE_VERSION = 2;

type WorkspaceAuthorizationSource = "placeholder" | "picker" | "environment" | "legacy-restored" | "legacy-ambiguous";
type StoredWorkspaceState = Partial<WorkspaceState> & {
  version?: number;
  authorizationSource?: WorkspaceAuthorizationSource;
};

let mainWindow: BrowserWindow | null = null;
let runtimeProcess: UtilityProcess | null = null;
let runtimePort: MessagePortMain | null = null;
let workspaceState: WorkspaceState | null = null;
let workspaceAuthorizationSource: WorkspaceAuthorizationSource = "placeholder";
let taskStore: TaskStore | null = null;
let boardStore: BoardStore | null = null;
let improvementStore: ImprovementStore | null = null;
let agentProfileStore: AgentProfileStore | null = null;
let nativeProviderStore: NativeProviderStore | null = null;
let localProductEventStore: LocalProductEventStore | null = null;
let updateManager: UpdateManager | null = null;
const activeRunSubjects = new Map<string, string>();
const handoffSummaryGenerations = new Map<string, {
  sourceTaskId: string;
  fingerprint: string;
  provenance: HandoffSummaryProvenance;
  expiresAt: number;
}>();
const improvementExportPreviews = new Map<string, {
  assetId: string;
  target: ImprovementExportTarget;
  filePath: string;
  baseDirectory: string;
  content: string;
  beforeHash?: string;
  afterHash: string;
  expiresAt: number;
}>();
let runtimeStopPromise: Promise<void> | null = null;
let workspaceTransition: Promise<void> = Promise.resolve();
let quitCleanupStarted = false;
let allowQuit = false;
let backgroundImprovementTimer: NodeJS.Timeout | undefined;
let backgroundImprovementRunning = false;
const pendingRequests = new Map<string, PendingRequest>();
const runtimeExitPromises = new WeakMap<UtilityProcess, Promise<number>>();

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const window = mainWindow;
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error("Rejected IPC request from an untrusted Renderer frame");
  }
}

function gitValue(workspacePath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", workspacePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultWorkspacePath(): string {
  const welcomePlaceholder = resolve(app.getPath("userData"), "welcome-workspace");
  if (!process.env.RUX_WORKSPACE_ROOT) mkdirSync(welcomePlaceholder, { recursive: true });
  const configured = resolve(process.env.RUX_WORKSPACE_ROOT ?? welcomePlaceholder);
  return gitValue(configured, ["rev-parse", "--show-toplevel"]) ?? configured;
}

function legacyDevelopmentWorkspacePath(): string | undefined {
  if (app.isPackaged || process.env.RUX_WORKSPACE_ROOT) return undefined;
  try {
    const developmentRoot = realpathSync(resolve(import.meta.dirname, "../.."));
    const repositoryRoot = gitValue(developmentRoot, ["rev-parse", "--show-toplevel"]);
    return realpathSync(resolve(repositoryRoot ?? developmentRoot));
  } catch {
    return undefined;
  }
}

function inspectWorkspace(inputPath: string, lastOpenedAt = new Date().toISOString()): WorkspaceSummary {
  const workspacePath = realpathSync(resolve(inputPath));
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    throw new Error(`Workspace does not exist: ${workspacePath}`);
  }

  const placeholderPath = resolve(app.getPath("userData"), "welcome-workspace");
  const placeholder = workspacePath === placeholderPath;
  const repositoryRootValue = placeholder ? undefined : gitValue(workspacePath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = repositoryRootValue ? realpathSync(resolve(repositoryRootValue)) : undefined;
  const commonDirValue = repositoryRoot ? gitValue(workspacePath, ["rev-parse", "--git-common-dir"]) : undefined;
  const gitDirValue = repositoryRoot ? gitValue(workspacePath, ["rev-parse", "--git-dir"]) : undefined;
  const gitCommonDir = commonDirValue ? realpathSync(resolve(workspacePath, commonDirValue)) : undefined;
  const gitDir = gitDirValue ? realpathSync(resolve(workspacePath, gitDirValue)) : undefined;
  const workspaceId = createHash("sha256").update(workspacePath).digest("hex").slice(0, 12);
  const projectId = gitCommonDir
    ? createHash("sha256").update(`git:${gitCommonDir}`).digest("hex").slice(0, 12)
    : workspaceId;
  const workingCopyId = repositoryRoot
    ? createHash("sha256").update(`worktree:${repositoryRoot}`).digest("hex").slice(0, 12)
    : workspaceId;
  return {
    id: workspaceId,
    name: placeholder ? "选择项目" : basename(workspacePath) || workspacePath,
    path: workspacePath,
    branch: gitValue(workspacePath, ["branch", "--show-current"]) ?? "—",
    lastOpenedAt,
    ...(!placeholder ? {
      projectId,
      projectName: repositoryRoot ? basename(repositoryRoot) || repositoryRoot : basename(workspacePath) || workspacePath,
      workingCopyId,
      workingCopyName: repositoryRoot ? basename(repositoryRoot) || repositoryRoot : basename(workspacePath) || workspacePath,
      workingCopyKind: repositoryRoot ? (gitDir === gitCommonDir ? "main" : "worktree") : "directory",
      ...(repositoryRoot ? { repositoryRoot } : {}),
      ...(gitCommonDir ? { gitCommonDir } : {}),
    } : {}),
    ...(placeholder ? { placeholder: true } : {}),
  };
}

function pathIsWithin(rootPath: string, candidatePath: string): boolean {
  const candidateRelative = relative(rootPath, candidatePath);
  return candidateRelative === "" || (!isAbsolute(candidateRelative) && candidateRelative !== ".." && !candidateRelative.startsWith(`..${sep}`));
}

function projectWorkingCopies(projectId: string): ProjectWorkingCopy[] {
  const authorizedProjectWorkspaces = requireAuthorizedProjectWorkspaces(projectId);
  const source = authorizedProjectWorkspaces.find((workspace) => workspace.gitCommonDir) ?? authorizedProjectWorkspaces[0];
  if (!source.gitCommonDir) return [];
  let output: string;
  try {
    output = execFileSync("git", ["-C", source.path, "worktree", "list", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 });
  } catch {
    throw new Error("WORKTREE_DISCOVERY_FAILED: Git could not list Project working copies");
  }
  const records = output.trim().split(/\n\s*\n/).filter(Boolean);
  return records.map((record, index) => {
    const lines = record.split("\n");
    const rawPath = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!rawPath) throw new Error("WORKTREE_DISCOVERY_FAILED: Git returned a working copy without a path");
    const rawHead = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length);
    const rawBranch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length).replace(/^refs\/heads\//, "");
    let canonicalPath = resolve(rawPath);
    let availability: ProjectWorkingCopy["availability"] = "missing";
    let inspected: WorkspaceSummary | undefined;
    try {
      canonicalPath = realpathSync(canonicalPath);
      inspected = inspectWorkspace(canonicalPath);
      availability = (inspected.projectId ?? inspected.id) === projectId ? "available" : "invalid";
    } catch {
      availability = existsSync(canonicalPath) ? "invalid" : "missing";
    }
    const authorized = availability === "available" && authorizedProjectWorkspaces.some((workspace) => pathIsWithin(workspace.path, canonicalPath));
    return {
      id: inspected?.workingCopyId ?? createHash("sha256").update(`worktree:${canonicalPath}`).digest("hex").slice(0, 12),
      projectId,
      path: canonicalPath,
      name: basename(canonicalPath) || canonicalPath,
      kind: index === 0 ? "main" : "worktree",
      ...(rawBranch ? { branch: rawBranch } : {}),
      ...(rawHead ? { headOid: rawHead } : {}),
      availability,
      authorizationState: authorized ? "authorized" : "pending",
    };
  });
}

function workspaceStatePath(): string {
  return resolve(app.getPath("userData"), "workspace-state.json");
}

function packagedUpdateConfig(): { feedUrl?: string; channel?: string } {
  try {
    const path = app.isPackaged ? resolve(process.resourcesPath, "update-config.json") : resolve(import.meta.dirname, "../../update-config.json");
    const value = JSON.parse(readFileSync(path, "utf8")) as { version?: number; enabled?: boolean; feedUrl?: unknown; channel?: unknown };
    if (value.version !== 1 || value.enabled !== true || typeof value.feedUrl !== "string") return {};
    return { feedUrl: value.feedUrl, ...(typeof value.channel === "string" ? { channel: value.channel } : {}) };
  } catch {
    return {};
  }
}

function persistWorkspaceState(): void {
  if (!workspaceState) return;
  const target = workspaceStatePath();
  const temporary = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  const stored: StoredWorkspaceState = {
    version: WORKSPACE_STATE_VERSION,
    authorizationSource: workspaceAuthorizationSource,
    ...workspaceState,
  };
  writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
}

function initializeWorkspaceState(): void {
  let stored: StoredWorkspaceState | undefined;
  try {
    stored = JSON.parse(readFileSync(workspaceStatePath(), "utf8")) as StoredWorkspaceState;
  } catch {
    stored = undefined;
  }

  const fallback = inspectWorkspace(defaultWorkspacePath());
  const recent: WorkspaceSummary[] = [];
  const storedRecent = Array.isArray(stored?.recent) ? stored.recent : [];

  for (const item of storedRecent) {
    if (!item || typeof item.path !== "string") continue;
    try {
      const inspected = inspectWorkspace(item.path, item.lastOpenedAt);
      if (!recent.some((workspace) => workspace.path === inspected.path)) recent.push(inspected);
    } catch {
      // Ignore workspaces that have moved or no longer exist.
    }
  }

  let storedActive: WorkspaceSummary | undefined;
  if (stored?.active && typeof stored.active.path === "string") {
    try {
      storedActive = inspectWorkspace(stored.active.path, new Date().toISOString());
    } catch {
      storedActive = undefined;
    }
  }

  const legacyDevelopmentPath = legacyDevelopmentWorkspacePath();
  const legacyDevelopmentActivation = Boolean(
    storedActive
    && !stored?.authorizationSource
    && legacyDevelopmentPath
    && storedActive.path === legacyDevelopmentPath,
  );
  const environmentConfigured = Boolean(process.env.RUX_WORKSPACE_ROOT);
  let active = fallback;
  if (environmentConfigured) {
    workspaceAuthorizationSource = "environment";
  } else if (
    storedActive
    && !legacyDevelopmentActivation
    && stored?.authorizationSource !== "environment"
    && stored?.authorizationSource !== "legacy-ambiguous"
  ) {
    active = storedActive;
    workspaceAuthorizationSource = stored?.authorizationSource ?? "legacy-restored";
  } else if (legacyDevelopmentActivation && storedActive) {
    workspaceAuthorizationSource = "legacy-ambiguous";
    if (!recent.some((workspace) => workspace.path === storedActive.path)) recent.unshift(storedActive);
  } else {
    workspaceAuthorizationSource = "placeholder";
  }

  workspaceState = {
    active,
    recent: [active, ...recent.filter((workspace) => workspace.path !== active.path && !workspace.placeholder)].slice(0, 8),
  };
  persistWorkspaceState();
}

function requireWorkspaceState(): WorkspaceState {
  if (!workspaceState) throw new Error("Rux workspace state is unavailable");
  return workspaceState;
}

function requireTaskStore(): TaskStore {
  if (!taskStore) throw new Error("Rux task store is unavailable");
  return taskStore;
}

function requireBoardStore(): BoardStore {
  if (!boardStore) throw new Error("Rux Board Store is unavailable");
  return boardStore;
}

function requireImprovementStore(): ImprovementStore {
  if (!improvementStore) throw new Error("Rux Improvement Store is unavailable");
  return improvementStore;
}

function requireAuthorizedProjectWorkspaces(projectId: string): WorkspaceSummary[] {
  const workspaces = requireWorkspaceState().recent.filter((workspace) => !workspace.placeholder && (workspace.projectId ?? workspace.id) === projectId);
  if (!workspaces.length) throw new Error("BOARD_PROJECT_UNAUTHORIZED: Project is not in the authorized Workspace set");
  for (const workspace of workspaces) requireAuthorizedWorkspaceId(workspace.id);
  return workspaces;
}

function localSubjectHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function recordLocalProductEvent(kind: LocalProductEventKind, dimensions: Parameters<LocalProductEventStore["record"]>[1] = {}): void {
  try {
    localProductEventStore?.record(kind, dimensions);
  } catch (error) {
    console.error(`[local-metrics] ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireAuthorizedWorkspaceId(workspaceId?: string): string {
  const state = requireWorkspaceState();
  const requestedId = workspaceId ?? state.active.id;
  if (!state.recent.some((workspace) => workspace.id === requestedId)) {
    throw new Error("Task state may only be accessed for an authorized workspace");
  }
  return requestedId;
}

function activateWorkspace(inputPath: string, allowNew: boolean): Promise<WorkspaceState> {
  const transition = workspaceTransition.catch(() => undefined).then(async () => {
    const current = requireWorkspaceState();
    const resolvedPath = realpathSync(resolve(inputPath));
    if (!allowNew && !current.recent.some((workspace) => workspace.path === resolvedPath)) {
      throw new Error("Workspace must be selected through the native folder picker first");
    }

    const active = inspectWorkspace(resolvedPath);
    await stopRuntimeProcess("workspace switch");
    const nextState: WorkspaceState = {
      active,
      recent: [active, ...current.recent.filter((workspace) => workspace.path !== active.path && !workspace.placeholder)].slice(0, 8),
    };
    workspaceState = nextState;
    workspaceAuthorizationSource = "picker";
    persistWorkspaceState();
    startRuntimeProcess();
    return nextState;
  });
  workspaceTransition = transition.then(() => undefined, () => undefined);
  return transition;
}

function emitToRenderers(event: RuntimeEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    try {
      window.webContents.send(IPC_CHANNELS.event, event);
    } catch {
      // A concurrently disappearing Renderer must not interrupt fail-closed cleanup.
    }
  }
}

function rejectPendingRequests(message: string): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
    pendingRequests.delete(id);
  }
}

function holdPendingRequests(): PendingRequest[] {
  const held = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const pending of held) clearTimeout(pending.timeout);
  return held;
}

function rejectHeldRequests(held: PendingRequest[], message: string): void {
  for (const pending of held) pending.reject(new Error(message));
}

function observeRuntimeExit(child: UtilityProcess): Promise<number> {
  const existing = runtimeExitPromises.get(child);
  if (existing) return existing;
  const exit = new Promise<number>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code ?? -1));
  });
  runtimeExitPromises.set(child, exit);
  return exit;
}

async function waitForRuntimeExit(child: UtilityProcess, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
  });
  const exited = await Promise.race([
    observeRuntimeExit(child).then(() => true as const),
    timedOut,
  ]);
  if (timeout) clearTimeout(timeout);
  return exited;
}

function handleRuntimeMessage(message: RuntimeWireMessage): void {
  if (message.kind === "event") {
    if (message.event.type === "run.started") {
      const subjectHash = message.event.resumeSessionId ? localSubjectHash(message.event.resumeSessionId) : undefined;
      if (subjectHash) {
        activeRunSubjects.set(message.event.runId, subjectHash);
        recordLocalProductEvent("session-continued", { subjectHash, engine: message.event.adapter });
        if (localProductEventStore?.has("run-failed", subjectHash)) recordLocalProductEvent("error-recovery-attempted", { subjectHash, engine: message.event.adapter });
      }
    } else if (message.event.type === "run.failed") {
      const subjectHash = message.event.resumeSessionId ? localSubjectHash(message.event.resumeSessionId) : activeRunSubjects.get(message.event.runId);
      recordLocalProductEvent("run-failed", { ...(subjectHash ? { subjectHash } : {}) });
      activeRunSubjects.delete(message.event.runId);
    } else if (message.event.type === "run.completed") {
      const subjectHash = activeRunSubjects.get(message.event.runId);
      recordLocalProductEvent("run-succeeded", { ...(subjectHash ? { subjectHash } : {}) });
      if (subjectHash && localProductEventStore?.has("run-failed", subjectHash)) recordLocalProductEvent("error-recovered", { subjectHash });
      activeRunSubjects.delete(message.event.runId);
    } else if (message.event.type === "run.cancelled") {
      activeRunSubjects.delete(message.event.runId);
    }
    emitToRenderers(message.event);
    if (message.event.type === "runtime.ready") void syncNativeProviderConnections().catch((error) => {
      console.error(`[runtime] Native Provider sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return;
  }

  const pending = pendingRequests.get(message.id);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);

  if (message.ok) {
    pending.resolve(message.result);
  } else {
    pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
  }
}

function requireNativeProviderStore(): NativeProviderStore {
  if (!nativeProviderStore) throw new Error("Rux Native Provider store is unavailable");
  return nativeProviderStore;
}

function nativeCredentialStorageBackend(): string {
  if (process.platform === "linux") return `safeStorage:${safeStorage.getSelectedStorageBackend()}`;
  return `safeStorage:${process.platform}`;
}

function nativeProviderImpactPreview(params: NativeProviderConnectionImpactPreviewParams): NativeProviderConnectionImpactPreview {
  const connection = requireNativeProviderStore().list().find((item) => item.id === params.id);
  if (!connection) throw new Error("Native Provider Connection not found");
  const agents = (agentProfileStore?.list() ?? [])
    .filter((profile) => profile.providerConnection.id === params.id)
    .map((profile) => ({ id: profile.id, name: profile.name, revisionNumber: profile.revisionNumber }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const tasks = requireTaskStore().listProviderConnectionTaskImpacts(params.id)
    .sort((left, right) => `${left.workspaceId}:${left.taskId}`.localeCompare(`${right.workspaceId}:${right.taskId}`));
  const normalizedNext = params.next ? { ...params.next, baseUrl: params.next.baseUrl.replace(/\/+$/, ""), customHeaderNames: params.next.customHeaderNames?.map((name) => name.trim()).sort((left, right) => left.localeCompare(right)) } : undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    connection: { id: connection.id, label: connection.label, providerType: connection.providerType, baseUrl: connection.baseUrl, defaultModel: connection.defaultModel, hasCredential: connection.hasCredential, customHeaderNames: connection.customHeaderNames, updatedAt: connection.updatedAt },
    action: params.action,
    next: normalizedNext,
    agents,
    tasks,
  })).digest("hex");
  return { connectionId: connection.id, connectionLabel: connection.label, action: params.action, agents, tasks, deletesCredential: params.action === "delete", fingerprint };
}

function assertNativeProviderImpactFingerprint(params: NativeProviderConnectionImpactPreviewParams, fingerprint: string | undefined): void {
  if (!fingerprint || nativeProviderImpactPreview(params).fingerprint !== fingerprint) {
    throw new Error("Connection 影响已变化，请重新预览并确认");
  }
}

async function syncNativeProviderConnections(): Promise<void> {
  const store = requireNativeProviderStore();
  await requestRuntime({
    kind: "request",
    id: `provider-sync-${randomUUID()}`,
    method: "provider.connection.sync",
    params: { connections: store.runtimeCredentials() },
  });
}

function startRuntimeProcess(): void {
  if (runtimeProcess) return;

  const currentWorkspaceState = requireWorkspaceState();
  const workspaceRoot = currentWorkspaceState.active.path;
  const authorizedWorkspaces = currentWorkspaceState.recent
    .filter((workspace) => !workspace.placeholder)
    .map(({ id, name, path }) => ({ id, name, path }));
  const { port1, port2 } = new MessageChannelMain();

  runtimePort = port2;
  runtimePort.on("message", (event) => {
    handleRuntimeMessage(event.data as RuntimeWireMessage);
  });
  runtimePort.on("close", () => {
    const wasActivePort = runtimePort === port2;
    if (wasActivePort) runtimePort = null;
    if (runtimeStopPromise) {
      rejectPendingRequests("Rux Runtime connection closed");
    } else if (wasActivePort && runtimeProcess) {
      void stopRuntimeProcess("Runtime connection closed");
    }
  });
  runtimePort.start();

  const child = utilityProcess.fork(runtimePath, [], {
    serviceName: "Rux Runtime",
    stdio: "pipe",
    env: {
      ...process.env,
      RUX_WORKSPACE_ROOT: workspaceRoot,
      RUX_AUTHORIZED_WORKSPACES: JSON.stringify(authorizedWorkspaces),
      RUX_STATE_ROOT: app.getPath("userData"),
      RUX_ENABLE_MOCK: app.isPackaged ? "0" : "1",
    },
  });
  runtimeProcess = child;
  void observeRuntimeExit(child);

  child.stdout?.on("data", (chunk) => {
    console.log(`[runtime] ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on("data", (chunk) => {
    console.error(`[runtime] ${String(chunk).trimEnd()}`);
  });
  child.on("exit", (code) => {
    const exitCode = code ?? -1;
    const wasActiveProcess = runtimeProcess === child;
    if (wasActiveProcess) {
      runtimeProcess = null;
      if (runtimePort === port2) {
        runtimePort.close();
        runtimePort = null;
      }
      emitToRenderers({ type: "runtime.stopped", exitCode });
    }
    if (wasActiveProcess || runtimeStopPromise) {
      rejectPendingRequests(`Rux Runtime exited with code ${exitCode}`);
    }
  });

  child.postMessage({ kind: "connect" }, [port1]);
}

function requestRuntimeOnPort(
  port: MessagePortMain,
  request: RuntimeRequest,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.id);
      rejectRequest(new Error(`Rux Runtime request timed out: ${request.method}`));
    }, timeoutMs);
    pendingRequests.set(request.id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timeout,
    });
    try {
      port.postMessage(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(request.id);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function performRuntimeStop(reason: string): Promise<void> {
  const child = runtimeProcess;
  const port = runtimePort;
  let exitCode = child ? -1 : 0;
  if (child) void observeRuntimeExit(child).then((code) => {
    exitCode = code;
  });
  runtimeProcess = null;
  runtimePort = null;
  const heldRequests = holdPendingRequests();

  try {
    if (port) {
      const request: RuntimeRequest<"runtime.shutdown"> = {
        kind: "request",
        id: `runtime-shutdown-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        method: "runtime.shutdown",
        params: { reason },
      };
      try {
        await requestRuntimeOnPort(port, request, RUNTIME_SHUTDOWN_TIMEOUT_MS);
      } catch (error) {
        console.error(`[runtime] Graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (child && !await waitForRuntimeExit(child, RUNTIME_EXIT_TIMEOUT_MS)) {
      child.kill();
      if (!await waitForRuntimeExit(child, RUNTIME_SIGTERM_EXIT_TIMEOUT_MS)) {
        try {
          if (child.pid) process.kill(child.pid, "SIGKILL");
          else child.kill();
        } catch {
          // The Utility Process exited between the wait and the force signal.
        }
        if (!await waitForRuntimeExit(child, RUNTIME_SIGKILL_EXIT_TIMEOUT_MS)) {
          console.error(`[runtime] Utility Process ${child.pid} did not report exit after SIGKILL`);
        }
      }
    }
  } finally {
    try {
      port?.close();
    } catch {
      // The Runtime already closed its side of the MessagePort.
    }
    rejectPendingRequests("Rux Runtime stopped");
    rejectHeldRequests(heldRequests, `Rux Runtime stopped: ${reason}`);
    if (child) emitToRenderers({ type: "runtime.stopped", exitCode });
  }
}

function stopRuntimeProcess(reason: string): Promise<void> {
  if (runtimeStopPromise) return runtimeStopPromise;
  const stopping = Promise.resolve().then(() => performRuntimeStop(reason));
  const tracked = stopping.finally(() => {
    if (runtimeStopPromise === tracked) runtimeStopPromise = null;
  });
  runtimeStopPromise = tracked;
  return tracked;
}

async function requestRuntime(request: RuntimeRequest): Promise<unknown> {
  await workspaceTransition;
  if (runtimeStopPromise) await runtimeStopPromise;
  if (!runtimePort || !runtimeProcess) {
    startRuntimeProcess();
  }
  if (!runtimePort) {
    return Promise.reject(new Error("Rux Runtime is unavailable"));
  }

  const port = runtimePort;
  if (!port) return Promise.reject(new Error("Rux Runtime is unavailable"));
  return new Promise((resolveRequest, rejectRequest) => {
    const policy = runtimeRequestPolicy(request.method);
    const timeout = setTimeout(() => {
      const pending = pendingRequests.get(request.id);
      if (!pending) return;
      pendingRequests.delete(request.id);
      if (policy.timeoutAction === "stop-runtime") {
        void failClosedTimeout(
          request.method,
          () => stopRuntimeProcess(`request timeout: ${request.method}`),
        ).catch(rejectRequest);
      } else {
        rejectRequest(new Error(`Rux Runtime request timed out: ${request.method}`));
      }
    }, policy.timeoutMs);

    pendingRequests.set(request.id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timeout,
    });
    try {
      port.postMessage(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(request.id);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function performImprovementEvaluation(parsed: ImprovementEvaluateParams): Promise<ImprovementSummary> {
  const candidate = requireImprovementStore().getCandidate(parsed.candidateId);
  if (!candidate?.projectId) throw new Error("IMPROVEMENT_EVALUATION_PROJECT_REQUIRED: Candidate is not bound to a Project");
  requireAuthorizedProjectWorkspaces(candidate.projectId);
  const active = requireWorkspaceState().active;
  if ((active.projectId ?? active.id) !== candidate.projectId) throw new Error("IMPROVEMENT_EVALUATION_PROJECT_INACTIVE: Open the candidate Project before evaluation");
  const settings = requireImprovementStore().summary(candidate.projectId).settings;
  if (settings.onlyWhenIdle && activeRunSubjects.size > 0) throw new Error("IMPROVEMENT_EVALUATION_NOT_IDLE: Wait for active Runs to finish");
  if (settings.onlyOnAcPower && powerMonitor.isOnBatteryPower()) throw new Error("IMPROVEMENT_EVALUATION_POWER_POLICY: Evaluation is restricted to AC power");

  let adapter: "codex" | "claude-code";
  let evaluatorAgentRevisionId: string;
  let profileId: string | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  let evaluatorInstructions = "";
  const customProfile = agentProfileStore?.get(parsed.evaluatorAgentId);
  if (customProfile) {
    if (customProfile.backend !== "codex" && customProfile.backend !== "claude-code") throw new Error("IMPROVEMENT_EVALUATOR_UNSUPPORTED: Evaluator must use Codex or Claude Code with isolated-session support");
    adapter = customProfile.backend;
    evaluatorAgentRevisionId = customProfile.latestRevisionId;
    profileId = customProfile.id;
    model = customProfile.model;
    reasoningEffort = customProfile.reasoningEffort;
    evaluatorInstructions = customProfile.instructions;
  } else if (parsed.evaluatorAgentId === "codex" || parsed.evaluatorAgentId === "claude-code") {
    adapter = parsed.evaluatorAgentId;
    evaluatorAgentRevisionId = builtInAgentRevisionId(adapter);
  } else {
    throw new Error("IMPROVEMENT_EVALUATOR_UNAVAILABLE: Select a connected built-in or custom Codex/Claude Code Agent");
  }
  const reservation = requireImprovementStore().reserveEvaluation(candidate.projectId);
  try {
    const record = improvementEvaluationRecordSchema.parse(await requestRuntime({
      kind: "request",
      id: `improvement-evaluation-${randomUUID()}`,
      method: "improvement.evaluation.run",
      params: {
        operationId: `improvement-evaluation-${randomUUID()}`,
        candidateId: candidate.id,
        projectId: candidate.projectId,
        candidateContent: candidate.content,
        adapter,
        evaluatorAgentId: parsed.evaluatorAgentId,
        evaluatorAgentRevisionId,
        ...(profileId ? { profileId } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(evaluatorInstructions ? { evaluatorInstructions } : {}),
        cases: parsed.cases,
      },
    })) as ImprovementEvaluationRecord;
    return requireImprovementStore().recordEvaluation(reservation.id, record);
  } catch (error) {
    requireImprovementStore().failEvaluation(reservation.id);
    throw error;
  }
}

async function maybeRunBackgroundImprovementEvaluation(): Promise<void> {
  if (backgroundImprovementRunning || !improvementStore || !workspaceState || workspaceState.active.placeholder) return;
  const projectId = workspaceState.active.projectId ?? workspaceState.active.id;
  const summary = improvementStore.summary(projectId);
  const settings = summary.settings;
  if (!settings.backgroundModelReview || settings.paused || !settings.evaluatorAgentId) return;
  const today = new Date().toISOString().slice(0, 10);
  const candidate = summary.candidates.find((item) => ["pending", "snoozed"].includes(item.status)
    && summary.evaluations.some((evaluation) => evaluation.candidateId === item.id)
    && !summary.evaluations.some((evaluation) => evaluation.candidateId === item.id && evaluation.createdAt.startsWith(today)));
  if (!candidate) return;
  const prior = [...summary.evaluations].reverse().find((evaluation) => evaluation.candidateId === candidate.id);
  if (!prior) return;
  backgroundImprovementRunning = true;
  try {
    await performImprovementEvaluation({ candidateId: candidate.id, evaluatorAgentId: settings.evaluatorAgentId, cases: prior.cases });
  } catch (error) {
    console.error(`[improvement-background] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    backgroundImprovementRunning = false;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.desktopInfo, (event): DesktopInfo => {
    assertTrustedRenderer(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle(IPC_CHANNELS.request, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = runtimeRequestSchema.parse(input) as RuntimeRequest;
    if (
      ["runtime.shutdown", "session.list", "session.import", "session.refresh", "session.rebuild", "session.revision.list", "session.revision.restore", "session.attribution.migrate", "session.read", "session.resume.check", "handoff.preview", "handoff.commit", "local.data.summary", "local.data.preview", "local.data.execute", "local.data.export"].includes(parsed.method)
      || ["provider.connection.sync", "provider.connection.test", "git.worktree.create", "improvement.evaluation.run"].includes(parsed.method)
    ) {
      throw new Error("This Runtime method is not exposed to the Renderer");
    }
    const result = await requestRuntime(parsed);
    if (parsed.method === "auth.status") recordLocalProductEvent("cli-detection");
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.workspaceState, (event): WorkspaceState => {
    assertTrustedRenderer(event);
    return requireWorkspaceState();
  });

  ipcMain.handle(IPC_CHANNELS.workspaceChoose, async (event): Promise<WorkspaceState | null> => {
    assertTrustedRenderer(event);
    const activeWorkspace = requireWorkspaceState().active;
    const options: Electron.OpenDialogOptions = {
      title: "选择 Rux 工作区",
      defaultPath: activeWorkspace.placeholder ? app.getPath("documents") : activeWorkspace.path,
      properties: ["openDirectory"],
      buttonLabel: "打开工作区",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return activateWorkspace(result.filePaths[0], true);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceChooseFiles, async (event): Promise<string[]> => {
    assertTrustedRenderer(event);
    const workspace = requireWorkspaceState().active;
    if (workspace.placeholder) throw new Error("请先选择一个项目");
    requireAuthorizedWorkspaceId(workspace.id);
    const workspaceRoot = realpathSync(workspace.path);
    const options: Electron.OpenDialogOptions = {
      title: "添加项目文件到 Agent Context",
      defaultPath: workspaceRoot,
      properties: ["openFile", "multiSelections"],
      buttonLabel: "添加到 Context",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    return result.filePaths.map((selectedPath) => {
      const canonicalPath = realpathSync(selectedPath);
      if (!statSync(canonicalPath).isFile()) throw new Error("Context 只能添加普通文件");
      const workspaceRelativePath = relative(workspaceRoot, canonicalPath);
      if (!workspaceRelativePath || isAbsolute(workspaceRelativePath) || workspaceRelativePath === ".." || workspaceRelativePath.startsWith(`..${sep}`)) {
        throw new Error("所选文件必须位于当前授权 Workspace 内");
      }
      return workspaceRelativePath.split(sep).join("/");
    });
  });

  ipcMain.handle(IPC_CHANNELS.clipboardImageSave, (event, input: unknown): LocalImageAttachment => {
    assertTrustedRenderer(event);
    const workspace = requireWorkspaceState().active;
    if (workspace.placeholder) throw new Error("请先选择一个项目");
    requireAuthorizedWorkspaceId(workspace.id);
    const parsed = clipboardImageSaveParamsSchema.parse(input);
    const bytes = Buffer.from(parsed.dataBase64, "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("粘贴图片必须小于 20 MB");
    const validHeader = parsed.mimeType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : parsed.mimeType === "image/jpeg"
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : parsed.mimeType === "image/gif"
          ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
          : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!validHeader) throw new Error("剪贴板内容与声明的图片格式不匹配");
    const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" }[parsed.mimeType];
    const id = randomUUID();
    const bucket = createHash("sha256").update(realpathSync(workspace.path)).digest("hex").slice(0, 24);
    const directory = resolve(app.getPath("userData"), "clipboard-images", bucket);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, `${id}${extension}`);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    return {
      id,
      name: parsed.name ? basename(parsed.name) : `pasted-image${extension}`,
      mimeType: parsed.mimeType,
      path,
    };
  });

  ipcMain.handle(IPC_CHANNELS.workspaceActivate, async (event, input: unknown): Promise<WorkspaceState> => {
    assertTrustedRenderer(event);
    const parsed = workspaceActivateParamsSchema.parse(input);
    return activateWorkspace(parsed.path, false);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async (event, input: unknown): Promise<WorkspaceOpenResult> => {
    assertTrustedRenderer(event);
    const { target } = workspaceOpenParamsSchema.parse(input ?? {});
    const workspace = requireWorkspaceState().active;
    if (workspace.placeholder) return { opened: false, target, detail: "请先选择一个项目" };
    requireAuthorizedWorkspaceId(workspace.id);

    if (target === "finder") {
      const detail = await shell.openPath(workspace.path);
      return detail
        ? { opened: false, target: "finder", detail }
        : { opened: true, target: "finder" };
    }

    try {
      const workspaceUrl = pathToFileURL(workspace.path);
      await shell.openExternal(`vscode://file${workspaceUrl.pathname}`);
      return { opened: true, target: "vscode" };
    } catch {
      const finderDetail = await shell.openPath(workspace.path);
      return finderDetail
        ? { opened: false, target: "finder", detail: `VS Code 打开失败；Finder 回退失败：${finderDetail}` }
        : { opened: true, target: "finder", detail: "VS Code 打开失败，已回退到 Finder 显示项目目录。" };
    }
  });

  ipcMain.handle(IPC_CHANNELS.taskStateLoad, (event, input: unknown): WorkspaceTaskState => {
    assertTrustedRenderer(event);
    const parsed = taskStateLoadParamsSchema.parse(input ?? {});
    return requireTaskStore().load(requireAuthorizedWorkspaceId(parsed.workspaceId));
  });

  ipcMain.handle(IPC_CHANNELS.taskStateSave, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = workspaceTaskStateSchema.parse(input);
    const welcomeWorkspaceId = inspectWorkspace(resolve(app.getPath("userData"), "welcome-workspace")).id;
    if (parsed.workspaceId === welcomeWorkspaceId) {
      return { workspaceId: parsed.workspaceId, savedAt: new Date().toISOString(), persisted: false };
    }
    requireAuthorizedWorkspaceId(parsed.workspaceId);
    const saved = requireTaskStore().save(parsed);
    return { workspaceId: saved.workspaceId, savedAt: saved.updatedAt, persisted: true };
  });

  ipcMain.handle(IPC_CHANNELS.boardLoad, (event, input: unknown): BoardSnapshot => {
    assertTrustedRenderer(event);
    const parsed = boardLoadParamsSchema.parse(input);
    const workspaces = requireAuthorizedProjectWorkspaces(parsed.projectId);
    const tasks = workspaces.flatMap((workspace) => requireTaskStore().load(workspace.id).tasks);
    return requireBoardStore().load(parsed.projectId, tasks);
  });

  ipcMain.handle(IPC_CHANNELS.boardMutate, (event, input: unknown): BoardSnapshot => {
    assertTrustedRenderer(event);
    const parsed = boardMutationParamsSchema.parse(input);
    const workspaces = requireAuthorizedProjectWorkspaces(parsed.projectId);
    const tasks = workspaces.flatMap((workspace) => requireTaskStore().load(workspace.id).tasks);
    return requireBoardStore().mutate(parsed, tasks);
  });

  ipcMain.handle(IPC_CHANNELS.projectWorkingCopiesList, (event, input: unknown): ProjectWorkingCopy[] => {
    assertTrustedRenderer(event);
    const parsed = projectWorkingCopiesParamsSchema.parse(input);
    return projectWorkingCopies(parsed.projectId);
  });

  ipcMain.handle(IPC_CHANNELS.projectWorkingCopyAuthorize, async (event, input: unknown): Promise<WorkspaceState> => {
    assertTrustedRenderer(event);
    const parsed = projectWorkingCopyAuthorizeParamsSchema.parse(input);
    const candidate = projectWorkingCopies(parsed.projectId).find((workingCopy) => workingCopy.path === resolve(parsed.path));
    if (!candidate || candidate.availability !== "available") throw new Error("WORKTREE_AUTHORIZATION_INVALID: Working copy is unavailable or no longer belongs to this Project");
    if (candidate.authorizationState === "authorized") return requireWorkspaceState();
    const activated = await activateWorkspace(candidate.path, true);
    if ((activated.active.projectId ?? activated.active.id) !== parsed.projectId) throw new Error("WORKTREE_AUTHORIZATION_INVALID: Activated Workspace Project identity changed");
    return activated;
  });

  ipcMain.handle(IPC_CHANNELS.projectWorkingCopyCreate, async (event, input: unknown): Promise<WorkspaceState> => {
    assertTrustedRenderer(event);
    const parsed = projectWorkingCopyCreateParamsSchema.parse(input);
    const workspaces = requireAuthorizedProjectWorkspaces(parsed.projectId);
    const source = workspaces.find((workspace) => workspace.repositoryRoot && workspace.path === workspace.repositoryRoot);
    if (!source) throw new Error("WORKTREE_ROOT_AUTHORIZATION_REQUIRED: Authorize the Project repository root before creating a worktree");
    if ((requireWorkspaceState().active.projectId ?? requireWorkspaceState().active.id) !== parsed.projectId || requireWorkspaceState().active.id !== source.id) {
      await activateWorkspace(source.path, false);
    }
    const result = gitWorktreeCreateResultSchema.parse(await requestRuntime({
      kind: "request",
      id: `worktree-create-${randomUUID()}`,
      method: "git.worktree.create",
      params: { path: parsed.path, branch: parsed.branch, confirmed: true },
    }));
    const inspected = inspectWorkspace(result.path);
    if ((inspected.projectId ?? inspected.id) !== parsed.projectId) throw new Error("WORKTREE_IDENTITY_MISMATCH: Created path did not retain the source Git common dir");
    return activateWorkspace(result.path, true);
  });

  ipcMain.handle(IPC_CHANNELS.improvementSummary, (event, input: unknown): ImprovementSummary => {
    assertTrustedRenderer(event);
    const parsed = improvementSummaryParamsSchema.parse(input ?? {});
    if (parsed.projectId) requireAuthorizedProjectWorkspaces(parsed.projectId);
    return requireImprovementStore().summary(parsed.projectId);
  });

  ipcMain.handle(IPC_CHANNELS.improvementAnalyze, (event, input: unknown): ImprovementSummary => {
    assertTrustedRenderer(event);
    const parsed = improvementAnalyzeParamsSchema.parse(input);
    const workspaces = requireAuthorizedProjectWorkspaces(parsed.projectId);
    const tasks = workspaces.flatMap((workspace) => requireTaskStore().load(workspace.id).tasks);
    return requireImprovementStore().analyze(parsed.projectId, tasks);
  });

  ipcMain.handle(IPC_CHANNELS.improvementEvaluate, async (event, input: unknown): Promise<ImprovementSummary> => {
    assertTrustedRenderer(event);
    return performImprovementEvaluation(improvementEvaluateParamsSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.improvementDecide, (event, input: unknown): ImprovementSummary => {
    assertTrustedRenderer(event);
    const parsed = improvementDecideParamsSchema.parse(input);
    const candidate = requireImprovementStore().getCandidate(parsed.candidateId);
    if (!candidate) throw new Error("IMPROVEMENT_CANDIDATE_MISSING: Candidate no longer exists");
    if (candidate?.projectId) requireAuthorizedProjectWorkspaces(candidate.projectId);
    if (candidate.type === "agent-instruction" && (parsed.action === "publish" || parsed.action === "rollback")) {
      const profiles = agentProfileStore;
      if (!profiles) throw new Error("Rux Agent Profile Store is unavailable");
      return parsed.action === "publish"
        ? publishAgentInstructionCandidate(requireImprovementStore(), profiles, candidate.id, parsed.editedContent)
        : rollbackAgentInstructionCandidate(requireImprovementStore(), profiles, candidate.id);
    }
    return requireImprovementStore().decide(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.improvementSettingsUpdate, (event, input: unknown): ImprovementSummary => {
    assertTrustedRenderer(event);
    const parsed = improvementSettingsUpdateParamsSchema.parse(input);
    return requireImprovementStore().updateSettings(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.improvementPropose, (event, input: unknown): ImprovementSummary => {
    assertTrustedRenderer(event);
    const parsed = improvementProposeParamsSchema.parse(input);
    requireAuthorizedProjectWorkspaces(parsed.projectId);
    if (parsed.type === "agent-instruction") {
      const profile = parsed.agentProfileId ? agentProfileStore?.get(parsed.agentProfileId) : undefined;
      if (!profile) throw new Error("IMPROVEMENT_AGENT_TARGET_MISSING: Select an existing custom Agent Definition");
      return requireImprovementStore().propose(parsed, { agentProfileId: profile.id, agentRevisionId: profile.latestRevisionId });
    }
    return requireImprovementStore().propose(parsed);
  });

  ipcMain.handle(IPC_CHANNELS.improvementExportPreview, async (event, input: unknown): Promise<ImprovementExportPreview | null> => {
    assertTrustedRenderer(event);
    const parsed = improvementExportPreviewParamsSchema.parse(input);
    const summary = requireImprovementStore().summary();
    const asset = summary.assets.find((item) => item.id === parsed.assetId && item.status === "active");
    if (!asset) throw new Error("IMPROVEMENT_ASSET_UNAVAILABLE: Only an active immutable asset can be exported");
    const candidate = summary.candidates.find((item) => item.id === asset.candidateId);
    const rendered = improvementAssetContent(asset, candidate?.expectedBenefit ?? "", parsed.target);
    let baseDirectory: string;
    let filePath: string;
    if (parsed.target === "project-codex") {
      if (!parsed.projectId) throw new Error("IMPROVEMENT_EXPORT_PROJECT_REQUIRED: Project export requires a Project");
      const workspaces = requireAuthorizedProjectWorkspaces(parsed.projectId);
      const root = workspaces.find((workspace) => workspace.repositoryRoot && workspace.path === workspace.repositoryRoot);
      if (!root?.repositoryRoot) throw new Error("IMPROVEMENT_EXPORT_ROOT_REQUIRED: Authorize the repository root before exporting a Project Skill");
      baseDirectory = root.repositoryRoot;
      filePath = resolve(baseDirectory, ".agents", "skills", rendered.fileName);
    } else if (parsed.target === "user-codex") {
      baseDirectory = homedir();
      filePath = resolve(baseDirectory, ".agents", "skills", rendered.fileName);
    } else {
      const options: Electron.OpenDialogOptions = { title: "选择 Rux 资产导出目录", properties: ["openDirectory", "createDirectory"], buttonLabel: "选择导出目录" };
      const selected = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths[0]) return null;
      baseDirectory = realpathSync(selected.filePaths[0]);
      filePath = resolve(baseDirectory, rendered.fileName);
    }
    assertImprovementExportPath(baseDirectory, filePath);
    let before = "";
    if (existsSync(filePath)) {
      const status = statSync(filePath);
      if (!status.isFile() || status.size > 1024 * 1024) throw new Error("IMPROVEMENT_EXPORT_TARGET_INVALID: Existing export target is not a bounded regular file");
      before = readFileSync(filePath, "utf8");
    }
    const beforeHash = existsSync(filePath) ? improvementFileHash(before) : undefined;
    const afterHash = improvementFileHash(rendered.content);
    const previewId = randomUUID();
    const expiresAt = Date.now() + 10 * 60_000;
    improvementExportPreviews.set(previewId, { assetId: asset.id, target: parsed.target, filePath, baseDirectory, content: rendered.content, ...(beforeHash ? { beforeHash } : {}), afterHash, expiresAt });
    return { id: previewId, assetId: asset.id, target: parsed.target, engine: rendered.engine, filePath, exists: beforeHash !== undefined, ...(beforeHash ? { beforeHash } : {}), afterHash, diff: improvementExportDiff(before, rendered.content), expiresAt: new Date(expiresAt).toISOString() };
  });

  ipcMain.handle(IPC_CHANNELS.improvementExportCommit, (event, input: unknown): ImprovementExportResult => {
    assertTrustedRenderer(event);
    const parsed = improvementExportCommitParamsSchema.parse(input);
    const preview = improvementExportPreviews.get(parsed.previewId);
    improvementExportPreviews.delete(parsed.previewId);
    if (!preview || preview.expiresAt < Date.now()) throw new Error("IMPROVEMENT_EXPORT_PREVIEW_STALE: Export preview is missing or expired");
    const asset = requireImprovementStore().summary().assets.find((item) => item.id === preview.assetId && item.status === "active");
    if (!asset) throw new Error("IMPROVEMENT_ASSET_UNAVAILABLE: Asset changed after preview");
    assertImprovementExportPath(preview.baseDirectory, preview.filePath);
    const current = existsSync(preview.filePath) ? readFileSync(preview.filePath, "utf8") : "";
    const currentHash = existsSync(preview.filePath) ? improvementFileHash(current) : undefined;
    if (currentHash !== preview.beforeHash) throw new Error("IMPROVEMENT_EXPORT_PREVIEW_STALE: Export target changed after preview");
    if (improvementFileHash(preview.content) !== preview.afterHash) throw new Error("IMPROVEMENT_EXPORT_PREVIEW_STALE: Proposed asset content changed after preview");
    mkdirSync(dirname(preview.filePath), { recursive: true });
    const temporary = `${preview.filePath}.rux-${randomUUID()}.tmp`;
    writeFileSync(temporary, preview.content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, preview.filePath);
    return { assetId: preview.assetId, target: preview.target, filePath: preview.filePath, bytes: Buffer.byteLength(preview.content), exportedAt: new Date().toISOString() };
  });

  ipcMain.handle(IPC_CHANNELS.sessionImport, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionImportParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    if (active.placeholder || parsed.activeWorkspaceId !== active.id) {
      throw new Error("Session import requires the active authorized Workspace");
    }
    requireAuthorizedWorkspaceId(active.id);
    const { mode, ...previewInput } = parsed;
    const previewParams = sessionPreviewParamsSchema.parse(previewInput);
    const requestId = `session-import-${createHash("sha256")
      .update(`${Date.now()}:${parsed.operationId}:${parsed.nativeSessionId}`)
      .digest("hex").slice(0, 32)}`;
    const preview = sessionPreviewResultSchema.parse(await requestRuntime({
      kind: "request",
      id: requestId,
      method: "session.preview",
      params: previewParams,
    }));
    const imported = requireTaskStore().importExternalSession({
      workspaceId: active.id,
      workspaceBranch: active.branch,
      preview,
      mode,
    });
    recordLocalProductEvent(imported.created ? "session-imported" : "session-import-deduplicated", { subjectHash: localSubjectHash(preview.identityKey), engine: preview.metadata.engine, mode });
    if (mode === "continue") recordLocalProductEvent("session-continued", { subjectHash: localSubjectHash(preview.identityKey), engine: preview.metadata.engine, mode });
    return imported;
  });

  ipcMain.handle(IPC_CHANNELS.sessionAttributionMigrate, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionAttributionMigrateParamsSchema.parse(input);
    const workspaceState = requireWorkspaceState();
    const target = workspaceState.recent.find((workspace) => workspace.id === parsed.targetWorkspaceId && !workspace.placeholder);
    const previous = workspaceState.recent.find((workspace) => workspace.id === parsed.expectedPreviousWorkspaceId && !workspace.placeholder);
    if (!target || !previous) throw new Error("Session migration requires both Workspaces to remain authorized");
    const migrated = sessionAttributionMigrateResultSchema.parse(await requestRuntime({
      kind: "request",
      id: `session-attribution-migrate-${randomUUID()}`,
      method: "session.attribution.migrate",
      params: parsed,
    }));
    const movedTaskId = requireTaskStore().migrateImportedSessionWorkspace(
      parsed.identityKey,
      parsed.expectedPreviousWorkspaceId,
      parsed.targetWorkspaceId,
      target.branch,
    );
    return sessionAttributionMigrateResultSchema.parse({
      ...migrated,
      ...(movedTaskId ? { movedTaskId } : {}),
    });
  });

  ipcMain.handle(IPC_CHANNELS.sessionRefresh, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionRefreshParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    if (active.placeholder) throw new Error("Session refresh requires the active authorized Workspace");
    const state = requireTaskStore().load(requireAuthorizedWorkspaceId(active.id));
    const task = state.tasks.find((candidate) => candidate.id === parsed.taskId);
    const link = task?.importedSession?.sessionLink;
    if (!task || !link || (link.engine !== "codex" && link.engine !== "claude-code")) throw new Error("Imported Session Task was not found");
    if (task.importedSession?.status === "unlinked") throw new Error("This imported Session is unlinked; explicitly import it again before refreshing");
    const previewParams = sessionPreviewParamsSchema.parse({
      operationId: parsed.operationId,
      engine: link.engine,
      providerConnection: task.providerConnection,
      activeWorkspaceId: active.id,
      nativeSessionId: link.nativeSessionId,
      limit: 100,
    });
    try {
      const preview = sessionPreviewResultSchema.parse(await requestRuntime({
        kind: "request",
        id: `session-refresh-${createHash("sha256").update(`${Date.now()}:${parsed.operationId}:${task.id}`).digest("hex").slice(0, 32)}`,
        method: "session.preview",
        params: previewParams,
      }));
      return requireTaskStore().refreshExternalSession({ workspaceId: active.id, taskId: task.id, preview });
    } catch (error) {
      requireTaskStore().recordSessionAuditFailure(active.id, task.id, "refresh");
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessionRebuild, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionRebuildParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    try {
      return requireTaskStore().activateSessionRevision(active.id, parsed.taskId, parsed.candidateRevisionId, "rebuild");
    } catch (error) {
      requireTaskStore().recordSessionAuditFailure(active.id, parsed.taskId, "rebuild");
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.sessionRevisionList, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionRevisionListParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    return requireTaskStore().listSessionRevisions(active.id, parsed.taskId);
  });

  ipcMain.handle(IPC_CHANNELS.sessionRevisionRestore, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = sessionRevisionRestoreParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    try {
      return requireTaskStore().activateSessionRevision(active.id, parsed.taskId, parsed.revisionId, "restore");
    } catch (error) {
      requireTaskStore().recordSessionAuditFailure(active.id, parsed.taskId, "restore");
      throw error;
    }
  });

  const resolveHandoffTarget = (targetAgentId: string): HandoffTarget => {
    if (targetAgentId === "codex" || targetAgentId === "claude-code") {
      const adapter = targetAgentId;
      const model = adapter === "codex" ? "Rux default" : "Claude default";
      return { agentId: adapter, agentName: adapter === "codex" ? "Rux" : "Claude Code", adapter, agentRevisionId: builtInAgentRevisionId(adapter), providerConnection: defaultProviderConnectionForAdapter(adapter), model, ...defaultModelState(model), permissionMode: "acceptEdits" as const };
    }
    const profile = agentProfileStore?.get(targetAgentId);
    if (!profile) throw new Error("Handoff target Agent was not found");
    return { agentId: profile.id, agentName: profile.name, adapter: profile.backend, agentProfileId: profile.id, agentRevisionId: profile.latestRevisionId, providerConnection: profile.providerConnection, model: profile.model || (profile.backend === "codex" ? "Rux default" : "Claude default"), modelSource: profile.modelSource, modelVerificationStatus: profile.modelVerificationStatus, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}), permissionMode: profile.permissionMode };
  };

  ipcMain.handle(IPC_CHANNELS.handoffPreview, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = handoffPreviewParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    const source = requireTaskStore().load(active.id).tasks.find((task) => task.id === parsed.sourceTaskId);
    if (!source) throw new Error("Handoff source Task was not found");
    return requireTaskStore().previewContextHandoff({ workspaceId: active.id, sourceTaskId: source.id, target: resolveHandoffTarget(parsed.targetAgentId), messageIds: parsed.messageIds, filePaths: parsed.filePaths, sourceAgentAvailable: source.status !== "interrupted" });
  });

  ipcMain.handle(IPC_CHANNELS.handoffSummaryGenerate, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = handoffSummaryGenerateParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    const source = requireTaskStore().load(active.id).tasks.find((task) => task.id === parsed.sourceTaskId);
    if (!source) throw new Error("Handoff source Task was not found");
    if (source.adapter !== "codex" && source.adapter !== "claude-code") throw new Error("The source Agent cannot generate a handoff summary");
    const preview = requireTaskStore().previewContextHandoff({
      workspaceId: active.id,
      sourceTaskId: source.id,
      target: resolveHandoffTarget(parsed.targetAgentId),
      messageIds: parsed.messageIds,
      filePaths: parsed.filePaths,
      sourceAgentAvailable: source.status !== "interrupted",
    });
    if (preview.fingerprint !== parsed.fingerprint) throw new Error("Handoff source facts changed; review the preview again");
    const factsJson = JSON.stringify(preview.facts, null, 2);
    const prompt = [
      "Generate an optional narrative Context Handoff summary from the deterministic facts below.",
      "Use only these facts. Do not inspect the workspace, invoke tools, or add assumptions.",
      "Cover the goal, confirmed decisions, current progress, blockers, and recommended next steps when present.",
      "Return concise plain text only. The user will review and may edit or remove it before confirmation.",
      `Deterministic facts:\n${factsJson}`,
    ].join("\n\n");
    if (prompt.length > 100_000) throw new Error("Selected handoff facts are too large for summary generation; deselect some messages");
    const operationId = `handoff-summary-generation-${randomUUID()}`;
    const generated = handoffSummaryGenerateResultSchema.parse(await requestRuntime({
      kind: "request",
      id: operationId,
      method: "handoff.summary.generate",
      params: {
        operationId,
        adapter: source.adapter,
        prompt,
        ...(!source.model.toLowerCase().includes("default") ? { model: source.model } : {}),
        ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
        ...(source.agentProfileId ? { profileId: source.agentProfileId } : {}),
        agentRevisionId: source.agentRevisionId,
        providerConnection: source.providerConnection,
      },
    }));
    handoffSummaryGenerations.set(generated.generationId, {
      sourceTaskId: source.id,
      fingerprint: parsed.fingerprint,
      provenance: generated.provenance,
      expiresAt: Date.now() + 15 * 60_000,
    });
    return generated;
  });

  ipcMain.handle(IPC_CHANNELS.handoffCommit, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = handoffCommitParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    requireAuthorizedWorkspaceId(active.id);
    let agentSummaryProvenance: HandoffSummaryProvenance | undefined;
    if (parsed.agentSummaryGenerationId) {
      const generation = handoffSummaryGenerations.get(parsed.agentSummaryGenerationId);
      if (!generation || generation.expiresAt < Date.now() || generation.sourceTaskId !== parsed.sourceTaskId || generation.fingerprint !== parsed.fingerprint) {
        throw new Error("Handoff Agent summary is stale; generate it again or remove it before confirming");
      }
      agentSummaryProvenance = generation.provenance;
    }
    const result = requireTaskStore().commitContextHandoff({ workspaceId: active.id, sourceTaskId: parsed.sourceTaskId, target: resolveHandoffTarget(parsed.targetAgentId), messageIds: parsed.messageIds, filePaths: parsed.filePaths, sourceAgentAvailable: true, fingerprint: parsed.fingerprint, ...(parsed.agentSummary ? { agentSummary: parsed.agentSummary } : {}), ...(agentSummaryProvenance ? { agentSummaryProvenance } : {}), ...(parsed.constraints ? { constraints: parsed.constraints } : {}) });
    recordLocalProductEvent("task-branched", { subjectHash: localSubjectHash(parsed.sourceTaskId), mode: "handoff" });
    if (parsed.agentSummaryGenerationId) handoffSummaryGenerations.delete(parsed.agentSummaryGenerationId);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.localDataSummary, (event) => {
    assertTrustedRenderer(event);
    const active = requireWorkspaceState().active;
    if (active.placeholder) throw new Error("Local data requires an active authorized Workspace");
    return requireTaskStore().getLocalDataSummary(requireAuthorizedWorkspaceId(active.id));
  });

  ipcMain.handle(IPC_CHANNELS.localDataPreview, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = localDataPreviewParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    if (active.placeholder) throw new Error("Local data requires an active authorized Workspace");
    return requireTaskStore().previewLocalDataAction(requireAuthorizedWorkspaceId(active.id), parsed);
  });

  ipcMain.handle(IPC_CHANNELS.localDataExecute, (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = localDataExecuteParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    if (active.placeholder) throw new Error("Local data requires an active authorized Workspace");
    return requireTaskStore().executeLocalDataAction(requireAuthorizedWorkspaceId(active.id), parsed);
  });

  ipcMain.handle(IPC_CHANNELS.localDataExport, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = localDataExportParamsSchema.parse(input);
    const active = requireWorkspaceState().active;
    if (active.placeholder) throw new Error("Local data export requires an active authorized Workspace");
    const artifact = requireTaskStore().buildLocalDataExport(
      requireAuthorizedWorkspaceId(active.id),
      parsed.scope,
      parsed.taskId,
      parsed.format,
      parsed.revisions,
    );
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "导出 Rux 本地数据",
      defaultPath: artifact.suggestedName,
      filters: parsed.format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, canceled: true };
    writeFileSync(result.filePath, artifact.content, { encoding: "utf8", mode: 0o600 });
    return { saved: true, canceled: false, filePath: result.filePath, bytes: Buffer.byteLength(artifact.content, "utf8") };
  });

  ipcMain.handle(IPC_CHANNELS.providerConnectionList, (event) => {
    assertTrustedRenderer(event);
    return requireNativeProviderStore().list();
  });

  ipcMain.handle(IPC_CHANNELS.providerConnectionImpactPreview, (event, input: unknown) => {
    assertTrustedRenderer(event);
    return nativeProviderImpactPreview(nativeProviderConnectionImpactPreviewParamsSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.providerConnectionSave, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = nativeProviderConnectionInputSchema.parse(input);
    if (parsed.id) {
      if (!parsed.confirmed) throw new Error("编辑 Connection 前必须确认影响预览");
      assertNativeProviderImpactFingerprint({
        id: parsed.id,
        action: parsed.apiKey || parsed.customHeaders ? "replace-credential" : "update",
        next: { label: parsed.label, providerType: parsed.providerType, baseUrl: parsed.baseUrl, defaultModel: parsed.defaultModel, ...(parsed.customHeaders ? { customHeaderNames: parsed.customHeaders.map((header) => header.name) } : {}) },
      }, parsed.impactFingerprint);
    }
    const { impactFingerprint: _impactFingerprint, confirmed: _confirmed, ...storeInput } = parsed;
    const saved = requireNativeProviderStore().save(storeInput);
    await syncNativeProviderConnections();
    return saved;
  });

  ipcMain.handle(IPC_CHANNELS.providerConnectionDelete, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = nativeProviderConnectionDeleteParamsSchema.parse(input);
    assertNativeProviderImpactFingerprint({ id: parsed.id, action: "delete" }, parsed.impactFingerprint);
    requireNativeProviderStore().delete(parsed.id);
    await syncNativeProviderConnections();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.providerConnectionTest, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const parsed = nativeProviderConnectionTestParamsSchema.parse(input);
    await syncNativeProviderConnections();
    const result = await requestRuntime({
      kind: "request",
      id: `provider-test-${randomUUID()}`,
      method: "provider.connection.test",
      params: parsed,
    }) as import("../shared/protocol").NativeProviderConnectionTestResult;
    requireNativeProviderStore().recordTest(result);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.providerCredentialDiagnostics, (event) => {
    assertTrustedRenderer(event);
    return requireNativeProviderStore().diagnose(nativeCredentialStorageBackend());
  });

  ipcMain.handle(IPC_CHANNELS.providerCredentialMigrate, async (event, input: unknown) => {
    assertTrustedRenderer(event);
    nativeProviderCredentialMigrationParamsSchema.parse(input);
    const result = requireNativeProviderStore().migrateCredentials(nativeCredentialStorageBackend());
    await syncNativeProviderConnections();
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.localProductEventSummary, (event) => {
    assertTrustedRenderer(event);
    if (!localProductEventStore) throw new Error("Local product event store is unavailable");
    return localProductEventStore.summary();
  });

  ipcMain.handle(IPC_CHANNELS.updateState, (event) => {
    assertTrustedRenderer(event);
    if (!updateManager) throw new Error("Update manager is unavailable");
    return updateManager.getState();
  });

  ipcMain.handle(IPC_CHANNELS.updateCheck, async (event) => {
    assertTrustedRenderer(event);
    if (!updateManager) throw new Error("Update manager is unavailable");
    return updateManager.check();
  });

  ipcMain.handle(IPC_CHANNELS.updateDownload, async (event) => {
    assertTrustedRenderer(event);
    if (!updateManager) throw new Error("Update manager is unavailable");
    return updateManager.download();
  });

  ipcMain.handle(IPC_CHANNELS.updateInstall, async (event) => {
    assertTrustedRenderer(event);
    if (!updateManager) throw new Error("Update manager is unavailable");
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = parent
      ? await dialog.showMessageBox(parent, { type: "warning", title: "安装 Rux 更新", message: "立即重启并安装已校验的更新？", detail: "当前 Run 与 Terminal 将停止。更新仅在签名和包哈希校验通过后可安装。", buttons: ["取消", "重启并安装"], defaultId: 0, cancelId: 0, noLink: true })
      : await dialog.showMessageBox({ type: "warning", title: "安装 Rux 更新", message: "立即重启并安装已校验的更新？", buttons: ["取消", "重启并安装"], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response !== 1) return { accepted: false };
    await stopRuntimeProcess("installing signed update");
    taskStore?.close();
    taskStore = null;
    allowQuit = true;
    updateManager.install();
    return { accepted: true };
  });

  ipcMain.handle(IPC_CHANNELS.updateConfirmHealthy, (event) => {
    assertTrustedRenderer(event);
    if (!updateManager) throw new Error("Update manager is unavailable");
    return updateManager.confirmHealthy();
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1433,
    height: 812,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#f5f5f2",
    title: "Rux",
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 17 },
        }
      : {}),
    webPreferences: {
      preload: resolve(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    void stopRuntimeProcess("window destroyed");
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    void stopRuntimeProcess(`renderer process gone: ${details.reason}`);
  });

  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:") void shell.openExternal(target.toString());
    } catch {
      // Malformed and non-HTTPS targets stay inside the fail-closed boundary.
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
  }

  return window;
}

// Keep the existing state directory stable across the visible RUX -> Rux rename,
// while preserving Electron's explicit --user-data-dir override for isolated QA.
const hasExplicitUserDataDirectory = process.argv.some(
  (argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
);
if (!hasExplicitUserDataDirectory) {
  app.setPath("userData", resolve(app.getPath("appData"), "RUX"));
}
app.setName("Rux");

const ownsSingleInstanceLock = app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (ownsSingleInstanceLock) app.whenReady().then(() => {
  initializeWorkspaceState();
  agentProfileStore = new AgentProfileStore(resolve(app.getPath("userData"), "agent-profiles.json"));
  nativeProviderStore = new NativeProviderStore(
    resolve(app.getPath("userData"), "native-provider-connections.json"),
    {
      available: () => safeStorage.isEncryptionAvailable()
        && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    },
  );
  localProductEventStore = new LocalProductEventStore(resolve(app.getPath("userData"), "local-product-events.json"));
  const updateConfig = packagedUpdateConfig();
  updateManager = new UpdateManager({
    updater: updaterPackage.autoUpdater,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    statePath: resolve(app.getPath("userData"), "update-health.json"),
    feedUrl: updateConfig.feedUrl,
    channel: updateConfig.channel,
  });
  taskStore = new TaskStore(
    resolve(app.getPath("userData"), "rux-task-state.sqlite3"),
    undefined,
    (revisionId) => agentProfileStore?.getRevision(revisionId),
  );
  boardStore = new BoardStore(resolve(app.getPath("userData"), "project-boards.json"));
  improvementStore = new ImprovementStore(resolve(app.getPath("userData"), "improvements.json"));
  const restoredInterrupted = requireWorkspaceState().recent
    .filter((workspace) => !workspace.placeholder)
    .flatMap((workspace) => taskStore!.load(workspace.id).tasks)
    .filter((task) => task.status === "interrupted").length;
  if (restoredInterrupted) recordLocalProductEvent("restart-recovery", { count: restoredInterrupted });
  registerIpcHandlers();
  startRuntimeProcess();
  mainWindow = createMainWindow();
  backgroundImprovementTimer = setInterval(() => void maybeRunBackgroundImprovementEvaluation(), 15 * 60_000);
  backgroundImprovementTimer.unref();
  setTimeout(() => {
    if (!updateManager) return;
    if (updateManager.getState().rollbackPending) void updateManager.recoverIfNeeded();
    else void requestRuntime({ kind: "request", id: `update-health-${randomUUID()}`, method: "runtime.ping", params: {} })
      .then(() => updateManager?.confirmHealthy())
      .catch(() => undefined);
  }, 60_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (allowQuit) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  if (backgroundImprovementTimer) clearInterval(backgroundImprovementTimer);
  void stopRuntimeProcess("application quit").finally(() => {
    try {
      taskStore?.close();
      taskStore = null;
    } finally {
      allowQuit = true;
      app.quit();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
