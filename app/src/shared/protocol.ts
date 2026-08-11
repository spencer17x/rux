import { z } from "zod";

export const RUX_PROTOCOL_VERSION = 2 as const;

export const IPC_CHANNELS = {
  request: "rux:runtime:request",
  event: "rux:runtime:event",
  desktopInfo: "rux:desktop:info",
  workspaceState: "rux:workspace:state",
  workspaceChoose: "rux:workspace:choose",
  workspaceActivate: "rux:workspace:activate",
  workspaceOpen: "rux:workspace:open",
  taskStateLoad: "rux:task-state:load",
  taskStateSave: "rux:task-state:save",
} as const;

export const runtimeMethods = [
  "runtime.ping",
  "runtime.shutdown",
  "auth.status",
  "auth.login",
  "auth.cancel",
  "terminal.create",
  "terminal.write",
  "terminal.resize",
  "terminal.dispose",
  "agent.list",
  "agent.model.list",
  "agent.profile.list",
  "agent.profile.create",
  "agent.profile.update",
  "agent.profile.delete",
  "run.start",
  "run.cancel",
  "permission.decide",
  "run.changes.diff",
  "run.changes.accept",
  "run.changes.previewRestore",
  "run.changes.restore",
  "changes.list",
  "changes.diff",
  "changes.previewRestore",
  "changes.restore",
  "changes.accept",
  "git.branches.list",
  "git.branch.switch",
  "git.commit",
  "git.push",
  "git.compare",
  "context.snapshot",
  "task.state.load",
  "task.state.save",
] as const;

export type RuntimeMethod = (typeof runtimeMethods)[number];
export type RendererRuntimeMethod = Exclude<RuntimeMethod, "runtime.shutdown">;

export interface RuntimeStatus {
  protocolVersion: typeof RUX_PROTOCOL_VERSION;
  pid: number;
  platform: NodeJS.Platform;
  workspaceRoot: string;
  startedAt: string;
}

export interface RuntimeShutdownParams {
  reason: string;
}

export interface TerminalCreateParams {
  cwd?: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  terminalId: string;
  shell: string;
  cwd: string;
}

export interface TerminalWriteParams {
  terminalId: string;
  data: string;
}

export interface TerminalResizeParams {
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalDisposeParams {
  terminalId: string;
}

export const authProviderIds = ["claude-code", "chatgpt"] as const;
export type AuthProviderId = (typeof authProviderIds)[number];

export const authConnectionStatuses = ["connected", "signed-out", "not-installed", "error"] as const;
export type AuthConnectionStatus = (typeof authConnectionStatuses)[number];

export const authMethods = ["oauth", "chatgpt", "api-key", "cloud", "unknown"] as const;
export type AuthMethod = (typeof authMethods)[number];

export interface AuthProviderInfo {
  id: AuthProviderId;
  name: string;
  cliName: string;
  status: AuthConnectionStatus;
  installed: boolean;
  canLogin: boolean;
  authMethod?: AuthMethod;
  version?: string;
  executable?: string;
  detail?: string;
}

export interface AuthState {
  providers: AuthProviderInfo[];
  checkedAt: string;
}

export interface AuthLoginParams {
  provider: AuthProviderId;
}

export type AuthCancelParams = AuthLoginParams;

export const runAdapters = ["claude-code", "codex", "mock"] as const;
export type RunAdapter = (typeof runAdapters)[number];

export const permissionModes = ["plan", "acceptEdits", "dontAsk"] as const;
export type PermissionMode = (typeof permissionModes)[number];

/**
 * Codex advertises model-specific effort values through `model/list` and may
 * add values in newer CLI releases. Keep this forward-compatible instead of
 * freezing the Runtime protocol to today's enum.
 */
export const reasoningEffortSchema = z.string().trim().min(1).max(64);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export interface AgentAdapterInfo {
  id: RunAdapter;
  name: string;
  available: boolean;
  version?: string;
  executable?: string;
  detail?: string;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: ReasoningEffort;
  description: string;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: ReasoningEffort;
  isDefault: boolean;
}

export interface AgentModelListParams {
  adapter: "codex";
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}

export interface AgentModelListResult {
  adapter: "codex";
  models: CodexModelInfo[];
  nextCursor?: string | null;
}

export const agentBackends = ["claude-code", "codex"] as const;
export type AgentBackend = (typeof agentBackends)[number];

export interface AgentProfileInput {
  name: string;
  description?: string;
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  permissionMode?: PermissionMode;
  skillIds?: string[];
  toolIds?: string[];
  enabled?: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  permissionMode: PermissionMode;
  skillIds: string[];
  toolIds: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileUpdateParams {
  id: string;
  patch: Partial<AgentProfileInput>;
}

export interface AgentProfileDeleteParams {
  id: string;
}

export interface RunStartParams {
  runId: string;
  adapter: RunAdapter;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: PermissionMode;
  sessionId?: string;
  profileId?: string;
  contextFiles?: string[];
}

export interface RunCancelParams {
  runId: string;
}

export const permissionActions = [
  "workspace.write",
  "command.execute",
  "file.write",
  "network.access",
  "tool.execute",
] as const;
export type PermissionAction = (typeof permissionActions)[number];

export const permissionRequestStatuses = ["pending", "approved", "denied", "cancelled"] as const;
export type PermissionRequestStatus = (typeof permissionRequestStatuses)[number];

export const permissionDecisionValues = ["approved", "denied", "cancelled"] as const;
export type PermissionDecisionValue = (typeof permissionDecisionValues)[number];

export interface PermissionScope {
  kind: "workspace" | "tool";
  path: string;
  appliesTo: "this-run" | "single-action";
}

export interface PermissionRequest {
  id: string;
  runId: string;
  action: PermissionAction;
  scope: PermissionScope;
  impact: string;
  provider?: RunAdapter;
  providerRequestId?: string;
  toolName?: string;
  requestedAt: string;
  status: PermissionRequestStatus;
}

export interface PermissionDecision {
  id: string;
  requestId: string;
  runId: string;
  decision: PermissionDecisionValue;
  source: "user" | "runtime";
  decidedAt: string;
}

export interface PermissionDecideParams {
  runId: string;
  requestId: string;
  decision: Exclude<PermissionDecisionValue, "cancelled">;
}

export interface RunActivity {
  id: string;
  kind: "read" | "edit" | "command" | "tool" | "retry";
  title: string;
  detail: string;
  state: "active" | "done" | "error";
}

export type GitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export type GitDiffLayer = "staged" | "unstaged" | "untracked";

export interface GitDiffStat {
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitFileChange {
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
  isBinary: boolean;
  layers: Partial<Record<GitDiffLayer, GitDiffStat>>;
}

export interface GitChangesSnapshot {
  workspaceRoot: string;
  snapshotId: string;
  files: GitFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
}

export interface GitDiffSection extends GitDiffStat {
  layer: GitDiffLayer;
  patch: string | null;
}

export interface GitFileDiff {
  snapshotId: string;
  path: string;
  originalPath?: string;
  kind: GitChangeKind;
  isBinary: boolean;
  sections: GitDiffSection[];
}

export interface GitLocalBranch {
  name: string;
  headId: string;
  current: boolean;
  upstream?: string;
}

export interface GitRemoteBranch {
  name: string;
  headId: string;
  remote: string;
  branch: string;
}

export interface GitComparableBranch {
  name: string;
  kind: "local" | "remote";
  headId: string;
}

export interface GitBranchesListResult {
  workspaceRoot: string;
  currentBranch: string | null;
  headId: string | null;
  detached: boolean;
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  comparable: GitComparableBranch[];
}

export interface GitBranchSwitchParams {
  branch: string;
}

export interface GitCommitParams {
  message: string;
}

export interface GitCommitResult {
  commitId: string;
  branch: string;
  message: string;
  files: number;
}

export interface GitPushParams {
  confirmed: true;
}

export interface GitPushResult {
  branch: string;
  upstream: string;
  commitId: string;
  pushed: true;
}

export interface GitCompareParams {
  base: string;
}

export interface GitCompareFile {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitCompareResult {
  base: string;
  head: string;
  mergeBase: string;
  files: GitCompareFile[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  summary: string;
  patch: string;
  truncated: boolean;
}

export type GitChangeSelection =
  | { scope: "all"; expectedSnapshotId: string }
  | { scope: "file"; path: string; expectedSnapshotId: string };

export interface GitRestorePreview {
  snapshotId: string;
  selectedPaths: string[];
  restoreFromHeadPaths: string[];
  deletePaths: string[];
  warning?: string;
}

export type GitRestoreRequest = GitChangeSelection & { confirmed: boolean };

export interface GitRestoreResult {
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  remaining: GitChangesSnapshot;
}

export interface GitReviewAcceptance {
  id: string;
  semantics: "review-only";
  snapshotId: string;
  /** Present for Run-owned reviews; omitted by legacy workspace acceptances. */
  runId?: string;
  /** Immutable Run patch snapshot reviewed by this acceptance. */
  runPatchSnapshotId?: string;
  acceptedAt: string;
  scope: GitChangeSelection["scope"];
  paths: string[];
  additions: number;
  deletions: number;
}

export interface GitRunReviewAcceptance extends GitReviewAcceptance {
  runId: string;
  runPatchSnapshotId: string;
}

export interface GitRunBaseline {
  id: string;
  runId: string;
  workspaceRoot: string;
  createdAt: string;
  treeId: string;
  indexSnapshotId: string;
  headId?: string;
  ignoredFilesExcluded: true;
}

export interface GitRunFileChange {
  path: string;
  kind: Exclude<GitChangeKind, "renamed" | "copied" | "unmerged">;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface GitRunPatch {
  id: string;
  runId: string;
  baselineId: string;
  workspaceRoot: string;
  generatedAt: string;
  beforeTreeId: string;
  afterTreeId: string;
  beforeIndexSnapshotId: string;
  afterIndexSnapshotId: string;
  snapshotId: string;
  files: GitRunFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
}

export interface GitRunChangeSelection {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  /** Omit paths to select every path attributed to the Run. */
  paths?: string[];
}

export interface GitRunDiffParams {
  baseline: GitRunBaseline;
  patch: GitRunPatch;
  expectedSnapshotId: string;
  path: string;
}

export interface GitRunFileDiff {
  /** Legacy-compatible snapshot alias. */
  snapshotId: string;
  runId: string;
  runPatchSnapshotId: string;
  beforeTreeId: string;
  afterTreeId: string;
  path: string;
  kind: GitRunFileChange["kind"];
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch: string | null;
}

export const gitRunRestoreConflictReasons = [
  "WORKTREE_CHANGED_AFTER_RUN",
  "INDEX_CHANGED_DURING_RUN",
  "INDEX_CHANGED_AFTER_RUN",
  "INCOMPLETE_PATH_GROUP",
] as const;
export type GitRunRestoreConflictReason = (typeof gitRunRestoreConflictReasons)[number];

export interface GitRunRestoreConflict {
  path?: string;
  reason: GitRunRestoreConflictReason;
  message: string;
}

export type GitRunRestoreSelection = GitRunChangeSelection;

export interface GitRunRestorePreview {
  snapshotId: string;
  currentTreeId: string;
  currentIndexSnapshotId: string;
  selectedPaths: string[];
  restorePaths: string[];
  deletePaths: string[];
  conflicts: GitRunRestoreConflict[];
  warning?: string;
}

export type GitRunRestoreRequest = GitRunRestoreSelection & { confirmed: boolean };

export interface GitRunRestoreResult {
  snapshotId: string;
  attemptedPaths: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  unresolvedPaths: string[];
  beforeTreeId: string;
  afterTreeId: string;
  indexSnapshotId: string;
}

export interface GitRunRestoreRecord {
  id: string;
  runId: string;
  restoredAt: string;
  selectedPaths: string[];
  result: GitRunRestoreResult;
}

export interface ContextSource {
  path: string;
  kind: "instructions" | "selected-file";
  bytes: number;
  exists: boolean;
  sha256: string;
  content?: string;
  truncated: boolean;
  binary: boolean;
}

export interface ContextSnapshot {
  workspaceRoot: string;
  generatedAt: string;
  instructions: ContextSource[];
  selectedFiles: ContextSource[];
  capabilities: string[];
}

export interface ContextSnapshotParams {
  selectedFiles?: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  branch: string;
  lastOpenedAt: string;
  placeholder?: boolean;
}

export interface WorkspaceState {
  active: WorkspaceSummary;
  recent: WorkspaceSummary[];
}

export const persistedTaskStatuses = ["waiting", "blocked", "running", "completed", "failed", "interrupted", "stopped"] as const;
export type PersistedTaskStatus = (typeof persistedTaskStatuses)[number];

export const persistedRunStatuses = [
  "waiting-permission",
  "running",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
] as const;
export type PersistedRunStatus = (typeof persistedRunStatuses)[number];

export const persistedPlanStates = ["pending", "active", "done"] as const;
export type PersistedPlanState = (typeof persistedPlanStates)[number];

export interface PersistedTaskMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  createdAt?: string;
  runId?: string;
  agent?: string;
  adapter?: RunAdapter;
  profileId?: string;
}

export interface PersistedPlanStep {
  label: string;
  state: PersistedPlanState;
}

export interface PersistedRunEvent {
  id: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export const verificationKinds = ["test", "lint", "typecheck", "build", "command"] as const;
export type VerificationKind = (typeof verificationKinds)[number];

export const verificationStatuses = ["passed", "failed", "unknown"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export interface VerificationEvidence {
  id: string;
  runId: string;
  kind: VerificationKind;
  command: string;
  cwd?: string;
  startedAt?: string;
  finishedAt: string;
  exitCode?: number;
  status: VerificationStatus;
  log: string;
  redacted: boolean;
  truncated: boolean;
}

export interface PersistedRun {
  id: string;
  taskId: string;
  adapter: RunAdapter;
  status: PersistedRunStatus;
  prompt: string;
  permissionMode: PermissionMode;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionId?: string;
  profileId?: string;
  agentSnapshot?: AgentProfile;
  contextFiles: string[];
  contextSnapshot?: ContextSnapshot;
  gitBaseline?: GitRunBaseline;
  gitPatch?: GitRunPatch;
  gitRestores: GitRunRestoreRecord[];
  cwd?: string;
  version?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  durationMs?: number;
  costUsd?: number;
  turns?: number;
  error?: string;
  permissionRequests: PermissionRequest[];
  permissionDecisions: PermissionDecision[];
  verifications: VerificationEvidence[];
  events: PersistedRunEvent[];
}

export interface PersistedTask {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  status: PersistedTaskStatus;
  updatedAt: string;
  updatedAtIso?: string;
  createdAt?: string;
  pinned?: boolean;
  archived?: boolean;
  agent: string;
  adapter?: RunAdapter;
  agentProfileId?: string;
  permissionMode?: PermissionMode;
  model: string;
  reasoningEffort?: ReasoningEffort;
  contextFiles?: string[];
  branch: string;
  elapsed: string;
  tokens: string;
  messages: PersistedTaskMessage[];
  plan: PersistedPlanStep[];
  activity: RunActivity[];
  runs: PersistedRun[];
  reviewAcceptances?: GitReviewAcceptance[];
}

export interface WorkspaceTaskState {
  version: 1;
  workspaceId: string;
  tasks: PersistedTask[];
  updatedAt: string;
}

export interface TaskStateLoadParams {
  workspaceId?: string;
}

export interface TaskStateSaveResult {
  workspaceId: string;
  savedAt: string;
}

export interface RuntimeRequestMap {
  "runtime.ping": {
    params: Record<string, never>;
    result: RuntimeStatus;
  };
  "runtime.shutdown": {
    params: RuntimeShutdownParams;
    result: { ok: true };
  };
  "auth.status": {
    params: Record<string, never>;
    result: AuthState;
  };
  "auth.login": {
    params: AuthLoginParams;
    result: AuthState;
  };
  "auth.cancel": {
    params: AuthCancelParams;
    result: { ok: true };
  };
  "terminal.create": {
    params: TerminalCreateParams;
    result: TerminalSession;
  };
  "terminal.write": {
    params: TerminalWriteParams;
    result: { ok: true };
  };
  "terminal.resize": {
    params: TerminalResizeParams;
    result: { ok: true };
  };
  "terminal.dispose": {
    params: TerminalDisposeParams;
    result: { ok: true };
  };
  "agent.list": {
    params: Record<string, never>;
    result: { adapters: AgentAdapterInfo[] };
  };
  "agent.model.list": {
    params: AgentModelListParams;
    result: AgentModelListResult;
  };
  "agent.profile.list": {
    params: Record<string, never>;
    result: { profiles: AgentProfile[] };
  };
  "agent.profile.create": {
    params: AgentProfileInput;
    result: AgentProfile;
  };
  "agent.profile.update": {
    params: AgentProfileUpdateParams;
    result: AgentProfile;
  };
  "agent.profile.delete": {
    params: AgentProfileDeleteParams;
    result: { ok: true };
  };
  "run.start": {
    params: RunStartParams;
    result: { runId: string; adapter: RunAdapter; state: "running" | "waiting-permission" };
  };
  "run.cancel": {
    params: RunCancelParams;
    result: { ok: true };
  };
  "permission.decide": {
    params: PermissionDecideParams;
    result: { ok: true; state: "running" | "cancelled" | "failed" };
  };
  "run.changes.diff": {
    params: GitRunDiffParams;
    result: GitRunFileDiff;
  };
  "run.changes.accept": {
    params: GitRunChangeSelection;
    result: GitRunReviewAcceptance;
  };
  "run.changes.previewRestore": {
    params: GitRunRestoreSelection;
    result: GitRunRestorePreview;
  };
  "run.changes.restore": {
    params: GitRunRestoreRequest;
    result: GitRunRestoreRecord;
  };
  "changes.list": {
    params: Record<string, never>;
    result: GitChangesSnapshot;
  };
  "changes.diff": {
    params: { path: string; expectedSnapshotId: string };
    result: GitFileDiff;
  };
  "changes.previewRestore": {
    params: GitChangeSelection;
    result: GitRestorePreview;
  };
  "changes.restore": {
    params: GitRestoreRequest;
    result: GitRestoreResult;
  };
  "changes.accept": {
    params: GitChangeSelection;
    result: GitReviewAcceptance;
  };
  "git.branches.list": {
    params: Record<string, never>;
    result: GitBranchesListResult;
  };
  "git.branch.switch": {
    params: GitBranchSwitchParams;
    result: GitBranchesListResult;
  };
  "git.commit": {
    params: GitCommitParams;
    result: GitCommitResult;
  };
  "git.push": {
    params: GitPushParams;
    result: GitPushResult;
  };
  "git.compare": {
    params: GitCompareParams;
    result: GitCompareResult;
  };
  "context.snapshot": {
    params: ContextSnapshotParams;
    result: ContextSnapshot;
  };
  "task.state.load": {
    params: TaskStateLoadParams;
    result: WorkspaceTaskState;
  };
  "task.state.save": {
    params: WorkspaceTaskState;
    result: WorkspaceTaskState;
  };
}

export type RuntimeRequest<M extends RuntimeMethod = RuntimeMethod> = M extends RuntimeMethod
  ? {
      kind: "request";
      id: string;
      method: M;
      params: RuntimeRequestMap[M]["params"];
    }
  : never;

export type RuntimeResponse =
  | {
      kind: "response";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      kind: "response";
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export type RuntimeEvent =
  | {
      type: "runtime.ready";
      status: RuntimeStatus;
    }
  | {
      type: "runtime.stopped";
      exitCode: number;
    }
  | {
      type: "terminal.data";
      terminalId: string;
      data: string;
    }
  | {
      type: "terminal.exit";
      terminalId: string;
      exitCode: number;
      signal?: number;
    }
  | {
      type: "run.started";
      runId: string;
      adapter: RunAdapter;
      prompt: string;
      permissionMode?: PermissionMode;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      profileId?: string;
    }
  | {
      type: "run.metadata";
      runId: string;
      sessionId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: string;
      cwd?: string;
      version?: string;
    }
  | {
      type: "run.agent-snapshot";
      runId: string;
      profile: AgentProfile;
    }
  | {
      type: "run.context-snapshot";
      runId: string;
      snapshot: ContextSnapshot;
    }
  | {
      type: "run.git-baseline";
      runId: string;
      baseline: GitRunBaseline;
    }
  | {
      type: "run.git-patch";
      runId: string;
      patch: GitRunPatch;
    }
  | {
      type: "permission.requested";
      runId: string;
      adapter?: RunAdapter;
      prompt?: string;
      permissionMode?: "acceptEdits";
      model?: string;
      reasoningEffort?: ReasoningEffort;
      profileId?: string;
      contextFiles?: string[];
      request: PermissionRequest;
    }
  | {
      type: "permission.decided";
      runId: string;
      decision: PermissionDecision;
    }
  | {
      type: "activity.started" | "activity.completed";
      runId: string;
      activity: RunActivity;
    }
  | {
      type: "assistant.message";
      runId: string;
      text: string;
      itemId?: string;
    }
  | {
      /** Transient assistant text. Clients must not persist individual chunks. */
      type: "assistant.message.delta";
      runId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "assistant.reasoning-summary";
      runId: string;
      text: string;
    }
  | {
      type: "plan.updated";
      runId: string;
      items: Array<{ text: string; completed: boolean }>;
    }
  | {
      type: "run.usage";
      runId: string;
      usage: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
    }
  | {
      type: "run.log";
      runId: string;
      level: "info" | "warning" | "error";
      message: string;
    }
  | {
      type: "verification.recorded";
      runId: string;
      verification: VerificationEvidence;
    }
  | {
      type: "run.completed";
      runId: string;
      durationMs?: number;
      costUsd?: number;
      turns?: number;
    }
  | {
      type: "run.cancelled";
      runId: string;
    }
  | {
      type: "run.failed";
      runId: string;
      error: string;
    };

export type RuntimeWireMessage =
  | RuntimeResponse
  | {
      kind: "event";
      event: RuntimeEvent;
    };

export interface DesktopInfo {
  platform: NodeJS.Platform;
  version: string;
  isPackaged: boolean;
}

export const workspaceOpenTargets = ["vscode", "finder"] as const;
export type WorkspaceOpenTarget = (typeof workspaceOpenTargets)[number];

export interface WorkspaceOpenParams {
  target?: WorkspaceOpenTarget;
}

export interface WorkspaceOpenResult {
  opened: boolean;
  target: WorkspaceOpenTarget;
  detail?: string;
}

export interface RuxDesktopApi {
  getDesktopInfo(): Promise<DesktopInfo>;
  getWorkspaceState(): Promise<WorkspaceState>;
  chooseWorkspace(): Promise<WorkspaceState | null>;
  activateWorkspace(path: string): Promise<WorkspaceState>;
  openWorkspaceLocation(target?: WorkspaceOpenTarget): Promise<WorkspaceOpenResult>;
  loadTaskState(workspaceId?: string): Promise<WorkspaceTaskState>;
  saveTaskState(state: WorkspaceTaskState): Promise<TaskStateSaveResult>;
  request<M extends RendererRuntimeMethod>(
    method: M,
    params: RuntimeRequestMap[M]["params"],
  ): Promise<RuntimeRequestMap[M]["result"]>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}

export const runtimeRequestSchema = z.object({
  kind: z.literal("request"),
  id: z.string().min(1).max(120),
  method: z.enum(runtimeMethods),
  params: z.unknown(),
});

export const runtimeShutdownParamsSchema = z.object({
  reason: z.string().trim().min(1).max(160),
}).strict();

export const terminalCreateParamsSchema = z.object({
  cwd: z.string().min(1).optional(),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});

export const terminalWriteParamsSchema = z.object({
  terminalId: z.string().min(1),
  data: z.string().max(1_000_000),
});

export const terminalResizeParamsSchema = z.object({
  terminalId: z.string().min(1),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});

export const terminalDisposeParamsSchema = z.object({
  terminalId: z.string().min(1),
});

export const authLoginParamsSchema = z.object({
  provider: z.enum(authProviderIds),
});

export const agentModelListParamsSchema = z.object({
  adapter: z.literal("codex"),
  cursor: z.string().min(1).max(4_096).nullable().optional(),
  limit: z.number().int().min(1).max(500).nullable().optional(),
  includeHidden: z.boolean().nullable().optional(),
}).strict();

export const codexReasoningEffortOptionSchema = z.object({
  reasoningEffort: reasoningEffortSchema,
  description: z.string().max(2_000),
}).strict();

export const codexModelInfoSchema = z.object({
  id: z.string().trim().min(1).max(240),
  model: z.string().trim().min(1).max(240),
  displayName: z.string().trim().min(1).max(240),
  description: z.string().max(4_000),
  isDefault: z.boolean(),
  defaultReasoningEffort: reasoningEffortSchema,
  supportedReasoningEfforts: z.array(codexReasoningEffortOptionSchema).max(64),
}).strict();

export const agentModelListResultSchema = z.object({
  adapter: z.literal("codex"),
  models: z.array(codexModelInfoSchema).max(500),
  nextCursor: z.string().min(1).max(4_096).nullable().optional(),
}).strict();

export const runStartParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  adapter: z.enum(runAdapters),
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).max(120).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  permissionMode: z.enum(permissionModes),
  sessionId: z.string().min(1).max(500).optional(),
  profileId: z.string().min(1).max(120).optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(500).default([]),
}).strict();

export const runCancelParamsSchema = z.object({
  runId: z.string().min(1).max(120),
}).strict();

export const permissionDecideParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(160),
  decision: z.enum(["approved", "denied"]),
}).strict();

const agentIdentifierSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._/-]*$/i);
const agentProfileNameSchema = z.string().trim().min(1).max(80);
const agentProfileDescriptionSchema = z.string().trim().max(400);
const agentProfileModelSchema = z.string().trim().min(1).max(120);
const agentProfileInstructionsSchema = z.string().trim().min(1).max(20_000);
const agentProfileSkillIdsSchema = z.array(agentIdentifierSchema).max(64);
const agentProfileToolIdsSchema = z.array(agentIdentifierSchema).max(64);

export const agentProfileInputSchema = z.object({
  name: agentProfileNameSchema,
  description: agentProfileDescriptionSchema.default(""),
  backend: z.enum(agentBackends),
  model: agentProfileModelSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  instructions: agentProfileInstructionsSchema,
  permissionMode: z.enum(permissionModes).default("acceptEdits"),
  skillIds: agentProfileSkillIdsSchema.default([]),
  toolIds: agentProfileToolIdsSchema.default([]),
  enabled: z.boolean().default(true),
}).strict();

export const agentProfileSchema = agentProfileInputSchema.extend({
  id: z.string().regex(/^custom-[a-f0-9-]{36}$/),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const agentProfilePatchSchema = z.object({
  name: agentProfileNameSchema.optional(),
  description: agentProfileDescriptionSchema.optional(),
  backend: z.enum(agentBackends).optional(),
  model: agentProfileModelSchema.optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  instructions: agentProfileInstructionsSchema.optional(),
  permissionMode: z.enum(permissionModes).optional(),
  skillIds: agentProfileSkillIdsSchema.optional(),
  toolIds: agentProfileToolIdsSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

export const agentProfileUpdateParamsSchema = z.object({
  id: z.string().min(1).max(120),
  patch: agentProfilePatchSchema,
}).strict();

export const agentProfileDeleteParamsSchema = z.object({
  id: z.string().min(1).max(120),
}).strict();

export const gitChangeSelectionSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    scope: z.literal("file"),
    path: z.string().min(1).max(4096),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
]);

export const gitDiffParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const gitObjectIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const gitBranchNameSchema = z.string().trim().min(1).max(1_024).refine(
  (value) => !value.includes("\0") && !value.includes("\n") && !value.includes("\r"),
  "Git branch name contains unsupported control characters",
);

export const gitEmptyParamsSchema = z.object({}).strict();

export const gitBranchSwitchParamsSchema = z.object({
  branch: gitBranchNameSchema,
}).strict();

export const gitCommitParamsSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
}).strict();

export const gitPushParamsSchema = z.object({
  confirmed: z.literal(true),
}).strict();

export const gitCompareParamsSchema = z.object({
  base: gitBranchNameSchema,
}).strict();

export const gitBranchesListResultSchema = z.object({
  workspaceRoot: z.string().min(1).max(4_096),
  currentBranch: gitBranchNameSchema.nullable(),
  headId: gitObjectIdSchema.nullable(),
  detached: z.boolean(),
  local: z.array(z.object({
    name: gitBranchNameSchema,
    headId: gitObjectIdSchema,
    current: z.boolean(),
    upstream: gitBranchNameSchema.optional(),
  }).strict()).max(20_000),
  remote: z.array(z.object({
    name: gitBranchNameSchema,
    headId: gitObjectIdSchema,
    remote: gitBranchNameSchema,
    branch: gitBranchNameSchema,
  }).strict()).max(20_000),
  comparable: z.array(z.object({
    name: gitBranchNameSchema,
    kind: z.enum(["local", "remote"]),
    headId: gitObjectIdSchema,
  }).strict()).max(40_000),
}).strict();

export const gitCommitResultSchema = z.object({
  commitId: gitObjectIdSchema,
  branch: gitBranchNameSchema,
  message: z.string().min(1).max(10_000),
  files: z.number().int().min(1).max(1_000_000),
}).strict();

export const gitPushResultSchema = z.object({
  branch: gitBranchNameSchema,
  upstream: gitBranchNameSchema,
  commitId: gitObjectIdSchema,
  pushed: z.literal(true),
}).strict();

const gitCompareFileSchema = z.object({
  path: z.string().min(1).max(4_096),
  kind: z.enum(["added", "modified", "deleted", "type-changed", "unknown"]),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  isBinary: z.boolean(),
}).strict();

export const gitCompareResultSchema = z.object({
  base: gitBranchNameSchema,
  head: gitObjectIdSchema,
  mergeBase: gitObjectIdSchema,
  files: z.array(gitCompareFileSchema).max(1_000_000),
  totals: z.object({
    files: z.number().int().min(0),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    binaryFiles: z.number().int().min(0),
  }).strict(),
  summary: z.string().max(4_096),
  patch: z.string().max(1_100_000),
  truncated: z.boolean(),
}).strict();

export const gitRestoreRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.boolean(),
  }).strict(),
  z.object({
    scope: z.literal("file"),
    path: z.string().min(1).max(4096),
    expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.boolean(),
  }).strict(),
]);

export const contextSnapshotParamsSchema = z.object({
  selectedFiles: z.array(z.string().min(1).max(4096)).max(200).optional(),
}).strict();

export const workspaceActivateParamsSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const workspaceOpenParamsSchema = z.object({
  target: z.enum(workspaceOpenTargets).default("vscode"),
}).strict();

const persistedIsoDateSchema = z.iso.datetime({ offset: true });
export const persistedWorkspaceIdSchema = z.string().min(1).max(120);

export const permissionScopeSchema = z.object({
  kind: z.enum(["workspace", "tool"]),
  path: z.string().min(1).max(4_096),
  appliesTo: z.enum(["this-run", "single-action"]),
}).strict();

export const permissionRequestSchema = z.object({
  id: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  action: z.enum(permissionActions),
  scope: permissionScopeSchema,
  impact: z.string().min(1).max(2_000),
  provider: z.enum(runAdapters).optional(),
  providerRequestId: z.string().min(1).max(240).optional(),
  toolName: z.string().min(1).max(240).optional(),
  requestedAt: persistedIsoDateSchema,
  status: z.enum(permissionRequestStatuses),
}).strict();

export const permissionDecisionSchema = z.object({
  id: z.string().min(1).max(160),
  requestId: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  decision: z.enum(permissionDecisionValues),
  source: z.enum(["user", "runtime"]),
  decidedAt: persistedIsoDateSchema,
}).strict();

export const contextSourceSchema = z.object({
  path: z.string().min(1).max(4_096),
  kind: z.enum(["instructions", "selected-file"]),
  bytes: z.number().int().nonnegative(),
  exists: z.boolean(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(100_000).optional(),
  truncated: z.boolean(),
  binary: z.boolean(),
}).strict();

export const contextSnapshotSchema = z.object({
  workspaceRoot: z.string().min(1).max(4_096),
  generatedAt: persistedIsoDateSchema,
  instructions: z.array(contextSourceSchema).max(32),
  selectedFiles: z.array(contextSourceSchema).max(200),
  capabilities: z.array(z.string().min(1).max(240)).max(500),
}).strict();

const gitTreeIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

export const gitRunBaselineSchema = z.object({
  id: z.string().min(1).max(120),
  runId: z.string().min(1).max(120),
  workspaceRoot: z.string().min(1).max(4_096),
  createdAt: persistedIsoDateSchema,
  treeId: gitTreeIdSchema,
  indexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  headId: gitTreeIdSchema.optional(),
  ignoredFilesExcluded: z.literal(true),
}).strict();

export const gitRunPatchSchema = z.object({
  id: z.string().min(1).max(120),
  runId: z.string().min(1).max(120),
  baselineId: z.string().min(1).max(120),
  workspaceRoot: z.string().min(1).max(4_096),
  generatedAt: persistedIsoDateSchema,
  beforeTreeId: gitTreeIdSchema,
  afterTreeId: gitTreeIdSchema,
  beforeIndexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  afterIndexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({
    path: z.string().min(1).max(4_096),
    kind: z.enum(["added", "modified", "deleted", "type-changed", "unknown"]),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    isBinary: z.boolean(),
  }).strict()).max(20_000),
  totals: z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaryFiles: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const gitRunSelectionShape = {
  baseline: gitRunBaselineSchema,
  patch: gitRunPatchSchema,
  expectedSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
} as const;

export const gitRunChangeSelectionSchema = z.object({
  ...gitRunSelectionShape,
  paths: z.array(z.string().min(1).max(4_096)).max(20_000).optional(),
}).strict();

export const gitRunDiffParamsSchema = z.object({
  ...gitRunSelectionShape,
  path: z.string().min(1).max(4_096),
}).strict();

export const gitRunRestoreSelectionSchema = gitRunChangeSelectionSchema;

export const gitRunRestoreRequestSchema = gitRunRestoreSelectionSchema.extend({
  confirmed: z.boolean(),
}).strict();

const gitReviewAcceptanceShape = {
  id: z.string().min(1).max(120),
  semantics: z.literal("review-only"),
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedAt: persistedIsoDateSchema,
  scope: z.enum(["all", "file"]),
  paths: z.array(z.string().min(1).max(4_096)).max(20_000),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
} as const;

/** Accepts historical workspace-only records and new Run-bound records. */
export const gitReviewAcceptanceSchema = z.object({
  ...gitReviewAcceptanceShape,
  runId: z.string().min(1).max(120).optional(),
  runPatchSnapshotId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((acceptance, context) => {
  if (Boolean(acceptance.runId) !== Boolean(acceptance.runPatchSnapshotId)) {
    context.addIssue({
      code: "custom",
      path: acceptance.runId ? ["runPatchSnapshotId"] : ["runId"],
      message: "Run review acceptance must include both Run binding fields",
    });
  }
});

/** Runtime-generated Run acceptances must always carry immutable Run binding. */
export const gitRunReviewAcceptanceSchema = z.object({
  ...gitReviewAcceptanceShape,
  runId: z.string().min(1).max(120),
  runPatchSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const gitRunRestoreResultSchema = z.object({
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  attemptedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  restoredPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  deletedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  unresolvedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  beforeTreeId: gitTreeIdSchema,
  afterTreeId: gitTreeIdSchema,
  indexSnapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const gitRunRestoreRecordSchema = z.object({
  id: z.string().min(1).max(160),
  runId: z.string().min(1).max(120),
  restoredAt: persistedIsoDateSchema,
  selectedPaths: z.array(z.string().min(1).max(4_096)).max(20_000),
  result: gitRunRestoreResultSchema,
}).strict();

export const persistedTaskMessageSchema = z.object({
  id: z.string().min(1).max(240),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(1_000_000),
  time: z.string().max(120),
  createdAt: persistedIsoDateSchema.optional(),
  runId: z.string().min(1).max(120).optional(),
  agent: z.string().min(1).max(240).optional(),
  adapter: z.enum(runAdapters).optional(),
  profileId: z.string().min(1).max(120).optional(),
}).strict();

export const persistedPlanStepSchema = z.object({
  label: z.string().min(1).max(2_000),
  state: z.enum(persistedPlanStates),
}).strict();

export const persistedRunActivitySchema = z.object({
  id: z.string().min(1).max(240),
  kind: z.enum(["read", "edit", "command", "tool", "retry"]),
  title: z.string().max(10_000),
  detail: z.string().max(100_000),
  state: z.enum(["active", "done", "error"]),
}).strict();

export const persistedRunEventSchema = z.object({
  id: z.string().min(1).max(300),
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(120),
  occurredAt: persistedIsoDateSchema,
  payload: z.record(z.string(), z.unknown()),
}).strict();

export const verificationEvidenceSchema = z.object({
  id: z.string().min(1).max(240),
  runId: z.string().min(1).max(120),
  kind: z.enum(verificationKinds),
  command: z.string().min(1).max(20_000),
  cwd: z.string().min(1).max(4_096).optional(),
  startedAt: persistedIsoDateSchema.optional(),
  finishedAt: persistedIsoDateSchema,
  exitCode: z.number().int().optional(),
  status: z.enum(verificationStatuses),
  log: z.string().max(100_000),
  redacted: z.boolean(),
  truncated: z.boolean(),
}).strict().superRefine((evidence, context) => {
  if (evidence.exitCode === 0 && evidence.status !== "passed") {
    context.addIssue({ code: "custom", path: ["status"], message: "Exit code 0 must be passed" });
  }
  if (evidence.exitCode !== undefined && evidence.exitCode !== 0 && evidence.status !== "failed") {
    context.addIssue({ code: "custom", path: ["status"], message: "Non-zero exit code must be failed" });
  }
});

export const persistedRunSchema = z.object({
  id: z.string().min(1).max(120),
  taskId: z.string().min(1).max(240),
  adapter: z.enum(runAdapters),
  status: z.enum(persistedRunStatuses),
  prompt: z.string().max(100_000),
  permissionMode: z.enum(permissionModes),
  model: z.string().max(120).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  sessionId: z.string().max(500).optional(),
  profileId: z.string().max(120).optional(),
  agentSnapshot: agentProfileSchema.optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(500).default([]),
  contextSnapshot: contextSnapshotSchema.optional(),
  gitBaseline: gitRunBaselineSchema.optional(),
  gitPatch: gitRunPatchSchema.optional(),
  gitRestores: z.array(gitRunRestoreRecordSchema).max(2_000).default([]),
  cwd: z.string().max(4096).optional(),
  version: z.string().max(120).optional(),
  startedAt: persistedIsoDateSchema,
  updatedAt: persistedIsoDateSchema,
  finishedAt: persistedIsoDateSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  error: z.string().max(100_000).optional(),
  permissionRequests: z.array(permissionRequestSchema).max(10_000).default([]),
  permissionDecisions: z.array(permissionDecisionSchema).max(10_000).default([]),
  verifications: z.array(verificationEvidenceSchema).max(20_000).default([]),
  events: z.array(persistedRunEventSchema).max(50_000),
}).strict().superRefine((run, context) => {
  if (run.gitBaseline && run.gitBaseline.runId !== run.id) {
    context.addIssue({ code: "custom", path: ["gitBaseline", "runId"], message: "Git baseline runId must match its parent Run" });
  }
  if (run.gitPatch && run.gitPatch.runId !== run.id) {
    context.addIssue({ code: "custom", path: ["gitPatch", "runId"], message: "Git patch runId must match its parent Run" });
  }
  if (run.gitPatch && run.gitBaseline && run.gitPatch.baselineId !== run.gitBaseline.id) {
    context.addIssue({ code: "custom", path: ["gitPatch", "baselineId"], message: "Git patch must reference the persisted Run baseline" });
  }
  run.gitRestores.forEach((restore, index) => {
    if (restore.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["gitRestores", index, "runId"],
        message: "Run restore runId must match its parent Run",
      });
    }
  });
  run.permissionRequests.forEach((request, index) => {
    if (request.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["permissionRequests", index, "runId"],
        message: "Permission request runId must match its parent Run",
      });
    }
  });
  run.permissionDecisions.forEach((decision, index) => {
    if (decision.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["permissionDecisions", index, "runId"],
        message: "Permission decision runId must match its parent Run",
      });
    }
    if (!run.permissionRequests.some((request) => request.id === decision.requestId)) {
      context.addIssue({
        code: "custom",
        path: ["permissionDecisions", index, "requestId"],
        message: "Permission decision must reference a request in the same Run",
      });
    }
  });
  run.verifications.forEach((verification, index) => {
    if (verification.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["verifications", index, "runId"],
        message: "Verification runId must match its parent Run",
      });
    }
  });
});

export const persistedTaskSchema = z.object({
  id: z.string().min(1).max(240),
  workspaceId: persistedWorkspaceIdSchema,
  title: z.string().min(1).max(10_000),
  preview: z.string().max(100_000),
  status: z.enum(persistedTaskStatuses),
  updatedAt: z.string().max(120),
  updatedAtIso: persistedIsoDateSchema.optional(),
  createdAt: persistedIsoDateSchema.optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  agent: z.string().min(1).max(240),
  adapter: z.enum(runAdapters).optional(),
  agentProfileId: z.string().min(1).max(120).optional(),
  permissionMode: z.enum(permissionModes).optional(),
  model: z.string().min(1).max(240),
  reasoningEffort: reasoningEffortSchema.optional(),
  contextFiles: z.array(z.string().min(1).max(4_096)).max(200).default([]),
  branch: z.string().max(1_000),
  elapsed: z.string().max(120),
  tokens: z.string().max(120),
  messages: z.array(persistedTaskMessageSchema).max(20_000),
  plan: z.array(persistedPlanStepSchema).max(1_000),
  activity: z.array(persistedRunActivitySchema).max(20_000),
  runs: z.array(persistedRunSchema).max(2_000).default([]),
  reviewAcceptances: z.array(gitReviewAcceptanceSchema).max(2_000).default([]),
}).strict().superRefine((task, context) => {
  task.reviewAcceptances.forEach((acceptance, index) => {
    if (!acceptance.runId || !acceptance.runPatchSnapshotId) return;
    const run = task.runs.find((candidate) => candidate.id === acceptance.runId);
    if (!run?.gitPatch) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "runId"],
        message: "Run review acceptance must reference a Run patch in the same Task",
      });
      return;
    }
    if (
      acceptance.snapshotId !== acceptance.runPatchSnapshotId
      || run.gitPatch.snapshotId !== acceptance.runPatchSnapshotId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "runPatchSnapshotId"],
        message: "Run review acceptance snapshot must match its persisted Run patch",
      });
      return;
    }
    const patchFiles = new Map(run.gitPatch.files.map((file) => [file.path, file]));
    const reviewedFiles = acceptance.paths.map((path) => patchFiles.get(path));
    if (reviewedFiles.some((file) => !file)) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index, "paths"],
        message: "Run review acceptance paths must belong to its persisted Run patch",
      });
      return;
    }
    const additions = reviewedFiles.reduce((sum, file) => sum + (file?.additions ?? 0), 0);
    const deletions = reviewedFiles.reduce((sum, file) => sum + (file?.deletions ?? 0), 0);
    if (acceptance.additions !== additions || acceptance.deletions !== deletions) {
      context.addIssue({
        code: "custom",
        path: ["reviewAcceptances", index],
        message: "Run review acceptance stats must match its reviewed Run patch paths",
      });
    }
  });
});

export const workspaceTaskStateSchema = z.object({
  version: z.literal(1),
  workspaceId: persistedWorkspaceIdSchema,
  tasks: z.array(persistedTaskSchema).max(20_000),
  updatedAt: persistedIsoDateSchema,
}).strict().superRefine((state, context) => {
  state.tasks.forEach((task, taskIndex) => {
    if (task.workspaceId !== state.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["tasks", taskIndex, "workspaceId"],
        message: "Task workspaceId must match its workspace snapshot",
      });
    }
    task.runs.forEach((run, runIndex) => {
      if (run.taskId !== task.id) {
        context.addIssue({
          code: "custom",
          path: ["tasks", taskIndex, "runs", runIndex, "taskId"],
          message: "Run taskId must match its parent task",
        });
      }
    });
  });
});

export const taskStateLoadParamsSchema = z.object({
  workspaceId: persistedWorkspaceIdSchema.optional(),
}).strict();
